// End-to-End: Helfer-App (helfer.html) im Hallen-Server-Betrieb mit HELFER_APP_AKTIV=true (test-env.js).
// Der Einzelbenutzer offline_user ist Admin im „Offline Club“; neue Turniere gehören diesem Verein.
import { test, expect } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

const NAME = `Helfer-App ${Date.now()}`;
let turnierId;

const karte = (page) => page.locator('.hf-turnier-karte').filter({ hasText: NAME });
const gruppe = (page, name) => page.locator('.hf-gruppe').filter({ has: page.locator('.hf-gruppe-titel', { hasText: name }) });

test.beforeAll(async ({ request }) => {
    const resp = await request.post('/api/turniere', {
        data: {
            bezeichnung: NAME, ort: 'Sporthalle Nord', datum: '2031-11-15', ausrichter: 'Offline Club',
            anzahl_kampfflaechen: 1, beginn_min: 540, ende_min: 780
        }
    });
    expect(resp.ok(), await resp.text()).toBeTruthy();
    turnierId = (await resp.json()).turnierId;
    const pub = await request.post(`/api/turniere/${turnierId}/veroeffentlichen`);
    expect(pub.ok(), await pub.text()).toBeTruthy();
    // Legt die Standard-Tätigkeiten (Matte, Waage) samt Slots an
    const plan = await request.get(`/api/helfer-plan/${turnierId}`);
    expect(plan.ok(), await plan.text()).toBeTruthy();
});

test('Turnierkarte mit Datum, Ort, Verein und offenen Diensten', async ({ page }) => {
    await page.goto('/helfer.html');
    const k = karte(page);
    await expect(k).toBeVisible();
    await expect(k).toContainText('Sa., 15.11.2031');
    await expect(k).toContainText('Sporthalle Nord');
    await expect(k).toContainText('Offline Club');
    await expect(k.locator('.hf-badge')).toContainText(/\d+ Dienste? offen/);
});

test('Offene Dienste sind nach Tätigkeit gruppiert, Slots nach Uhrzeit', async ({ page }) => {
    await page.goto('/helfer.html');
    await karte(page).click();
    await expect(page).toHaveURL(new RegExp(`#turnier=${turnierId}$`));
    await expect(page.locator('.hf-titel')).toContainText(NAME);
    const titel = await page.locator('.hf-gruppe-titel').allTextContents();
    expect(titel).toEqual(['Kampfgericht Matte 1', 'Waage 1']);
    const waage = gruppe(page, 'Waage 1');
    await expect(waage.locator('.hf-slot-zeit')).toHaveText(['09:00 – 11:00', '11:00 – 13:00']);
    await expect(waage.locator('.hf-slot').first()).toContainText(/noch \d+ Pl(atz|ätze) frei/);

    // Zurück-Pfeil führt zur Turnierliste
    await page.locator('.hf-zurueck').click();
    await expect(page).toHaveURL(/#turniere$/);
    await expect(karte(page)).toBeVisible();
});

test('Eintragen, Überschneidung, Meine Dienste und Austragen', async ({ page }) => {
    await page.goto(`/helfer.html#turnier=${turnierId}`);
    const waageSlot = gruppe(page, 'Waage 1').locator('.hf-slot').first();
    await waageSlot.getByRole('button', { name: 'Eintragen' }).click();
    await expect(waageSlot).toContainText('Du bist eingetragen');
    await expect(waageSlot.locator('.hf-badge')).toHaveText('Eingetragen');

    // Gleiche Zeit in einer anderen Tätigkeit: Hinweis inline
    const matteSlot = gruppe(page, 'Kampfgericht Matte 1').locator('.hf-slot').first();
    await matteSlot.getByRole('button', { name: 'Eintragen' }).click();
    await expect(matteSlot.locator('.hf-fehler')).toHaveText('Das überschneidet sich mit einem deiner Dienste.');

    await page.locator('.hf-nav a[href="#dienste"]').click();
    await expect(page).toHaveURL(/#dienste$/);
    const tag = page.locator('.hf-tag').filter({ hasText: NAME });
    await expect(tag).toContainText('Sa., 15.11.2031');
    const dienst = tag.locator('.hf-dienst');
    await expect(dienst).toHaveCount(1);
    await expect(dienst).toContainText('Waage 1');
    await expect(dienst).toContainText('09:00 – 11:00');

    await dienst.getByRole('button', { name: 'Austragen' }).click();
    await expect(page.locator('.hf-tag').filter({ hasText: NAME })).toHaveCount(0);

    const meine = await (await page.request.get('/api/helfer/meine-dienste')).json();
    expect(meine.filter(d => d.turnier.id === turnierId)).toEqual([]);
});

test('Profil zeigt den Verein, Autovervollständigung findet „Offline Club“', async ({ page }) => {
    await page.goto('/helfer.html#profil');
    const verein = page.locator('.hf-verein').filter({ hasText: 'Offline Club' });
    await expect(verein).toBeVisible();
    await expect(verein).toContainText('Freigeschaltet als Admin');
    await expect(page.locator('.hf-profil-name')).toContainText('Offline User');

    const feld = page.locator('#hfVereinSuche');
    await feld.fill('Off');
    const option = page.locator('#hfVereinListe [role="option"]').filter({ hasText: 'Offline Club' });
    await expect(option).toBeVisible();
    // Pfeiltaste + Enter wählt; bereits vorhandener Verein ergibt einen Hinweis
    await feld.press('ArrowDown');
    await expect(page.locator('#hfVereinListe [aria-selected="true"]')).toHaveCount(1);
    await option.click();
    await expect(page.locator('#hfVereinMeldung')).toContainText('bereits');
});

test('Mobil 375×812: kein horizontales Scrollen, Navigation unten', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    for (const ziel of ['#turniere', `#turnier=${turnierId}`, '#dienste', '#profil']) {
        await page.goto(`/helfer.html${ziel}`);
        await expect(page.locator('.hf-inhalt')).not.toBeEmpty();
        await page.waitForLoadState('networkidle');
        const passt = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
        expect(passt, `horizontales Scrollen bei ${ziel}`).toBeTruthy();
    }
    const nav = await page.locator('.hf-nav').boundingBox();
    expect(nav.y + nav.height).toBeGreaterThanOrEqual(811);
    const reiter = await page.locator('.hf-nav a').first().boundingBox();
    expect(reiter.height).toBeGreaterThanOrEqual(44);
});

test('Desktop 1280×800: Inhalt mittig mit höchstens 720 px, Navigation oben', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/helfer.html');
    await expect(karte(page)).toBeVisible();
    const inhalt = page.locator('.hf-inhalt');
    expect(await inhalt.evaluate(e => getComputedStyle(e).maxWidth)).toBe('720px');
    const box = await inhalt.boundingBox();
    const breite = await page.evaluate(() => document.documentElement.clientWidth);
    expect(box.width).toBeLessThanOrEqual(720);
    expect(Math.abs(box.x - (breite - box.width) / 2)).toBeLessThan(2);
    const nav = await page.locator('.hf-nav').boundingBox();
    expect(nav.y).toBeLessThan(box.y);
});
