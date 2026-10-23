import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { Readable, Writable } from 'node:stream';
import { createServer } from 'node:http';

process.env.BETRIEBSMODUS = 'cloud';
delete process.env.IS_OFFLINE;
process.env.SUPER_ADMIN_2FA = 'false';
process.env.JWT_SECRET = 'test-geheimnis-sicherung';

const { starteTestPostgres } = await import('../helpers/testPostgres.js');
const ds = await import('../../src/services/datensicherung.js');
const { getSicherungRoutes, BESTAETIGUNGSWORT } = await import('../../src/routes/sicherungRoutes.js');
const express = (await import('express')).default;
const jwt = (await import('jsonwebtoken')).default;

async function sicherungAlsBuffer(knex) {
    const stuecke = [];
    await ds.schreibeSicherung(knex, new Writable({ write(chunk, _enc, cb) { stuecke.push(chunk); cb(); } }));
    return Buffer.concat(stuecke);
}

const wiederherstellenAus = (knex, buffer, optionen) => ds.stelleWiederHer(knex, Readable.from([buffer]), optionen);

async function fuelle(knex) {
    const [{ id: vereinId }] = await knex('vereine').insert({ name: 'JC Sicherung', bundesland: 'Hessen' }).returning('id');
    await knex('benutzer').insert({ id: 'b1', email: 'b1@test.de', vorname: 'Be', nachname: 'Nutzer', password_hash: 'x:y' });
    await knex('benutzer_vereine').insert({ benutzer_id: 'b1', verein_id: vereinId, freigegeben: 1, rolle: 'admin' });
    await knex('urkunden_vorlagen').insert({
        verein_id: vereinId, name: 'Vorlage', pdf: Buffer.from([0, 1, 2, 250, 255]), seiten_breite_pt: 595.5, seiten_hoehe_pt: 842,
        felder: '[{"typ":"text","text":"Ä"}]'
    });
    await knex('turniere').insert({ bezeichnung: 'Cup', ort: 'Senden', datum: '2026-10-15', ausrichter: 'JC', verein_id: vereinId, status: 'veroeffentlicht' });
    return vereinId;
}

test('Datensicherung: Sicherung, Änderung, Wiederherstellen', async () => {
    const db = await starteTestPostgres();
    const { knex } = db;
    try {
        const vereinId = await fuelle(knex);

        // Reihenfolge: Eltern vor Kindern
        const sortiert = await ds.sortiereNachFremdschluesseln(knex, ['benutzer_vereine', 'turniere', 'vereine', 'benutzer']);
        assert.ok(sortiert.indexOf('vereine') < sortiert.indexOf('turniere'));
        assert.ok(sortiert.indexOf('benutzer') < sortiert.indexOf('benutzer_vereine'));

        const datei = await sicherungAlsBuffer(knex);
        const zeilen = zlib.gunzipSync(datei).toString('utf8').trim().split('\n').map((z) => JSON.parse(z));
        assert.equal(zeilen[0].format, ds.FORMAT);
        assert.ok(zeilen[0].tabellen.includes('vereine') && !zeilen[0].tabellen.includes('knex_migrations'));
        assert.equal(zeilen[zeilen.length - 1].ende, true);
        assert.equal(zeilen[zeilen.length - 1].zeilen.vereine, 1);

        // Bestand verändern: ändern, löschen, neues anlegen
        await knex('vereine').where({ id: vereinId }).update({ name: 'Geändert' });
        await knex('turniere').del();
        await knex('urkunden_vorlagen').del();
        await knex('benutzer').insert({ id: 'b2', email: 'b2@test.de', vorname: 'Neu', nachname: 'Er', password_hash: 'x:y' });

        const protokoll = [];
        const ergebnis = await wiederherstellenAus(knex, datei, { vorher: async () => { protokoll.push('vorher'); } });
        assert.deepEqual(protokoll, ['vorher']);
        assert.ok(ergebnis.tabellen > 10 && ergebnis.zeilen >= 4);

        assert.equal((await knex('vereine').where({ id: vereinId }).first()).name, 'JC Sicherung');
        assert.equal((await knex('benutzer').where({ id: 'b2' })).length, 0, 'später Angelegtes verschwindet');
        const turnier = await knex('turniere').first();
        assert.equal(turnier.bezeichnung, 'Cup');
        assert.equal(new Date(turnier.datum).getFullYear(), 2026);
        assert.equal(String(turnier.datum instanceof Date ? turnier.datum.toLocaleDateString('sv') : turnier.datum).slice(0, 10), '2026-10-15', 'Datum bleibt ohne Zeitzonen-Verschiebung');
        const vorlage = await knex('urkunden_vorlagen').first();
        assert.deepEqual([...vorlage.pdf], [0, 1, 2, 250, 255], 'bytea bleibt erhalten');
        assert.equal(vorlage.felder, '[{"typ":"text","text":"Ä"}]');
        assert.equal(vorlage.seiten_breite_pt, 595.5);

        // Sequenzen laufen weiter (kein Schlüsselkonflikt beim nächsten Anlegen)
        const [neu] = await knex('vereine').insert({ name: 'Nach Wiederherstellung' }).returning('id');
        assert.ok((typeof neu === 'object' ? neu.id : neu) > vereinId);

        // ohne Superuser-Rechte bleiben die Fremdschlüssel aktiv: die Reihenfolge in der Datei muss reichen
        await knex('vereine').where({ id: vereinId }).update({ name: 'Nochmal geändert' });
        await wiederherstellenAus(knex, datei, { fremdschluesselPruefen: true });
        assert.equal((await knex('vereine').where({ id: vereinId }).first()).name, 'JC Sicherung');

        // zweimal hintereinander geht ebenfalls
        await wiederherstellenAus(knex, datei);
        assert.equal((await knex('vereine').where({ name: 'Nach Wiederherstellung' })).length, 0);
    } finally {
        await db.stoppe();
    }
});

test('Datensicherung: fehlerhafte Dateien ändern nichts', async () => {
    const db = await starteTestPostgres();
    const { knex } = db;
    try {
        await fuelle(knex);
        const datei = await sicherungAlsBuffer(knex);
        const vorher = await knex('vereine').select('id', 'name');
        const unveraendert = async () => assert.deepEqual(await knex('vereine').select('id', 'name'), vorher);

        const gzip = (text) => zlib.gzipSync(Buffer.from(text));
        const zeilen = zlib.gunzipSync(datei).toString('utf8').trim().split('\n');

        await assert.rejects(() => wiederherstellenAus(knex, Buffer.from('kein gzip'), {}), /gültige|Sicherung/);
        await assert.rejects(() => wiederherstellenAus(knex, gzip('{"foo":1}\n'), {}), /keine Hajime-Pro-Sicherung/);
        await assert.rejects(() => wiederherstellenAus(knex, gzip('Text\n'), {}), /keine Hajime-Pro-Sicherung/);

        // anderer Schema-Stand
        const fremd = JSON.parse(zeilen[0]);
        fremd.migrationen = [...fremd.migrationen.slice(0, -1), '99999999999999_zukunft.js'];
        await assert.rejects(() => wiederherstellenAus(knex, gzip([JSON.stringify(fremd), ...zeilen.slice(1)].join('\n')), {}), /anderen Datenbank-Stand/);

        // abgeschnitten (ohne Endzeile) und falsche Zählung: Rollback nach dem Leeren
        await assert.rejects(() => wiederherstellenAus(knex, gzip(zeilen.slice(0, -1).join('\n')), {}), /unvollständig/);
        const falsch = JSON.parse(zeilen[zeilen.length - 1]);
        falsch.zeilen.vereine += 1;
        await assert.rejects(() => wiederherstellenAus(knex, gzip([...zeilen.slice(0, -1), JSON.stringify(falsch)].join('\n')), {}), /unvollständig oder beschädigt/);
        await assert.rejects(() => wiederherstellenAus(knex, datei.subarray(0, Math.floor(datei.length / 2)), {}), /gültige oder vollständige|unvollständig|beschädigt/);
        await unveraendert();
        assert.equal((await knex('urkunden_vorlagen')).length, 1);

        // schlägt die Vorab-Sicherung fehl, bleibt alles unverändert
        await assert.rejects(() => wiederherstellenAus(knex, datei, { vorher: async () => { throw new Error('Platte voll'); } }), /Platte voll/);
        await unveraendert();
    } finally {
        await db.stoppe();
    }
});

test('Datensicherung: Dateien auf dem Server und Routen', async () => {
    const db = await starteTestPostgres();
    const { knex } = db;
    const verzeichnis = fs.mkdtempSync(path.join(os.tmpdir(), 'hajime-sicherung-'));
    let server;
    try {
        await fuelle(knex);
        await knex('benutzer').insert({ id: 'sa', email: 'sa@test.de', vorname: 'Sa', nachname: 'Admin', password_hash: 'x:y', ist_super_admin: true, super_admin_modus: true });
        const token = jwt.sign({ id: 'sa', email: 'sa@test.de' }, process.env.JWT_SECRET, { expiresIn: '1h' });
        const app = express();
        app.use('/api/sicherung', getSicherungRoutes(knex, { verzeichnis }));
        server = createServer(app);
        await new Promise((r) => server.listen(0, '127.0.0.1', r));
        const basis = `http://127.0.0.1:${server.address().port}/api/sicherung`;
        const kopf = { Authorization: `Bearer ${token}` };
        const anfrage = (pfad, optionen = {}) => fetch(`${basis}${pfad}`, { ...optionen, headers: { ...kopf, ...(optionen.headers || {}) } });

        assert.equal((await fetch(`${basis}/`)).status, 401, 'ohne Anmeldung');
        const normal = jwt.sign({ id: 'b1', email: 'b1@test.de' }, process.env.JWT_SECRET, { expiresIn: '1h' });
        assert.equal((await fetch(`${basis}/`, { headers: { Authorization: `Bearer ${normal}` } })).status, 403, 'kein Super-Admin');

        // auf dem Server ablegen, auflisten, herunterladen
        const erstellt = await (await anfrage('/erstellen', { method: 'POST' })).json();
        assert.equal(erstellt.success, true);
        const liste = await (await anfrage('/')).json();
        assert.deepEqual(liste.dateien.map((d) => d.name), [erstellt.datei.name]);
        const dl = await anfrage(`/dateien/${erstellt.datei.name}/herunterladen`, { method: 'POST' });
        assert.equal(dl.status, 200);
        assert.match(dl.headers.get('content-disposition'), /attachment; filename=/);
        const heruntergeladen = Buffer.from(await dl.arrayBuffer());
        assert.equal(heruntergeladen.length, erstellt.datei.groesse);
        assert.equal((await anfrage('/dateien/..%2Fgeheim/herunterladen', { method: 'POST' })).status, 400);
        assert.equal((await anfrage('/dateien/gibtsnicht.hajime-sicherung.gz/herunterladen', { method: 'POST' })).status, 404);

        const live = await anfrage('/herunterladen', { method: 'POST' });
        assert.equal(live.status, 200);
        assert.equal(zlib.gunzipSync(Buffer.from(await live.arrayBuffer())).toString('utf8').split('\n')[0].includes(ds.FORMAT), true);

        // Wiederherstellen: erst Bestätigungswort, dann Upload
        await knex('vereine').update({ name: 'Verändert' });
        assert.equal((await anfrage('/wiederherstellen', { method: 'POST', body: heruntergeladen, headers: { 'Content-Type': 'application/octet-stream' } })).status, 400);
        const bestaetigung = { 'X-Bestaetigung': BESTAETIGUNGSWORT, 'Content-Type': 'application/octet-stream' };
        const kaputt = await anfrage('/wiederherstellen', { method: 'POST', body: Buffer.from('murks'), headers: bestaetigung });
        assert.equal(kaputt.status, 400);
        assert.equal((await knex('vereine').first()).name, 'Verändert', 'kaputte Datei ändert nichts');

        const upload = await (await anfrage('/wiederherstellen', { method: 'POST', body: heruntergeladen, headers: bestaetigung })).json();
        assert.equal(upload.success, true, JSON.stringify(upload));
        assert.match(upload.vorherSicherung, /^vor-wiederherstellung-.*\.hajime-sicherung\.gz$/);
        assert.equal((await knex('vereine').first()).name, 'JC Sicherung');
        assert.deepEqual((await (await anfrage('/')).json()).dateien.length, 2, 'Vorab-Sicherung liegt im Verzeichnis');

        // aus einer Datei auf dem Server
        await knex('vereine').update({ name: 'Wieder verändert' });
        const ausDatei = await (await anfrage(`/wiederherstellen?datei=${erstellt.datei.name}`, { method: 'POST', headers: { 'X-Bestaetigung': BESTAETIGUNGSWORT } })).json();
        assert.equal(ausDatei.success, true);
        assert.equal((await knex('vereine').first()).name, 'JC Sicherung');
        assert.equal((await anfrage('/wiederherstellen?datei=..%2Fx', { method: 'POST', headers: { 'X-Bestaetigung': BESTAETIGUNGSWORT } })).status, 400);

        // Löschen
        assert.equal((await anfrage(`/dateien/${erstellt.datei.name}`, { method: 'DELETE' })).status, 200);
        assert.equal((await anfrage(`/dateien/${erstellt.datei.name}`, { method: 'DELETE' })).status, 404);
    } finally {
        if (server) await new Promise((r) => server.close(r));
        fs.rmSync(verzeichnis, { recursive: true, force: true });
        await db.stoppe();
    }
});

test('Datensicherung: Sicherungen im Verzeichnis, Dateinamen', () => {
    assert.equal(ds.pruefeDateiname('sicherung-20261023-120000.hajime-sicherung.gz'), true);
    for (const schlecht of ['../x.hajime-sicherung.gz', 'a/b.hajime-sicherung.gz', 'x.gz', '', 'a b.hajime-sicherung.gz', null]) {
        assert.equal(ds.pruefeDateiname(schlecht), false, String(schlecht));
    }
});
