// End-to-End: Ein Vereins-Admin (hier offline_user, freigegebener Admin von "Offline Club") hat für die Konten seiner
// Vereine dieselben Einstellmöglichkeiten wie ein Super-Admin (/api/nutzer), darf aber niemanden zum Super-Admin machen,
// keine Super-Admin-Konten anfassen und nichts an Konten ändern, die auch zu fremden Vereinen gehören.
import { test, expect } from '@playwright/test';
import knexLib from 'knex';
import { testDbVerbindung } from './test-env.js';

async function mitTestDb(fn) {
    const db = knexLib({ client: 'pg', connection: testDbVerbindung, pool: { min: 0, max: 2 } });
    try {
        return await fn(db);
    } finally {
        await db.destroy();
    }
}

const lauf = Date.now();
const KONTEN = {
    eigenes: `e2e-va-eigenes-${lauf}`,
    mehrere: `e2e-va-mehrere-${lauf}`,
    super: `e2e-va-super-${lauf}`,
    fremd: `e2e-va-fremd-${lauf}`
};

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ request }) => {
    expect((await request.get('/api/auth/me')).ok()).toBeTruthy(); // legt "Offline Club" an
    await mitTestDb(async (db) => {
        const club = await db('vereine').where({ name: 'Offline Club' }).first();
        const [zeile] = await db('vereine').insert({ name: `E2E-Fremdverein-${lauf}` }).returning('id');
        const fremdId = typeof zeile === 'object' ? zeile.id : zeile;
        for (const [schluessel, id] of Object.entries(KONTEN)) {
            await db('benutzer').insert({
                id, email: `${id}@example.test`, vorname: 'Va', nachname: schluessel,
                ist_super_admin: schluessel === 'super', email_bestaetigt_am: db.fn.now()
            });
        }
        await db('benutzer_vereine').insert([
            { benutzer_id: KONTEN.eigenes, verein_id: club.id, freigegeben: 1, rolle: 'benutzer' },
            { benutzer_id: KONTEN.mehrere, verein_id: club.id, freigegeben: 1, rolle: 'benutzer' },
            { benutzer_id: KONTEN.mehrere, verein_id: fremdId, freigegeben: 1, rolle: 'admin' },
            { benutzer_id: KONTEN.super, verein_id: club.id, freigegeben: 1, rolle: 'benutzer' },
            { benutzer_id: KONTEN.fremd, verein_id: fremdId, freigegeben: 1, rolle: 'benutzer' }
        ]);
    });
});

test.afterAll(async () => {
    await mitTestDb(async (db) => {
        await db('benutzer').whereIn('id', Object.values(KONTEN)).del();
        await db('vereine').where('name', `E2E-Fremdverein-${lauf}`).del();
    });
});

test('Vereins-Admin sieht nur Konten seiner Vereine, keine Super-Admins', async ({ request }) => {
    const liste = await (await request.get('/api/nutzer')).json();
    const ids = liste.map(k => k.id);
    expect(ids).toContain(KONTEN.eigenes);
    expect(ids).toContain(KONTEN.mehrere);
    expect(ids).not.toContain(KONTEN.super);
    expect(ids).not.toContain(KONTEN.fremd);
    expect(liste.find(k => k.id === KONTEN.eigenes).vollverwaltbar).toBe(true);
    const mehrere = liste.find(k => k.id === KONTEN.mehrere);
    expect(mehrere.vollverwaltbar).toBe(false);
    expect(mehrere.mitgliedschaften.map(m => m.verein_name)).toEqual(['Offline Club']);
});

test('Vereins-Admin darf Konten seines Vereins bearbeiten, Passwort setzen und sperren', async ({ request }) => {
    const put = await request.put(`/api/nutzer/${KONTEN.eigenes}`, {
        data: { vorname: 'Neu', nachname: 'Name', email: `${KONTEN.eigenes}@example.test` }
    });
    expect(put.ok()).toBeTruthy();
    expect((await request.post(`/api/nutzer/${KONTEN.eigenes}/passwort`, { data: { passwort: 'neuespasswort1' } })).ok()).toBeTruthy();
    expect((await request.post(`/api/nutzer/${KONTEN.eigenes}/sperren`, { data: { wert: true } })).ok()).toBeTruthy();
    expect((await request.post(`/api/nutzer/${KONTEN.eigenes}/sperren`, { data: { wert: false } })).ok()).toBeTruthy();
});

test('Vereins-Admin darf niemanden zum Super-Admin machen und keine fremden oder Super-Admin-Konten ändern', async ({ request }) => {
    expect((await request.post(`/api/nutzer/${KONTEN.eigenes}/super-admin`, { data: { wert: true } })).status()).toBe(403);
    const daten = { vorname: 'X', nachname: 'Y', email: 'x@example.test' };
    expect((await request.put(`/api/nutzer/${KONTEN.mehrere}`, { data: daten })).status()).toBe(403);
    expect((await request.put(`/api/nutzer/${KONTEN.super}`, { data: daten })).status()).toBe(403);
    expect((await request.post(`/api/nutzer/${KONTEN.super}/passwort`, { data: { passwort: 'neuespasswort1' } })).status()).toBe(403);
    expect((await request.put(`/api/nutzer/${KONTEN.fremd}`, { data: daten })).status()).toBe(404);
    expect((await request.get('/api/nutzer/vereine')).status()).toBe(403);
    expect((await request.post(`/api/nutzer/${KONTEN.eigenes}/mitgliedschaft`, { data: { vereinId: 1, rolle: 'admin' } })).status()).toBe(403);
    const ist = await mitTestDb((db) => db('benutzer').where({ id: KONTEN.eigenes }).first('ist_super_admin'));
    expect(ist.ist_super_admin).toBe(false);
});

test('Löschen eines Kontos mit weiteren Vereinen entfernt nur die Zuordnung zum eigenen Verein', async ({ request }) => {
    const antwort = await request.delete(`/api/nutzer/${KONTEN.mehrere}`);
    expect(antwort.ok()).toBeTruthy();
    expect((await antwort.json()).nurZuordnung).toBe(true);
    const rest = await mitTestDb((db) => db('benutzer_vereine').join('vereine', 'vereine.id', 'verein_id')
        .where({ benutzer_id: KONTEN.mehrere }).select('vereine.name'));
    expect(rest.map(r => r.name)).toEqual([`E2E-Fremdverein-${lauf}`]);
    expect(await mitTestDb((db) => db('benutzer').where({ id: KONTEN.mehrere }).first())).toBeTruthy();
});

test('Vereins-Admin darf ein Konto, das nur zu seinem Verein gehört, löschen', async ({ request }) => {
    expect((await request.delete(`/api/nutzer/${KONTEN.eigenes}`)).ok()).toBeTruthy();
    expect(await mitTestDb((db) => db('benutzer').where({ id: KONTEN.eigenes }).first())).toBeUndefined();
});

test('Vereins-Admin darf die Zuordnung eines Super-Admins oder in fremden Vereinen nicht entfernen', async ({ request }) => {
    const clubId = await mitTestDb(async (db) => (await db('vereine').where({ name: 'Offline Club' }).first()).id);
    const fremdId = await mitTestDb(async (db) => (await db('vereine').where('name', `E2E-Fremdverein-${lauf}`).first()).id);
    expect((await request.delete(`/api/nutzer/${KONTEN.super}/mitgliedschaft/${clubId}`)).status()).toBe(403);
    expect((await request.delete(`/api/nutzer/${KONTEN.fremd}/mitgliedschaft/${fremdId}`)).status()).toBe(404);
    expect(await mitTestDb((db) => db('benutzer_vereine').where({ benutzer_id: KONTEN.super, verein_id: clubId }).first())).toBeTruthy();
});
