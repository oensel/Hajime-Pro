// End-to-End: Freigabe offener Beitrittsanfragen mit Rollenwahl (turniere.html, profil.html) und die
// Mitgliederverwaltung in profil.html (Helferverwaltung, Spec 3/4). Läuft als offline_user, der
// freigegebener Admin von "Offline Club" ist (requireAuth-Bootstrap im Einzelbenutzerbetrieb); die
// Antragsteller werden direkt in der Test-DB angelegt (siehe registrierung.spec.js).
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

async function legeAntragstellerAn(request, kennung, angefragtUeber) {
    // "Offline Club" entsteht beim ersten angemeldeten Aufruf
    expect((await request.get('/api/auth/me')).ok()).toBeTruthy();
    const id = `e2e-rolle-${kennung}-${lauf}`;
    const vereinId = await mitTestDb(async (db) => {
        const club = await db('vereine').where({ name: 'Offline Club' }).first();
        await db('benutzer').insert({ id, email: `${id}@example.test`, vorname: 'Rolf', nachname: `Rolle-${kennung}` });
        await db('benutzer_vereine').insert({ benutzer_id: id, verein_id: club.id, freigegeben: 0, angefragt_ueber: angefragtUeber });
        return club.id;
    });
    return { id, vereinId };
}

const mitgliedschaft = (benutzerId, vereinId) =>
    mitTestDb((db) => db('benutzer_vereine').where({ benutzer_id: benutzerId, verein_id: vereinId }).first());

test('turniere.html: Freigabe sendet die gewählte Rolle, Vorbelegung Helfer bei Anfragen aus der Helfer-App', async ({ page }) => {
    const { id, vereinId } = await legeAntragstellerAn(page.request, 'turniere', 'helfer-app');
    await page.goto('/turniere.html');

    const zeile = page.locator(`.pending-request-row[data-user-id="${id}"]`);
    await expect(zeile).toBeVisible();
    await expect(zeile.locator('select')).toHaveValue('helfer');

    const anfrage = page.waitForRequest((r) => r.url().endsWith('/api/vereine/approve') && r.method() === 'POST');
    await zeile.locator('button[data-action="approve"]').click();
    expect((await anfrage).postDataJSON()).toEqual({ userId: id, vereinId, rolle: 'helfer' });
    await expect(zeile).toHaveCount(0);
    expect(await mitgliedschaft(id, vereinId)).toMatchObject({ freigegeben: 1, rolle: 'helfer' });
});

test('profil.html: Freigabe mit Rollenwahl, Rolle ändern und Mitglied entfernen', async ({ page }) => {
    const { id, vereinId } = await legeAntragstellerAn(page.request, 'profil', 'verwaltung');
    await page.goto('/profil.html');

    // Rolle je Verein in "Meine Vereine"
    await expect(page.locator(`#meineVereineListe [data-verein-id="${vereinId}"] .verein-mitglied-status`))
        .toHaveText('Freigegeben als Admin');

    const zeile = page.locator(`#beitrittsanfragenListe [data-user-id="${id}"]`);
    await expect(zeile.locator('select')).toHaveValue('benutzer');
    await zeile.locator('select').selectOption('helfer');
    const anfrage = page.waitForRequest((r) => r.url().endsWith('/api/vereine/approve') && r.method() === 'POST');
    await zeile.locator('button[data-action="approve"]').click();
    expect((await anfrage).postDataJSON()).toEqual({ userId: id, vereinId, rolle: 'helfer' });
    expect(await mitgliedschaft(id, vereinId)).toMatchObject({ freigegeben: 1, rolle: 'helfer' });

    // Mitgliederverwaltung: das neue Mitglied steht mit Rolle in der Tabelle
    const mitglied = page.locator(`#mitgliederBereich [data-verein-id="${vereinId}"] tr[data-user-id="${id}"]`);
    await expect(mitglied.locator('select')).toHaveValue('helfer');
    const rollenAnfrage = page.waitForRequest((r) => r.url().endsWith('/api/vereine/rolle'));
    await mitglied.locator('select').selectOption('benutzer');
    expect((await rollenAnfrage).postDataJSON()).toEqual({ userId: id, vereinId, rolle: 'benutzer' });
    await expect(page.locator('#snackbarText')).toContainText('ist jetzt Benutzer');
    await expect.poll(async () => (await mitgliedschaft(id, vereinId)).rolle).toBe('benutzer');

    await mitglied.locator('button', { hasText: 'Entfernen' }).click();
    await page.locator('#modalConfirmBtn').click();
    await expect(mitglied).toHaveCount(0);
    expect(await mitgliedschaft(id, vereinId)).toBeUndefined();
});

test('profil.html: Herabstufen des letzten Admins zeigt die Meldung des Servers', async ({ page }) => {
    expect((await page.request.get('/api/auth/me')).ok()).toBeTruthy();
    const vereinId = await mitTestDb(async (db) => {
        const [zeile] = await db('vereine').insert({ name: `E2E-Letzter-Admin-${lauf}` }).returning('id');
        const vid = typeof zeile === 'object' ? zeile.id : zeile;
        await db('benutzer_vereine').insert({ benutzer_id: 'offline_user', verein_id: vid, freigegeben: 1, rolle: 'admin' });
        return vid;
    });
    try {
        await page.goto('/profil.html');
        const eigene = page.locator(`#mitgliederBereich [data-verein-id="${vereinId}"] tr[data-user-id="offline_user"]`);
        await expect(eigene.locator('select')).toHaveValue('admin');
        await eigene.locator('select').selectOption('helfer');
        await expect(page.locator('#snackbarText')).toContainText('letzte Admin');
        await expect(eigene.locator('select')).toHaveValue('admin');
        expect((await mitgliedschaft('offline_user', vereinId)).rolle).toBe('admin');
    } finally {
        await mitTestDb(async (db) => {
            await db('benutzer').where({ id: 'offline_user', aktiver_verein_id: vereinId }).update({ aktiver_verein_id: null });
            await db('benutzer_vereine').where({ verein_id: vereinId }).del();
            await db('vereine').where({ id: vereinId }).del();
        });
    }
});
