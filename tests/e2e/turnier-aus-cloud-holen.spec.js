// Turnier aus der Cloud holen (Turnierauswahl am Hallen-Server), gegen die Fake-Cloud aus
// tests/helpers/fake-cloud.mjs (CLOUD_URL in test-env.js).
import { test, expect } from '@playwright/test';
import { FAKE_CLOUD_EMAIL, FAKE_CLOUD_PASSWORT } from './test-env.js';

test.describe('Turnier aus der Cloud holen', () => {
    test('Status meldet die erreichbare Cloud als verfügbar', async ({ request }) => {
        const resp = await request.get('/api/cloud/status');
        expect(resp.ok()).toBe(true);
        expect((await resp.json()).verfuegbar).toBe(true);
    });

    test('falsches Passwort wird abgelehnt und das Token nicht ausgegeben', async ({ request }) => {
        const resp = await request.post('/api/cloud/turniere', { data: { email: FAKE_CLOUD_EMAIL, password: 'falsch' } });
        // 422 statt 401: ein 401 würde die Seite auf die Anmeldeseite dieses Servers umleiten
        expect(resp.status()).toBe(422);
        const body = await resp.json();
        expect(body.token).toBeUndefined();
    });

    test('Holen eines noch laufenden Turniers wird von der Cloud abgelehnt', async ({ request }) => {
        const login = await (await request.post('/api/cloud/turniere', {
            data: { email: FAKE_CLOUD_EMAIL, password: FAKE_CLOUD_PASSWORT }
        })).json();
        const resp = await request.post('/api/cloud/turniere/11/holen', { data: { token: login.token } });
        expect(resp.status()).toBe(403);
        expect((await resp.json()).error).toMatch(/Anmeldefrist/);
    });

    test('Oberfläche: Trennstrich, Anmeldung, Liste und Holen legt ein neues, noch nicht aktives Turnier an', async ({ page }) => {
        await page.goto('/turniere.html');

        const bereich = page.locator('#cloudBereich');
        await expect(bereich).toBeVisible();
        await expect(bereich.locator('.cloud-trenner')).toContainText('Turniere aus der Cloud');

        // falsche Anmeldung: Fehler direkt unter dem Formular, Formular bleibt
        await page.fill('#cloudEmail', FAKE_CLOUD_EMAIL);
        await page.fill('#cloudPasswort', 'falsch');
        await page.click('#cloudLoginBtn');
        await expect(page.locator('#cloudFehler')).toContainText('Ungültige Anmeldedaten');
        await expect(page.locator('#cloudLoginForm')).toBeVisible();

        // richtige Anmeldung: Liste, nur das geschlossene Turnier ist holbar
        await page.fill('#cloudPasswort', FAKE_CLOUD_PASSWORT);
        await page.click('#cloudLoginBtn');
        await expect(page.locator('#cloudLoginForm')).toBeHidden();
        await expect(page.locator('#cloudListe .tournament-card')).toHaveCount(2);
        await expect(page.locator('#cloudListe .cloud-holen')).toHaveCount(1);
        await expect(page.locator('#cloudListe')).toContainText('Anmeldung läuft noch');

        // Holen (Bestätigungsdialog der Seite oder window.confirm)
        page.on('dialog', d => d.accept());
        await page.locator('#cloudListe .cloud-holen').click();
        const bestaetigen = page.getByRole('button', { name: /^(Fortfahren|Bestätigen|OK|Ja)/i });
        if (await bestaetigen.first().isVisible().catch(() => false)) await bestaetigen.first().click();

        await page.waitForURL(/\/teilnehmer\.html\?turnierId=\d+/);

        const liste = await (await page.request.get('/api/turniere')).json();
        const geholt = liste.find(t => t.bezeichnung === 'Cloud-Turnier geschlossen');
        expect(geholt).toBeTruthy();
        expect(geholt.aktiv).toBe(false); // aktiviert wird per Knopf am Wettkampftag
        expect(new URL(page.url()).searchParams.get('turnierId')).toBe(String(geholt.id));

        // die Vereinsliste der Cloud steht danach auch in der lokalen Tabelle (Vorschläge im Feld "Verein")
        const vereine = (await (await page.request.get('/api/vereine')).json()).map(v => v.name);
        expect(vereine).toEqual(expect.arrayContaining(['Cloud-Verein Alpha', 'Cloud-Verein Beta']));
    });
});
