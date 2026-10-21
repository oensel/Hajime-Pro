// End-to-End: Admin lädt auf profil.html Helfer per E-Mail ein (Liste oder einzelne Adresse). Die Suite läuft im
// Einzelbenutzerbetrieb; Cloud-Konto und die Einladungs-API werden per page.route ersetzt (wie menue-rollen.spec.js).
import { test, expect } from '@playwright/test';

const CLOUD_CONFIG = { isOffline: false, syncRolle: null, betriebsmodus: 'cloud' };

const konto = (rolle) => ({
    id: 'e2e-einladen', email: 'admin@example.test', vorname: 'Ada', nachname: 'Admin',
    verein_id: 7, verein_name: 'JC Einladen', verein_freigegeben: true, verein_rolle: rolle,
    verein_wartet_auf_super_admin: false, ist_super_admin: false,
    vereine: [{ verein_id: 7, name: 'JC Einladen', freigegeben: true, rolle }]
});

async function alsCloudKonto(page, rolle, { einladungen = [], senden } = {}) {
    await page.route('**/api/config', (route) => route.fulfill({ json: CLOUD_CONFIG }));
    await page.route('**/api/auth/me', (route) => route.fulfill({ json: { success: true, user: konto(rolle) } }));
    await page.route('**/api/vereine/mitglieder**', (route) => route.fulfill({ json: [] }));
    await page.route('**/api/vereine/einladungen**', (route) => {
        if (route.request().method() === 'POST') return senden(route);
        return route.fulfill({ json: { success: true, einladungen } });
    });
}

test('Admin: Adressen als Liste eintragen, Ergebnis je Adresse sehen', async ({ page }) => {
    let gesendet = null;
    await alsCloudKonto(page, 'admin', {
        einladungen: [{ email: 'offen@extern.de', laeuftAbAm: '2099-01-01T00:00:00.000Z' }],
        senden: (route) => {
            gesendet = route.request().postDataJSON();
            return route.fulfill({
                json: {
                    success: true,
                    ergebnisse: [
                        { email: 'neu@extern.de', status: 'gesendet' },
                        { email: 'schon@extern.de', status: 'bereits_mitglied' }
                    ],
                    ungueltig: ['kaputt']
                }
            });
        }
    });
    await page.goto('/profil.html');

    const box = page.locator('.einladung-box');
    await expect(box).toBeVisible();
    await expect(box).toContainText('Helfer einladen');
    await expect(box).toContainText('Offene Einladungen: 1');

    await box.locator('textarea').fill('neu@extern.de\nschon@extern.de, kaputt');
    await box.getByRole('button', { name: 'Einladungen senden' }).click();

    await expect(box.locator('ul li')).toHaveCount(3);
    await expect(box.locator('ul')).toContainText('neu@extern.de: Einladung gesendet');
    await expect(box.locator('ul')).toContainText('schon@extern.de: ist schon Mitglied, keine Mail');
    await expect(box.locator('ul')).toContainText('kaputt: keine gültige E-Mail-Adresse');
    expect(gesendet).toEqual({ vereinId: 7, emails: 'neu@extern.de\nschon@extern.de, kaputt' });
});

test('Ohne Adresse kommt kein Aufruf, ein Fehler der API wird gemeldet', async ({ page }) => {
    let aufrufe = 0;
    await alsCloudKonto(page, 'admin', {
        senden: (route) => { aufrufe += 1; return route.fulfill({ status: 503, json: { success: false, error: 'PUBLIC_BASE_URL fehlt' } }); }
    });
    await page.goto('/profil.html');
    const box = page.locator('.einladung-box');
    await box.getByRole('button', { name: 'Einladungen senden' }).click();
    expect(aufrufe).toBe(0);
    await box.locator('textarea').fill('a@extern.de');
    await box.getByRole('button', { name: 'Einladungen senden' }).click();
    await expect.poll(() => aufrufe).toBe(1);
    await expect(box.locator('ul li')).toHaveCount(0);
});

test('Benutzer und Helfer sehen die Einladungsfunktion nicht', async ({ page }) => {
    await alsCloudKonto(page, 'benutzer', { senden: (route) => route.fulfill({ json: { success: true, ergebnisse: [], ungueltig: [] } }) });
    await page.goto('/profil.html');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('#mitgliederCard')).toBeHidden();
    await expect(page.locator('.einladung-box')).toHaveCount(0);
});
