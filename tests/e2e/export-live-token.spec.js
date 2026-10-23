// End-to-End (Cloud-Seite): der Export mit ?liveToken=1 stellt ein an das Turnier gebundenes Ingest-Token aus und
// sperrt das vorige; ein normaler Export lässt Tokens unberührt. Der Testserver hängt die Live-API ein (LIVE_API_AKTIV).
import { test, expect } from '@playwright/test';
import knexLib from 'knex';
import { testDbVerbindung } from './test-env.js';

async function neuesExportierbaresTurnier(request, name) {
    const r = await request.post('/api/turniere', {
        data: { bezeichnung: name, ort: 'Cloudstadt', datum: '2026-10-12', ausrichter: 'Test', anzahl_kampfflaechen: 1 }
    });
    expect(r.ok(), await r.text()).toBeTruthy();
    const id = (await r.json()).turnierId;
    const db = knexLib({ client: 'pg', connection: testDbVerbindung });
    try {
        await db('turniere').where({ id }).update({ status: 'veroeffentlicht' });
    } finally {
        await db.destroy();
    }
    return id;
}

async function ingestStatus(request, token) {
    const r = await request.post('/api/live/ingest', {
        headers: { Authorization: `Bearer ${token}` }, data: { turnierKey: 'egal' }
    });
    return r.status();
}

test('Ein neues Token sperrt das vorige erst bei seiner ersten Benutzung; ein normaler Export lässt alles unberührt', async ({ request }) => {
    const id = await neuesExportierbaresTurnier(request, 'Live-Token-Export');

    const erster = await (await request.get(`/api/turniere/${id}/export?liveToken=1`)).json();
    expect(erster.live.token).toMatch(/^hjl_[0-9a-f]{64}$/);
    // Gültiges Token, aber falsches Turnier im Paket: 403 (nicht 401) beweist, dass das Token gilt und gebunden ist.
    expect(await ingestStatus(request, erster.live.token)).toBe(403);

    const normal = await (await request.get(`/api/turniere/${id}/export`)).json();
    expect(normal.live).toBeUndefined();
    expect(await ingestStatus(request, erster.live.token)).toBe(403);

    // Ein zweites Holen (das beim Hallen-Server scheitern könnte) macht das laufende Token noch nicht ungültig ...
    const zweiter = await (await request.get(`/api/turniere/${id}/export?liveToken=1`)).json();
    expect(zweiter.live.token).not.toBe(erster.live.token);
    expect(await ingestStatus(request, erster.live.token)).toBe(403);
    // ... erst wenn das neue Token zum ersten Mal benutzt wird, verfällt das alte.
    expect(await ingestStatus(request, zweiter.live.token)).toBe(403);
    expect(await ingestStatus(request, erster.live.token)).toBe(401);
});
