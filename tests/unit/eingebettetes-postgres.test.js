import test from 'node:test';
import assert from 'node:assert/strict';
import { plattformPaket, startHindernis } from '../../src/utils/eingebettetesPostgres.js';

test('plattformPaket wählt das Binary-Paket je Betriebssystem und Architektur', () => {
    assert.equal(plattformPaket('win32', 'x64'), '@embedded-postgres/windows-x64');
    assert.equal(plattformPaket('linux', 'x64'), '@embedded-postgres/linux-x64');
    assert.equal(plattformPaket('linux', 'arm64'), '@embedded-postgres/linux-arm64');
    assert.equal(plattformPaket('darwin', 'x64'), '@embedded-postgres/darwin-x64');
    assert.equal(plattformPaket('darwin', 'arm64'), '@embedded-postgres/darwin-arm64');
    assert.equal(plattformPaket('freebsd', 'x64'), null);
    assert.equal(plattformPaket('win32', 'arm64'), null);
});

test('istPortKonflikt erkennt einen belegten Port (Windows und Unix), andere Startfehler nicht', async () => {
    const { istPortKonflikt } = await import('../helpers/testPostgres.js');
    assert.equal(istPortKonflikt(new Error('PostgreSQL konnte nicht gestartet werden (Port 58643 belegt?):\nLOG:  could not bind IPv4 address "127.0.0.1": unrecognized winsock error 10048')), true);
    assert.equal(istPortKonflikt(new Error('LOG:  could not bind IPv4 address "127.0.0.1": Address already in use')), true);
    assert.equal(istPortKonflikt(new Error('PostgreSQL-Instanz konnte nicht angelegt werden (initdb): Zugriff verweigert')), false);
    assert.equal(istPortKonflikt(null), false);
});

test('startHindernis: root darf PostgreSQL nicht starten (Linux/macOS), normale Benutzer und Windows schon', () => {
    assert.match(startHindernis({ platform: 'linux', uid: 0 }), /root/);
    assert.match(startHindernis({ platform: 'darwin', uid: 0 }), /DB_HOST/);
    assert.equal(startHindernis({ platform: 'linux', uid: 1000 }), null);
    assert.equal(startHindernis({ platform: 'darwin', uid: 501 }), null);
    // Windows kennt keine uid; PostgreSQL gibt dort selbst die Administratorrechte ab.
    assert.equal(startHindernis({ platform: 'win32', uid: null }), null);
    assert.equal(startHindernis({ platform: 'win32', uid: 0 }), null);
});

test('Wächter startet die Datenbank erst nach mehreren Fehlversuchen hintereinander neu', async () => {
    const { ueberwacheEingebettetesPostgres } = await import('../../src/utils/eingebettetesPostgres.js');
    const antworten = [false, true, false, false, false, true];
    let neustarts = 0;
    const still = { log() {}, warn() {}, error() {} };
    const stopp = ueberwacheEingebettetesPostgres({ host: '127.0.0.1', port: 1, user: 'postgres', neustart: () => { neustarts += 1; } },
        { intervallMs: 5, fehlversucheBisNeustart: 3, pruefe: async () => antworten.shift() ?? true, log: still });
    await new Promise(r => setTimeout(r, 120));
    stopp();
    // ein einzelner Fehlversuch zählt nicht, erst drei in Folge
    assert.equal(neustarts, 1);
});

test('Start ersetzt eine laufende, aber nicht antwortende Instanz', { timeout: 120_000 }, async () => {
    const os = await import('os');
    const fs = await import('fs');
    const path = await import('path');
    const pg = (await import('pg')).default;
    const { starteEingebettetesPostgres } = await import('../../src/utils/eingebettetesPostgres.js');
    const verzeichnis = fs.mkdtempSync(path.join(os.tmpdir(), 'hajime-pg-heil-'));
    const pgDir = path.join(verzeichnis, 'pg');
    const port = 56000 + Math.floor(Math.random() * 2000);
    const meldungen = [];
    const log = { log: (m) => meldungen.push(m), warn: (m) => meldungen.push(m), error: (m) => meldungen.push(m) };
    let instanz;
    try {
        const erste = await starteEingebettetesPostgres({ datenverzeichnis: pgDir, port, dbName: 'heil', log });
        const c = new pg.Client({ host: erste.host, port: erste.port, user: 'postgres', database: 'heil' });
        await c.connect();
        await c.query('create table merker (wert text)');
        await c.query("insert into merker values ('vorher')");
        await c.end();

        // Zweiter Start: die Instanz läuft, gilt aber als hängend -> sie wird neu gestartet, die Daten bleiben
        instanz = await starteEingebettetesPostgres({ datenverzeichnis: pgDir, port, dbName: 'heil', log, pruefe: async () => false });
        assert.ok(meldungen.some(m => /antwortet nicht/.test(m)), meldungen.join('\n'));
        assert.equal(instanz.bereitsGelaufen, false);
        const d = new pg.Client({ host: instanz.host, port: instanz.port, user: 'postgres', database: 'heil' });
        await d.connect();
        assert.equal((await d.query('select wert from merker')).rows[0].wert, 'vorher');
        await d.end();

        // Neustart im laufenden Betrieb (Wächter) behält den Port
        instanz.neustart();
        const e = new pg.Client({ host: instanz.host, port: instanz.port, user: 'postgres', database: 'heil' });
        await e.connect();
        assert.equal((await e.query('select count(*)::int as n from merker')).rows[0].n, 1);
        await e.end();
    } finally {
        try { instanz?.stoppe('immediate'); } catch { /* egal */ }
        fs.rmSync(verzeichnis, { recursive: true, force: true });
    }
});
