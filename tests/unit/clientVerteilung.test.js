// Kopplungscode nur mit Turnierleitungs-Passwort (STEUERUNG_PASSWORD) — direkt gegen den Router,
// ohne die Suite-Server neu starten zu müssen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { getClientVerteilungRoutes } from '../../src/routes/clientVerteilungRoutes.js';

async function mitServer(fn) {
    const app = express();
    app.use(express.json());
    const datenverzeichnis = mkdtempSync(path.join(tmpdir(), 'verteilung-'));
    app.use('/api/client', getClientVerteilungRoutes({
        datenverzeichnis, downloadsVerzeichnis: datenverzeichnis, version: '1.0.0',
        kopplung: { code: '123456', secret: 's' }
    }));
    const server = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
    try {
        await fn(`http://127.0.0.1:${server.address().port}/api/client`);
    } finally {
        server.close();
    }
}

test('GET /kopplungscode und Erneuern verlangen das Passwort, wenn STEUERUNG_PASSWORD gesetzt ist', async () => {
    const vorher = process.env.STEUERUNG_PASSWORD;
    process.env.STEUERUNG_PASSWORD = 'leitung';
    try {
        await mitServer(async (basis) => {
            assert.equal((await fetch(`${basis}/kopplungscode`)).status, 401);
            assert.equal((await fetch(`${basis}/kopplungscode`, { headers: { 'x-steuerung-password': 'falsch' } })).status, 401);
            assert.equal((await fetch(`${basis}/kopplungscode/erneuern`, { method: 'POST' })).status, 401);
            const ok = await fetch(`${basis}/kopplungscode`, { headers: { 'x-steuerung-password': 'leitung' } });
            assert.equal(ok.status, 200);
            const antwort = await ok.json();
            assert.equal(antwort.code, '123456');
            // LAN-Adressen für den Kopplungs-QR-Code der Android-App (Port des Servers, IPv4).
            assert.ok(Array.isArray(antwort.urls));
            for (const url of antwort.urls) assert.match(url, /^http:\/\/\d+\.\d+\.\d+\.\d+:\d+$/);
        });
    } finally {
        if (vorher === undefined) delete process.env.STEUERUNG_PASSWORD;
        else process.env.STEUERUNG_PASSWORD = vorher;
    }
});

test('ohne STEUERUNG_PASSWORD ist der Kopplungscode frei abrufbar (Hallenbetrieb ohne Passwort)', async () => {
    const vorher = process.env.STEUERUNG_PASSWORD;
    delete process.env.STEUERUNG_PASSWORD;
    try {
        await mitServer(async (basis) => {
            assert.equal((await fetch(`${basis}/kopplungscode`)).status, 200);
        });
    } finally {
        if (vorher !== undefined) process.env.STEUERUNG_PASSWORD = vorher;
    }
});
