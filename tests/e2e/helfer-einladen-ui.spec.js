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

test('Mitglieder: „Mitglieder hinzufügen“ trägt Adressen für den Verein ein und lädt die Liste neu', async ({ page }) => {
    let gesendet = null;
    let listenAufrufe = 0;
    await alsCloudKonto(page, 'admin', {
        senden: (route) => {
            gesendet = route.request().postDataJSON();
            return route.fulfill({
                json: {
                    success: true,
                    ergebnisse: [
                        { email: 'neu@extern.de', status: 'gesendet' },
                        { email: 'vorhanden@extern.de', status: 'zugeordnet' }
                    ],
                    ungueltig: []
                }
            });
        }
    });
    await page.route('**/api/nutzer', (route) => { listenAufrufe += 1; return route.fulfill({ json: [] }); });
    await page.route('**/api/vereine/pending', (route) => route.fulfill({ json: [] }));
    await page.goto('/admin-nutzer.html');
    await expect(page.locator('#nav-einladungen')).toBeHidden();

    await page.getByRole('button', { name: 'Mitglieder hinzufügen' }).click();
    await expect(page.locator('#mitgliedHinzufuegenVerein')).toHaveValue('JC Einladen');
    await page.locator('#mitgliedHinzufuegenAdressen').fill('neu@extern.de\nvorhanden@extern.de');
    await page.getByRole('button', { name: 'Hinzufügen', exact: true }).click();

    const ergebnis = page.locator('#mitgliedHinzufuegenErgebnis');
    await expect(ergebnis).toContainText('neu@extern.de: Einladung gesendet');
    await expect(ergebnis).toContainText('vorhanden@extern.de: dem Verein zugeordnet');
    expect(gesendet).toEqual({ vereinId: 7, emails: 'neu@extern.de\nvorhanden@extern.de' });
    await expect.poll(() => listenAufrufe).toBeGreaterThan(1);
});

test('Mitglieder hinzufügen: Super-Admin lässt den Verein leer und lädt zur Registrierung ein', async ({ page }) => {
    let gesendet = null;
    await page.route('**/api/config', (route) => route.fulfill({ json: CLOUD_CONFIG }));
    await page.route('**/api/auth/me', (route) => route.fulfill({ json: { success: true, user: {
        id: 'e2e-sa', email: 'sa@example.test', vorname: 'Sam', nachname: 'Super', verein_id: null, verein_name: null,
        verein_freigegeben: false, verein_rolle: null, verein_wartet_auf_super_admin: false,
        ist_super_admin: true, super_admin_aktiv: true, vereine: [] } } }));
    await page.route('**/api/vereine', (route) => route.fulfill({ json: [{ id: 3, name: 'JC Eins' }] }));
    await page.route('**/api/vereine/super/pending', (route) => route.fulfill({ json: [] }));
    await page.route('**/api/vereine/pending', (route) => route.fulfill({ json: [] }));
    await page.route('**/api/nutzer', (route) => route.fulfill({ json: [] }));
    await page.route('**/api/vereine/einladungen**', (route) => {
        gesendet = route.request().postDataJSON();
        return route.fulfill({ json: { success: true, ergebnisse: [{ email: 'x@extern.de', status: 'gesendet' }], ungueltig: [] } });
    });
    await page.goto('/admin-nutzer.html');
    await expect(page.locator('#nurUnbestaetigt')).toHaveCount(0);
    await page.getByRole('button', { name: 'Mitglieder hinzufügen' }).click();
    await expect(page.locator('#mitgliedHinzufuegenVerein')).toHaveValue('');
    await page.locator('#mitgliedHinzufuegenAdressen').fill('x@extern.de');
    await page.getByRole('button', { name: 'Hinzufügen', exact: true }).click();
    await expect(page.locator('#mitgliedHinzufuegenErgebnis')).toContainText('x@extern.de: Einladung gesendet');
    expect(gesendet).toEqual({ emails: 'x@extern.de' });
});
