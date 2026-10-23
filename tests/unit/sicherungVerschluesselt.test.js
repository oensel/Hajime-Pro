import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

process.env.BETRIEBSMODUS = 'cloud';
delete process.env.IS_OFFLINE;
process.env.SUPER_ADMIN_2FA = 'false';
process.env.JWT_SECRET = 'test-geheimnis-verschluesselung';
delete process.env.SICHERUNG_PASSWORT;
delete process.env.SICHERUNG_PASSWORT_DATEI;

const { starteTestPostgres } = await import('../helpers/testPostgres.js');
const v = await import('../../src/services/sicherungsVerschluesselung.js');
const ds = await import('../../src/services/datensicherung.js');
const { getSicherungRoutes, BESTAETIGUNGSWORT } = await import('../../src/routes/sicherungRoutes.js');
const express = (await import('express')).default;
const jwt = (await import('jsonwebtoken')).default;

const PASSWORT = 'Das-ist-ein-sehr-langes-Sicherungspasswort-2026!';

async function sammle(strom) {
    const stuecke = [];
    await pipeline(strom, new Writable({ write(c, _e, cb) { stuecke.push(c); cb(); } }));
    return Buffer.concat(stuecke);
}

// Klartext in ungleichmäßigen Stücken verschlüsseln und entschlüsseln
const verschluessele = (klar, passwort = PASSWORT, stueck = 7919) => sammle(Readable.from((function* g() {
    for (let i = 0; i < klar.length; i += stueck) yield klar.subarray(i, i + stueck);
}())).pipe(v.erzeugeVerschluesselung(passwort)));
const entschluessele = (chiffre, passwort = PASSWORT, stueck = 4099) => sammle(Readable.from((function* g() {
    for (let i = 0; i < chiffre.length; i += stueck) yield chiffre.subarray(i, i + stueck);
}())).pipe(v.erzeugeEntschluesselung(passwort)));

test('Verschlüsselung: Hin und zurück über alle Blockgrenzen', async () => {
    for (const laenge of [0, 1, 100, 65535, 65536, 65537, 131072, 200_001]) {
        const klar = crypto.randomBytes(laenge);
        const chiffre = await verschluessele(klar);
        assert.equal(v.istVerschluesselt(chiffre), true);
        assert.deepEqual(await entschluessele(chiffre), klar, `Länge ${laenge}`);
    }
    // gleicher Klartext, jedes Mal anderes Salz: andere Datei
    const klar = Buffer.from('immer derselbe Inhalt');
    const a = await verschluessele(klar);
    const b = await verschluessele(klar);
    assert.notDeepEqual(a, b);
    assert.equal(a.includes(klar), false, 'der Klartext steht nicht in der Datei');
    assert.equal(v.istVerschluesselt(Buffer.from('plain')), false);
});

test('Verschlüsselung: falsches Passwort, Veränderung und Abbruch fallen auf', async () => {
    const klar = crypto.randomBytes(200_000);
    const chiffre = await verschluessele(klar);
    const fehler = (p) => assert.rejects(p, (err) => err instanceof v.EntschluesselungsFehler && err.code === 'SICHERUNG_ENTSCHLUESSELUNG');

    await fehler(entschluessele(chiffre, 'ein-ganz-anderes-passwort-mit-genug-laenge'));
    // ein Byte im ersten, mittleren und letzten Block sowie im Kopf (Salz) verändert
    for (const stelle of [40, Math.floor(chiffre.length / 2), chiffre.length - 5, 12]) {
        const kaputt = Buffer.from(chiffre);
        kaputt[stelle] ^= 0x01;
        await fehler(entschluessele(kaputt));
    }
    // abgeschnitten: mitten im Block, genau an einer Blockgrenze (ohne Endkennzeichen) und nur der Kopf
    await fehler(entschluessele(chiffre.subarray(0, chiffre.length - 10)));
    const erster = 29 + 5 + 65536 + 16;
    await fehler(entschluessele(chiffre.subarray(0, erster)));
    await fehler(entschluessele(chiffre.subarray(0, 29)));
    await fehler(entschluessele(Buffer.alloc(0)));
    // Daten hinter dem letzten Block
    await fehler(entschluessele(Buffer.concat([chiffre, Buffer.from([0])])));
    // Blöcke vertauscht
    const rahmen = 5 + 65536 + 16;
    const getauscht = Buffer.concat([chiffre.subarray(0, 29), chiffre.subarray(29 + rahmen, 29 + 2 * rahmen), chiffre.subarray(29, 29 + rahmen), chiffre.subarray(29 + 2 * rahmen)]);
    await fehler(entschluessele(getauscht));
    // Endkennzeichen von „letzter Block“ auf „weitere folgen“ gedreht (Abschneiden verschleiern)
    const letzterStart = 29 + 3 * rahmen;
    const gedreht = Buffer.from(chiffre);
    gedreht[letzterStart] = 0;
    await fehler(entschluessele(gedreht));
    // keine Sicherung
    await fehler(entschluessele(Buffer.concat([Buffer.from('HJMSICH1'), crypto.randomBytes(100)])));
    await assert.rejects(entschluessele(Buffer.from('kein Kopf, aber lang genug für 29 Bytes ...')), v.EntschluesselungsFehler);
});

test('Verschlüsselung: Passwort aus Umgebung und Datei, zu kurz ist ein Fehler', () => {
    assert.equal(v.leseSicherungsPasswort({}), null);
    assert.equal(v.leseSicherungsPasswort({ SICHERUNG_PASSWORT: PASSWORT }), PASSWORT);
    assert.throws(() => v.leseSicherungsPasswort({ SICHERUNG_PASSWORT: 'kurz' }), /zu kurz/);
    const datei = path.join(os.tmpdir(), `hajime-pw-${process.pid}.txt`);
    fs.writeFileSync(datei, `${PASSWORT}\n`);
    try {
        assert.equal(v.leseSicherungsPasswort({ SICHERUNG_PASSWORT_DATEI: datei }), PASSWORT, 'Zeilenende wird entfernt');
        assert.equal(v.leseSicherungsPasswort({ SICHERUNG_PASSWORT_DATEI: datei, SICHERUNG_PASSWORT: 'ignoriert-weil-datei-gewinnt-0000' }), PASSWORT);
    } finally { fs.rmSync(datei, { force: true }); }
    assert.throws(() => v.leseSicherungsPasswort({ SICHERUNG_PASSWORT_DATEI: path.join(os.tmpdir(), 'gibt-es-nicht.txt') }), /nicht lesbar/);
});

async function fuelle(knex) {
    const [{ id }] = await knex('vereine').insert({ name: 'JC Verschlüsselt', bundesland: 'Hessen' }).returning('id');
    await knex('urkunden_vorlagen').insert({ verein_id: id, name: 'Vorlage', pdf: crypto.randomBytes(300_000), seiten_breite_pt: 595, seiten_hoehe_pt: 842, felder: '[]' });
    return id;
}

test('Sicherung verschlüsselt: schreiben, prüfen, einspielen, Rückwärtskompatibilität', async () => {
    const db = await starteTestPostgres();
    const { knex } = db;
    const verzeichnis = fs.mkdtempSync(path.join(os.tmpdir(), 'hajime-enc-'));
    try {
        const vereinId = await fuelle(knex);

        // Ohne Passwort: unverschlüsselt (.gz); mit Passwort: .enc, ohne lesbaren Klartext
        const offen = await ds.schreibeSicherungsdatei(knex, verzeichnis, 'sicherung', { passwort: null });
        assert.match(offen.name, /\.hajime-sicherung\.gz$/);
        assert.equal(offen.verschluesselt, false);
        await new Promise((r) => setTimeout(r, 1100));
        const zu = await ds.schreibeSicherungsdatei(knex, verzeichnis, 'sicherung', { passwort: PASSWORT });
        assert.match(zu.name, /\.hajime-sicherung\.gz\.enc$/);
        assert.equal(zu.verschluesselt, true);
        const inhalt = fs.readFileSync(zu.pfad);
        assert.equal(v.istVerschluesselt(inhalt), true);
        assert.equal(inhalt.includes(Buffer.from('JC Verschlüsselt')), false);
        assert.equal(inhalt.includes(Buffer.from('hajime-sicherung')), false);

        const liste = await ds.listeSicherungsdateien(verzeichnis);
        assert.deepEqual(liste.map((d) => [d.name, d.verschluesselt]).sort(), [[offen.name, false], [zu.name, true]].sort());
        assert.equal(ds.pruefeDateiname(zu.name), true);
        assert.equal(ds.pruefeDateiname(`${zu.name}.exe`), false);

        // Prüfen ohne Datenbank
        const geprueft = await ds.pruefeSicherung(fs.createReadStream(zu.pfad), { passwort: PASSWORT });
        assert.equal(geprueft.verschluesselt, true);
        assert.ok(geprueft.tabellen > 10 && geprueft.zeilen >= 2);
        assert.equal((await ds.pruefeSicherung(fs.createReadStream(offen.pfad), { passwort: null })).verschluesselt, false);
        await assert.rejects(ds.pruefeSicherung(fs.createReadStream(zu.pfad), { passwort: null }), /kein Passwort/);
        await assert.rejects(ds.pruefeSicherung(fs.createReadStream(zu.pfad), { passwort: 'falsches-passwort-aber-lang-genug' }), /Passwort falsch/);

        // Einspielen: richtiges Passwort; unverschlüsselte Datei auch dann, wenn ein Passwort eingestellt ist
        await knex('vereine').where({ id: vereinId }).update({ name: 'Verändert' });
        await ds.stelleWiederHer(knex, fs.createReadStream(zu.pfad), { passwort: PASSWORT });
        assert.equal((await knex('vereine').where({ id: vereinId }).first()).name, 'JC Verschlüsselt');
        await knex('vereine').where({ id: vereinId }).update({ name: 'Verändert' });
        await ds.stelleWiederHer(knex, fs.createReadStream(offen.pfad), { passwort: PASSWORT });
        assert.equal((await knex('vereine').where({ id: vereinId }).first()).name, 'JC Verschlüsselt');
        assert.equal(Buffer.compare((await knex('urkunden_vorlagen').first()).pdf.subarray(0, 4), (await knex('urkunden_vorlagen').first()).pdf.subarray(0, 4)), 0);

        // Falsches/fehlendes Passwort und beschädigte Datei: nichts ändert sich, auch keine Vorab-Sicherung
        await knex('vereine').where({ id: vereinId }).update({ name: 'Bleibt' });
        let vorabGelaufen = false;
        const vorher = async () => { vorabGelaufen = true; };
        await assert.rejects(ds.stelleWiederHer(knex, fs.createReadStream(zu.pfad), { passwort: null, vorher }), /kein Passwort/);
        await assert.rejects(ds.stelleWiederHer(knex, fs.createReadStream(zu.pfad), { passwort: 'falsches-passwort-aber-lang-genug', vorher }), /Passwort falsch/);
        const kaputt = Buffer.from(inhalt);
        kaputt[kaputt.length - 30] ^= 0xff; // im letzten Block: der Fehler tritt erst nach dem Leeren der Tabellen auf
        const kaputtPfad = path.join(verzeichnis, 'kaputt-20260101-000000.hajime-sicherung.gz.enc');
        fs.writeFileSync(kaputtPfad, kaputt);
        await assert.rejects(ds.stelleWiederHer(knex, fs.createReadStream(kaputtPfad), { passwort: PASSWORT }), /Passwort falsch oder die Sicherung ist beschädigt/);
        assert.equal((await knex('vereine').where({ id: vereinId }).first()).name, 'Bleibt', 'Rollback: alter Stand bleibt');
        assert.equal(vorabGelaufen, false);

        // Aufbewahrung zählt .gz und .gz.enc zusammen je Vorsilbe
        for (let i = 0; i < 3; i += 1) {
            fs.writeFileSync(path.join(verzeichnis, `auto-sicherung-2026010${i + 1}-000000.hajime-sicherung.gz.enc`), 'x');
        }
        await ds.schreibeSicherungsdatei(knex, verzeichnis, 'auto-sicherung', { passwort: PASSWORT, behalte: { 'auto-sicherung': 2 } });
        assert.equal((await ds.listeSicherungsdateien(verzeichnis)).filter((d) => d.name.startsWith('auto-sicherung-')).length, 2);
    } finally {
        fs.rmSync(verzeichnis, { recursive: true, force: true });
        await db.stoppe();
    }
});

test('Sicherung verschlüsselt: Routen und Skript', async () => {
    const db = await starteTestPostgres();
    const { knex } = db;
    const verzeichnis = fs.mkdtempSync(path.join(os.tmpdir(), 'hajime-enc-route-'));
    let server;
    try {
        await fuelle(knex);
        await knex('benutzer').insert({ id: 'sa', email: 'sa@test.de', vorname: 'Sa', nachname: 'Admin', password_hash: 'x:y', ist_super_admin: true, super_admin_modus: true });
        const token = jwt.sign({ id: 'sa', email: 'sa@test.de' }, process.env.JWT_SECRET, { expiresIn: '1h' });
        const app = express();
        app.set('knex', knex);
        app.use('/api/sicherung', getSicherungRoutes(knex, { verzeichnis }));
        server = createServer(app);
        await new Promise((r) => server.listen(0, '127.0.0.1', r));
        const basis = `http://127.0.0.1:${server.address().port}/api/sicherung`;
        const rufe = (pfad, optionen = {}) => fetch(`${basis}${pfad}`, { ...optionen, headers: { Authorization: `Bearer ${token}`, ...(optionen.headers || {}) } });

        // ohne Passwort: Seite warnt
        let info = await (await rufe('/')).json();
        assert.deepEqual(info.verschluesselung, { aktiv: false, fehler: null });

        process.env.SICHERUNG_PASSWORT = PASSWORT;
        try {
            info = await (await rufe('/')).json();
            assert.deepEqual(info.verschluesselung, { aktiv: true, fehler: null });

            // Download: verschlüsselt, Endung .enc, entschlüsselbar
            const dl = await rufe('/herunterladen', { method: 'POST' });
            assert.equal(dl.status, 200);
            assert.match(dl.headers.get('content-disposition'), /\.hajime-sicherung\.gz\.enc"/);
            assert.equal(dl.headers.get('content-type'), 'application/octet-stream');
            const geladen = Buffer.from(await dl.arrayBuffer());
            assert.equal(v.istVerschluesselt(geladen), true);
            assert.match(zlib.gunzipSync(await entschluessele(geladen)).toString('utf8').split('\n')[0], /hajime-sicherung/);

            // Ablegen und Wiederherstellen per Upload der verschlüsselten Datei
            const abgelegt = await (await rufe('/erstellen', { method: 'POST' })).json();
            assert.match(abgelegt.datei.name, /\.enc$/);
            await knex('vereine').update({ name: 'Verändert' });
            const hoch = await (await rufe('/wiederherstellen', { method: 'POST', body: geladen, headers: { 'X-Bestaetigung': BESTAETIGUNGSWORT, 'Content-Type': 'application/octet-stream' } })).json();
            assert.equal(hoch.success, true, JSON.stringify(hoch));
            assert.match(hoch.vorherSicherung, /\.enc$/, 'auch die Vorab-Sicherung ist verschlüsselt');
            assert.equal((await knex('vereine').first()).name, 'JC Verschlüsselt');

            // falsches Passwort am Server: klare Meldung, nichts geändert
            process.env.SICHERUNG_PASSWORT = 'ein-anderes-langes-passwort-fuer-den-test';
            await knex('vereine').update({ name: 'Bleibt' });
            const falsch = await rufe('/wiederherstellen', { method: 'POST', body: geladen, headers: { 'X-Bestaetigung': BESTAETIGUNGSWORT, 'Content-Type': 'application/octet-stream' } });
            assert.equal(falsch.status, 400);
            assert.match((await falsch.json()).error, /Passwort falsch/);
            assert.equal((await knex('vereine').first()).name, 'Bleibt');

            // zu kurzes Passwort: Anzeige und Sicherungen scheitern, statt unverschlüsselt zu schreiben
            process.env.SICHERUNG_PASSWORT = 'kurz';
            info = await (await rufe('/')).json();
            assert.equal(info.verschluesselung.aktiv, true);
            assert.match(info.verschluesselung.fehler, /zu kurz/);
            assert.equal((await rufe('/erstellen', { method: 'POST' })).status, 500);
            const vorhandene = (await ds.listeSicherungsdateien(verzeichnis)).filter((d) => !d.verschluesselt);
            assert.equal(vorhandene.length, 0, 'es entsteht keine unverschlüsselte Sicherung');

            // Skript: prüfen und entschlüsseln ohne Datenbank
            process.env.SICHERUNG_PASSWORT = PASSWORT;
            const datei = path.join(verzeichnis, 'kopie.hajime-sicherung.gz.enc');
            fs.writeFileSync(datei, geladen);
            const skript = path.resolve('scripts/sicherung.mjs');
            const lauf = (...args) => spawnSync(process.execPath, [skript, ...args], { env: { ...process.env, DB_HOST: '', DB_URL: '' }, encoding: 'utf8' });
            const ok = lauf('pruefen', datei);
            assert.equal(ok.status, 0, ok.stderr);
            assert.match(ok.stdout, /In Ordnung: verschlüsselt/);
            const ziel = path.join(verzeichnis, 'klar.hajime-sicherung.gz');
            const ent = lauf('entschluesseln', datei, ziel);
            assert.equal(ent.status, 0, ent.stderr);
            assert.match(zlib.gunzipSync(fs.readFileSync(ziel)).toString('utf8'), /hajime-sicherung/);
            assert.notEqual(lauf('entschluesseln', datei, ziel).status, 0, 'überschreibt keine vorhandene Datei');
            const falschesPasswort = spawnSync(process.execPath, [skript, 'pruefen', datei], { env: { ...process.env, SICHERUNG_PASSWORT: 'falsches-passwort-aber-lang-genug' }, encoding: 'utf8' });
            assert.notEqual(falschesPasswort.status, 0);
            assert.match(falschesPasswort.stderr, /Passwort falsch/);
        } finally {
            delete process.env.SICHERUNG_PASSWORT;
        }
    } finally {
        if (server) await new Promise((r) => server.close(r));
        fs.rmSync(verzeichnis, { recursive: true, force: true });
        await db.stoppe();
    }
});
