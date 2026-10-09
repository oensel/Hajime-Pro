import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { erzeugeVideoSpeicher } from '../../src/video/videoSpeicher.js';
import { erzeugeVideoDienst, VIDEO_PFAD, VIDEO_LIVE_PFAD } from '../../src/video/videoDienst.js';
import { getVideoRoutes } from '../../src/routes/videoRoutes.js';
import { haengeWebSocketAn } from '../../src/durchsage/durchsageDienst.js';

const pause = (ms) => new Promise(r => setTimeout(r, ms));
const META = { clipId: 'clip-1', turnierId: 7, matteId: 2, matteName: 'Matte 2', kampfId: 41, pool: 'U15 männlich -50kg', kaempfer1: 'Adler, Anna', kaempfer2: 'Busch, Berta', farbe2: 'rot', mime: 'video/webm;codecs=vp8', beginn: '2027-07-10T10:15:00.000Z' };
const ENDE = { marken: [{ typ: 'geladen', ms: 0 }, { typ: 'start', ms: 8000 }, { typ: 'ergebnis', ms: 99000 }], ergebnis: 'Sieger Rot', farbe2: 'rot', ende: '2027-07-10T10:19:30.000Z', abgebrochen: false };
const bytes = (von, bis) => Buffer.from(Array.from({ length: bis - von }, (_, i) => (von + i) % 251));

async function starteServer(optionen = {}) {
    const dir = mkdtempSync(path.join(tmpdir(), 'video-'));
    const speicher = erzeugeVideoSpeicher({ wurzel: dir });
    const dienst = erzeugeVideoDienst({ speicher, ...optionen });
    const app = express();
    app.use('/api/video', getVideoRoutes({ speicher, dienst }));
    const server = http.createServer(app);
    haengeWebSocketAn(server, { pfad: VIDEO_PFAD, verbinde: ws => dienst.verbindeSender(ws), maxPayload: 16 * 1024 * 1024 });
    haengeWebSocketAn(server, { pfad: VIDEO_LIVE_PFAD, verbinde: (ws, req) => dienst.verbindeZuschauer(ws, new URL(req.url, 'http://x').searchParams.get('matte')) });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    return {
        dir, speicher, dienst, server,
        http: `http://127.0.0.1:${port}/api/video`,
        sender: `ws://127.0.0.1:${port}${VIDEO_PFAD}`,
        live: (m) => `ws://127.0.0.1:${port}${VIDEO_LIVE_PFAD}?matte=${m}`,
        ende() { server.close(); server.closeAllConnections?.(); rmSync(dir, { recursive: true, force: true }); }
    };
}

function client(url) {
    const ws = new WebSocket(url);
    const text = [];
    const binaer = [];
    const wartend = [];
    ws.on('message', (d, bin) => {
        if (bin) { binaer.push(Buffer.from(d)); return; }
        const m = JSON.parse(d.toString());
        const w = wartend.shift();
        if (w) w(m); else text.push(m);
    });
    ws.naechste = () => new Promise(r => { const m = text.shift(); if (m) r(m); else wartend.push(r); });
    ws.binaer = binaer;
    ws.empfangen = () => Buffer.concat(binaer);
    return new Promise((resolve, reject) => { ws.on('open', () => resolve(ws)); ws.on('error', reject); });
}

async function oeffneSender(s, meta = META) {
    const ws = await client(s.sender);
    ws.send(JSON.stringify({ t: 'start', meta }));
    const bereit = await ws.naechste();
    return { ws, bereit };
}

test('Übertragung: fertiger Clip landet vollständig mit Marken, Ergebnis und Farbe', async () => {
    const s = await starteServer();
    try {
        const { ws, bereit } = await oeffneSender(s);
        assert.deepEqual(bereit, { t: 'bereit', clipId: 'clip-1', empfangen: 0 });
        ws.send(bytes(0, 3000));
        ws.send(JSON.stringify({ t: 'ende', groesse: 3000, meta: ENDE }));
        assert.equal((await ws.naechste()).t, 'fertig');

        const clips = s.speicher.liste();
        assert.equal(clips.length, 1);
        assert.equal(clips[0].id, 'clip-1');
        assert.equal(clips[0].groesse, 3000);
        assert.equal(clips[0].beginn, META.beginn);
        assert.equal(clips[0].ende, ENDE.ende);
        assert.equal(clips[0].ergebnis, 'Sieger Rot');
        assert.equal(clips[0].farbe2, 'rot');
        assert.deepEqual(clips[0].marken.map(m => m.typ), ['geladen', 'start', 'ergebnis']);
        assert.deepEqual(readFileSync(s.speicher.hole('clip-1').videoPfad), bytes(0, 3000));

        // Abspielen mit Range-Anfrage und Status
        const teil = await fetch(`${s.http}/clips/clip-1/datei`, { headers: { Range: 'bytes=10-19' } });
        assert.equal(teil.status, 206);
        assert.deepEqual(Buffer.from(await teil.arrayBuffer()), bytes(10, 20));
        assert.equal((await (await fetch(`${s.http}/status`)).json()).speicher.clips, 1);
        ws.close();
    } finally { s.ende(); }
});

test('Übertragung: nach einem Verbindungsabbruch geht es an derselben Stelle weiter', async () => {
    const s = await starteServer();
    try {
        const { ws } = await oeffneSender(s);
        ws.send(bytes(0, 1000));
        await pause(150);
        ws.terminate(); // Verbindung weg, Clip unvollständig
        await pause(150);
        assert.equal(s.speicher.liste()[0].ende, null);

        const { ws: ws2, bereit } = await oeffneSender(s);
        assert.equal(bereit.empfangen, 1000); // Server meldet, was er schon hat
        ws2.send(bytes(1000, 2500));
        ws2.send(JSON.stringify({ t: 'ende', groesse: 2500, meta: ENDE }));
        assert.equal((await ws2.naechste()).t, 'fertig');
        assert.deepEqual(readFileSync(s.speicher.hole('clip-1').videoPfad), bytes(0, 2500));
        assert.equal(s.speicher.liste().length, 1);
        ws2.close();
    } finally { s.ende(); }
});

test('Übertragung: fehlen dem Server Bytes, meldet er das; wiederholtes Ende ist unschädlich', async () => {
    const s = await starteServer();
    try {
        const { ws } = await oeffneSender(s);
        ws.send(bytes(0, 800));
        ws.send(JSON.stringify({ t: 'ende', groesse: 1200, meta: ENDE }));
        assert.deepEqual(await ws.naechste(), { t: 'fehlt', empfangen: 800 });
        ws.send(bytes(800, 1200));
        ws.send(JSON.stringify({ t: 'ende', groesse: 1200, meta: ENDE }));
        assert.equal((await ws.naechste()).t, 'fertig');
        ws.send(JSON.stringify({ t: 'ende', groesse: 1200, meta: ENDE })); // Antwort ging verloren, Client fragt noch einmal
        assert.equal((await ws.naechste()).t, 'fertig');
        ws.close();
        // Und auch eine neue Verbindung für einen schon fertigen Clip ist ein Erfolg ohne Doppelspeicherung.
        const { ws: ws2, bereit } = await oeffneSender(s);
        assert.equal(bereit.empfangen, 1200);
        ws2.send(JSON.stringify({ t: 'ende', groesse: 1200, meta: ENDE }));
        assert.equal((await ws2.naechste()).t, 'fertig');
        assert.equal(s.speicher.liste().length, 1);
        assert.deepEqual(readFileSync(s.speicher.hole('clip-1').videoPfad), bytes(0, 1200));
        ws2.close();
    } finally { s.ende(); }
});

test('Live: Zuschauer bekommt bisherigen Stand und den Live-Strom, am Ende "ende"; Nachlieferungen gehen nicht live', async () => {
    const s = await starteServer();
    try {
        const { ws } = await oeffneSender(s, { ...META, live: true });
        ws.send(bytes(0, 100));
        await pause(150);
        assert.equal(s.dienst.status().live.length, 1);
        assert.equal(s.dienst.status().live[0].matteId, 2);

        const z = await client(s.live(2));
        assert.equal((await z.naechste()).t, 'clip');
        await pause(150);
        assert.deepEqual(z.empfangen(), bytes(0, 100)); // bisheriger Stand

        ws.send(bytes(100, 160));
        ws.send(JSON.stringify({ t: 'ende', groesse: 160, meta: ENDE }));
        assert.equal((await z.naechste()).t, 'ende');
        assert.deepEqual(z.empfangen(), bytes(0, 160)); // Live-Strom
        assert.equal(s.dienst.status().live.length, 0);
        ws.close();

        // Eine nachgelieferte (nicht live aufgenommene) Übertragung wird nicht an Zuschauer weitergereicht.
        const { ws: nach } = await oeffneSender(s, { ...META, clipId: 'clip-2', kampfId: 42 });
        nach.send(bytes(0, 50));
        await pause(150);
        assert.deepEqual(z.empfangen(), bytes(0, 160));
        nach.close(); z.close();
        await pause(100);
    } finally { s.ende(); }
});

test('Live: bricht die Live-Verbindung ab und kommt wieder, sehen Zuschauer den Clip erneut von vorn und ohne Lücke', async () => {
    const s = await starteServer();
    try {
        const z = await client(s.live(2));
        assert.equal((await z.naechste()).t, 'leer');
        const { ws } = await oeffneSender(s, { ...META, live: true });
        assert.equal((await z.naechste()).t, 'clip');
        ws.send(bytes(0, 400));
        await pause(150);
        ws.terminate();
        assert.equal((await z.naechste()).t, 'ende');

        const { ws: ws2, bereit } = await oeffneSender(s, { ...META, live: true });
        assert.equal(bereit.empfangen, 400);
        assert.equal((await z.naechste()).t, 'clip');
        ws2.send(bytes(400, 700));
        await pause(200);
        const alles = z.empfangen();
        // erst der erste Durchgang (0..400), dann der Neustart mit dem bisherigen Stand (0..400) und die neuen Bytes (400..700)
        assert.deepEqual(alles.subarray(alles.length - 700), bytes(0, 700));
        ws2.close(); z.close();
        await pause(100);
    } finally { s.ende(); }
});

test('Übertragung: ungültige Kampfdaten, leerer Clip, zu große Clips und Secondary werden abgewiesen', async () => {
    let master = false;
    const s = await starteServer({ maxBytes: 1000, darfSenden: () => master });
    try {
        const { ws, bereit } = await oeffneSender(s);
        assert.equal(bereit.t, 'fehler');
        assert.match(bereit.grund, /Secondary/);
        assert.equal((await (await fetch(`${s.http}/status`)).json()).verfuegbar, false);
        ws.close();

        master = true;
        const ohneMatte = await client(s.sender);
        ohneMatte.send(JSON.stringify({ t: 'start', meta: { clipId: 'x1' } }));
        assert.equal((await ohneMatte.naechste()).t, 'fehler');
        ohneMatte.close();

        const { ws: leer } = await oeffneSender(s, { ...META, clipId: 'leer-1' });
        leer.send(JSON.stringify({ t: 'ende', groesse: 0, meta: ENDE }));
        assert.equal((await leer.naechste()).t, 'fehler');
        leer.close();

        const { ws: gross } = await oeffneSender(s, { ...META, clipId: 'gross-1' });
        gross.send(bytes(0, 600));
        gross.send(bytes(600, 1200));
        assert.equal((await gross.naechste()).t, 'fehler');
        await pause(100);
        assert.equal(s.speicher.hole('gross-1').meta.groesse <= 1000, true);
    } finally { s.ende(); }
});

test('Löschen einzeln und alle', async () => {
    const s = await starteServer();
    try {
        for (const clipId of ['a-1', 'a-2', 'a-3']) {
            const { ws } = await oeffneSender(s, { ...META, clipId });
            ws.send(bytes(0, 10));
            ws.send(JSON.stringify({ t: 'ende', groesse: 10, meta: ENDE }));
            await ws.naechste();
            ws.close();
        }
        assert.equal(s.speicher.liste().length, 3);
        assert.equal((await fetch(`${s.http}/clips/a-1`, { method: 'DELETE' })).status, 200);
        assert.equal((await fetch(`${s.http}/clips/a-1`, { method: 'DELETE' })).status, 404);
        assert.equal((await (await fetch(`${s.http}/clips/alle-loeschen`, { method: 'POST' })).json()).geloescht, 2);
        assert.equal(s.speicher.liste().length, 0);
    } finally { s.ende(); }
});
