import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { EventEmitter } from 'node:events';

process.env.BETRIEBSMODUS = 'cloud';
delete process.env.IS_OFFLINE;
process.env.SUPER_ADMIN_2FA = 'false';
process.env.JWT_SECRET = 'test-geheimnis-konsole';

const { starteTestPostgres } = await import('../helpers/testPostgres.js');
const fp = await import('../../src/services/fehlerProtokoll.js');
const { getKonsoleRoutes, getFehlerMeldeRoutes } = await import('../../src/routes/konsoleRoutes.js');
const { hashPassword } = await import('../../src/utils/password.js');
const express = (await import('express')).default;
const jwt = (await import('jsonwebtoken')).default;

const warteAuf = async (bedingung, ms = 5000) => {
    const ende = Date.now() + ms;
    for (;;) {
        const ergebnis = await bedingung();
        if (ergebnis) return ergebnis;
        if (Date.now() > ende) throw new Error('Zeitüberschreitung');
        await new Promise((r) => setTimeout(r, 50));
    }
};

test('Fehlerprotokoll: Zugangsdaten schwärzen und Meldungen formatieren', () => {
    const jwtText = 'eyJhbGciOiJIUzI1NiJ9.eyJpZCI6IjEyMzQ1Njc4OTAifQ.abcdefghijklmnop';
    const t = fp.schwaerze(`Authorization: Bearer ${jwtText} und token=geheim123 sowie "password": "hunter2"`);
    assert.equal(t.includes(jwtText) || t.includes('geheim123') || t.includes('hunter2'), false);
    assert.match(t, /Bearer \*\*\*/);

    assert.deepEqual(fp.formatiereMeldung(['[Login-Fehler]:', 'kaputt']), { meldung: '[Login-Fehler]: kaputt', details: null });
    const mitFehler = fp.formatiereMeldung(['[X]:', new Error('Boom')]);
    assert.match(mitFehler.meldung, /^\[X\]: Error: Boom$/);
    assert.match(mitFehler.details, /at /, 'Stack in den Einzelheiten');
    assert.equal(fp.formatiereMeldung(['a'.repeat(900)]).meldung.length, 500);
    assert.equal(fp.formatiereMeldung(['']).meldung, '(leere Meldung)');
});

test('Fehlerprotokoll: Infos (auch vor der Installation) und Zähler', async () => {
    const db = await starteTestPostgres();
    const { knex } = db;
    try {
        // vor der Installation aufgehoben (z. B. Migrationen beim Start), nach der Installation eingetragen
        fp.meldeInfo('Datenbank-Migration angewendet: 20261028100000_fehlerprotokoll.js');
        const erfassung = fp.installiereFehlerErfassung(knex, { konsole: { error() {}, warn() {} }, prozess: new EventEmitter(), beendeBeiAbsturz: false });
        fp.meldeInfo('Server gestartet: Modus cloud, Port 3300 (100% bereit)');
        fp.meldeInfo('Aufräumen: 3 Protokolleinträge gelöscht', { quelle: 'prozess' });
        erfassung.erfasse('warn', 'server', ['Mailversand verzögert']);
        erfassung.erfasse('error', 'server', ['[X]:', new Error('kaputt')]);
        erfassung.erfasse('error', 'browser', ['Skriptfehler'], { pfad: '/x.html' });
        await erfassung.leere();
        const zeilen = await knex('fehlerprotokoll').orderBy('id');
        assert.deepEqual(zeilen.map((z) => [z.ebene, z.quelle]), [
            ['info', 'server'], ['info', 'server'], ['info', 'prozess'], ['warn', 'server'], ['error', 'server'], ['error', 'browser']
        ]);
        assert.equal(zeilen[1].meldung, 'Server gestartet: Modus cloud, Port 3300 (100% bereit)', 'Prozentzeichen bleiben unverändert');

        const alle = await fp.listeFehler(knex, {});
        assert.deepEqual(alle.zaehler, { gesamt: 6, info: 3, warn: 1, error: 2 });
        assert.equal(alle.eintraege.length, 6);
        // die Kacheln zählen ohne Ebene, aber mit Quelle und Suche
        const browser = await fp.listeFehler(knex, { ebene: 'info', quelle: 'browser' });
        assert.deepEqual(browser.zaehler, { gesamt: 1, info: 0, warn: 0, error: 1 });
        assert.equal(browser.eintraege.length, 0);
        const nurInfos = await fp.listeFehler(knex, { ebene: 'info' });
        assert.equal(nurInfos.eintraege.length, 3);
        assert.deepEqual(nurInfos.zaehler, alle.zaehler, 'der Filter ändert die Zähler nicht');
        const gesucht = await fp.listeFehler(knex, { suche: 'Aufräumen' });
        assert.deepEqual(gesucht.zaehler, { gesamt: 1, info: 1, warn: 0, error: 0 });
        const gruppiert = await fp.listeFehler(knex, { ebene: 'info', gruppiert: true });
        assert.equal(gruppiert.gruppen.length, 3);
        assert.deepEqual(gruppiert.zaehler, alle.zaehler);
        erfassung.stop();
    } finally {
        await db.stoppe();
    }
});

test('Fehlerprotokoll: Erfassung von console, Absturz, Flut und Eintragsfehlern', async () => {
    const db = await starteTestPostgres();
    const { knex } = db;
    const konsole = { ausgabe: [], error(...a) { this.ausgabe.push(['error', a]); }, warn(...a) { this.ausgabe.push(['warn', a]); } };
    const prozess = Object.assign(new EventEmitter(), { beendet: null, exit(code) { this.beendet = code; } });
    try {
        const erfassung = fp.installiereFehlerErfassung(knex, { konsole, prozess });
        konsole.error('[Test]:', new Error('Datenbank weg'));
        konsole.warn('Achtung', 'Platte fast voll');
        // die Ausgabe bleibt wie sie war
        assert.deepEqual(konsole.ausgabe.map((z) => z[0]), ['error', 'warn']);
        await erfassung.leere();
        const zeilen = await knex('fehlerprotokoll').orderBy('id');
        assert.deepEqual(zeilen.map((z) => [z.ebene, z.quelle]), [['error', 'server'], ['warn', 'server']]);
        assert.match(zeilen[0].meldung, /Datenbank weg/);
        assert.match(zeilen[0].details, /at /);
        assert.equal(zeilen[1].meldung, 'Achtung Platte fast voll');

        // Absturz: eingetragen, danach Prozessende mit Code 1
        prozess.emit('uncaughtException', new Error('unerwartet'), 'uncaughtException');
        await warteAuf(() => prozess.beendet === 1);
        const absturz = await knex('fehlerprotokoll').where({ quelle: 'prozess' }).first();
        assert.match(absturz.meldung, /Prozess abgestürzt/);
        assert.match(absturz.details, /unerwartet/);

        // Fehlerflut: höchstens 200 je Minute, der Rest wird gezählt und gemeldet
        await knex('fehlerprotokoll').del();
        for (let i = 0; i < 250; i += 1) konsole.error(`Flut ${i}`);
        await erfassung.leere();
        // 200 je Minute insgesamt: drei Einträge dieser Minute (zwei console-Meldungen, ein Absturz) zählen mit
        assert.equal((await knex('fehlerprotokoll')).length, 197);

        // Ein Fehler beim Eintragen löst keinen neuen Eintrag aus (keine Endlosschleife)
        const kaputt = { ...knex };
        const konsole2 = { ausgabe: [], error(...a) { this.ausgabe.push(a); }, warn() {} };
        const e2 = fp.installiereFehlerErfassung((() => { const f = () => ({ insert: () => Promise.reject(new Error('Tabelle fehlt')) }); return f; })(), { konsole: konsole2, prozess: new EventEmitter() });
        konsole2.error('Ursprungsfehler');
        await e2.leere();
        assert.deepEqual(konsole2.ausgabe.map((a) => String(a[0])), ['Ursprungsfehler', '[Fehlerprotokoll] Eintragen fehlgeschlagen:']);
        assert.ok(kaputt);
        e2.stop();
        erfassung.stop();
        // nach stop() wird nichts mehr mitgeschrieben, die Ausgabe funktioniert weiter
        const vorher = (await knex('fehlerprotokoll')).length;
        konsole.error('nach stop');
        await new Promise((r) => setTimeout(r, 1800));
        assert.equal((await knex('fehlerprotokoll')).length, vorher);
        assert.equal(konsole.ausgabe[konsole.ausgabe.length - 1][1][0], 'nach stop');
    } finally {
        await db.stoppe();
    }
});

test('Fehlerprotokoll: Routen, Rechte, Filter, Browser-Meldungen und Fehlerbehandlung', async () => {
    const db = await starteTestPostgres();
    const { knex } = db;
    let server;
    const erfassung = fp.installiereFehlerErfassung(knex, { prozess: new EventEmitter(), beendeBeiAbsturz: false });
    const alterOriginal = erfassung.original;
    try {
        for (const [id, super_] of [['sa', true], ['bn', false]]) {
            await knex('benutzer').insert({ id, email: `${id}@test.de`, vorname: id, nachname: 'Test', password_hash: hashPassword('Passwort-123'), ist_super_admin: super_, super_admin_modus: super_, email_bestaetigt_am: knex.fn.now() });
        }
        const app = express();
        app.set('knex', knex);
        app.use(express.json({ limit: '10kb' }));
        app.use('/api/fehler', getFehlerMeldeRoutes(erfassung.erfasse));
        app.use('/api/konsole', getKonsoleRoutes(knex));
        app.get('/kaputt', () => { throw Object.assign(new Error('Interna: Verbindung zu db.intern:5432 verloren'), { status: 500 }); });
        app.get('/async-kaputt', async () => { throw new Error('async Fehler mit token=abc123'); });
        app.use(fp.fehlerBehandlung);
        server = createServer(app);
        await new Promise((r) => server.listen(0, '127.0.0.1', r));
        const basis = `http://127.0.0.1:${server.address().port}`;
        const token = (id) => jwt.sign({ id, email: `${id}@test.de` }, process.env.JWT_SECRET, { expiresIn: '1h' });
        const rufe = (pfad, optionen = {}, wer = null) => fetch(`${basis}${pfad}`, {
            ...optionen, headers: { 'Content-Type': 'application/json', ...(wer ? { Authorization: `Bearer ${token(wer)}` } : {}), ...(optionen.headers || {}) }
        });

        // Fehlerbehandlung: JSON ohne Interna, Eintrag mit Pfad; Client-Fehler (413/400) kein Eintrag
        for (const pfad of ['/kaputt', '/async-kaputt']) {
            const r = await rufe(pfad);
            assert.equal(r.status, 500);
            assert.deepEqual(await r.json(), { success: false, error: 'Interner Server-Fehler.' });
        }
        assert.equal((await rufe('/api/fehler/browser', { method: 'POST', body: `{"meldung":"${'x'.repeat(20000)}"}` })).status, 413);
        assert.equal((await rufe('/api/fehler/browser', { method: 'POST', body: '{kaputt' })).status, 400);

        // Browser-Meldungen: anonym und angemeldet, gekürzt, ohne Meldung abgelehnt
        assert.equal((await rufe('/api/fehler/browser', { method: 'POST', body: JSON.stringify({ meldung: 'TypeError: x is undefined', stack: 'at a.js:1', url: '/turniere.html' }) }, 'bn')).status, 204);
        assert.equal((await rufe('/api/fehler/browser', { method: 'POST', body: JSON.stringify({ meldung: 'Anmeldeseite kaputt', url: '/login.html' }) })).status, 204);
        assert.equal((await rufe('/api/fehler/browser', { method: 'POST', body: JSON.stringify({ stack: 'nur Stack' }) })).status, 400);

        await erfassung.leere();
        const alle = await knex('fehlerprotokoll').orderBy('id');
        const nachMeldung = (teil) => alle.find((z) => z.meldung.includes(teil));
        assert.equal(alle.some((z) => z.meldung.includes('Ungültige')), false);
        const serverFehler = nachMeldung('Interna: Verbindung');
        assert.equal(serverFehler.quelle, 'server');
        assert.match(serverFehler.meldung, /^\[GET \/kaputt\]/);
        assert.equal(nachMeldung('async Fehler').details.includes('abc123'), false, 'Zugangsdaten sind geschwärzt');
        const browser = nachMeldung('TypeError');
        assert.deepEqual([browser.quelle, browser.pfad, browser.benutzer], ['browser', '/turniere.html', 'bn@test.de']);
        assert.equal(nachMeldung('Anmeldeseite kaputt').benutzer, null);

        // Konsole: nur Super-Admin
        assert.equal((await rufe('/api/konsole')).status, 401);
        assert.equal((await rufe('/api/konsole', {}, 'bn')).status, 403);
        const liste = async (abfrage = '') => (await (await rufe(`/api/konsole${abfrage}`, {}, 'sa')).json());
        const alleEintraege = await liste('?ebene=alle');
        assert.ok(alleEintraege.eintraege.length >= 4);
        assert.equal(alleEintraege.zaehler.gesamt, alleEintraege.zaehler.info + alleEintraege.zaehler.warn + alleEintraege.zaehler.error);
        assert.ok(alleEintraege.zaehler.error >= 4);
        assert.ok(Number(alleEintraege.eintraege[0].id) > Number(alleEintraege.eintraege[1].id), 'neueste zuerst');
        assert.equal((await liste('?quelle=browser')).eintraege.length, 2);
        assert.equal((await liste('?suche=Anmeldeseite')).eintraege.length, 1);
        assert.equal((await liste('?suche=Anmeldeseite%25')).eintraege.length, 0, 'ein Prozentzeichen ist kein Platzhalter');
        assert.equal((await liste('?suche=Anmeldeseite_kaputt')).eintraege.length, 0, 'ein Unterstrich ist kein Platzhalter');
        assert.equal((await liste('?ebene=warn')).eintraege.length, 0);
        assert.equal((await liste('?ebene=info')).eintraege.length, 0);

        // Live-Ansicht: nur neuere als die zuletzt gesehene ID
        const letzte = alleEintraege.neuesteId;
        assert.equal((await liste(`?nach=${letzte}`)).eintraege.length, 0);
        erfassung.erfasse('error', 'server', ['neuer Fehler nach dem Abruf']);
        await erfassung.leere();
        const neu = await liste(`?nach=${letzte}`);
        assert.deepEqual(neu.eintraege.map((e) => e.meldung), ['neuer Fehler nach dem Abruf']);
        const aelter = await liste(`?vor=${neu.eintraege[0].id}&limit=2`);
        assert.equal(aelter.eintraege.length, 2);

        // Gruppiert: gleiche Meldungen zusammenfassen
        for (let i = 0; i < 3; i += 1) erfassung.erfasse('error', 'server', ['immer derselbe Fehler']);
        await erfassung.leere();
        const gruppen = (await liste('?gruppiert=1')).gruppen;
        const gruppe = gruppen.find((g) => g.meldung === 'immer derselbe Fehler');
        assert.equal(gruppe.anzahl, 3);
        assert.ok(gruppe.zuletzt >= gruppe.erstmals);
        assert.ok(gruppen.length >= 5);

        // Aufbewahrung und Leeren
        await knex('fehlerprotokoll').insert({ zeitpunkt: knex.raw("now() - interval '40 days'"), ebene: 'error', quelle: 'server', meldung: 'alt' });
        assert.equal(await fp.bereinigeFehler(knex, 30), 1);
        assert.equal(await fp.bereinigeFehler(knex, 0), 0);
        assert.equal((await rufe('/api/konsole', { method: 'DELETE' }, 'bn')).status, 403);
        const geleert = await (await rufe('/api/konsole', { method: 'DELETE' }, 'sa')).json();
        assert.ok(geleert.geloescht > 0);
        assert.equal((await liste('?ebene=alle')).eintraege.length, 0);
    } finally {
        erfassung.stop();
        void alterOriginal;
        if (server) await new Promise((r) => server.close(r));
        await db.stoppe();
    }
});
