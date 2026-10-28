// End-to-End: Turnier anlegen und bearbeiten am Handy (375 x 812) — alle vier Assistenten-Seiten ohne Seitwärts-Scrollen,
// Navigation und Speichern erreichbar. Hallen-Server ohne Anmeldung (Einzelbenutzer).
import { test, expect } from '@playwright/test';
import { keinSeitwaertsScrollen } from './helpers/mobil.js';

test.use({ viewport: { width: 375, height: 812 }, hasTouch: true });

let turnierId;

test.beforeAll(async ({ request }) => {
    const resp = await request.post('/api/turniere', {
        data: { bezeichnung: `Mobil-Turnier ${Date.now()}`, ort: 'Halle', datum: '2033-07-02', ausrichter: 'Offline Club', anzahl_kampfflaechen: 2 }
    });
    expect(resp.ok(), await resp.text()).toBeTruthy();
    turnierId = (await resp.json()).turnierId;
});

for (const schritt of [1, 2, 3, 4]) {
    test(`Bearbeiten, Seite ${schritt}: kein Seitwärts-Scrollen`, async ({ page }) => {
        await page.goto(`/turnier.html?id=${turnierId}`);
        await page.locator(`.assistent-schritt[data-schritt="${schritt}"]`).click();
        await expect(page.locator(`.assistent-seite[data-seite="${schritt}"]`)).toBeVisible();
        await keinSeitwaertsScrollen(page);
    });
}

test('Bearbeiten: Schrittanzeige und Speichern erreichbar', async ({ page }) => {
    await page.goto(`/turnier.html?id=${turnierId}`);
    for (const nr of [1, 2, 3, 4]) await expect(page.locator(`.assistent-schritt[data-schritt="${nr}"]`)).toBeInViewport({ ratio: 1 });
    await page.locator('.assistent-schritt[data-schritt="4"]').click();
    await expect(page.locator('#submitBtn')).toBeVisible();
});

test('Neu anlegen: Seite 1 ohne Seitwärts-Scrollen, Weiter erreichbar', async ({ page }) => {
    await page.goto('/turnier.html');
    await expect(page.locator('.assistent-seite[data-seite="1"]')).toBeVisible();
    await keinSeitwaertsScrollen(page);
    await expect(page.locator('#assistentWeiter')).toBeVisible();
});
