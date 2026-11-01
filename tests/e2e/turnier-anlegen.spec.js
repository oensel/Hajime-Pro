// End-to-End: Turnier über turnier.html anlegen und in der Übersicht (turniere.html)
// wiederfinden. Deckt den kompletten Weg vom leeren Formular über die Server-Validierung bis zur
// Anzeige ab statt nur einzelne Funktionen zu prüfen.
import { test, expect } from '@playwright/test';

const TURNIER_NAME = `E2E-Test-Turnier ${Date.now()}`;
const TURNIER_NAME_KLASSEN = `E2E-Test-Turnier-Klassen ${Date.now()}`;

test('Turnier anlegen erscheint danach in der Turnierübersicht', async ({ page }) => {
    await page.goto('/turnier.html');

    await page.locator('#bezeichnung').fill(TURNIER_NAME);
    await page.locator('#datum').fill('2027-05-15');
    await page.locator('#ort').fill('Senden');
    await page.locator('#plz').fill('48308');
    await page.locator('#ausrichter').fill('JC Senden');
    await page.locator('#bundesland').selectOption('Nordrhein-Westfalen');
    await page.locator('[data-schritt="2"]').click();
    await page.locator('#anzahl_kampfflaechen').fill('2');

    await page.locator('#submitBtn').click();

    // Erfolgsmeldung aus window.zeigeNotification (siehe menu.js) — bestätigt, dass der
    // POST /api/turniere tatsächlich mit success:true durchgelaufen ist, statt nur, dass der
    // Button geklickt wurde.
    await expect(page.locator('#snackbarText')).toHaveText('Turnier erfolgreich angelegt!');

    // Nach dem Anlegen leitet turnier.js auf /turnier.html?id=<neueId> weiter (siehe dortiges
    // setTimeout) — das ist zugleich der Beleg, dass der Server eine turnierId zurückgegeben hat.
    await expect(page).toHaveURL(/\/turnier\.html\?id=\d+/);

    await page.goto('/turniere.html');
    await expect(page.getByText(TURNIER_NAME)).toBeVisible();
});

// Sucht innerhalb eines Altersklassen-Containers (Einzel oder Mannschaft) den Geschlechts-Block
// anhand seines Titeltexts (siehe turnier-ak-gender-title in turnier.js) statt anhand der
// Reihenfolge, damit die Selektoren stabil bleiben, falls sich die Geschlechter-Reihenfolge ändert.
function geschlechtsBlock(container, geschlecht) {
    return container.locator('.turnier-ak-gender-block').filter({
        has: container.page().locator('.turnier-ak-gender-title', { hasText: geschlecht })
    });
}

// Klickt den "+"-Button eines Geschlechts-Blocks, tippt den Namen der freien Klasse in den
// Material-Ersatzdialog für window.prompt (siehe window.zeigeTextEingabe in menu.js) und
// bestätigt ihn.
async function fuegeFreieKlasseHinzu(page, block, name) {
    await block.locator('.turnier-ak-add-btn').click();

    const modal = page.locator('#customPromptModal');
    await expect(modal).toBeVisible();
    await page.locator('#promptModalInput').fill(name);
    await page.locator('#promptModalConfirmBtn').click();
    await expect(modal).toBeHidden();
}

test('Alters- und Mannschaftsklassen auswählen und mit dem Turnier speichern', async ({ page }) => {
    await page.goto('/turnier.html');

    await page.locator('#bezeichnung').fill(TURNIER_NAME_KLASSEN);
    await page.locator('#datum').fill('2027-06-12');
    await page.locator('#ort').fill('Senden');
    await page.locator('#plz').fill('48308');
    await page.locator('#ausrichter').fill('JC Senden');
    await page.locator('#bundesland').selectOption('Nordrhein-Westfalen');
    await page.locator('[data-schritt="2"]').click();
    await page.locator('#anzahl_kampfflaechen').fill('2');

    // --- Einzel: Männlich U11 und Weiblich U11 anhaken (Standard-DJB-Klassen aus
    // altersklassen.json) — der Modus bleibt auf "DJB" stehen, dem Default beim Anhaken. ---
    await page.locator('input[name="altersklasse_cb"][value="männlich_U11"]').check();
    await expect(page.locator('input[name="modus_männlich_U11"][value="djb"]')).toBeChecked();

    await page.locator('input[name="altersklasse_cb"][value="weiblich_U11"]').check();
    await expect(page.locator('input[name="modus_weiblich_U11"][value="djb"]')).toBeChecked();

    // --- Einzel: freie Klasse "U9" bei Mixed hinzufügen — U9 existiert bei "mixed" nicht in der
    // DJB-Konfiguration (nur U11), muss also über den "Klasse hinzufügen"-Weg angelegt werden. ---
    const einzelContainer = page.locator('#altersklassenContainer');
    await fuegeFreieKlasseHinzu(page, geschlechtsBlock(einzelContainer, 'mixed'), 'U9');
    await expect(page.locator('input[name="altersklasse_cb"][value="mixed_U9"]')).toBeChecked();

    // --- Mannschaft: die Karte ist beim Anlegen eingeklappt (Einzel dagegen offen), erst aufklappen, dann Klassen U15 wählen
    await expect(page.locator('#einzelKarte')).toHaveJSProperty('open', true);
    await expect(page.locator('#mannschaftKarte')).toHaveJSProperty('open', false);
    await page.locator('#mannschaftKarte > summary').click();
    await expect(page.locator('#mannschaftKarte')).toHaveJSProperty('open', true);
    await page.locator('input[name="mannschaft_altersklasse_cb"][value="weiblich_U15"]').check();
    await expect(page.locator('input[name="mannschaft_altersklasse_cb"][value="weiblich_U15"]')).toBeChecked();
    await page.locator('input[name="mannschaft_altersklasse_cb"][value="männlich_U15"]').check();
    await expect(page.locator('input[name="mannschaft_altersklasse_cb"][value="männlich_U15"]')).toBeChecked();

    await page.locator('#submitBtn').click();

    await expect(page.locator('#snackbarText')).toHaveText('Turnier erfolgreich angelegt!');
    await expect(page).toHaveURL(/\/turnier\.html\?id=\d+/);

    // --- Round-Trip: nach dem Redirect lädt turnier.js im Edit-Modus (ladeTurnierDaten) die
    // gespeicherten Klassen aus der Datenbank und hakt die Checkboxen erneut an — bestätigt, dass
    // die Auswahl tatsächlich im Server gelandet ist, statt nur clientseitig angezeigt zu werden. ---
    await expect(page.locator('input[name="altersklasse_cb"][value="männlich_U11"]')).toBeChecked();
    await expect(page.locator('input[name="altersklasse_cb"][value="weiblich_U11"]')).toBeChecked();
    await expect(page.locator('input[name="altersklasse_cb"][value="mixed_U9"]')).toBeChecked();
    await expect(page.locator('input[name="mannschaft_altersklasse_cb"][value="weiblich_U15"]')).toBeChecked();
    await expect(page.locator('input[name="mannschaft_altersklasse_cb"][value="männlich_U15"]')).toBeChecked();

    // --- turniere.html: das Turnier taucht dort auf und steht noch im Status "Entwurf" ---
    await page.goto('/turniere.html');
    const karte = page.locator('.tournament-card').filter({ hasText: TURNIER_NAME_KLASSEN });
    await expect(karte).toBeVisible();
    await expect(karte.locator('.status-badge')).toHaveText('Entwurf');

    // --- Erneut in die Bearbeitung wechseln: Turnier auswählen, dann im Menü "Turnier" (nicht per
    // direkter URL, damit auch dieser Navigationsweg abgedeckt ist) ---
    await expect(karte.getByRole('button', { name: 'Bearbeiten' })).toHaveCount(0);
    await karte.getByRole('button', { name: 'Auswählen' }).click();
    await page.locator('#nav-turnier').click();
    await expect(page).toHaveURL(/\/turnier\.html\?id=\d+/);

    // --- Startgeld ohne Zahlungsdaten: clientseitige Validierung in turnier.js (gespiegelt vom
    // Server in validiereZahlungsdaten, turnierController.js) muss das Speichern verhindern. ---
    await page.locator('[data-schritt="3"]').click();
    await page.locator('#startgeld').fill('10');
    await page.locator('#submitBtn').click();
    await expect(page.locator('#snackbarText')).toHaveText(
        'Wenn ein Startgeld verlangt wird, müssen IBAN, Kontoinhaber und Verwendungszweck ausgefüllt sein.'
    );
    // Kein Update durchgelaufen -> weiterhin auf derselben Edit-Seite
    await expect(page).toHaveURL(/\/turnier\.html\?id=\d+/);

    // --- Nur bar an der Waage: kein Konto nötig, das Speichern geht ohne Zahlungsdaten durch ---
    await page.locator('#zahlwegUeberweisung').uncheck();
    await expect(page.locator('#verwendungszweckGruppe')).toBeHidden();
    await page.locator('#submitBtn').click();
    await expect(page.locator('#snackbarText')).toHaveText('Turnier erfolgreich aktualisiert!');
    await page.locator('#zahlwegUeberweisung').check();

    // --- Mit Überweisung und vollständigen Zahlungsdaten geht das Speichern durch ---
    await page.locator('#iban').fill('DE12345678901234567890');
    await page.locator('#kontoinhaber').fill('JC Senden e.V.');
    await page.locator('#verwendungszweck').fill('Startgeld <Turniername> <Verein>');
    await page.locator('#submitBtn').click();
    await expect(page.locator('#snackbarText')).toHaveText('Turnier erfolgreich aktualisiert!');

    // --- Am Hallen-Server gibt es den Knopf "Veröffentlichen" nicht; die Route bleibt per API erreichbar ---
    await expect(page.locator('#veroeffentlichenBtn')).toBeHidden();
    const turnierIdAusUrl = new URL(page.url()).searchParams.get('id');
    const antwort = await page.request.post(`/api/turniere/${turnierIdAusUrl}/veroeffentlichen`);
    expect(antwort.ok()).toBeTruthy();

    // --- turniere.html: Status ist jetzt von "Entwurf" auf "Geplant" gewechselt (Hallen-Server-Bezeichnung) ---
    await page.goto('/turniere.html');
    const karteVeroeffentlicht = page.locator('.tournament-card').filter({ hasText: TURNIER_NAME_KLASSEN });
    await expect(karteVeroeffentlicht.locator('.status-badge')).toHaveText('Geplant');
});

test('Abbrechen nach Eingaben fragt nach, unverändert nicht', async ({ page }) => {
    await page.goto('/turnier.html');
    await page.locator('#abbrechenBtn').click();
    await expect(page).toHaveURL(/\/turniere\.html/);

    await page.goto('/turnier.html');
    await page.locator('#bezeichnung').fill('Rückfrage-Test');
    await page.locator('#abbrechenBtn').click();
    await expect(page.locator('#modalMessage')).toContainText('nicht gespeichert');
    await page.locator('#modalCancelBtn').click();
    await expect(page).toHaveURL(/\/turnier\.html/);
    await expect(page.locator('#bezeichnung')).toHaveValue('Rückfrage-Test');
    await page.locator('#abbrechenBtn').click();
    await page.locator('#modalConfirmBtn').click();
    await expect(page).toHaveURL(/\/turniere\.html/);
});

test('Cloud: Entwurf speichern und Speichern und veröffentlichen beim Anlegen', async ({ page }) => {
    await page.route('**/api/config', async (route) => {
        const antwort = await route.fetch();
        await route.fulfill({ response: antwort, json: { ...(await antwort.json()), isOffline: false } });
    });
    const aufrufe = [];
    await page.route('**/api/turniere/*/veroeffentlichen', (route) => { aufrufe.push(route.request().url()); return route.fulfill({ json: { success: true } }); });
    await page.goto('/turnier.html');
    await expect(page.locator('#submitBtn')).toHaveAttribute('aria-label', 'Als Entwurf speichern');
    await expect(page.locator('#speichernVeroeffentlichenBtn')).toBeVisible();

    await page.locator('#bezeichnung').fill(`E2E-Veröffentlichen ${Date.now()}`);
    await page.locator('#datum').fill('2027-05-16');
    await page.locator('#ort').fill('Senden');
    await page.locator('#plz').fill('48308');
    await page.locator('#ausrichter').fill('JC Senden');
    await page.locator('#bundesland').selectOption('Nordrhein-Westfalen');
    await page.locator('#speichernVeroeffentlichenBtn').click();
    await page.locator('#modalConfirmBtn').click();
    await expect(page).toHaveURL(/\/turnier\.html\?id=\d+/);
    expect(aufrufe).toHaveLength(1);
});
