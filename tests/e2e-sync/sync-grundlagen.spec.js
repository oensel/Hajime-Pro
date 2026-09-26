// Grundlagen der Sync-Schicht auf dem Hallen-Server: /api/sync/status, Anlage der Dokument-DB je
// Turnier-Instanz und das Ersetzen des (einzigen) Turniers beim Anlegen eines neuen.
import { test, expect } from '@playwright/test';
import { syncStatus, legeTurnierAn } from './helpers.js';

test.describe.serial('Sync-Grundlagen: Dokument-DB und Turnier-Instanz', () => {
    // Kein "anfangs ohne Turnier": die Spec-Dateien teilen sich einen Server, die Reihenfolge der
    // Dateien ist nicht garantiert.
    test('Status meldet Server-Rolle', async ({ request }) => {
        const status = await syncStatus(request);
        expect(status.rolle).toBe('server');
    });

    test('Turnier anlegen erzeugt Instanz und Dokument-DB', async ({ request }) => {
        const turnierId = await legeTurnierAn(request, 'Sync Grundlagen 1');
        const status = await syncStatus(request);
        expect(status.turnier_id).toBe(turnierId);
        expect(status.instanz_id).toMatch(/^[0-9a-f-]{36}$/);
        expect(status.db_name).toBe(`turnier_${status.instanz_id}`);
        expect((await request.get(`/db/${status.db_name}`)).ok()).toBeTruthy();
        expect((await request.get('/db/irgendeine_andere_db')).status()).toBe(404);
    });

    test('zweites Turnier ersetzt das erste komplett (SQL und Dokument-DB)', async ({ request }) => {
        const alt = await syncStatus(request);
        await legeTurnierAn(request, 'Sync Grundlagen 2');
        const neu = await syncStatus(request);
        expect(neu.instanz_id).not.toBe(alt.instanz_id);
        expect((await request.get(`/db/${alt.db_name}`)).status()).toBe(404);
        const turniere = await (await request.get('/api/turniere')).json();
        expect(turniere.map(t => t.bezeichnung)).toEqual(['Sync Grundlagen 2']);
    });

    test('Neuanlage über turnier.html fragt vorher nach; Abbrechen behält das bisherige Turnier', async ({ page, request }) => {
        const vorher = await syncStatus(request);

        await page.goto('/turnier.html');
        await page.locator('#bezeichnung').fill('Sync Grundlagen 3');
        await page.locator('#datum').fill('2027-05-15');
        await page.locator('#ort').fill('Senden');
        await page.locator('#plz').fill('48308');
        await page.locator('#ausrichter').fill('JC Senden');
        await page.locator('#anzahl_kampfflaechen').fill('1');
        await page.locator('#bundesland').selectOption('Nordrhein-Westfalen');
        await page.locator('#submitBtn').click();

        const dialog = page.locator('#customConfirmModal');
        await expect(dialog).toBeVisible();
        await expect(page.locator('#modalMessage')).toContainText('nur ein Turnier');
        await page.locator('#modalCancelBtn').click();
        await expect(dialog).toBeHidden();
        expect((await syncStatus(request)).instanz_id).toBe(vorher.instanz_id);

        await page.locator('#submitBtn').click();
        await expect(dialog).toBeVisible();
        await page.locator('#modalConfirmBtn').click();
        await expect(page.locator('#snackbarText')).toHaveText('Turnier erfolgreich angelegt!');
        const nachher = await syncStatus(request);
        expect(nachher.instanz_id).not.toBe(vorher.instanz_id);
        const turniere = await (await request.get('/api/turniere')).json();
        expect(turniere.map(t => t.bezeichnung)).toEqual(['Sync Grundlagen 3']);
    });
});
