// End-to-End: Dialoge der Seite „Benutzer“ sind in beiden Themes lesbar (Text und Hintergrund der Felder unterscheiden sich).
import { test, expect } from '@playwright/test';

const CLOUD_CONFIG = { isOffline: false, syncRolle: null, betriebsmodus: 'cloud' };
const SUPER = {
    id: 'e2e-super', email: 'super@example.test', vorname: 'Sam', nachname: 'Super',
    verein_id: 1, verein_name: 'Administration', verein_freigegeben: true, verein_rolle: 'admin',
    verein_wartet_auf_super_admin: false, ist_super_admin: true, super_admin_aktiv: true,
    vereine: [{ verein_id: 1, name: 'Administration', freigegeben: true, rolle: 'admin' }]
};
const KONTEN = [
    { id: 'u-anna', vorname: 'Anna', nachname: 'Adler', email: 'anna@example.test', ist_super_admin: false, email_bestaetigt: true,
        mitgliedschaften: [{ verein_id: 2, verein_name: 'JC Alpha', rolle: 'helfer', freigegeben: true }] }
];

// Relative Helligkeit nach WCAG, Kontrast = (heller + 0.05) / (dunkler + 0.05)
function kontrast(a, b) {
    const lum = ([r, g, bl]) => {
        const k = [r, g, bl].map((c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
        return 0.2126 * k[0] + 0.7152 * k[1] + 0.0722 * k[2];
    };
    const [h, d] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (h + 0.05) / (d + 0.05);
}

// Alle sichtbaren Textelemente unterhalb von wurzel: Textfarbe gegen den tatsächlichen Hintergrund (Browser-Seite)
function pruefeTexte(wurzel) {
    const lies = (wert) => (wert.match(/[\d.]+/g) || []).map(Number);
    const hintergrund = (el) => {
        for (let n = el; n; n = n.parentElement) {
            const c = lies(getComputedStyle(n).backgroundColor);
            if (c.length >= 3 && (c.length < 4 || c[3] > 0.5)) return c.slice(0, 3);
        }
        return [255, 255, 255];
    };
    const aus = [];
    for (const el of wurzel.querySelectorAll('h2, p, label, button, li, input, select')) {
        if (!el.getClientRects().length) continue;
        aus.push({ knopf: el.classList.contains('btn'), el: `${el.tagName.toLowerCase()}#${el.id || el.className || el.textContent.trim().slice(0, 20)}`, text: lies(getComputedStyle(el).color).slice(0, 3), grund: hintergrund(el) });
    }
    return aus;
}

for (const theme of ['light', 'dark']) {
    test(`Benutzer: Felder in den Dialogen sind lesbar (${theme})`, async ({ page }) => {
        await page.addInitScript((t) => { try { localStorage.setItem('hajime-theme', t); } catch { /* egal */ } }, theme);
        await page.route('**/api/config', (route) => route.fulfill({ json: CLOUD_CONFIG }));
        await page.route('**/api/auth/me', (route) => route.fulfill({ json: { success: true, user: SUPER } }));
        await page.route('**/api/nutzer', (route) => route.fulfill({ json: KONTEN }));
        await page.route('**/api/vereine', (route) => route.fulfill({ json: [{ id: 2, name: 'JC Alpha' }] }));
        await page.goto('/admin-nutzer.html');
        await expect(page.locator('tr[data-id="u-anna"]')).toBeVisible();

        const felder = {
            bearbeitenDialog: ['#bearbeitenVorname', '#bearbeitenNachname', '#bearbeitenEmail'],
            passwortDialog: ['#passwortFeld'],
            zuweisenDialog: ['#zuweisenVerein', '#zuweisenRolle'],
            superHinzufuegenDialog: ['#superHinzufuegenSuche']
        };
        const oeffnen = {
            bearbeitenDialog: 'tr[data-id="u-anna"] button[title="Bearbeiten"]',
            passwortDialog: 'tr[data-id="u-anna"] button[title="Initialpasswort vergeben"]',
            zuweisenDialog: 'tr[data-id="u-anna"] button[title="Verein und Rolle zuweisen"]',
            superHinzufuegenDialog: '#superHinzufuegenKnopf'
        };
        for (const [dialog, selektoren] of Object.entries(felder)) {
            await page.locator(oeffnen[dialog]).click();
            for (const selektor of selektoren) {
                const farben = await page.locator(selektor).evaluate((el) => {
                    const lies = (wert) => (wert.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
                    const stil = getComputedStyle(el);
                    return { text: lies(stil.color), grund: lies(stil.backgroundColor) };
                });
                expect(kontrast(farben.text, farben.grund), `${dialog} ${selektor} (${theme}): ${JSON.stringify(farben)}`).toBeGreaterThan(4.5);
            }
            if (dialog === 'superHinzufuegenDialog') {
                await page.locator('#superHinzufuegenSuche').fill('a');
                await expect(page.locator('#superHinzufuegenTreffer li').first()).toBeVisible();
            }
            for (const p of await page.locator(`#${dialog}`).evaluate(pruefeTexte)) {
                expect(kontrast(p.text, p.grund), `${dialog} ${p.el} (${theme}): ${JSON.stringify(p)}`).toBeGreaterThan(p.knopf ? 3 : 4.5);
            }
            await page.keyboard.press('Escape');
        }

        // Aufklappliste der Dropdowns: Einträge haben eigene Farben (nicht helle Schrift auf weißem Standardgrund)
        await page.locator('tr[data-id="u-anna"] button[title="Verein und Rolle zuweisen"]').click();
        const option = await page.locator('#zuweisenRolle option').first().evaluate((el) => {
            const lies = (wert) => (wert.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
            const stil = getComputedStyle(el);
            return { text: lies(stil.color), grund: lies(stil.backgroundColor) };
        });
        expect(kontrast(option.text, option.grund), `option (${theme}): ${JSON.stringify(option)}`).toBeGreaterThan(4.5);
        await page.keyboard.press('Escape');

        // Texte im Bestätigungs-Modal (Knöpfe: große Beschriftung im App-Stil, 3:1 genügt)
        await page.locator('tr[data-id="u-anna"] button[title="Löschen"]').click();
        await expect(page.locator('#modalMessage')).toBeVisible();
        for (const p of await page.locator('#customConfirmModal').evaluate(pruefeTexte)) {
            expect(kontrast(p.text, p.grund), `Modal ${p.el} (${theme}): ${JSON.stringify(p)}`).toBeGreaterThan(p.knopf ? 3 : 4.5);
        }
    });
}
