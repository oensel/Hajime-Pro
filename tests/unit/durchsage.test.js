import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { writeFileSync, readFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { waehlePlayer, playerKandidaten, erzeugeAusgabe } from '../../src/durchsage/audioAusgabe.js';
import { erzeugeDurchsageDienst, haengeDurchsageAn, verbindeAlsProxy, istErlaubt, DURCHSAGE_PFAD } from '../../src/durchsage/durchsageDienst.js';

test('Playerwahl: erster vorhandener Kandidat je Betriebssystem, sonst null', () => {
    assert.equal(waehlePlayer({ plattform: 'linux', env: {}, vorhanden: b => b === 'paplay' }).name, 'paplay');
    assert.equal(waehlePlayer({ plattform: 'linux', env: {}, vorhanden: () => true }).name, 'aplay');
    assert.equal(waehlePlayer({ plattform: 'darwin', env: {}, vorhanden: b => b === 'play' }).name, 'sox');
    assert.equal(waehlePlayer({ plattform: 'win32', env: {}, vorhanden: () => true }).name, 'windows-waveout');
    assert.equal(waehlePlayer({ plattform: 'linux', env: {}, vorhanden: () => false }), null);
});

test('DURCHSAGE_PLAYER_BEFEHL überschreibt die Suche', () => {
    const p = waehlePlayer({ plattform: 'linux', env: { DURCHSAGE_PLAYER_BEFEHL: 'mein-player -x' }, vorhanden: () => false });
    assert.equal(p.befehl, 'mein-player -x');
    assert.equal(p.shell, true);
});

test('alle Kandidaten lesen 16 kHz Mono von stdin', () => {
    for (const plattform of ['linux', 'darwin', 'win32']) {
        for (const k of playerKandidaten(plattform)) {
            if (k.name === 'windows-waveout') continue;
            assert.ok(k.args.join(' ').includes('16000'), `${k.name} muss 16000 Hz verwenden`);
        }
    }
});

test('ohne Player meldet der Status einen Grund', () => {
    const a = erzeugeAusgabe({ plattform: 'linux', env: {}, vorhanden: () => false });
    const st = a.status();
    assert.equal(st.verfuegbar, false);
    assert.match(st.grund, /alsa-utils/);
    assert.throws(() => a.oeffne(), /alsa-utils/);
});

// --- Dienst mit echtem WebSocket und Fake-Player (schreibt stdin in eine Datei) -------------------------------

function fakeAusgabe(verzeichnis) {
    const datei = path.join(verzeichnis, 'pcm.raw');
    const skript = path.join(verzeichnis, 'player.mjs');
    writeFileSync(skript, `import { createWriteStream } from 'node:fs'; process.stdin.pipe(createWriteStream(${JSON.stringify(datei)}));`);
    const befehl = `"${process.execPath}" "${skript}"`;
    return { datei, ausgabe: erzeugeAusgabe({ env: { DURCHSAGE_PLAYER_BEFEHL: befehl } }) };
}

async function starteServer(dienst, secret = '') {
    const server = http.createServer();
    haengeDurchsageAn(server, { verbinde: ws => dienst.verbinde(ws), secret: () => secret });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    return { server, url: `ws://127.0.0.1:${server.address().port}${DURCHSAGE_PFAD}` };
}

function oeffneClient(url, optionen) {
    const ws = new WebSocket(url, optionen);
    const nachrichten = [];
    const warten = [];
    ws.on('message', (d, bin) => {
        if (bin) return;
        const m = JSON.parse(d.toString());
        const w = warten.shift();
        if (w) w(m); else nachrichten.push(m);
    });
    ws.naechste = () => new Promise(r => { const m = nachrichten.shift(); if (m) r(m); else warten.push(r); });
    return new Promise((resolve, reject) => { ws.on('open', () => resolve(ws)); ws.on('error', reject); });
}

const pause = (ms) => new Promise(r => setTimeout(r, ms));

test('PCM-Blöcke gelangen vom WebSocket in den Player; zweiter Sprecher ist besetzt', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'durchsage-'));
    const { datei, ausgabe } = fakeAusgabe(dir);
    const dienst = erzeugeDurchsageDienst({ ausgabe });
    const { server, url } = await starteServer(dienst);
    try {
        const a = await oeffneClient(url);
        a.send(JSON.stringify({ t: 'start' }));
        assert.deepEqual(await a.naechste(), { t: 'bereit' });
        assert.equal(dienst.status().besetzt, true);

        const b = await oeffneClient(url);
        b.send(JSON.stringify({ t: 'start' }));
        assert.equal((await b.naechste()).t, 'fehler');
        b.close();

        a.send(Buffer.from([1, 2, 3, 4]));
        a.send(Buffer.from([5, 6]));
        a.send(JSON.stringify({ t: 'ende' }));
        await pause(700);
        assert.deepEqual([...readFileSync(datei)], [1, 2, 3, 4, 5, 6]);
        assert.equal(dienst.status().besetzt, false);
        a.close();

        // Sprecherplatz ist wieder frei
        const c = await oeffneClient(url);
        c.send(JSON.stringify({ t: 'start' }));
        assert.equal((await c.naechste()).t, 'bereit');
        c.close();
        await pause(300);
    } finally {
        server.close(); server.closeAllConnections?.();
        rmSync(dir, { recursive: true, force: true });
    }
});

test('Verbindungsabbruch gibt den Sprecherplatz frei', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'durchsage-'));
    const { ausgabe } = fakeAusgabe(dir);
    const dienst = erzeugeDurchsageDienst({ ausgabe });
    const { server, url } = await starteServer(dienst);
    try {
        const a = await oeffneClient(url);
        a.send(JSON.stringify({ t: 'start' }));
        await a.naechste();
        a.terminate();
        await pause(300);
        assert.equal(dienst.status().besetzt, false);
    } finally {
        server.close(); server.closeAllConnections?.();
        rmSync(dir, { recursive: true, force: true });
    }
});

test('Zeitlimit beendet die Durchsage mit Meldung', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'durchsage-'));
    const { ausgabe } = fakeAusgabe(dir);
    const dienst = erzeugeDurchsageDienst({ ausgabe, maxSekunden: 0.2 });
    const { server, url } = await starteServer(dienst);
    try {
        const a = await oeffneClient(url);
        a.send(JSON.stringify({ t: 'start' }));
        await a.naechste();
        const ende = await a.naechste();
        assert.equal(ende.t, 'ende');
        assert.match(ende.grund, /Zeitlimit/);
        assert.equal(dienst.status().besetzt, false);
        a.close();
    } finally {
        server.close(); server.closeAllConnections?.();
        rmSync(dir, { recursive: true, force: true });
    }
});

test('Secondary und fehlender Player lehnen den Start mit Grund ab', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'durchsage-'));
    const { ausgabe } = fakeAusgabe(dir);
    const secondary = erzeugeDurchsageDienst({ ausgabe, darfSenden: () => false });
    assert.equal(secondary.status().verfuegbar, false);
    const { server, url } = await starteServer(secondary);
    try {
        const a = await oeffneClient(url);
        a.send(JSON.stringify({ t: 'start' }));
        const m = await a.naechste();
        assert.equal(m.t, 'fehler');
        assert.match(m.grund, /Secondary/);
        a.close();
    } finally {
        server.close(); server.closeAllConnections?.();
        rmSync(dir, { recursive: true, force: true });
    }
    assert.equal(existsSync(path.join(dir, 'pcm.raw')), false);
});

test('SYNC_SECRET: Header oder Same-Origin-Browser, sonst 401', async () => {
    assert.equal(istErlaubt({ headers: {}, url: '/api/durchsage' }, ''), true);
    assert.equal(istErlaubt({ headers: {}, url: '/api/durchsage' }, 'geheim'), false);
    assert.equal(istErlaubt({ headers: { 'x-hajime-sync-secret': 'geheim' }, url: '/api/durchsage' }, 'geheim'), true);
    assert.equal(istErlaubt({ headers: { 'sec-fetch-site': 'same-origin' }, url: '/api/durchsage' }, 'geheim'), true);
    assert.equal(istErlaubt({ headers: {}, url: '/api/durchsage?secret=geheim' }, 'geheim'), true);
    assert.equal(istErlaubt({ headers: { origin: 'http://turnier.local:3000', host: 'turnier.local:3000' }, url: '/api/durchsage' }, 'geheim'), true);
    assert.equal(istErlaubt({ headers: { origin: 'http://boese.example', host: 'turnier.local:3000' }, url: '/api/durchsage' }, 'geheim'), false);

    const dir = mkdtempSync(path.join(tmpdir(), 'durchsage-'));
    const { ausgabe } = fakeAusgabe(dir);
    const { server, url } = await starteServer(erzeugeDurchsageDienst({ ausgabe }), 'geheim');
    try {
        await assert.rejects(oeffneClient(url), /401/);
        const ok = await oeffneClient(url, { headers: { 'x-hajime-sync-secret': 'geheim' } });
        ok.close();
    } finally {
        server.close(); server.closeAllConnections?.();
        rmSync(dir, { recursive: true, force: true });
    }
});

test('Client-Knoten leitet die Durchsage mit SYNC_SECRET an den Hallen-Server weiter', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'durchsage-'));
    const { datei, ausgabe } = fakeAusgabe(dir);
    const hallenServer = await starteServer(erzeugeDurchsageDienst({ ausgabe }), 'geheim');
    // Client-Knoten: bindet nur an localhost (kein Secret nötig), reicht an den Hallen-Server weiter
    const clientHttp = http.createServer();
    haengeDurchsageAn(clientHttp, {
        verbinde: ws => verbindeAlsProxy(ws, { serverUrl: hallenServer.url.replace(/^ws/, 'http').replace(DURCHSAGE_PFAD, ''), secret: 'geheim' })
    });
    await new Promise(r => clientHttp.listen(0, '127.0.0.1', r));
    try {
        const a = await oeffneClient(`ws://127.0.0.1:${clientHttp.address().port}${DURCHSAGE_PFAD}`);
        a.send(JSON.stringify({ t: 'start' })); // geht vor dem Verbindungsaufbau zum Server ein und wird zwischengespeichert
        assert.deepEqual(await a.naechste(), { t: 'bereit' });
        a.send(Buffer.from([9, 8, 7, 6]));
        a.send(JSON.stringify({ t: 'ende' }));
        // Der Fake-Player ist ein eigener Node-Prozess: unter Last (volle Suite) braucht er länger als ein fester Wert
        for (let i = 0; i < 100 && !(existsSync(datei) && readFileSync(datei).length >= 4); i++) await pause(50);
        assert.deepEqual([...readFileSync(datei)], [9, 8, 7, 6]);
        a.close();
        await pause(200);
    } finally {
        for (const s of [clientHttp, hallenServer.server]) { s.close(); s.closeAllConnections?.(); }
        rmSync(dir, { recursive: true, force: true });
    }
});
