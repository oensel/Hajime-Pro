// End-to-End: Menü mit aufklappbarem Orga-Untermenü (public/js/menu.js, Spec Orga-Planer, Abschnitt Oberfläche → Menü).
// Hallen-Server ohne Anmeldung (Einzelbenutzer); die Helfer-API (/api/helfer/orga/meine) gibt es dort nicht,
// daher bleibt der Zähler „Meine Aufgaben“ verborgen.
import { test, expect } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

let turnierId;
let orga;
const aufgabe = (key) => orga.phasen.flatMap((p) => p.aufgaben).find((a) => a.vorlage_key === key);

test.beforeAll(async ({ request }) => {
    const resp = await request.post('/api/turniere', {
        data: { planungs_tools: true, bezeichnung: `Menü-Orga ${Date.now()}`, ort: 'Halle', datum: '2033-04-09', ausrichter: 'Offline Club', anzahl_kampfflaechen: 1 }
    });
    expect(resp.ok(), await resp.text()).toBeTruthy();
    turnierId = (await resp.json()).turnierId;
    const r = await request.get(`/api/orga?turnierId=${turnierId}`);
    expect(r.ok()).toBeTruthy();
    orga = await r.json();
});

const kopf = (page) => page.locator('#nav-orga-kopf');

test('Hauptleiste enthält Orga mit Untermenü in fester Reihenfolge, Helfer und Designer nicht mehr oben', async ({ page }) => {
    await page.goto(`/turnier.html?id=${turnierId}`);
    await expect(kopf(page)).toBeVisible();
    await expect(kopf(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(kopf(page)).toHaveAttribute('aria-controls', 'nav-orga-liste');
    await expect(page.locator('#nav-orga-liste > li > a > .menu-text')).toHaveText(
        ['Übersicht', 'Meine Aufgaben', 'Helfer', 'Technik', 'Catering', 'Medaillen und Pokale', 'Urkunden-Designer']);
    // direkt nach „Turnier“
    const reihenfolge = await page.locator('#sidebarNavPrimary > *').evaluateAll((els) => els.map((e) => e.id));
    expect(reihenfolge.indexOf('nav-orga')).toBe(reihenfolge.indexOf('nav-turnier') + 1);
    // Helfer und Urkunden-Designer stehen nur im Untermenü
    await expect(page.locator('#sidebarNavPrimary > #nav-helfer')).toHaveCount(0);
    await expect(page.locator('#sidebarNavPrimary > #nav-urkunden-designer')).toHaveCount(0);
    await expect(page.locator('#nav-orga-liste #nav-helfer')).toHaveAttribute('href', `/helfer-plan.html?turnierId=${turnierId}`);
    await expect(page.locator('#nav-orga-meine')).toHaveAttribute('href', `/orga.html?ansicht=meine&turnierId=${turnierId}`);
    // Systempunkte unten unverändert vorhanden
    await expect(page.locator('#sidebarNavUnten #nav-helfer-app')).toHaveCount(1);
});

test('Zuklappen/Aufklappen per Tastatur-Button, Zustand überlebt Neuladen', async ({ page }) => {
    await page.goto(`/turnier.html?id=${turnierId}`);
    await expect(page.locator('#nav-orga-liste')).toBeVisible();
    await kopf(page).click();
    await expect(kopf(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#nav-orga-liste')).toBeHidden();
    await page.reload();
    await expect(kopf(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#nav-orga-liste')).toBeHidden();
    // Enter auf dem fokussierten Button klappt wieder auf
    await kopf(page).focus();
    await page.keyboard.press('Enter');
    await expect(kopf(page)).toHaveAttribute('aria-expanded', 'true');
    await page.reload();
    await expect(page.locator('#nav-orga-liste')).toBeVisible();
});

test('Zugeklappt, aber auf einer Orga-Seite öffnet sich das Untermenü wieder', async ({ page }) => {
    await page.goto(`/turnier.html?id=${turnierId}`);
    await kopf(page).click();
    await expect(page.locator('#nav-orga-liste')).toBeHidden();
    await page.goto(`/orga.html?turnierId=${turnierId}`);
    await expect(page.locator('#nav-orga-liste')).toBeVisible();
    await expect(kopf(page)).toHaveClass(/active/);
    await expect(page.locator('#nav-orga-uebersicht')).toHaveClass(/active/);
    await expect(page.locator('#nav-orga-meine')).not.toHaveClass(/active/);
});

test('Meine Aufgaben: Link aktiviert den Filter „Nur meine Aufgaben“ und ist aktiv markiert', async ({ page }) => {
    await page.goto(`/orga.html?turnierId=${turnierId}`);
    await page.locator('#nav-orga-meine').click();
    await expect(page).toHaveURL(/ansicht=meine/);
    await expect(page.locator('#ogNurMeine')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#nav-orga-meine')).toHaveClass(/active/);
    await expect(page.locator('#nav-orga-uebersicht')).not.toHaveClass(/active/);
    // Hallen-Server hat keine Helfer-API: kein Zähler
    await expect(page.locator('#nav-orga-meine-zaehler')).toBeHidden();
});

test('Aktiver Punkt auf helfer-plan.html und urkunden-designer.html (Eltern und Kind)', async ({ page }) => {
    await page.goto(`/helfer-plan.html?turnierId=${turnierId}`);
    await expect(page.locator('#nav-helfer')).toHaveClass(/active/);
    await expect(kopf(page)).toHaveClass(/active/);
    await page.goto(`/urkunden-designer.html?turnierId=${turnierId}`);
    await expect(page.locator('#nav-urkunden-designer')).toHaveClass(/active/);
    await expect(kopf(page)).toHaveClass(/active/);
    await expect(page.locator('#nav-helfer')).not.toHaveClass(/active/);
});

test('Zähler und Link der Technik-Zeile folgen den Posten; Technik öffnet die richtige Aufgabe', async ({ page, request }) => {
    const technik = aufgabe('technik_bereitstellen');
    const gesamt = technik.kinder.length;
    await page.goto(`/turnier.html?id=${turnierId}`);
    const link = page.locator('#nav-orga-technik');
    await expect(link).toBeVisible();
    await expect(link.locator('.menu-item-badge')).toHaveText(`0/${gesamt}`);
    for (const kind of technik.kinder.slice(0, 3)) {
        const r = await request.post(`/api/orga/aufgaben/${kind.id}/erledigt`, { data: { erledigt: true } });
        expect(r.ok(), await r.text()).toBeTruthy();
    }
    await page.reload();
    await expect(link.locator('.menu-item-badge')).toHaveText(`3/${gesamt}`);
    await expect(link).toHaveAttribute('href', `/orga-aufgabe.html?id=${technik.id}&turnierId=${turnierId}`);
    await link.click();
    await expect(page.locator('#ogAufgabeTitel')).toHaveText('Technik bereitstellen');
    await expect(page.locator('#nav-orga-technik')).toHaveClass(/active/);
    await expect(kopf(page)).toHaveClass(/active/);
    // Catering und Medaillen verweisen auf ihre Aufgaben
    await expect(page.locator('#nav-orga-catering')).toHaveAttribute('href', new RegExp(`id=${aufgabe('catering').id}&`));
    await expect(page.locator('#nav-orga-medaillen')).toHaveAttribute('href', new RegExp(`id=${aufgabe('medaillen').id}&`));
});

test('Eingeklappte Seitenleiste: nur Icon, Klick auf Orga öffnet die Übersicht', async ({ page }) => {
    await page.goto(`/turnier.html?id=${turnierId}`);
    await page.locator('#sidebarCollapseBtn').click();
    await expect(page.locator('#nav-orga-liste')).toBeHidden();
    await expect(page.locator('#nav-orga-kopf .menu-text')).toBeHidden();
    await kopf(page).click();
    await expect(page).toHaveURL(new RegExp(`/orga\\.html\\?turnierId=${turnierId}`));
    // Zustand der Seitenleiste zurücksetzen
    await page.evaluate(() => localStorage.removeItem('hajime-sidebar-collapsed'));
});

test('Telefonbreite: Orga-Symbol sichtbar, Untermenü ausgeblendet, Klick öffnet die Übersicht', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(`/turnier.html?id=${turnierId}`);
    await expect(kopf(page)).toBeVisible();
    await expect(page.locator('#nav-orga-liste')).toBeHidden();
    await kopf(page).click();
    await expect(page).toHaveURL(new RegExp(`/orga\\.html\\?turnierId=${turnierId}`));
});
