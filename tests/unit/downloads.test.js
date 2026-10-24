import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { generateKeyPairSync } from 'crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'fs';
import os from 'os';
import path from 'path';
import { starteTestPostgres } from '../helpers/testPostgres.js';

// Installer und Updates über die Cloud (Spec docs/specs/2026-10-24-downloads-ueber-cloud-design.md): Spiegelung aus einem
// "privaten Repository" (Double), Berechtigung, Download per Ticket, Einlösecode und Geräteschlüssel, GitHub-kompatible Fassade.
process.env.BETRIEBSMODUS = 'cloud';
delete process.env.IS_OFFLINE;
delete process.env.SYNC_ROLLE;
process.env.JWT_SECRET = 'downloads-test-geheimnis';

const jwt = (await import('jsonwebtoken')).default;
const { erzeugeVersionJson } = await import('../../scripts/signiere-client.mjs');
const { spiegleRelease, listeVersionen, liesIndex, erzeugeLokalenReleaseZugriff } = await import('../../src/services/releaseSpeicher.js');
const { getDownloadRoutes, getReleaseFassadeRoutes, dateinameMitCode, erzeugeTicketDienst } = await import('../../src/routes/downloadRoutes.js');
const { darfReleasesLaden, erzeugeEinloesecode, loeseEinloesecodeAb, pruefeGeraeteSchluessel } = await import('../../src/services/releaseSchluessel.js');

const id = (r) => (typeof r === 'object' ? r.id : r);
const tmp = () => mkdtempSync(path.join(os.tmpdir(), 'hajime-dl-'));

// Baut ein Release-Double: client (version.json) + server (server-version.json) signiert, als GitHub-Antworten ausgeliefert.
function baueRelease({ version, privat, dateiInhalt = {} }) {
    const quelle = tmp();
    const inhalt = (name) => Buffer.from(dateiInhalt[name] ?? `inhalt von ${name}`.repeat(50));
    const clientNamen = [`Hajime-Pro-Setup-${version}.exe`, `Hajime-Pro-${version}.apk`];
    const serverNamen = [`Hajime-Pro-Server-${version}-win-x64.exe`, `Hajime-Pro-Dienst-${version}.tar.gz`];
    const clientDir = path.join(quelle, 'c');
    const serverDir = path.join(quelle, 's');
    mkdirSync(clientDir); mkdirSync(serverDir);
    for (const n of clientNamen) writeFileSync(path.join(clientDir, n), inhalt(n));
    for (const n of serverNamen) writeFileSync(path.join(serverDir, n), inhalt(n));
    erzeugeVersionJson({ verzeichnis: clientDir, version, privaterSchluessel: privat });
    erzeugeVersionJson({ verzeichnis: serverDir, version, privaterSchluessel: privat, ausgabeName: 'server-version.json' });
    const dateien = new Map();
    for (const d of [clientDir, serverDir]) for (const n of readdirSync(d)) dateien.set(n, readFileSync(path.join(d, n)));
    dateien.set('hajime-holen.sh', Buffer.from('#!/bin/sh\n'));
    const fetchFn = async (url) => {
        const u = String(url);
        if (u.endsWith('/releases/latest') || u.endsWith(`/releases/tags/v${version}`)) {
            return new Response(JSON.stringify({
                tag_name: `v${version}`, published_at: '2026-10-24T10:00:00Z',
                assets: [...dateien.keys()].map(name => ({ name, url: `https://gh.test/a/${name}` }))
            }), { status: 200 });
        }
        const m = /\/a\/(.+)$/.exec(u);
        if (m && dateien.has(m[1])) return new Response(dateien.get(m[1]), { status: 200 });
        return new Response('{}', { status: 404 });
    };
    return { fetchFn, dateien, aufraeumen: () => rmSync(quelle, { recursive: true, force: true }) };
}

test('Spiegelung: prüft Signatur und Prüfsumme, ordnet Gruppen zu, räumt auf, lehnt Fälschungen ab', async () => {
    const dir = tmp();
    const schluesselPaar = generateKeyPairSync('ed25519');
    const privat = schluesselPaar.privateKey.export({ type: 'pkcs8', format: 'pem' });
    const oeffentlich = schluesselPaar.publicKey.export({ type: 'spki', format: 'pem' });
    const fremd = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' });
    const log = { log() {}, warn() {} };
    const doubles = [];
    try {
        const r1 = baueRelease({ version: '1.2.3', privat }); doubles.push(r1);
        const ergebnis = await spiegleRelease({ repo: 'x/y', token: 't', dir, schluessel: oeffentlich, fetchFn: r1.fetchFn, apiBasis: 'https://gh.test', log });
        assert.deepEqual(ergebnis, { status: 'gespiegelt', version: '1.2.3' });
        const index = liesIndex(dir, '1.2.3');
        const nach = (n) => index.dateien.find(d => d.name === n);
        assert.equal(nach('Hajime-Pro-Server-1.2.3-win-x64.exe').gruppe, 'server');
        assert.equal(nach('Hajime-Pro-Setup-1.2.3.exe').gruppe, 'client');
        assert.equal(nach('Hajime-Pro-1.2.3.apk').bezeichnung, 'Android');
        assert.equal(nach('Hajime-Pro-Dienst-1.2.3.tar.gz').plattform, 'linux-dienst');
        assert.equal(nach('hajime-holen.sh').gruppe, 'hilfe');
        assert.equal(nach('version.json').gruppe, 'intern');
        assert.equal((await spiegleRelease({ repo: 'x/y', token: 't', dir, schluessel: oeffentlich, fetchFn: r1.fetchFn, apiBasis: 'https://gh.test', log })).status, 'aktuell');

        // Signatur mit anderem Schlüssel: nichts wird sichtbar, kein Rest bleibt liegen
        const r2 = baueRelease({ version: '1.2.4', privat: fremd }); doubles.push(r2);
        await assert.rejects(spiegleRelease({ repo: 'x/y', token: 't', dir, schluessel: oeffentlich, fetchFn: r2.fetchFn, apiBasis: 'https://gh.test', log }), /Signatur ungültig/);
        assert.deepEqual(listeVersionen(dir), ['1.2.3']);
        assert.equal(existsSync(path.join(dir, '1.2.4.teil')), false);

        // Datei nach dem Signieren verändert: Prüfsumme stimmt nicht
        const r3 = baueRelease({ version: '1.2.5', privat }); doubles.push(r3);
        const original = r3.fetchFn;
        const verfaelscht = async (url, o) => /Setup-1\.2\.5\.exe$/.test(String(url)) ? new Response('manipuliert') : original(url, o);
        await assert.rejects(spiegleRelease({ repo: 'x/y', token: 't', dir, schluessel: oeffentlich, fetchFn: verfaelscht, apiBasis: 'https://gh.test', log }), /Prüfsumme/);
        assert.deepEqual(listeVersionen(dir), ['1.2.3']);

        // Aufbewahrung: nur die neuesten N Versionen
        for (const v of ['1.2.6', '1.2.7', '1.2.8']) {
            const r = baueRelease({ version: v, privat }); doubles.push(r);
            await spiegleRelease({ repo: 'x/y', token: 't', dir, schluessel: oeffentlich, fetchFn: r.fetchFn, apiBasis: 'https://gh.test', behalte: 2, log });
        }
        assert.deepEqual(listeVersionen(dir), ['1.2.8', '1.2.7']);

        // Die Cloud aktualisiert sich aus der eigenen Ablage (GitHub-Form)
        const lokal = erzeugeLokalenReleaseZugriff(dir);
        const latest = await (await lokal.fetchFn(`${lokal.apiBasis}/repos/lokal/releases/latest`)).json();
        assert.equal(latest.tag_name, 'v1.2.8');
        const asset = latest.assets.find(a => a.name === 'Hajime-Pro-Dienst-1.2.8.tar.gz');
        const roh = Buffer.from(await (await lokal.fetchFn(asset.url, { headers: {} })).arrayBuffer());
        assert.equal(roh.length, asset.size);
        const rest = Buffer.from(await (await lokal.fetchFn(asset.url, { headers: { Range: 'bytes=10-' } })).arrayBuffer());
        assert.equal(rest.length, asset.size - 10);
    } finally {
        doubles.forEach(d => d.aufraeumen());
        rmSync(dir, { recursive: true, force: true });
    }
});

test('Dateiname trägt den Einlösecode vor der Endung; Tickets sind einmalig und kurz gültig', () => {
    assert.equal(dateinameMitCode('Hajime-Pro-Server-1.2.3-win-x64.exe', 'AbCdEfGh23456789'), 'Hajime-Pro-Server-1.2.3-win-x64.AbCdEfGh23456789.exe');
    let jetzt = 1_000_000;
    const tickets = erzeugeTicketDienst({ jetzt: () => jetzt });
    const t = tickets.stelleAus({ benutzerId: 'u1', version: '1.0.0', datei: 'a.exe' });
    assert.equal(tickets.loeseEin(`${t}x`), null, 'veränderte Signatur');
    assert.deepEqual(tickets.loeseEin(t), { benutzerId: 'u1', version: '1.0.0', datei: 'a.exe' });
    assert.equal(tickets.loeseEin(t), null, 'zweiter Abruf');
    const t2 = tickets.stelleAus({ benutzerId: 'u1', version: '1.0.0', datei: 'a.exe' });
    jetzt += 61_000;
    assert.equal(tickets.loeseEin(t2), null, 'abgelaufen');
});

test('Berechtigung, Download, Einlösecode, Geräteschlüssel und Fassade gegen die Datenbank', async () => {
    const db = await starteTestPostgres();
    const { knex } = db;
    const dir = tmp();
    const schluesselPaar = generateKeyPairSync('ed25519');
    const privat = schluesselPaar.privateKey.export({ type: 'pkcs8', format: 'pem' });
    const oeffentlich = schluesselPaar.publicKey.export({ type: 'spki', format: 'pem' });
    const release = baueRelease({ version: '2.0.0', privat });
    let server;
    try {
        await spiegleRelease({ repo: 'x/y', token: 't', dir, schluessel: oeffentlich, fetchFn: release.fetchFn, apiBasis: 'https://gh.test', log: { log() {}, warn() {} } });

        const verein = id((await knex('vereine').insert({ name: 'JC Test' }).returning('id'))[0]);
        const andererVerein = id((await knex('vereine').insert({ name: 'JC Anders' }).returning('id'))[0]);
        const konten = ['helfer', 'benutzer', 'admin', 'super', 'offen', 'unbestaetigt', 'gesperrt', 'ohneverein', 'fremdadmin'];
        for (const n of konten) {
            await knex('benutzer').insert({
                id: `u-${n}`, email: `${n}@test.de`, vorname: n, nachname: 'Test', password_hash: 'x:y',
                email_bestaetigt_am: n === 'unbestaetigt' ? null : knex.fn.now(), gesperrt: n === 'gesperrt'
            });
        }
        await knex('benutzer').where({ id: 'u-super' }).update({ ist_super_admin: true, super_admin_modus: true });
        await knex('benutzer_vereine').insert([
            { benutzer_id: 'u-helfer', verein_id: verein, freigegeben: 1, rolle: 'helfer' },
            { benutzer_id: 'u-benutzer', verein_id: verein, freigegeben: 1, rolle: 'benutzer' },
            { benutzer_id: 'u-admin', verein_id: verein, freigegeben: 1, rolle: 'admin' },
            { benutzer_id: 'u-offen', verein_id: verein, freigegeben: 0, rolle: 'benutzer' },
            { benutzer_id: 'u-unbestaetigt', verein_id: verein, freigegeben: 1, rolle: 'benutzer' },
            { benutzer_id: 'u-gesperrt', verein_id: verein, freigegeben: 1, rolle: 'admin' },
            { benutzer_id: 'u-fremdadmin', verein_id: andererVerein, freigegeben: 1, rolle: 'admin' }
        ]);

        // Berechtigung: Benutzer, Admins, Super-Admins; Konto UND Mitgliedschaft müssen freigeschaltet sein
        const darf = {};
        for (const n of konten) darf[n] = await darfReleasesLaden(knex, `u-${n}`);
        assert.deepEqual(darf, {
            helfer: false, benutzer: true, admin: true, super: true, offen: false, unbestaetigt: false, gesperrt: false, ohneverein: false, fremdadmin: true
        });
        assert.equal(await darfReleasesLaden(knex, 'gibt-es-nicht'), false);

        const app = express();
        app.set('knex', knex);
        app.use(express.json());
        app.use('/api/downloads', getDownloadRoutes(knex, { dir, spiegel: null }));
        app.use('/api/releases/v1', getReleaseFassadeRoutes(knex, { dir }));
        server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
        const basis = `http://127.0.0.1:${server.address().port}`;
        const token = (n) => jwt.sign({ id: `u-${n}`, email: `${n}@test.de` }, process.env.JWT_SECRET);
        const aufruf = (konto, methode, pfad, body, kopf = {}) => fetch(basis + pfad, {
            method: methode,
            headers: { 'Content-Type': 'application/json', ...(konto ? { Authorization: `Bearer ${konto.startsWith('hjg_') ? konto : token(konto)}` } : {}), ...kopf },
            body: body === undefined ? undefined : JSON.stringify(body)
        });

        // Liste: nur berechtigte Konten; interne Dateien (version.json …) tauchen nicht auf
        assert.equal((await aufruf(null, 'GET', '/api/downloads')).status, 401);
        for (const n of ['helfer', 'offen', 'unbestaetigt', 'gesperrt']) assert.ok([401, 403].includes((await aufruf(n, 'GET', '/api/downloads')).status), n);
        const liste = await (await aufruf('benutzer', 'GET', '/api/downloads')).json();
        assert.equal(liste.version, '2.0.0');
        const namen = liste.dateien.map(d => d.name).sort();
        assert.ok(namen.includes('Hajime-Pro-Server-2.0.0-win-x64.exe'));
        assert.ok(!namen.includes('version.json') && !namen.includes('server-version.json'));
        assert.equal(liste.dateien.find(d => d.name === 'Hajime-Pro-Setup-2.0.0.exe').mitCode, false);
        assert.equal(liste.dateien.find(d => d.name === 'Hajime-Pro-Server-2.0.0-win-x64.exe').mitCode, true);

        // Ticket: Helfer bekommt keins, interne Dateien nicht, Benutzer lädt (Range, einmalig)
        assert.equal((await aufruf('helfer', 'POST', '/api/downloads/ticket', { datei: 'Hajime-Pro-Setup-2.0.0.exe' })).status, 403);
        assert.equal((await aufruf('benutzer', 'POST', '/api/downloads/ticket', { datei: 'version.json' })).status, 404);
        assert.equal((await aufruf('benutzer', 'POST', '/api/downloads/ticket', { datei: '../../etc/passwd' })).status, 404);
        const t1 = await (await aufruf('benutzer', 'POST', '/api/downloads/ticket', { datei: 'Hajime-Pro-Setup-2.0.0.exe' })).json();
        const roh = release.dateien.get('Hajime-Pro-Setup-2.0.0.exe');
        const geladen = await fetch(basis + t1.url);
        assert.equal(geladen.status, 200);
        assert.equal(geladen.headers.get('content-disposition'), 'attachment; filename="Hajime-Pro-Setup-2.0.0.exe"');
        assert.deepEqual(Buffer.from(await geladen.arrayBuffer()), roh);
        assert.equal((await fetch(basis + t1.url)).status, 403, 'Ticket gilt nur einmal');
        const t2 = await (await aufruf('benutzer', 'POST', '/api/downloads/ticket', { datei: 'Hajime-Pro-Setup-2.0.0.exe' })).json();
        const teil = await fetch(basis + t2.url, { headers: { Range: 'bytes=5-9' } });
        assert.equal(teil.status, 206);
        assert.equal(teil.headers.get('content-range'), `bytes 5-9/${roh.length}`);
        assert.deepEqual(Buffer.from(await teil.arrayBuffer()), roh.subarray(5, 10));

        // Wird das Konto nach dem Ticket gesperrt, ist der Link nutzlos
        const t3 = await (await aufruf('benutzer', 'POST', '/api/downloads/ticket', { datei: 'Hajime-Pro-Setup-2.0.0.exe' })).json();
        await knex('benutzer').where({ id: 'u-benutzer' }).update({ gesperrt: true });
        assert.equal((await fetch(basis + t3.url)).status, 403);
        await knex('benutzer').where({ id: 'u-benutzer' }).update({ gesperrt: false });

        // Server-Installer: der Dateiname trägt einen Einlösecode, der gegen einen Geräteschlüssel getauscht werden kann
        const ts = await (await aufruf('admin', 'POST', '/api/downloads/ticket', { datei: 'Hajime-Pro-Server-2.0.0-win-x64.exe' })).json();
        const serverDatei = await fetch(basis + ts.url);
        const name = /filename="([^"]+)"/.exec(serverDatei.headers.get('content-disposition'))[1];
        const code = /\.([A-Za-z0-9]{16})\.exe$/.exec(name)[1];
        assert.match(name, /^Hajime-Pro-Server-2\.0\.0-win-x64\.[A-Za-z0-9]{16}\.exe$/);
        assert.equal(Buffer.from(await serverDatei.arrayBuffer()).length, release.dateien.get('Hajime-Pro-Server-2.0.0-win-x64.exe').length, 'der Inhalt bleibt unverändert (Signatur gilt weiter)');

        assert.equal((await aufruf(null, 'POST', '/api/downloads/einloesen', { code: 'AAAAAAAAAAAAAAAA' })).status, 403);
        assert.equal((await aufruf(null, 'POST', '/api/downloads/einloesen', { code: 'zu kurz' })).status, 403);
        const eingeloest = await aufruf(null, 'POST', '/api/downloads/einloesen', { code, bezeichnung: 'Halle Nord' });
        assert.equal(eingeloest.status, 200);
        const geraet = (await eingeloest.json()).schluessel;
        assert.match(geraet, /^hjg_/);
        assert.equal((await aufruf(null, 'POST', '/api/downloads/einloesen', { code })).status, 403, 'Code gilt nur einmal');
        const gespeichert = await knex('download_schluessel');
        assert.equal(gespeichert.length, 1);
        assert.ok(!JSON.stringify(gespeichert).includes(geraet.slice(4)), 'nur der Hash liegt in der Datenbank');
        assert.equal(gespeichert[0].benutzer_id, 'u-admin');
        assert.equal(gespeichert[0].bezeichnung, 'Halle Nord');

        // abgelaufener Code
        const alt = await erzeugeEinloesecode(knex, 'u-admin', { jetzt: () => Date.now() - 15 * 86_400_000 });
        assert.equal(await loeseEinloesecodeAb(knex, alt), null);

        // Fassade: GitHub-Form, nur mit Geräteschlüssel
        assert.equal((await aufruf(null, 'GET', '/api/releases/v1/repos/cloud/releases/latest')).status, 401);
        assert.equal((await aufruf('hjg_falsch', 'GET', '/api/releases/v1/repos/cloud/releases/latest')).status, 401);
        assert.equal((await aufruf('admin', 'GET', '/api/releases/v1/repos/cloud/releases/latest')).status, 401, 'Sitzung genügt nicht, es braucht den Geräteschlüssel');
        const latest = await (await aufruf(geraet, 'GET', '/api/releases/v1/repos/cloud/releases/latest')).json();
        assert.equal(latest.tag_name, 'v2.0.0');
        const asset = latest.assets.find(a => a.name === 'server-version.json');
        assert.match(asset.url, /\/api\/releases\/v1\/assets\/2\.0\.0\/server-version\.json$/);
        assert.equal(JSON.parse(await (await fetch(asset.url, { headers: { Authorization: `Bearer ${geraet}` } })).text()).version, '2.0.0');
        assert.equal((await fetch(asset.url)).status, 401, 'Asset-URLs verlangen ebenfalls den Schlüssel');
        assert.equal((await aufruf(geraet, 'GET', '/api/releases/v1/repos/cloud/releases/tags/v9.9.9')).status, 404);
        assert.equal((await aufruf(geraet, 'GET', '/api/releases/v1/assets/2.0.0/..%2F..%2Fpackage.json')).status, 404);

        // Berechtigung gilt bei jedem Abruf: Mitgliedschaft entzogen → der Schlüssel des Servers endet mit
        await knex('benutzer_vereine').where({ benutzer_id: 'u-admin' }).update({ freigegeben: 0 });
        assert.equal((await aufruf(geraet, 'GET', '/api/releases/v1/repos/cloud/releases/latest')).status, 401);
        assert.equal(await pruefeGeraeteSchluessel(knex, geraet), null);
        await knex('benutzer_vereine').where({ benutzer_id: 'u-admin' }).update({ freigegeben: 1 });
        assert.equal((await aufruf(geraet, 'GET', '/api/releases/v1/repos/cloud/releases/latest')).status, 200);

        // Schlüssel über die Anmeldung (Hallen-Server holt ihn bei „Turnier aus der Cloud holen“)
        assert.equal((await aufruf('helfer', 'POST', '/api/downloads/geraet', {})).status, 403);
        const sB = (await (await aufruf('benutzer', 'POST', '/api/downloads/geraet', { bezeichnung: 'Notebook' })).json()).schluessel;
        assert.equal((await aufruf(sB, 'GET', '/api/releases/v1/repos/cloud/releases/latest')).status, 200);

        // Verwaltung: Admin sieht die Schlüssel der Mitglieder seines Vereins, ein fremder Admin nicht; widerrufen geht nur im eigenen Bereich
        const sicht = async (konto) => (await (await aufruf(konto, 'GET', '/api/downloads/schluessel')).json()).schluessel;
        assert.equal((await sicht('admin')).length, 2);
        assert.equal((await sicht('fremdadmin')).length, 0);
        assert.equal((await sicht('benutzer')).length, 1, 'ein Benutzer sieht nur seine eigenen');
        const idB = (await sicht('benutzer'))[0].id;
        assert.equal((await aufruf('fremdadmin', 'DELETE', `/api/downloads/schluessel/${idB}`)).status, 404);
        assert.equal((await aufruf('admin', 'DELETE', `/api/downloads/schluessel/${idB}`)).status, 200);
        assert.equal((await aufruf(sB, 'GET', '/api/releases/v1/repos/cloud/releases/latest')).status, 401, 'widerrufen');
        assert.equal((await sicht('super')).length, 2, 'der Super-Admin sieht alle');
    } finally {
        if (server) await new Promise(r => server.close(r));
        release.aufraeumen();
        rmSync(dir, { recursive: true, force: true });
        await db.stoppe();
    }
});
