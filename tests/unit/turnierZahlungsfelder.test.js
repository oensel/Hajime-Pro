import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { starteTestPostgres } from '../helpers/testPostgres.js';

pg.types.setTypeParser(1082, (val) => val);
process.env.BETRIEBSMODUS = 'cloud';
delete process.env.IS_OFFLINE;
delete process.env.SYNC_ROLLE;
process.env.ZAHLUNGSDATEN_SCHLUESSEL = 'turnier-test-schluessel-mit-mindestens-32-zeichen';

const { createTurnier, updateTurnier, importiereTurnierDaten, baueTurnierExport } = await import('../../src/controllers/turnierController.js');
const { speichereStammdaten } = await import('../../src/services/abrechnungStammdaten.js');

const id = (r) => (typeof r === 'object' ? r.id : r);

function aufruf(fn, knex, req) {
    return new Promise((resolve, reject) => {
        const res = { status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code || 200, ...b }); return this; } };
        fn(knex, { app: { get: () => null }, params: {}, ...req }, res).catch(reject);
    });
}

test('Turnier: Zahlungskonto aus den Abrechnungsdaten, Zahlungsziel und Hinweistext', async () => {
    const { knex, stoppe } = await starteTestPostgres();
    try {
        const vMit = id((await knex('vereine').insert({ name: 'JC Mit' }).returning('id'))[0]);
        const vOhne = id((await knex('vereine').insert({ name: 'JC Ohne' }).returning('id'))[0]);
        for (const [n, v] of [['mit', vMit], ['ohne', vOhne]]) {
            await knex('benutzer').insert({ id: `u-${n}`, email: `${n}@test.de`, vorname: n, nachname: 'T', email_bestaetigt_am: knex.fn.now(), aktiver_verein_id: v });
            await knex('benutzer_vereine').insert({ benutzer_id: `u-${n}`, verein_id: v, freigegeben: 1, rolle: 'admin' });
        }
        await speichereStammdaten(knex, vMit, { iban: 'DE89370400440532013000', kontoinhaber: 'JC Mit e.V.' }, 'u-mit');
        const basis = { bezeichnung: 'Cup', ort: 'Halle', ausrichter: 'JC', datum: '2031-05-01', anzahl_kampfflaechen: 1, startgeld: 8 };
        const legeAn = (benutzer, extra = {}) => aufruf(createTurnier, knex, { user: { id: benutzer }, body: { ...basis, ...extra } });

        let r = await legeAn('u-mit');
        assert.equal(r.code, 201, JSON.stringify(r));
        const t = r.turnierId;
        assert.equal((await knex('turniere').where({ id: t }).first()).zahlungsziel_tage, 14);

        r = await legeAn('u-ohne');
        assert.equal(r.code, 400);
        assert.equal(r.error, 'Wenn ein Startgeld verlangt wird, braucht es IBAN und Kontoinhaber im Turnier oder in den Abrechnungsdaten des Vereins.');
        // Turnier-IBAN genügt, Verwendungszweck ist in der Cloud nicht nötig
        r = await legeAn('u-ohne', { iban: 'DE89370400440532013000', kontoinhaber: 'X' });
        assert.equal(r.code, 201, JSON.stringify(r));

        r = await legeAn('u-mit', { zahlungsziel_tage: 0 });
        assert.equal(r.code, 400);
        assert.equal(r.error, 'Das Zahlungsziel muss zwischen 1 und 90 Tagen liegen.');
        assert.equal((await legeAn('u-mit', { zahlungsziel_tage: 91 })).code, 400);
        r = await legeAn('u-mit', { zahlungsziel_tage: 30, rechnung_hinweis: '  Danke  ' });
        assert.equal(r.code, 201);
        const z = await knex('turniere').where({ id: r.turnierId }).first();
        assert.equal(z.zahlungsziel_tage, 30);
        assert.equal(z.rechnung_hinweis, 'Danke');
        assert.equal((await legeAn('u-mit', { rechnung_hinweis: 'x'.repeat(1001) })).code, 400);

        // Update: Konto kommt aus dem Verein des Turniers
        const upd = (extra) => aufruf(updateTurnier, knex, { params: { id: String(t) }, user: { id: 'u-mit' }, body: { ...basis, ...extra } });
        assert.equal((await upd({ zahlungsziel_tage: 45 })).code, 200);
        assert.equal((await knex('turniere').where({ id: t }).first()).zahlungsziel_tage, 45);
        assert.equal((await upd({ zahlungsziel_tage: 0 })).code, 400);
        await knex('vereins_abrechnung').where({ verein_id: vMit }).delete();
        assert.equal((await upd({})).code, 400);
    } finally {
        await stoppe();
    }
});

test('Turnier: Export und Import tragen Zahlungsziel und Hinweistext, ungültige Werte werden 14/null', async () => {
    const quelle = await starteTestPostgres();
    const ziel = await starteTestPostgres();
    try {
        const v = id((await quelle.knex('vereine').insert({ name: 'JC Q' }).returning('id'))[0]);
        const t = id((await quelle.knex('turniere').insert({
            bezeichnung: 'Cup', ort: 'O', datum: '2031-06-01', ausrichter: 'JC Q', verein_id: v,
            zahlungsziel_tage: 21, rechnung_hinweis: 'Bitte pünktlich'
        }).returning('id'))[0]);
        const daten = JSON.parse(JSON.stringify(await baueTurnierExport(quelle.knex, t)));
        assert.equal(daten.turnier.zahlungsziel_tage, 21);
        assert.equal(daten.turnier.rechnung_hinweis, 'Bitte pünktlich');
        let r = await importiereTurnierDaten(ziel.knex, null, daten);
        let z = await ziel.knex('turniere').where({ id: r.turnierId }).first();
        assert.equal(z.zahlungsziel_tage, 21);
        assert.equal(z.rechnung_hinweis, 'Bitte pünktlich');

        const uebergaben = [
            [{ zahlungsziel_tage: 0, rechnung_hinweis: '   ' }, 14, null],
            [{ zahlungsziel_tage: 500, rechnung_hinweis: 'x'.repeat(1001) }, 14, null],
            [{ zahlungsziel_tage: 'abc', rechnung_hinweis: 42 }, 14, null],
            [{}, 14, null]
        ];
        for (const [werte, tage, hinweis] of uebergaben) {
            const kopie = JSON.parse(JSON.stringify(daten));
            kopie.turnier.zahlungsziel_tage = undefined;
            kopie.turnier.rechnung_hinweis = undefined;
            Object.assign(kopie.turnier, werte);
            r = await importiereTurnierDaten(ziel.knex, null, kopie);
            z = await ziel.knex('turniere').where({ id: r.turnierId }).first();
            assert.equal(z.zahlungsziel_tage, tage, JSON.stringify(werte));
            assert.equal(z.rechnung_hinweis, hinweis, JSON.stringify(werte));
        }
    } finally {
        await quelle.stoppe();
        await ziel.stoppe();
    }
});
