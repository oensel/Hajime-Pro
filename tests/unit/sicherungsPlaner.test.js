import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.BETRIEBSMODUS = 'cloud';
delete process.env.IS_OFFLINE;

const { starteTestPostgres } = await import('../helpers/testPostgres.js');
const sp = await import('../../src/services/sicherungsPlaner.js');
const ds = await import('../../src/services/datensicherung.js');

test('Sicherungsplaner: Konfiguration', () => {
    assert.deepEqual(sp.leseSicherungsKonfig({}), { automatisch: true, uhrzeit: '03:00', behalte: 14, kopieVerzeichnis: '', nachBefehl: '' });
    const k = sp.leseSicherungsKonfig({
        SICHERUNG_AUTOMATISCH: 'false', SICHERUNG_UHRZEIT: '22:30', SICHERUNG_BEHALTEN: '5', SICHERUNG_KOPIE_VERZEICHNIS: ' /mnt/box ', SICHERUNG_NACH_BEFEHL: 'rclone copy x y'
    });
    assert.deepEqual(k, { automatisch: false, uhrzeit: '22:30', behalte: 5, kopieVerzeichnis: '/mnt/box', nachBefehl: 'rclone copy x y' });
    assert.equal(sp.leseSicherungsKonfig({ SICHERUNG_UHRZEIT: '25:99' }).uhrzeit, '03:00', 'ungültige Uhrzeit → Standard');
    assert.equal(sp.leseSicherungsKonfig({ SICHERUNG_BEHALTEN: '0' }).behalte, 14);
});

test('Sicherungsplaner: wann ist der Lauf fällig (Berliner Zeit)', () => {
    // Oktober 2026: Berlin = UTC+2, 03:00 Berlin = 01:00 UTC
    const um = (iso) => new Date(iso);
    assert.equal(sp.istFaellig(um('2026-10-23T00:30:00Z'), '03:00', null), false, 'vor der Uhrzeit');
    assert.equal(sp.istFaellig(um('2026-10-23T01:00:00Z'), '03:00', null), true, 'genau zur Uhrzeit');
    assert.equal(sp.istFaellig(um('2026-10-23T15:00:00Z'), '03:00', null), true, 'später am Tag, noch nie gelaufen: nachholen');
    assert.equal(sp.istFaellig(um('2026-10-23T15:00:00Z'), '03:00', '2026-10-23T01:00:05Z'), false, 'heute schon gelaufen');
    assert.equal(sp.istFaellig(um('2026-10-24T01:00:00Z'), '03:00', '2026-10-23T01:00:05Z'), true, 'nächster Tag');
    // 23:30 Berlin am 23.10. ist 21:30 UTC: ein Lauf um 21:45 UTC (23:45 Berlin) zählt noch zum 23.
    assert.equal(sp.istFaellig(um('2026-10-23T22:30:00Z'), '03:00', '2026-10-23T21:45:00Z'), false, 'nach Mitternacht Berlin, aber derselbe UTC-Tag');
    assert.equal(sp.istFaellig(um('2026-10-24T01:30:00Z'), '03:00', '2026-10-23T21:45:00Z'), true, 'neuer Berliner Tag');
});

test('Sicherungsplaner: Lauf mit Kopie, Befehl, Fehlern und Aufbewahrung', async () => {
    const db = await starteTestPostgres();
    const { knex } = db;
    const basis = fs.mkdtempSync(path.join(os.tmpdir(), 'hajime-planer-'));
    const verzeichnis = path.join(basis, 'sicherungen');
    const kopie = path.join(basis, 'kopie');
    const marker = path.join(basis, 'befehl-lief.txt');
    const fehlerLog = [];
    const alterFehler = console.error;
    console.error = (...a) => { fehlerLog.push(a.join(' ')); };
    try {
        await knex('vereine').insert({ name: 'JC Planer' });
        const konfig = { automatisch: true, uhrzeit: '03:00', behalte: 2, kopieVerzeichnis: kopie, nachBefehl: '' };

        // 1) nur Sicherung und Kopie
        let status = await sp.fuehreAutomatischeSicherungAus(knex, verzeichnis, konfig);
        assert.equal(status.ok, true);
        assert.match(status.name, /^auto-sicherung-\d{8}-\d{6}\.hajime-sicherung\.gz$/);
        assert.ok(status.groesse > 0);
        assert.deepEqual(status.kopie, { ok: true, ziel: kopie });
        assert.equal(fs.existsSync(path.join(kopie, status.name)), true);
        assert.equal(fs.statSync(path.join(kopie, status.name)).size, status.groesse, 'Kopie ist vollständig');
        assert.deepEqual(await sp.leseStatus(verzeichnis), status);

        // 2) Befehl bekommt Datei und Namen in der Umgebung
        const befehl = `node -e "require('fs').writeFileSync(process.argv[1], process.env.HAJIME_SICHERUNG_NAME + '|' + process.env.HAJIME_SICHERUNG_DATEI)" "${marker}"`;
        await new Promise((r) => setTimeout(r, 1100)); // eindeutiger Zeitstempel im Dateinamen
        status = await sp.fuehreAutomatischeSicherungAus(knex, verzeichnis, { ...konfig, nachBefehl: befehl });
        assert.equal(status.ok, true);
        assert.deepEqual(status.befehl, { ok: true });
        const [name, pfad] = fs.readFileSync(marker, 'utf8').split('|');
        assert.equal(name, status.name);
        assert.equal(pfad, path.join(verzeichnis, status.name));

        // 3) Aufbewahrung: nur die letzten 2 automatischen Sicherungen, auch in der Kopie; fremde Dateien bleiben
        fs.writeFileSync(path.join(verzeichnis, 'notiz.txt'), 'bleibt');
        fs.writeFileSync(path.join(kopie, 'fremd.txt'), 'bleibt');
        await new Promise((r) => setTimeout(r, 1100));
        await sp.fuehreAutomatischeSicherungAus(knex, verzeichnis, konfig);
        const auto = (await ds.listeSicherungsdateien(verzeichnis)).filter((d) => d.name.startsWith('auto-sicherung-'));
        assert.equal(auto.length, 2);
        assert.equal((await ds.listeSicherungsdateien(kopie)).length, 2);
        assert.equal(fs.existsSync(path.join(verzeichnis, 'notiz.txt')) && fs.existsSync(path.join(kopie, 'fremd.txt')), true);

        // 4) Kopie und Befehl scheitern: Sicherung bleibt, Status und Fehlerprotokoll melden es
        fehlerLog.length = 0;
        const gesperrt = path.join(basis, 'datei-statt-ordner');
        fs.writeFileSync(gesperrt, 'x');
        await new Promise((r) => setTimeout(r, 1100));
        status = await sp.fuehreAutomatischeSicherungAus(knex, verzeichnis, { ...konfig, kopieVerzeichnis: path.join(gesperrt, 'unterordner'), nachBefehl: 'node -e "process.stderr.write(\'Ziel nicht erreichbar\'); process.exit(3)"' });
        assert.equal(status.ok, false);
        assert.ok(status.name, 'die Sicherung selbst ist da');
        assert.equal(status.kopie.ok, false);
        assert.deepEqual([status.befehl.ok, /Exit-Code 3.*Ziel nicht erreichbar/.test(status.befehl.fehler)], [false, true]);
        assert.equal(fehlerLog.filter((z) => /\[Sicherung\]/.test(z)).length, 2);
        assert.equal((await sp.leseStatus(verzeichnis)).ok, false);

        // 5) die Sicherung selbst scheitert (Verzeichnis nicht anlegbar): Fehler im Status, Ausnahme für den Aufrufer
        fehlerLog.length = 0;
        await assert.rejects(() => sp.fuehreAutomatischeSicherungAus(knex, path.join(gesperrt, 'sicherungen'), konfig));
        assert.equal(fehlerLog.some((z) => /Automatische Sicherung fehlgeschlagen/.test(z)), true);

        // 6) Befehl mit Zeitlimit
        await assert.rejects(() => sp.fuehreBefehlAus('node -e "setTimeout(()=>{}, 60000)"', { pfad: 'x', name: 'y' }, { zeitlimitMs: 300 }), /Zeitüberschreitung/);
    } finally {
        console.error = alterFehler;
        fs.rmSync(basis, { recursive: true, force: true });
        await db.stoppe();
    }
});

test('Sicherungsplaner: Aufbewahrung je Dateityp bei manuellen Sicherungen', async () => {
    const db = await starteTestPostgres();
    const { knex } = db;
    const verzeichnis = fs.mkdtempSync(path.join(os.tmpdir(), 'hajime-aufbew-'));
    try {
        // zwölf „vor-wiederherstellung“-Dateien (erlaubt: 10) und eine fremde Datei
        for (let i = 0; i < 12; i += 1) {
            const name = `vor-wiederherstellung-20260101-0000${String(i).padStart(2, '0')}${ds.ENDUNG}`;
            fs.writeFileSync(path.join(verzeichnis, name), 'x');
            fs.utimesSync(path.join(verzeichnis, name), new Date(2026, 0, 1, 0, 0, i), new Date(2026, 0, 1, 0, 0, i));
        }
        fs.writeFileSync(path.join(verzeichnis, `anderes-20260101-000000${ds.ENDUNG}`), 'x');
        await ds.schreibeSicherungsdatei(knex, verzeichnis, 'vor-wiederherstellung');
        const dateien = await ds.listeSicherungsdateien(verzeichnis);
        assert.equal(dateien.filter((d) => d.name.startsWith('vor-wiederherstellung-')).length, 10);
        assert.equal(dateien.some((d) => d.name.startsWith('anderes-')), true, 'unbekannte Namen bleiben unberührt');
        assert.equal(dateien.some((d) => d.name.endsWith('000000.hajime-sicherung.gz') && d.name.startsWith('vor-')), false, 'die ältesten sind weg');
    } finally {
        fs.rmSync(verzeichnis, { recursive: true, force: true });
        await db.stoppe();
    }
});
