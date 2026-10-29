import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import pg from 'pg';
import { starteTestPostgres } from '../helpers/testPostgres.js';

// wie src/app.js: DATE-Spalten als Text
pg.types.setTypeParser(1082, (val) => val);

process.env.BETRIEBSMODUS = 'cloud';
delete process.env.IS_OFFLINE;
delete process.env.SYNC_ROLLE;
process.env.JWT_SECRET = 'rechnungen-uebersicht-test-geheimnis';

const jwt = (await import('jsonwebtoken')).default;
const { getAbrechnungRoutes } = await import('../../src/routes/abrechnungRoutes.js');
const { ladeRechnungenDesVereins } = await import('../../src/services/rechnungenUebersicht.js');

const id = (r) => (typeof r === 'object' ? r.id : r);

test('Rechnungen des Vereins: nur eigene, nur für Admins, ohne PDF, mit Anzeigestatus', async () => {
    const db = await starteTestPostgres();
    const { knex } = db;
    const app = express();
    app.set('knex', knex);
    app.use(express.json());
    app.use('/api/abrechnung', getAbrechnungRoutes(knex));
    const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const basis = `http://127.0.0.1:${server.address().port}`;
    const aufruf = async (benutzerId, pfad) => {
        const res = await fetch(basis + pfad, {
            headers: benutzerId ? { Authorization: `Bearer ${jwt.sign({ id: benutzerId }, process.env.JWT_SECRET)}` } : {}
        });
        return { status: res.status, daten: await res.json().catch(() => null) };
    };
    try {
        const vA = id((await knex('vereine').insert({ name: 'JC A' }).returning('id'))[0]);
        const vB = id((await knex('vereine').insert({ name: 'JC B' }).returning('id'))[0]);
        for (const [n, v, rolle] of [['admin', vA, 'admin'], ['benutzer', vA, 'benutzer'], ['fremd', vB, 'admin']]) {
            await knex('benutzer').insert({ id: `u-${n}`, email: `${n}@test.de`, vorname: n, nachname: 'T', email_bestaetigt_am: knex.fn.now(), aktiver_verein_id: v });
            await knex('benutzer_vereine').insert({ benutzer_id: `u-${n}`, verein_id: v, freigegeben: 1, rolle });
        }
        const rechnung = (vereinId, nummer, extra = {}) => knex('rechnungen').insert({
            aussteller_verein_id: vereinId, verein_name: 'JC Senden', zahlweg: 'ueberweisung', art: 'rechnung', nummer,
            rechnungsdatum: '2026-11-02', anzahl: 4, einzelpreis_cent: 800, betrag_cent: 3200, status: 'versandt',
            positionen: JSON.stringify([]), empfaenger: JSON.stringify({}), aussteller: JSON.stringify({}),
            turnier_bezeichnung: 'Herbstpokal', pdf: Buffer.from('%PDF-test'), ...extra
        });
        await rechnung(vA, 'A-00001', { zahlungsziel_datum: '2026-11-16' });
        await rechnung(vA, 'A-00002', { rechnungsdatum: '2026-11-05', status: 'bezahlt', zahlweg: 'bar' });
        await rechnung(vB, 'B-00001');

        const ok = await aufruf('u-admin', `/api/abrechnung/verein/${vA}/rechnungen`);
        assert.equal(ok.status, 200);
        assert.deepEqual(ok.daten.rechnungen.map((r) => r.nummer), ['A-00002', 'A-00001'], 'neueste zuerst, nur der eigene Verein');
        assert.equal(ok.daten.rechnungen[1].rechnungsdatum, '2026-11-02');
        assert.ok(ok.daten.rechnungen.every((r) => !('pdf' in r)), 'kein PDF-Inhalt in der Liste');

        // Anzahl für den Menüpunkt: nur Admins, zählt nur den eigenen Verein
        const anzahl = await aufruf('u-admin', `/api/abrechnung/verein/${vA}/rechnungen/anzahl`);
        assert.equal(anzahl.status, 200);
        assert.equal(anzahl.daten.anzahl, 2);
        assert.equal((await aufruf('u-fremd', `/api/abrechnung/verein/${vB}/rechnungen/anzahl`)).daten.anzahl, 1);
        assert.equal((await aufruf('u-benutzer', `/api/abrechnung/verein/${vA}/rechnungen/anzahl`)).status, 403);
        const vLeer = id((await knex('vereine').insert({ name: 'JC Leer' }).returning('id'))[0]);
        await knex('benutzer').insert({ id: 'u-leer', email: 'leer@test.de', vorname: 'l', nachname: 'T', email_bestaetigt_am: knex.fn.now(), aktiver_verein_id: vLeer });
        await knex('benutzer_vereine').insert({ benutzer_id: 'u-leer', verein_id: vLeer, freigegeben: 1, rolle: 'admin' });
        assert.equal((await aufruf('u-leer', `/api/abrechnung/verein/${vLeer}/rechnungen/anzahl`)).daten.anzahl, 0, 'ohne Rechnungen null');

        assert.equal((await aufruf('u-benutzer', `/api/abrechnung/verein/${vA}/rechnungen`)).status, 403);
        assert.equal((await aufruf('u-fremd', `/api/abrechnung/verein/${vA}/rechnungen`)).status, 403);
        assert.equal((await aufruf(null, `/api/abrechnung/verein/${vA}/rechnungen`)).status, 401);

        const spaeter = await ladeRechnungenDesVereins(knex, vA, '2026-12-01');
        assert.equal(spaeter.find((r) => r.nummer === 'A-00001').anzeigeStatus, 'ueberfaellig', 'versandt nach Zahlungsziel');
        assert.equal(spaeter.find((r) => r.nummer === 'A-00002').anzeigeStatus, 'bezahlt');
    } finally {
        await new Promise((resolve) => server.close(resolve));
        await db.stoppe();
    }
});
