// End-to-End: Admin lädt auf admin-einladungen.html Helfer per E-Mail ein (Liste oder einzelne Adresse). Die Suite läuft im
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
    await page.goto('/admin-einladungen.html');

    await expect(page.locator('#einladungVerein')).toHaveValue('JC Einladen');
    await expect(page.locator('#einladungOffen')).toContainText('Offene Einladungen: 1');

    await page.locator('#einladungAdressen').fill('neu@extern.de\nschon@extern.de, kaputt');
    await page.getByRole('button', { name: 'Einladungen senden' }).click();

    const ergebnis = page.locator('#einladungErgebnis');
    await expect(ergebnis.locator('li')).toHaveCount(3);
    await expect(ergebnis).toContainText('neu@extern.de: Einladung gesendet');
    await expect(ergebnis).toContainText('schon@extern.de: ist schon Mitglied, keine Mail');
    await expect(ergebnis).toContainText('kaputt: keine gültige E-Mail-Adresse');
    expect(gesendet).toEqual({ vereinId: 7, emails: 'neu@extern.de\nschon@extern.de, kaputt' });
});

test('Ohne Adresse kommt kein Aufruf, ein Fehler der API wird gemeldet', async ({ page }) => {
    let aufrufe = 0;
    await alsCloudKonto(page, 'admin', {
        senden: (route) => { aufrufe += 1; return route.fulfill({ status: 503, json: { success: false, error: 'PUBLIC_BASE_URL fehlt' } }); }
    });
    await page.goto('/admin-einladungen.html');
    await page.getByRole('button', { name: 'Einladungen senden' }).click();
    expect(aufrufe).toBe(0);
    await page.locator('#einladungAdressen').fill('a@extern.de');
    await page.getByRole('button', { name: 'Einladungen senden' }).click();
    await expect.poll(() => aufrufe).toBe(1);
    await expect(page.locator('#einladungErgebnis li')).toHaveCount(0);
});

test('Benutzer und Helfer sehen die Einladungsfunktion nicht', async ({ page }) => {
    await alsCloudKonto(page, 'benutzer', { senden: (route) => route.fulfill({ json: { success: true, ergebnisse: [], ungueltig: [] } }) });
    await page.goto('/admin-einladungen.html');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('#einladungInhalt')).toBeHidden();
    await expect(page.locator('#einladungFehler')).toContainText('nur Admins');
});
