import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { raeumeAlteTempVerzeichnisseAuf } from '../helpers/testPostgres.js';

function legeAn(basis, name, { alterMs = 0, pid = false } = {}) {
    const dir = path.join(basis, name);
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'PG_VERSION'), '17');
    if (pid) fs.writeFileSync(path.join(dir, 'postmaster.pid'), '1234');
    const zeit = new Date(Date.now() - alterMs);
    fs.utimesSync(dir, zeit, zeit);
    return dir;
}

test('raeumeAlteTempVerzeichnisseAuf: löscht nur alte hajime-pg-* ohne laufenden Server', () => {
    const basis = fs.mkdtempSync(path.join(os.tmpdir(), 'raeume-test-'));
    try {
        const stunde = 60 * 60 * 1000;
        const alt = legeAn(basis, 'hajime-pg-alt', { alterMs: 2 * stunde });
        fs.writeFileSync(`${alt}.log`, 'log');
        const laeuft = legeAn(basis, 'hajime-pg-laeuft', { alterMs: 2 * stunde, pid: true });
        const neu = legeAn(basis, 'hajime-pg-neu', { alterMs: 60 * 1000 });
        const fremd = legeAn(basis, 'anderes-pg', { alterMs: 2 * stunde });

        raeumeAlteTempVerzeichnisseAuf({ basis, maxAlterMs: stunde });

        assert.equal(fs.existsSync(alt), false, 'altes Verzeichnis ohne postmaster.pid wird gelöscht');
        assert.equal(fs.existsSync(`${alt}.log`), false, 'samt Log-Datei');
        assert.equal(fs.existsSync(laeuft), true, 'mit postmaster.pid (Server läuft) bleibt es');
        assert.equal(fs.existsSync(neu), true, 'jüngere Verzeichnisse bleiben (laufende Tests)');
        assert.equal(fs.existsSync(fremd), true, 'fremde Verzeichnisse werden nie angefasst');
    } finally {
        fs.rmSync(basis, { recursive: true, force: true });
    }
});

test('raeumeAlteTempVerzeichnisseAuf: fehlendes Basisverzeichnis ist kein Fehler', () => {
    assert.doesNotThrow(() => raeumeAlteTempVerzeichnisseAuf({ basis: path.join(os.tmpdir(), 'gibt-es-nicht-' + Date.now()) }));
});
