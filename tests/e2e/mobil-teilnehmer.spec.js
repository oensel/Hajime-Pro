// End-to-End: Teilnehmerliste am Handy (375 x 812) — Karten statt Tabelle, Suche, Tippen öffnet die Waage, kein Seitwärts-Scrollen.
// Hallen-Server ohne Anmeldung (Einzelbenutzer).
import { test, expect } from '@playwright/test';
import { legeTurnierAn, legeKlasseAn } from './helpers/turnier-aufbau.js';
import { keinSeitwaertsScrollen } from './helpers/mobil.js';

test.use({ viewport: { width: 375, height: 812 }, hasTouch: true });

let turnierId;

test.beforeAll(async ({ request }) => {
    turnierId = await legeTurnierAn(request, { name: 'Mobil Teilnehmer' });
    await legeKlasseAn(request, turnierId, { altersklasse: 'U13', geschlecht: 'männlich', gewichtsklasse: '-40', anzahl: 3, gewogen: true, gewichtStart: 36, namenszusatz: 'Gewogen' });
    await legeKlasseAn(request, turnierId, { altersklasse: 'U15', geschlecht: 'weiblich', gewichtsklasse: '-44', anzahl: 2, gewogen: false, gewichtStart: 40, namenszusatz: 'Offen' });
});

test('Karten statt Tabelle, mit Gewicht oder „offen“, ohne Seitwärts-Scrollen', async ({ page }) => {
    await page.goto(`/teilnehmer.html?turnierId=${turnierId}`);
    const karten = page.locator('#handyKarten .handy-karte');
    await expect(karten).toHaveCount(5);
    await expect(page.locator('.table-responsive')).toBeHidden();
    await expect(page.locator('#handyKarten .handy-chip-gruen')).toHaveCount(3);
    await expect(page.locator('#handyKarten .handy-chip-gelb')).toHaveCount(2);
    await expect(karten.first()).toBeInViewport();
    await expect(page.locator('#addBtn')).toBeVisible();
    await keinSeitwaertsScrollen(page);
});

test('Suche filtert die Karten', async ({ page }) => {
    await page.goto(`/teilnehmer.html?turnierId=${turnierId}`);
    await expect(page.locator('#handyKarten .handy-karte')).toHaveCount(5);
    await page.locator('#teilnehmerSearchInput').fill('Offen');
    await expect(page.locator('#handyKarten .handy-karte')).toHaveCount(2);
});

test('Tippen auf eine Karte öffnet die Waage', async ({ page }) => {
    await page.goto(`/teilnehmer.html?turnierId=${turnierId}`);
    await page.locator('#handyKarten .handy-karte[data-id]').first().click();
    await expect(page.locator('#waageModal')).toBeVisible();
    await keinSeitwaertsScrollen(page);
});

test('Auf dem Desktop bleibt die Tabelle', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`/teilnehmer.html?turnierId=${turnierId}`);
    await expect(page.locator('.judo-table tbody tr').first()).toBeVisible();
    await expect(page.locator('#handyKarten')).toBeHidden();
});
