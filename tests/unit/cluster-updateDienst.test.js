import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { erzeugeUpdateDienst } from '../../src/cluster/updateDienst.js';

const antwort = (tag, ok = true) => async () => ({ ok, json: async () => ({ tag_name: tag }) });
const leer = async () => {};

test('neueste Version: v-Präfix entfernt, 10 Minuten zwischengespeichert, Fehler ergeben null', async () => {
    let zeit = 0;
    let aufrufe = 0;
    const dienst = erzeugeUpdateDienst({
        repo: 'a/b', statusDatei: '/nicht/da', updateBefehl: 'x', fuehreBefehlAus: leer,
        fetchFn: async (...a) => { aufrufe++; return antwort('v1.0.18')(...a); }, jetzt: () => zeit, env: {}
    });
    assert.equal(await dienst.neuesteVersion(), '1.0.18');
    zeit = 9 * 60_000;
    assert.equal(await dienst.neuesteVersion(), '1.0.18');
    assert.equal(aufrufe, 1);
    zeit = 11 * 60_000;
    await dienst.neuesteVersion();
    assert.equal(aufrufe, 2);

    const kaputt = erzeugeUpdateDienst({ repo: 'a/b', statusDatei: '/x', updateBefehl: 'x', fuehreBefehlAus: leer, fetchFn: async () => { throw new Error('offline'); }, env: {} });
    assert.equal(await kaputt.neuesteVersion(), null);
    const unsinn = erzeugeUpdateDienst({ repo: 'a/b', statusDatei: '/x', updateBefehl: 'x', fuehreBefehlAus: leer, fetchFn: antwort('nightly'), env: {} });
    assert.equal(await unsinn.neuesteVersion(), null);
});

test('Test-Überschreibung CLUSTER_RELEASE_VERSION nur mit NODE_ENV=test', async () => {
    const mk = (env) => erzeugeUpdateDienst({ repo: 'a/b', statusDatei: '/x', updateBefehl: 'x', fuehreBefehlAus: leer, fetchFn: async () => { throw new Error('offline'); }, env });
    assert.equal(await mk({ NODE_ENV: 'test', CLUSTER_RELEASE_VERSION: '9.9.9' }).neuesteVersion(), '9.9.9');
    assert.equal(await mk({ CLUSTER_RELEASE_VERSION: '9.9.9' }).neuesteVersion(), null);
});

test('Start: nur gültige Version, Befehl mit Version, zweiter Start abgelehnt, Status aus der Datei', async () => {
    const ordner = mkdtempSync(path.join(os.tmpdir(), 'hajime-upd-'));
    const statusDatei = path.join(ordner, 'update-status.json');
    const befehle = [];
    let fertig;
    const dienst = erzeugeUpdateDienst({
        repo: 'a/b', statusDatei, updateBefehl: 'sudo -n /usr/local/bin/hajime-update.sh',
        fuehreBefehlAus: (b) => { befehle.push(b); return new Promise((r) => { fertig = r; }); }, env: {}
    });
    await assert.rejects(() => dienst.starte('1.0; rm -rf /'), /ungültig/i);
    assert.equal(befehle.length, 0);

    const l = dienst.starte('1.0.18');
    assert.equal(dienst.laeuft(), true);
    await assert.rejects(() => dienst.starte('1.0.18'), /läuft bereits/);
    assert.deepEqual(befehle, ['sudo -n /usr/local/bin/hajime-update.sh 1.0.18']);
    fertig('');
    await l;
    assert.equal(dienst.laeuft(), false);

    writeFileSync(statusDatei, JSON.stringify({ zustand: 'fertig', ziel: '1.0.18', meldung: 'ok', zeit: 't' }));
    assert.equal(dienst.status().zustand, 'fertig');
    assert.equal(erzeugeUpdateDienst({ repo: 'a/b', statusDatei: path.join(ordner, 'nix.json'), updateBefehl: 'x', fuehreBefehlAus: leer, env: {} }).status(), null);
});

test('laeuft(): auch während das Root-Skript im Hintergrund arbeitet (Status "laeuft"), veralteter Status zählt nicht', async () => {
    const ordner = mkdtempSync(path.join(os.tmpdir(), 'hajime-upd-'));
    const statusDatei = path.join(ordner, 'update-status.json');
    let zeit = Date.parse('2026-10-14T10:00:00Z');
    const dienst = erzeugeUpdateDienst({ repo: 'a/b', statusDatei, updateBefehl: 'x', fuehreBefehlAus: leer, jetzt: () => zeit, env: {} });
    assert.equal(dienst.laeuft(), false);
    writeFileSync(statusDatei, JSON.stringify({ zustand: 'laeuft', ziel: '1.0.18', zeit: '2026-10-14T09:50:00Z' }));
    assert.equal(dienst.laeuft(), true);
    zeit = Date.parse('2026-10-14T11:30:00Z'); // über 60 Minuten alt: abgebrochen/abgestürzt
    assert.equal(dienst.laeuft(), false);
});
