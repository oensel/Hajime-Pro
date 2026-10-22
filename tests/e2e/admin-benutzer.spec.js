// End-to-End: Seite „Benutzer“ (admin-nutzer.html) und „Server-Update“ (server-update.html) für Super-Admins.
// Die Suite läuft im Einzelbenutzerbetrieb; Cloud-Konto und die APIs werden per page.route ersetzt.
import { test, expect } from '@playwright/test';

const CLOUD_CONFIG = { isOffline: false, syncRolle: null, betriebsmodus: 'cloud' };

const SUPER = {
    id: 'e2e-super', email: 'super@example.test', vorname: 'Sam', nachname: 'Super',
    verein_id: 1, verein_name: 'Administration', verein_freigegeben: true, verein_rolle: 'admin',
    verein_wartet_auf_super_admin: false, ist_super_admin: true, super_admin_aktiv: true,
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

const superGesendet = [];

async function alsSuperAdmin(page, { rolleAntwort } = {}) {
    await page.route('**/api/config', (route) => route.fulfill({ json: CLOUD_CONFIG }));
    await page.route('**/api/auth/me', (route) => route.fulfill({ json: { success: true, user: SUPER } }));
    await page.route('**/api/nutzer', (route) => route.fulfill({ json: KONTEN }));
    await page.route('**/api/vereine/rolle', (route) => rolleAntwort(route));
    await page.route('**/api/nutzer/*/super-admin', (route) => { superGesendet.push([route.request().url(), route.request().postDataJSON()]); return route.fulfill({ json: { success: true } }); });
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
    // Eine Zeile je Benutzer; Verein und Rolle sind eigene Spalten (je weiterem Verein eine weitere Zeile darin)
    await expect(anna.locator('td')).toHaveCount(5); // Name, E-Mail, Verein, Rolle, Aktionen
    await expect(anna.locator('td').nth(2).locator('.zeile')).toHaveCount(2);
    await expect(anna.locator('td').nth(3).locator('.zeile')).toHaveCount(2);
    await expect(anna.locator('input[type=checkbox]')).toHaveCount(0);
    await expect(anna.locator('select option')).toHaveText(['Admin', 'Benutzer', 'Helfer']);
    await expect(anna.locator('td').nth(2).locator('select')).toHaveCount(0);
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

test('Benutzer: bearbeiten, Initialpasswort vergeben und löschen (das eigene Konto nicht)', async ({ page }) => {
    let geaendert = null;
    let passwort = null;
    let geloescht = null;
    await alsSuperAdmin(page, { rolleAntwort: (route) => route.fulfill({ json: { success: true } }) });
    await page.route('**/api/nutzer/u-anna', (route) => {
        const methode = route.request().method();
        if (methode === 'PUT') {
            geaendert = route.request().postDataJSON();
            return route.fulfill({ json: { success: true, ...geaendert } });
        }
        if (methode === 'DELETE') { geloescht = 'u-anna'; return route.fulfill({ json: { success: true } }); }
        return route.continue();
    });
    await page.route('**/api/nutzer/u-anna/passwort', (route) => {
        passwort = route.request().postDataJSON();
        return route.fulfill({ json: { success: true, aendernErforderlich: passwort.aendernErforderlich } });
    });
    await page.goto('/admin-nutzer.html');

    // Das eigene Konto lässt sich nicht löschen
    await expect(page.locator('tr[data-id="e2e-super"] button[title="Löschen"]')).toBeDisabled();

    // Bearbeiten
    const anna = page.locator('tr[data-id="u-anna"]');
    await anna.getByRole('button', { name: /Bearbeiten: Anna Adler/ }).click();
    const dialog = page.locator('#bearbeitenDialog');
    await expect(dialog).toBeVisible();
    await expect(page.locator('#bearbeitenVorname')).toHaveValue('Anna');
    await page.locator('#bearbeitenVorname').fill('Annika');
    await page.locator('#bearbeitenEmail').fill('annika@example.test');
    await page.locator('#bearbeitenSpeichern').click();
    await expect.poll(() => geaendert).toEqual({ vorname: 'Annika', nachname: 'Adler', email: 'annika@example.test' });
    await expect(dialog).toBeHidden();
    await expect(page.locator('tr[data-id="u-anna"]')).toContainText('Annika Adler');
    await expect(page.locator('#nutzerOk')).toContainText('Gespeichert: Annika Adler');

    // Initialpasswort: Standard = muss beim nächsten Anmelden geändert werden
    await page.locator('tr[data-id="u-anna"]').getByRole('button', { name: /Initialpasswort vergeben/ }).click();
    await expect(page.locator('#passwortDialog')).toBeVisible();
    await expect(page.locator('#passwortAendern')).toBeChecked();
    await page.locator('#passwortFeld').fill('Start-Passwort-1');
    await page.locator('#passwortSpeichern').click();
    await expect.poll(() => passwort).toEqual({ passwort: 'Start-Passwort-1', aendernErforderlich: true });
    await expect(page.locator('#nutzerOk')).toContainText('muss beim nächsten Anmelden geändert werden');
    await expect(page.locator('#passwortFeld')).toHaveValue('');

    // Löschen mit Bestätigung
    await page.locator('tr[data-id="u-anna"]').getByRole('button', { name: /Löschen: Annika Adler/ }).click();
    await page.locator('#modalConfirmBtn').click();
    await expect.poll(() => geloescht).toBe('u-anna');
    await expect(page.locator('tr[data-id="u-anna"]')).toHaveCount(0);
    await expect(page.locator('#nutzerOk')).toContainText('Gelöscht');
});

test('Initialpasswort: Konto mit Pflicht zur Änderung landet im Profil und muss ein neues Passwort setzen', async ({ page }) => {
    await page.route('**/api/config', (route) => route.fulfill({ json: CLOUD_CONFIG }));
    await page.route('**/api/auth/me', (route) => route.fulfill({
        json: { success: true, user: { ...SUPER, ist_super_admin: false, muss_passwort_aendern: true } }
    }));
    let profilGesendet = 0;
    await page.route('**/api/auth/profile', (route) => { profilGesendet += 1; return route.fulfill({ status: 400, json: { success: false, error: 'x' } }); });
    await page.goto('/turniere.html');
    await expect(page).toHaveURL(/\/profil\.html\?passwortAendern=1$/);
    await expect(page.locator('#passwortPflichtHinweis')).toBeVisible();
    // Ohne neues Passwort wird nicht gespeichert
    await page.locator('#currentPassword').fill('Start-Passwort-1');
    await page.locator('#profilForm button[type="submit"]').click();
    await page.waitForTimeout(300);
    expect(profilGesendet).toBe(0);
});

test('Benutzer: Super-Admin hinzufügen (Autovervollständigung, Bestätigung) und entziehen', async ({ page }) => {
    superGesendet.length = 0;
    await alsSuperAdmin(page, { rolleAntwort: (route) => route.fulfill({ json: { success: true } }) });
    await page.goto('/admin-nutzer.html');
    const superBereich = page.locator('.nutzer-bereich.super');

    // Keine Super-Admin-Option in der Rollenauswahl
    await expect(page.locator('tr[data-id="u-zett"] select option')).toHaveText(['Admin', 'Benutzer', 'Helfer']);

    // Hinzufügen: Suche zeigt nur Konten, die noch keine Super-Admins sind
    await page.locator('#superHinzufuegenKnopf').click();
    await page.locator('#superHinzufuegenSuche').fill('zett');
    await expect(page.locator('#superHinzufuegenTreffer li')).toHaveCount(1);
    await page.locator('#superHinzufuegenSuche').fill('super');
    await expect(page.locator('#superHinzufuegenTreffer')).toContainText('Kein passendes Konto');
    await page.locator('#superHinzufuegenSuche').fill('zo');
    await page.locator('#superHinzufuegenTreffer button').first().click();
    await expect(page.locator('#superHinzufuegenGewaehlt')).toContainText('Zoe Zett');

    // Abbrechen in der Bestätigung: nichts wird gesendet
    await page.locator('#superHinzufuegenSpeichern').click();
    await expect(page.locator('#modalMessage')).toContainText('wirklich zum Super-Admin machen');
    await page.locator('#modalCancelBtn').click();
    expect(superGesendet).toHaveLength(0);

    // Bestätigen: Zoe wird Super-Admin und wechselt in den oberen Bereich
    await page.locator('#superHinzufuegenSpeichern').click();
    await page.locator('#modalConfirmBtn').click();
    await expect.poll(() => superGesendet.length).toBe(1);
    expect(superGesendet[0][0]).toContain('/api/nutzer/u-zett/super-admin');
    expect(superGesendet[0][1]).toEqual({ wert: true });
    await expect(superBereich).toContainText('Zoe Zett');

    // Entziehen: eigene Aktion je Super-Admin, mit Bestätigung
    await superBereich.locator('tr[data-id="u-zett"] button[title="Super-Admin entziehen"]').click();
    await expect(page.locator('#modalMessage')).toContainText('entziehen');
    await page.locator('#modalConfirmBtn').click();
    await expect.poll(() => superGesendet.length).toBe(2);
    expect(superGesendet[1][1]).toEqual({ wert: false });
    await expect(superBereich).not.toContainText('Zoe Zett');
});

test('Benutzer: Verein und Rolle zuweisen (neu, offene Anfrage freigeben)', async ({ page }) => {
    const zuweisungen = [];
    await alsSuperAdmin(page, { rolleAntwort: (route) => route.fulfill({ json: { success: true } }) });
    await page.route('**/api/vereine', (route) => route.fulfill({ json: [{ id: 2, name: 'JC Alpha' }, { id: 3, name: 'JC Beta' }, { id: 4, name: 'JC Gamma' }] }));
    await page.route('**/api/nutzer/*/mitgliedschaft', (route) => { zuweisungen.push([route.request().url(), route.request().postDataJSON()]); return route.fulfill({ json: { success: true, aktion: 'angelegt' } }); });
    await page.goto('/admin-nutzer.html');
    const anna = page.locator('tr[data-id="u-anna"]');

    // Neuer Verein
    await anna.locator('button[title="Verein und Rolle zuweisen"]').click();
    await expect(page.locator('#zuweisenFuer')).toContainText('anna@example.test');
    await expect.poll(() => page.locator('#zuweisenVereineListe option').evaluateAll(
        os => os.map(o => `${o.value}|${o.label}`)
    )).toEqual(['JC Alpha|JC Alpha (bisher Helfer)', 'JC Beta|JC Beta (wartet auf Freischaltung)', 'JC Gamma|']);
    await page.locator('#zuweisenVerein').fill('JC Gamma');
    await page.locator('#zuweisenRolle').selectOption('admin');
    await page.locator('#zuweisenSpeichern').click();
    await expect.poll(() => zuweisungen.length).toBe(1);
    expect(zuweisungen[0][0]).toContain('/api/nutzer/u-anna/mitgliedschaft');
    expect(zuweisungen[0][1]).toEqual({ vereinId: 4, rolle: 'admin' });
    await expect(anna).toContainText('JC Gamma');
    await expect(page.locator('#nutzerOk')).toContainText('JC Gamma als Admin zugewiesen');

    // Offene Anfrage freigeben: die Zeile zeigt danach eine Rollenauswahl statt "wartet auf Freischaltung"
    await anna.locator('button[title="Verein und Rolle zuweisen"]').click();
    await page.locator('#zuweisenVerein').fill('JC Beta');
    await page.locator('#zuweisenRolle').selectOption('benutzer');
    await page.locator('#zuweisenSpeichern').click();
    await expect.poll(() => zuweisungen.length).toBe(2);
    await expect(anna).not.toContainText('wartet auf Freischaltung');
    await expect(anna.locator('select')).toHaveCount(3);
});

test('Benutzer: Vereinszuordnung entfernen (mit Bestätigung)', async ({ page }) => {
    const geloescht = [];
    await alsSuperAdmin(page, { rolleAntwort: (route) => route.fulfill({ json: { success: true } }) });
    await page.route('**/api/nutzer/*/mitgliedschaft/*', (route) => { geloescht.push([route.request().method(), route.request().url()]); return route.fulfill({ json: { success: true } }); });
    await page.goto('/admin-nutzer.html');
    const anna = page.locator('tr[data-id="u-anna"]');
    await expect(anna).toContainText('JC Alpha');

    await anna.locator('button[title="Vereinszuordnung entfernen"]').first().click();
    await expect(page.locator('#modalMessage')).toContainText('JC Alpha');
    await page.locator('#modalCancelBtn').click();
    expect(geloescht).toHaveLength(0);

    await anna.locator('button[title="Vereinszuordnung entfernen"]').first().click();
    await page.locator('#modalConfirmBtn').click();
    await expect.poll(() => geloescht.length).toBe(1);
    expect(geloescht[0][0]).toBe('DELETE');
    expect(geloescht[0][1]).toMatch(/\/api\/nutzer\/u-anna\/mitgliedschaft\/2$/);
    await expect(anna).not.toContainText('JC Alpha');
});

test('Benutzer: die Aktions-Icons bleiben in einer Zeile', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await alsSuperAdmin(page, { rolleAntwort: (route) => route.fulfill({ json: { success: true } }) });
    await page.goto('/admin-nutzer.html');
    // Anna ist unbestätigt (die meisten Aktionen), Sam ist Super-Admin (mit "Super-Admin entziehen")
    for (const kontoId of ['u-anna', 'e2e-super']) {
        const tops = await page.locator(`tr[data-id="${kontoId}"] td:last-child button`).evaluateAll((knoepfe) => knoepfe.map((k) => Math.round(k.getBoundingClientRect().top)));
        expect(tops.length).toBeGreaterThanOrEqual(7);
        expect(new Set(tops).size, `Icons von ${kontoId}: ${tops}`).toBe(1);
    }
});
