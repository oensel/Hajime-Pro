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
    await page.locator('#anzahl_kampfflaechen').fill('2');
    await page.locator('#bundesland').selectOption('Nordrhein-Westfalen');

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
    await page.locator('#anzahl_kampfflaechen').fill('2');
    await page.locator('#bundesland').selectOption('Nordrhein-Westfalen');

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

    // --- Mannschaft: Klassen U15 wählen
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

    // --- Erneut in die Bearbeitung wechseln (über den "Bearbeiten"-Button der Karte, nicht per
    // direkter URL, damit auch dieser Navigationsweg abgedeckt ist) ---
    await karte.getByRole('button', { name: 'Bearbeiten' }).click();
    await expect(page).toHaveURL(/\/turnier\.html\?id=\d+/);

    // --- Startgeld ohne Zahlungsdaten: clientseitige Validierung in turnier.js (gespiegelt vom
    // Server in validiereZahlungsdaten, turnierController.js) muss das Speichern verhindern. ---
    await page.locator('#startgeld').fill('10');
    await page.locator('#submitBtn').click();
    await expect(page.locator('#snackbarText')).toHaveText(
        'Wenn ein Startgeld verlangt wird, müssen IBAN, Kontoinhaber und Verwendungszweck ausgefüllt sein.'
    );
    // Kein Update durchgelaufen -> weiterhin auf derselben Edit-Seite
    await expect(page).toHaveURL(/\/turnier\.html\?id=\d+/);

    // --- Mit vollständigen Zahlungsdaten geht das Speichern durch ---
    await page.locator('#iban').fill('DE12345678901234567890');
    await page.locator('#kontoinhaber').fill('JC Senden e.V.');
    await page.locator('#verwendungszweck').fill('Startgeld <Turniername> <Verein>');
    await page.locator('#submitBtn').click();
    await expect(page.locator('#snackbarText')).toHaveText('Turnier erfolgreich aktualisiert!');

    // --- Veröffentlichen: bestätigt den Material-Dialog (zeigeZentraleBestaetigung in menu.js).
    // fuehreLebenszyklusAktionAus lädt bei Erfolg direkt per window.location.reload() neu, daher
    // wird sowohl auf die POST-Antwort als auch auf das anschließende "load" gewartet — sonst
    // kollidiert ein nachfolgendes page.goto() mit diesem eigenen Reload der Seite. ---
    const veroeffentlichenResponse = page.waitForResponse(
        (resp) => resp.url().includes('/veroeffentlichen') && resp.request().method() === 'POST'
    );
    const seiteWurdeNeuGeladen = page.waitForEvent('load');
    await page.locator('#veroeffentlichenBtn').click();
    await expect(page.locator('#customConfirmModal')).toBeVisible();
    await page.locator('#modalConfirmBtn').click();
    const antwort = await veroeffentlichenResponse;
    expect(antwort.ok()).toBeTruthy();
    await seiteWurdeNeuGeladen;

    // --- turniere.html: Status ist jetzt von "Entwurf" auf "Anmeldung läuft" gewechselt ---
    await page.goto('/turniere.html');
    const karteVeroeffentlicht = page.locator('.tournament-card').filter({ hasText: TURNIER_NAME_KLASSEN });
    await expect(karteVeroeffentlicht.locator('.status-badge')).toHaveText('Anmeldung läuft');
});
