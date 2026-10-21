// End-to-End: Seite „Benutzer“ (admin-nutzer.html) und „Server-Update“ (server-update.html) für Super-Admins.
// Die Suite läuft im Einzelbenutzerbetrieb; Cloud-Konto und die APIs werden per page.route ersetzt.
import { test, expect } from '@playwright/test';

const CLOUD_CONFIG = { isOffline: false, syncRolle: null, betriebsmodus: 'cloud' };

const SUPER = {
    id: 'e2e-super', email: 'super@example.test', vorname: 'Sam', nachname: 'Super',
    verein_id: 1, verein_name: 'Administration', verein_freigegeben: true, verein_rolle: 'admin',
    verein_wartet_auf_super_admin: false, ist_super_admin: true,
    vereine: [{ verein_id: 1, name: 'Administration', freigegeben: true, rolle: 'admin' }]
};

const KONTEN = [
    { id: 'u-zett', vorname: 'Zoe', nachname: 'Zett', email: 'zoe@example.test', ist_super_admin: false, email_bestaetigt: true,
        mitgliedschaften: [{ verein_id: 2, verein_name: 'JC Alpha', rolle: 'benutzer', freigegeben: true }] },
    { id: 'e2e-super', vorname: 'Sam', nachname: 'Super', email: 'super@example.test', ist_super_admin: true, email_bestaetigt: true,
        mitgliedschaften: [{ verein_id: 1, verein_name: 'Administration', rolle: 'admin', freigegeben: true }] },
    { id: 'u-anna', vorname: 'Anna', nachname: 'Adler', email: 'anna@example.test', ist_super_admin: false, email_bestaetigt: false,
        mitgliedschaften: [
            { verein_id: 2, verein_name: 'JC Alpha', rolle: 'helfer', freigegeben: true },
            { verein_id: 3, verein_name: 'JC Beta', rolle: null, freigegeben: false }
        ] },
    { id: 'u-zweit', vorname: 'Zora', nachname: 'Super2', email: 'zora@example.test', ist_super_admin: true, email_bestaetigt: true, mitgliedschaften: [] }
];

async function alsSuperAdmin(page, { rolleAntwort } = {}) {
    await page.route('**/api/config', (route) => route.fulfill({ json: CLOUD_CONFIG }));
    await page.route('**/api/auth/me', (route) => route.fulfill({ json: { success: true, user: SUPER } }));
    await page.route('**/api/nutzer', (route) => route.fulfill({ json: KONTEN }));
    await page.route('**/api/vereine/rolle', (route) => rolleAntwort(route));
    await page.route('**/api/cloud-update/status', (route) => route.fulfill({
        json: { moeglich: true, aktuelleVersion: '1.0.25', neuesteVersion: '1.0.26', updateVerfuegbar: true, zustand: 'bereit', meldungen: [] }
    }));
}

test('Benutzer: Super-Admins stehen oben in einem eigenen Bereich, Rollen je Verein sind änderbar', async ({ page }) => {
    let gesendet = null;
    await alsSuperAdmin(page, {
        rolleAntwort: (route) => { gesendet = route.request().postDataJSON(); return route.fulfill({ json: { success: true } }); }
    });
    await page.goto('/admin-nutzer.html');

    await expect(page.locator('.form-title-area h1')).toHaveText('Benutzer');
    const superBereich = page.locator('.nutzer-bereich.super');
    await expect(superBereich.locator('tbody tr')).toHaveCount(2);
    await expect(superBereich).toContainText('Sam Super');
    await expect(superBereich).toContainText('Zora Super2');
    const uebrige = page.locator('.nutzer-bereich:not(.super)');
    await expect(uebrige.locator('tbody tr')).toHaveCount(2);
    // Alphabetisch nach Nachname: Adler vor Zett; kein Super-Admin im unteren Bereich
    await expect(uebrige.locator('tbody tr').first()).toContainText('Anna Adler');
    await expect(uebrige).not.toContainText('Sam Super');
    // Der Bereich der Super-Admins steht im Dokument vor den übrigen Benutzern
    const reihenfolge = await page.evaluate(() => {
        const s = document.querySelector('.nutzer-bereich.super');
        const u = document.querySelector('.nutzer-bereich:not(.super)');
        return !!(s.compareDocumentPosition(u) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    expect(reihenfolge).toBe(true);

    // Vereine und Rollen von Anna: Rolle änderbar, nicht freigegebene Mitgliedschaft nur als Text
    const anna = uebrige.locator('tr[data-id="u-anna"]');
    await expect(anna).toContainText('JC Alpha');
    await expect(anna).toContainText('JC Beta');
    await expect(anna).toContainText('wartet auf Freischaltung');
    await expect(anna).toContainText('(unbestätigt)');
    const auswahl = anna.locator('select');
    await expect(auswahl).toHaveCount(1);
    await expect(auswahl).toHaveValue('helfer');
    await auswahl.selectOption('admin');
    await expect.poll(() => gesendet).toEqual({ userId: 'u-anna', vereinId: 2, rolle: 'admin' });
    await expect(page.locator('#nutzerOk')).toContainText('Rolle in JC Alpha ist jetzt Admin');
    await expect(auswahl).toHaveValue('admin');

    // Suche filtert über beide Bereiche
    await page.locator('#nutzerFilter').fill('Beta');
    await expect(superBereich.locator('tbody tr')).toHaveCount(1); // nur die Zeile „Keine Super-Admins gefunden.“
    await expect(superBereich).toContainText('Keine Super-Admins gefunden');
    await expect(uebrige.locator('tbody tr')).toHaveCount(1);
});

test('Benutzer: Fehler beim Ändern der Rolle wird gemeldet und der alte Wert bleibt', async ({ page }) => {
    await alsSuperAdmin(page, {
        rolleAntwort: (route) => route.fulfill({ status: 409, json: { success: false, error: 'Der letzte Admin des Vereins kann nicht herabgestuft werden.' } })
    });
    await page.goto('/admin-nutzer.html');
    const auswahl = page.locator('tr[data-id="u-zett"] select');
    await auswahl.selectOption('helfer');
    await expect(page.locator('#nutzerMeldung')).toContainText('letzte Admin');
    await expect(auswahl).toHaveValue('benutzer');
});

test('Server-Update hat eine eigene Seite mit Menüpunkt', async ({ page }) => {
    await alsSuperAdmin(page, { rolleAntwort: (route) => route.fulfill({ json: { success: true } }) });
    await page.goto('/admin-nutzer.html');
    await expect(page.locator('#updateBox')).toHaveCount(0);

    await page.locator('#nav-server-update').click();
    await expect(page).toHaveURL(/\/server-update\.html$/);
    await expect(page.locator('.form-title-area h1')).toHaveText('Server-Update');
    await expect(page.locator('#updateAktuell')).toHaveText('1.0.25');
    await expect(page.locator('#updateNeueste')).toHaveText('1.0.26');
    await expect(page.locator('#updateKnopf')).toBeEnabled();
    await expect(page.locator('#nav-server-update')).toHaveClass(/active/);
});
