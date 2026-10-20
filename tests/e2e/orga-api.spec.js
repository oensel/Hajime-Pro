// End-to-End (API): Orga-Planer im Hallen-Server-Betrieb mit HELFER_APP_AKTIV=true (test-env.js).
// Einzelbenutzer offline_user (Admin im "Offline Club"). Rollen-/Rechte-Szenarien deckt tests/unit/orgaRoutes.test.js ab.
import { test, expect } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

let turnierId;
let aufgaben;

test.beforeAll(async ({ request }) => {
    const resp = await request.post('/api/turniere', {
        data: { planungs_tools: true, bezeichnung: `Orga-API ${Date.now()}`, ort: 'Halle', datum: '2032-06-12', ausrichter: 'Offline Club', anzahl_kampfflaechen: 1 }
    });
    expect(resp.ok(), await resp.text()).toBeTruthy();
    turnierId = (await resp.json()).turnierId;
});

test('GET /api/orga legt die Vorlage einmalig an', async ({ request }) => {
    const r1 = await request.get(`/api/orga?turnierId=${turnierId}`);
    expect(r1.ok(), await r1.text()).toBeTruthy();
    const d1 = await r1.json();
    aufgaben = d1.phasen.flatMap((p) => p.aufgaben);
    expect(aufgaben.length).toBeGreaterThan(20);
    const d2 = await (await request.get(`/api/orga?turnierId=${turnierId}`)).json();
    expect(d2.kennzahlen.gesamt).toBe(d1.kennzahlen.gesamt);
    const nach = await (await request.post('/api/orga/vorlage-nachladen', { data: { turnierId } })).json();
    expect(nach.angelegt).toBe(0);
});

test('Aufgabe anlegen, ändern, abhaken, löschen; fremde Aufgaben-ID 404', async ({ request }) => {
    const neu = await request.post('/api/orga/aufgaben', { data: { turnierId, titel: 'Eigene Aufgabe', phase: 'turniertag' } });
    expect(neu.status()).toBe(201);
    const { id } = await neu.json();
    expect((await request.put(`/api/orga/aufgaben/${id}`, { data: { titel: 'Umbenannt', notiz: 'n' } })).ok()).toBeTruthy();
    expect((await request.post(`/api/orga/aufgaben/${id}/erledigt`, { data: { erledigt: true } })).ok()).toBeTruthy();
    const orga = await (await request.get(`/api/orga?turnierId=${turnierId}`)).json();
    const a = orga.phasen.flatMap((p) => p.aufgaben).find((x) => x.id === id);
    expect(a.titel).toBe('Umbenannt');
    expect(a.status.status).toBe('erledigt');
    expect((await request.delete(`/api/orga/aufgaben/${id}`)).ok()).toBeTruthy();
    expect((await request.put('/api/orga/aufgaben/99999999', { data: { titel: 'x' } })).status()).toBe(404);
});

test('Zuweisen mit freiem Namen; Mitbringliste und eigene Aufgaben über die Helfer-Routen', async ({ request }) => {
    const wiegen = aufgaben.find((a) => a.vorlage_key === 'wiegen');
    const z = await request.post(`/api/orga/aufgaben/${wiegen.id}/zuweisen`, { data: { name: 'Gast Frei' } });
    expect(z.ok(), await z.text()).toBeTruthy();
    expect((await z.json()).modus).toBe('frei');

    const mb = await request.post('/api/helfer/orga/mitbringliste', { data: { turnierId, titel: 'Kuchen' } });
    expect(mb.status(), await mb.text()).toBe(201);
    const { id } = await mb.json();
    expect((await request.put(`/api/helfer/orga/mitbringliste/${id}`, { data: { titel: 'Torte' } })).ok()).toBeTruthy();
    expect((await request.delete(`/api/helfer/orga/mitbringliste/${id}`)).ok()).toBeTruthy();

    const meine = await request.get('/api/helfer/orga/meine');
    expect(meine.ok()).toBeTruthy();
    expect(Array.isArray((await meine.json()).aufgaben)).toBeTruthy();
});

test('Einladung: unbekannter Token 404', async ({ request }) => {
    expect((await request.get('/api/einladung/unbekannt')).status()).toBe(404);
});
