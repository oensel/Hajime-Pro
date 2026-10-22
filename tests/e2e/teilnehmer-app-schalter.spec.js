// End-to-End: Teilnehmer-App-Schalter am Hallen-Server (docs/specs/2026-10-22-teilnehmer-app-schalter-design.md) gegen die
// Fake-Cloud (tests/helpers/fake-cloud.mjs): Holen liefert das Token, Einschalten sendet, Fehler und Ausfall färben das Icon.
import { test, expect } from '@playwright/test';
import knexLib from 'knex';
import { FAKE_CLOUD_URL, FAKE_CLOUD_EMAIL, FAKE_CLOUD_PASSWORT, testDbVerbindung } from './test-env.js';

test.describe.configure({ mode: 'serial' });

let turnierId;
let lokalId;

async function mitDb(fn) {
    const db = knexLib({ client: 'pg', connection: testDbVerbindung });
    try {
        return await fn(db);
    } finally {
        await db.destroy();
    }
}

async function status(request) {
    return (await request.get(`/api/live-app/status?turnierId=${turnierId}`)).json();
}

async function fakePakete(request) {
    return (await (await request.get(`${FAKE_CLOUD_URL}/test/ingest`)).json()).pakete;
}

test.beforeAll(async ({ request }) => {
    await request.post(`${FAKE_CLOUD_URL}/test/modus`, { data: { ingest: 'ok', erreichbar: true } });
    await request.delete(`${FAKE_CLOUD_URL}/test/ingest`);
});

// Räumt das geholte Turnier samt Matten/Pools auf, damit andere Specs (z. B. turnier-aus-cloud-holen) nicht über Duplikate stolpern.
async function raeumeAuf(ids) {
    await mitDb(async (db) => {
        for (const id of ids.filter(Boolean)) {
            try {
                await db('pools').where({ turnier_id: id }).del();
                await db('kampfflaechen').where({ turnier_id: id }).del();
                await db('turniere').where({ id }).del();
            } catch { /* abhängige Daten: das Turnier bleibt, schadet aber nur der Ordnung */ }
        }
    });
}

test.afterAll(async ({ request }) => {
    await request.post(`${FAKE_CLOUD_URL}/test/modus`, { data: { ingest: 'ok', erreichbar: true } });
    await raeumeAuf([turnierId, lokalId]);
});

test('Ein aus der Cloud geholtes Turnier ist verfügbar, aber noch ausgeschaltet und ohne verteilte Pools', async ({ request }) => {
    const liste = await request.post('/api/cloud/turniere', { data: { email: FAKE_CLOUD_EMAIL, password: FAKE_CLOUD_PASSWORT } });
    const { token } = await liste.json();
    const geholt = await request.post('/api/cloud/turniere/12/holen', { data: { token } });
    expect(geholt.ok(), await geholt.text()).toBeTruthy();
    turnierId = (await geholt.json()).turnierId;

    const s = await status(request);
    expect(s.verfuegbar).toBe(true);
    expect(s.aktiv).toBe(false);
    expect(s.zustand).toBe('grau');
    expect(s.poolsVerteilt).toBe(false);
    expect(JSON.stringify(s)).not.toContain('hjl_fake-live-token');
});

test('Ein lokal angelegtes Turnier ohne Cloud-Herkunft ist nicht verfügbar', async ({ request }) => {
    const r = await request.post('/api/turniere', {
        data: { bezeichnung: 'Nur lokal', ort: 'Halle', datum: '2031-04-01', ausrichter: 'Test', anzahl_kampfflaechen: 1 }
    });
    lokalId = (await r.json()).turnierId;
    const s = await (await request.get(`/api/live-app/status?turnierId=${lokalId}`)).json();
    expect(s.verfuegbar).toBe(false);
    expect(s.grund).toBe('kein_cloud_turnier');
    const ein = await request.post('/api/live-app/schalter', { data: { turnierId: lokalId, aktiv: true } });
    expect(ein.status()).toBe(409);
    expect((await ein.json()).grund).toBe('kein_cloud_turnier');
});

test('Einschalten sendet mit dem Cloud-Token, Fehler macht gelb, Ausfall rot, Erholung wieder grün', async ({ request }) => {
    await mitDb(async (db) => {
        const [{ id: matte }] = await db('kampfflaechen').insert({ turnier_id: turnierId, bezeichnung: 'Matte 1' }).returning('id');
        await db('pools').insert({
            turnier_id: turnierId, bezeichnung: 'U15 m -50', altersklasse: 'U15', geschlecht: 'm', gewichtsklasse: '-50', kampfflaeche_id: matte
        });
    });
    await expect.poll(async () => (await status(request)).poolsVerteilt).toBe(true);

    const ein = await request.post('/api/live-app/schalter', { data: { turnierId, aktiv: true } });
    expect(ein.ok(), await ein.text()).toBeTruthy();

    await expect.poll(async () => (await fakePakete(request)).length, { timeout: 10000 }).toBeGreaterThan(0);
    const erstes = (await fakePakete(request))[0];
    expect(erstes.bearer).toBe('Bearer hjl_fake-live-token');
    expect(erstes.paket.turnierKey).toBe('12');
    await expect.poll(async () => (await status(request)).zustand, { timeout: 10000 }).toBe('gruen');

    // Cloud erreichbar, aber der Ingest lehnt ab: gelb. Ein geänderter Pool erzwingt einen neuen Sendeversuch.
    await request.post(`${FAKE_CLOUD_URL}/test/modus`, { data: { ingest: 'fehler' } });
    await mitDb(db => db('pools').where({ turnier_id: turnierId }).update({ bezeichnung: 'U15 m -50 neu' }));
    await expect.poll(async () => (await status(request)).zustand, { timeout: 10000 }).toBe('gelb');

    // Cloud nicht mehr erreichbar: rot.
    await request.post(`${FAKE_CLOUD_URL}/test/modus`, { data: { erreichbar: false } });
    await expect.poll(async () => (await status(request)).zustand, { timeout: 10000 }).toBe('rot');

    // Alles wieder gut: grün (der Uplink wiederholt nach seinem Backoff).
    await request.post(`${FAKE_CLOUD_URL}/test/modus`, { data: { ingest: 'ok', erreichbar: true } });
    await expect.poll(async () => (await status(request)).zustand, { timeout: 30000 }).toBe('gruen');
});

test('Ausschalten nimmt das Turnier in der Cloud zurück und das Icon wird grau', async ({ request }) => {
    await request.delete(`${FAKE_CLOUD_URL}/test/ingest`);
    const aus = await request.post('/api/live-app/schalter', { data: { turnierId, aktiv: false } });
    expect(aus.ok(), await aus.text()).toBeTruthy();
    await expect.poll(async () => (await fakePakete(request)).some(p => p.paket && p.paket.zurueckgezogen === true), { timeout: 10000 }).toBe(true);
    expect((await status(request)).zustand).toBe('grau');
    expect((await status(request)).aktiv).toBe(false);
});
