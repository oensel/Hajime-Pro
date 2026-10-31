// Schreibpasswort in der Client-Konfig ohne das bisherige setzen (POST /api/client/steuerung-passwort).
// Das Passwort bleibt danach gesetzt (es lässt sich nicht entfernen): diese Spec muss als letzte ihres Shards laufen. Die Specs laufen in Dateinamen-Reihenfolge, darum beginnt der Dateiname mit "zuletzt-".
import crypto from 'node:crypto';
import { test, expect } from '@playwright/test';
import { syncStatus, warteLeerlauf, richteDk8TurnierEin, ladeDokument } from './helpers.js';

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

test.describe.serial('Schreibpasswort setzen', () => {
    test('Aufbau: aktives Turnier (noch ohne Passwort)', async ({ request }) => {
        await richteDk8TurnierEin(request, 'Schreibpasswort');
        await warteLeerlauf(request);
    });

    test('Karte in der Client-Konfig, Eingabe prüfen, neues Passwort gilt', async ({ page, request }) => {
        await page.goto('/client-konfig.html');
        await expect(page.locator('#passwortKarte')).toBeVisible();

        const zuKurz = await request.post('/api/client/steuerung-passwort', { data: { neuesPasswort: 'kurz' } });
        expect(zuKurz.status()).toBe(400);

        await page.fill('#passwortNeu', 'neuesPasswort-1');
        await page.fill('#passwortWiederholung', 'neuesPasswort-2');
        await page.click('#passwortForm button[type=submit]');
        await expect(page.locator('#passwortMeldung')).toContainText('nicht gleich');

        await page.fill('#passwortWiederholung', 'neuesPasswort-1');
        await page.click('#passwortForm button[type=submit]');
        await expect(page.locator('#passwortMeldung')).toContainText('gilt jetzt');

        const verify = (passwort) => request.post('/api/auth/verify', { data: { password: passwort } });
        expect((await verify('neuesPasswort-1')).ok()).toBeTruthy();
        // ohne das jetzt gültige Passwort noch einmal überschreiben
        const ueberschrieben = await request.post('/api/client/steuerung-passwort', { data: { neuesPasswort: 'nochmalAnders-3' } });
        expect(ueberschrieben.ok()).toBeTruthy();
        expect((await verify('neuesPasswort-1')).status()).toBe(401);
        expect((await verify('nochmalAnders-3')).ok()).toBeTruthy();
    });

    test('der Hash für die Client-Geräte (konfig:steuerung) folgt dem neuen Passwort', async ({ request }) => {
        // Windows-/Android-Clients prüfen das Passwort offline gegen diesen Hash
        const dbName = (await syncStatus(request)).db_name;
        // einziger schreibender Request: der Abgleich muss von der Route selbst angestoßen werden (sie liegt vor dem Abgleich-Hook in app.js)
        const r = await request.post('/api/client/steuerung-passwort', { data: { neuesPasswort: 'letztesPasswort-4' } });
        expect(r.ok()).toBeTruthy();
        await expect.poll(async () => (await ladeDokument(request, dbName, 'konfig:steuerung')).steuerung_passwort_sha256, { timeout: 15000 })
            .toBe(sha256('letztesPasswort-4'));
    });
});
