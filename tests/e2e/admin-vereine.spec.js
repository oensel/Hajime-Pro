// End-to-End: Vereinsübersicht für Super-Admins (admin-vereine.html): Vereine mit Bundesland, Anzahl Benutzer und
// Turniere; Klick auf die Zahlen öffnet die für den Verein gefilterte Benutzer- bzw. Turnierliste.
// Die Suite läuft im Einzelbenutzerbetrieb; Cloud-Konto und APIs werden per page.route ersetzt.
import { test, expect } from '@playwright/test';

const SUPER = {
    id: 'e2e-super', email: 'super@example.test', vorname: 'Sam', nachname: 'Super',
    verein_id: 1, verein_name: 'Administration', verein_freigegeben: true, verein_rolle: 'admin',
    verein_wartet_auf_super_admin: false, ist_super_admin: true, super_admin_aktiv: true,
    vereine: [{ verein_id: 1, name: 'Administration', freigegeben: true, rolle: 'admin' }]
};

const VEREINE = [
    { id: 2, name: 'JC Alpha', bundesland: 'Bayern', benutzer_anzahl: 2, turniere_anzahl: 3 },
    { id: 3, name: 'SV Beta', bundesland: null, benutzer_anzahl: 0, turniere_anzahl: 0 }
];

const KONTEN = [
    { id: 'u1', vorname: 'Anna', nachname: 'Adler', email: 'anna@example.test', ist_super_admin: false, email_bestaetigt: true,
        mitgliedschaften: [{ verein_id: 2, verein_name: 'JC Alpha', rolle: 'helfer', freigegeben: true }] },
    { id: 'u2', vorname: 'Ben', nachname: 'Bauer', email: 'ben@example.test', ist_super_admin: false, email_bestaetigt: true,
        mitgliedschaften: [{ verein_id: 2, verein_name: 'JC Alpha', rolle: 'admin', freigegeben: true }, { verein_id: 3, verein_name: 'SV Beta', rolle: 'benutzer', freigegeben: true }] },
    { id: 'u3', vorname: 'Cem', nachname: 'Celik', email: 'cem@example.test', ist_super_admin: false, email_bestaetigt: true,
        mitgliedschaften: [{ verein_id: 3, verein_name: 'SV Beta', rolle: 'helfer', freigegeben: true }] }
];

async function alsSuperAdmin(page, { bundeslandAntwort } = {}) {
    await page.route('**/api/config', (route) => route.fulfill({ json: { isOffline: false, syncRolle: null, betriebsmodus: 'cloud' } }));
    await page.route('**/api/auth/me', (route) => route.fulfill({ json: { success: true, user: SUPER } }));
    await page.route('**/api/nutzer', (route) => route.fulfill({ json: KONTEN }));
    await page.route('**/api/nutzer/vereine', (route) => route.fulfill({ json: VEREINE }));
    await page.route('**/api/nutzer/vereine/2/turniere', (route) => route.fulfill({
        json: {
            verein: { id: 2, name: 'JC Alpha' },
            turniere: [
                { id: 11, bezeichnung: 'Neues Turnier', datum: '2031-05-20', ort: 'Berlin', bundesland: 'Berlin', status: 'veroeffentlicht', teilnehmer_anzahl: 12 },
                { id: 10, bezeichnung: 'Mittleres Turnier', datum: '2030-09-01', ort: 'Köln', bundesland: null, status: 'entwurf', teilnehmer_anzahl: 0 },
                { id: 9, bezeichnung: 'Altes Turnier', datum: '2030-01-10', ort: 'Ulm', bundesland: 'Baden-Württemberg', status: 'abgeschlossen', teilnehmer_anzahl: 40 }
            ]
        }
    }));
    await page.route('**/api/nutzer/vereine/2', (route) => bundeslandAntwort(route));
}

test('Vereine: Bundesland, Benutzer- und Turnieranzahl, Klick auf die Zahlen', async ({ page }) => {
    await alsSuperAdmin(page, { bundeslandAntwort: (route) => route.fulfill({ json: { success: true } }) });
    await page.goto('/admin-vereine.html');

    await expect(page.locator('.form-title-area h1')).toHaveText('Vereine');
    await expect(page.locator('#vereineInfo')).toHaveText('2 von 2 Vereinen');
    const alpha = page.locator('tr[data-id="2"]');
    await expect(alpha).toContainText('JC Alpha');
    await expect(alpha.locator('select')).toHaveValue('Bayern');
    await expect(alpha.locator('td').nth(2)).toHaveText('2');
    await expect(alpha.locator('td').nth(3)).toHaveText('3');
    // Ohne Benutzer/Turniere gibt es keinen Link
    const beta = page.locator('tr[data-id="3"]');
    await expect(beta.locator('a.zahl')).toHaveCount(0);

    // Suche nach Verein oder Bundesland
    await page.locator('#vereineFilter').fill('bayern');
    await expect(page.locator('#vereineListe tr')).toHaveCount(1);
    await page.locator('#vereineFilter').fill('');

    // Benutzerzahl → gefilterte Benutzerliste
    await alpha.locator('td').nth(2).locator('a').click();
    await expect(page).toHaveURL(/\/admin-nutzer\.html\?vereinId=2$/);
    await expect(page.locator('#vereinFilterBox')).toContainText('Nur Benutzer von: JC Alpha');
    await expect(page.locator('#nutzerListe tr')).toHaveCount(2);
    await expect(page.locator('#nutzerListe')).toContainText('Anna Adler');
    await expect(page.locator('#nutzerListe')).toContainText('Ben Bauer');
    await expect(page.locator('#nutzerListe')).not.toContainText('Cem Celik');
    await page.getByRole('link', { name: 'Alle Benutzer anzeigen' }).click();
    await expect(page.locator('#nutzerListe tr')).toHaveCount(3);

    // Turnieranzahl → Turniere des Vereins, Wettkampftag absteigend
    await page.goto('/admin-vereine.html');
    await page.locator('tr[data-id="2"] td').nth(3).locator('a').click();
    await expect(page).toHaveURL(/\/admin-turniere\.html\?vereinId=2$/);
    await expect(page.locator('.form-title-area h1')).toHaveText('Turniere: JC Alpha');
    const zeilen = page.locator('#vtListe tr');
    await expect(zeilen).toHaveCount(3);
    await expect(zeilen.nth(0)).toContainText('20.05.2031');
    await expect(zeilen.nth(0)).toContainText('Neues Turnier');
    await expect(zeilen.nth(1)).toContainText('01.09.2030');
    await expect(zeilen.nth(2)).toContainText('10.01.2030');
    await expect(zeilen.nth(0)).toContainText('Veröffentlicht');
    await expect(zeilen.nth(2)).toContainText('40');
});

test('Vereine: Bundesland ändern, Fehler stellt den alten Wert wieder her', async ({ page }) => {
    let gesendet = null;
    let ablehnen = false;
    await alsSuperAdmin(page, {
        bundeslandAntwort: (route) => {
            gesendet = route.request().postDataJSON();
            return ablehnen
                ? route.fulfill({ status: 400, json: { success: false, error: 'Unbekanntes Bundesland.' } })
                : route.fulfill({ json: { success: true, bundesland: gesendet.bundesland } });
        }
    });
    await page.goto('/admin-vereine.html');
    const auswahl = page.locator('tr[data-id="2"] select');
    await auswahl.selectOption('Hessen');
    await expect.poll(() => gesendet).toEqual({ bundesland: 'Hessen' });
    await expect(auswahl).toHaveValue('Hessen');

    ablehnen = true;
    await auswahl.selectOption('Sachsen');
    await expect(page.locator('#vereineMeldung')).toContainText('Unbekanntes Bundesland');
    await expect(auswahl).toHaveValue('Hessen');
});
