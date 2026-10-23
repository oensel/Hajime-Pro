import { test } from 'node:test';
import assert from 'node:assert/strict';
import { starteTestPostgres } from '../helpers/testPostgres.js';

process.env.BETRIEBSMODUS = 'cloud';
delete process.env.IS_OFFLINE;
delete process.env.SYNC_ROLLE;

const { filtereSichtbareTurniere, darfTurnierSehen, normalisiereSichtbarkeit } = await import('../../src/services/turnierSichtbarkeit.js');
const { legeVereinAn } = await import('../../src/services/vereinsVerwaltung.js');
const { ladeBenutzerMitAktivemVerein } = await import('../../src/utils/vereinHelper.js');

const id = (r) => (typeof r === 'object' ? r.id : r);

test('normalisiereSichtbarkeit: unbekannte Werte fallen auf den Standard', () => {
    assert.equal(normalisiereSichtbarkeit('eingeladen'), 'eingeladen');
    assert.equal(normalisiereSichtbarkeit('quatsch'), 'alle');
    assert.equal(normalisiereSichtbarkeit(undefined, 'bundesland'), 'bundesland');
});

test('Vereine und Sichtbarkeit von Turnieren', async () => {
    const db = await starteTestPostgres();
    const { knex } = db;
    try {
        // Neue Vereine bekommen Nordrhein-Westfalen, Bestand ohne Bundesland wurde durch die Migration gefüllt
        const neu = await legeVereinAn(knex, { name: 'JC Neu' });
        assert.equal(neu.verein.bundesland, 'Nordrhein-Westfalen');
        assert.equal((await knex('vereine').insert({ name: 'JC Direkt' }).returning('bundesland'))[0].bundesland, 'Nordrhein-Westfalen');

        const ausrichter = id((await knex('vereine').insert({ name: 'JC Ausrichter' }).returning('id'))[0]);
        const nrw = id((await knex('vereine').insert({ name: 'JC NRW' }).returning('id'))[0]);
        const bayern = id((await knex('vereine').insert({ name: 'JC Bayern', bundesland: 'Bayern' }).returning('id'))[0]);
        const lade = async (benutzer, vereinId) => {
            await knex('benutzer').insert({ id: benutzer, email: `${benutzer}@test.de`, vorname: benutzer, nachname: 'T', aktiver_verein_id: vereinId });
            await knex('benutzer_vereine').insert({ benutzer_id: benutzer, verein_id: vereinId, freigegeben: 1, rolle: 'benutzer' });
            return ladeBenutzerMitAktivemVerein(knex, benutzer);
        };
        const uAusrichter = await lade('u-aus', ausrichter);
        const uNrw = await lade('u-nrw', nrw);
        const uBayern = await lade('u-bay', bayern);

        const turnier = async (sichtbarkeit, extra = {}) => {
            const zeile = { bezeichnung: `T-${sichtbarkeit}`, ort: 'X', ausrichter: 'JC Ausrichter', datum: '2026-12-01', verein_id: ausrichter, status: 'veroeffentlicht', sichtbarkeit, ...extra };
            const eingefuegt = id((await knex('turniere').insert(zeile).returning('id'))[0]);
            return knex('turniere').where({ id: eingefuegt }).first();
        };
        const tAlle = await turnier('alle');
        const tLand = await turnier('bundesland');
        const tEinl = await turnier('eingeladen');
        const tLandBay = await turnier('bundesland', { bundesland: 'Bayern', datum: '2026-12-02' });
        const alle = [tAlle, tLand, tEinl, tLandBay];
        const namen = async (user) => (await filtereSichtbareTurniere(knex, user, alle)).map((t) => t.sichtbarkeit + (t.bundesland ? ':' + t.bundesland : ''));

        // Ausrichter sieht alles
        assert.equal((await namen(uAusrichter)).length, 4);
        // NRW-Verein: Bundesland-Turnier des (NRW-)Ausrichters, aber nicht das bayerische und nicht das Einladungs-Turnier
        assert.deepEqual(await namen(uNrw), ['alle', 'bundesland']);
        // Bayerischer Verein: nur "alle" und das Turnier, das in Bayern stattfindet
        assert.deepEqual(await namen(uBayern), ['alle', 'bundesland:Bayern']);

        // Einladung öffnet das Einladungs-Turnier genau für den eingeladenen Verein
        await knex('turnier_einladungen').insert({ turnier_id: tEinl.id, verein_id: bayern });
        assert.deepEqual(await namen(uBayern), ['alle', 'eingeladen', 'bundesland:Bayern']);
        assert.equal(await darfTurnierSehen(knex, uNrw, tEinl), false);
        assert.equal(await darfTurnierSehen(knex, uBayern, tEinl), true);
    } finally {
        await db.stoppe();
    }
});
