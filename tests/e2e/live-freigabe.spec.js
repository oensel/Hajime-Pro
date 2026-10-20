// End-to-End: Live-Freigabe am Turnier (Teilnehmer-App Phase 1, Spec Abschnitt 5/10).
import { test, expect } from '@playwright/test';
import knexLib from 'knex';
import { testDbVerbindung } from './test-env.js';

async function neuesTurnier(request, name) {
    const r = await request.post('/api/turniere', {
        data: { bezeichnung: name, ort: 'Senden', datum: '2026-10-12', ausrichter: 'Test', anzahl_kampfflaechen: 1 }
    });
    expect(r.ok(), await r.text()).toBeTruthy();
    return (await r.json()).turnierId;
}

async function setzeInDb(id, werte) {
    const db = knexLib({ client: 'pg', connection: testDbVerbindung });
    try {
        await db('turniere').where({ id }).update(werte);
    } finally {
        await db.destroy();
    }
}

test('Freigabe: Standard aus, ohne Cloud-Herkunft gesperrt, mit Herkunft schaltbar', async ({ request }) => {
    const id = await neuesTurnier(request, 'Live-Freigabe');

    let r = await request.get(`/api/turniere/${id}/live-freigabe`);
    expect(await r.json()).toEqual({ freigegeben: false, moeglich: false });

    r = await request.put(`/api/turniere/${id}/live-freigabe`, { data: { freigegeben: true } });
    expect(r.status()).toBe(409);
    expect((await r.json()).error).toMatch(/Cloud/);

    r = await request.put(`/api/turniere/${id}/live-freigabe`, { data: { freigegeben: 'ja' } });
    expect(r.status()).toBe(400);

    await setzeInDb(id, { urspruengliche_id: 4711 });

    r = await request.get(`/api/turniere/${id}/live-freigabe`);
    expect(await r.json()).toEqual({ freigegeben: false, moeglich: true });

    r = await request.put(`/api/turniere/${id}/live-freigabe`, { data: { freigegeben: true } });
    expect(r.ok(), await r.text()).toBeTruthy();
    expect((await (await request.get(`/api/turniere/${id}/live-freigabe`)).json()).freigegeben).toBe(true);

    r = await request.put(`/api/turniere/${id}/live-freigabe`, { data: { freigegeben: false } });
    expect(r.ok()).toBeTruthy();
    expect((await (await request.get(`/api/turniere/${id}/live-freigabe`)).json()).freigegeben).toBe(false);
});

test('Freigabe: unbekanntes Turnier ergibt 404', async ({ request }) => {
    const r = await request.put('/api/turniere/999999/live-freigabe', { data: { freigegeben: false } });
    expect(r.status()).toBe(404);
});

test('Export/Import übernimmt die Freigabe nicht', async ({ request }) => {
    const id = await neuesTurnier(request, 'Live-Export');
    // Export ist erst ab 'veroeffentlicht' (hier: Wettkampftag erreicht) möglich
    await setzeInDb(id, { urspruengliche_id: 5000, live_freigabe: true, status: 'veroeffentlicht' });
    const exportAntwort = await request.get(`/api/turniere/${id}/export`);
    expect(exportAntwort.ok(), await exportAntwort.text()).toBeTruthy();
    const inhalt = Buffer.from(JSON.stringify(await exportAntwort.json()), 'utf-8').toString('base64');
    const importiert = await request.post('/api/turniere/import', { data: { contentBase64: inhalt } });
    expect(importiert.ok(), await importiert.text()).toBeTruthy();
    const neueId = (await importiert.json()).turnierId;
    const r = await request.get(`/api/turniere/${neueId}/live-freigabe`);
    expect((await r.json()).freigegeben).toBe(false);
});
