// End-to-End: Handy-Ansicht (375 x 812) — Menü als Schublade, kein horizontales Scrollen (public/css/common.css, public/js/menu.js).
// Hallen-Server ohne Anmeldung (Einzelbenutzer).
import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 375, height: 812 }, hasTouch: true });

let turnierId;

test.beforeAll(async ({ request }) => {
    const resp = await request.post('/api/turniere', {
        data: { bezeichnung: `Mobil-Menü ${Date.now()}`, ort: 'Halle', datum: '2033-05-14', ausrichter: 'Offline Club', anzahl_kampfflaechen: 1 }
    });
    expect(resp.ok(), await resp.text()).toBeTruthy();
    turnierId = (await resp.json()).turnierId;
});

const keinSeitwaertsScrollen = async (page) => {
    const breiter = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(breiter).toBe(false);
};

test('Menü ist am Handy eine Schublade: zu, mit Knopf auf, Hintergrund und Link schließen', async ({ page }) => {
    await page.goto(`/turnier.html?id=${turnierId}`);
    const knopf = page.locator('#menueKnopf');
    await expect(knopf).toBeVisible();
    await expect(knopf).toHaveAttribute('data-bereit', '1');
    await expect(page.locator('.app-sidebar')).not.toBeInViewport();

    await knopf.click();
    await expect(page.locator('.app-sidebar')).toBeInViewport();
    await expect(page.locator('#nav-teilnehmer .menu-text')).toBeVisible();

    await page.locator('#menueHintergrund').click({ position: { x: 360, y: 400 } });
    await expect(page.locator('.app-sidebar')).not.toBeInViewport();

    await knopf.click();
    await page.locator('#nav-teilnehmer').click();
    await expect(page).toHaveURL(/teilnehmer\.html/);
});

test('Turnierübersicht läuft am Handy nicht seitwärts über', async ({ page }) => {
    await page.goto('/turniere.html');
    await expect(page.locator('.tournament-card').first()).toBeVisible();
    await keinSeitwaertsScrollen(page);
});

test('Auf dem Desktop gibt es keinen Menü-Knopf', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`/turnier.html?id=${turnierId}`);
    await expect(page.locator('.app-sidebar')).toBeInViewport();
    await expect(page.locator('#menueKnopf')).toBeHidden();
});
