// End-to-End: Orga-Planer-Oberfläche (orga.html, orga-aufgabe.html). Hallen-Server ohne Anmeldung
// (Einzelbenutzer offline_user); die API selbst prüft orga-api.spec.js.
import { test, expect } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

let turnierId;
const zeile = (page, titel) => page.locator('.og-zeile').filter({ has: page.locator('.og-titel', { hasText: new RegExp(`^${titel}$`) }) });
const kennzahl = (page, id) => page.locator(`#${id}`);

async function ladeOrga(request) {
    const r = await request.get(`/api/orga?turnierId=${turnierId}`);
    expect(r.ok(), await r.text()).toBeTruthy();
    return r.json();
}
const alleAufgaben = (orga) => orga.phasen.flatMap((p) => p.aufgaben);

test.beforeAll(async ({ request }) => {
    const resp = await request.post('/api/turniere', {
        data: { bezeichnung: `Orga-UI ${Date.now()}`, ort: 'Halle', datum: '2033-03-12', ausrichter: 'Offline Club', anzahl_kampfflaechen: 1 }
    });
    expect(resp.ok(), await resp.text()).toBeTruthy();
    turnierId = (await resp.json()).turnierId;
});

test('zeigt die Vorlage in fünf Phasen mit Kennzahlen und abgesetzter Grundlage', async ({ page }) => {
    await page.goto(`/orga.html?turnierId=${turnierId}`);
    await expect(page.locator('.og-phase')).toHaveCount(5);
    await expect(page.locator('.og-phase h2')).toHaveText(['Grundlage', 'Vorbereitung', 'Meldephase', 'Turniertag', 'Nachbereitung']);
    await expect(page.locator('.og-phase-grundlage')).toContainText('6 bis 12 Monate vorher, vor allem anderen');
    await expect(page.locator('.og-phase-grundlage')).toHaveCSS('border-left-width', '6px');
    await expect(zeile(page, 'Hallenzeiten reservieren')).toBeVisible();
    await expect(kennzahl(page, 'ogErledigt')).toHaveText(/^0 von \d+$/);
    await expect(page.locator('#ogTurnierInfo')).toContainText('12.03.2033');
    await expect(zeile(page, 'Hallenzeiten reservieren').locator('.og-chip-faellig')).toHaveText('−240 Tage');
});

test('Aufgabe abhaken erhöht den Zähler und lässt sich zurücknehmen', async ({ page }) => {
    await page.goto(`/orga.html?turnierId=${turnierId}`);
    const z = zeile(page, 'Genehmigung beim Landesverband');
    await z.locator('.og-punkt').click();
    await expect(kennzahl(page, 'ogErledigt')).toHaveText(/^1 von \d+$/);
    await expect(zeile(page, 'Genehmigung beim Landesverband').locator('.og-punkt')).toHaveAttribute('aria-checked', 'true');
    await zeile(page, 'Genehmigung beim Landesverband').locator('.og-punkt').click();
    await expect(kennzahl(page, 'ogErledigt')).toHaveText(/^0 von \d+$/);
});

test('Technik bereitstellen: alle Posten abhaken, zurück, Aufgabe ist erledigt', async ({ page }) => {
    await page.goto(`/orga.html?turnierId=${turnierId}`);
    const z = zeile(page, 'Technik bereitstellen');
    await expect(z.locator('.og-fortschritt')).toHaveText(/^0 von \d+ Posten$/);
    await z.getByRole('link', { name: /Posten öffnen/ }).click();
    await expect(page).toHaveURL(/orga-aufgabe\.html\?id=\d+&turnierId=\d+/);
    await expect(page.locator('#ogAufgabeTitel')).toHaveText('Technik bereitstellen');
    const gesamt = await page.locator('#ogPosten .og-zeile').count();
    expect(gesamt).toBeGreaterThan(10);
    await expect(page.locator('#ogFortschrittText')).toHaveText(`0 von ${gesamt}`);
    for (let i = 0; i < gesamt; i++) {
        await page.locator('#ogPosten .og-zeile:not(.og-status-erledigt) .og-punkt').first().click();
        await expect(page.locator('#ogFortschrittText')).toHaveText(`${i + 1} von ${gesamt}`);
    }
    await expect(page.locator('#ogBalken')).toHaveAttribute('aria-valuenow', '100');
    await page.getByRole('link', { name: 'Zurück zur Orga' }).click();
    await expect(page).toHaveURL(/orga\.html/);
    const danach = zeile(page, 'Technik bereitstellen');
    await expect(danach).toHaveClass(/og-status-erledigt/);
    await expect(danach.locator('.og-punkt')).toHaveAttribute('aria-checked', 'true');
    await expect(danach.locator('.og-fortschritt')).toHaveText(`${gesamt} von ${gesamt} Posten`);
});

test('Zuweisen an einen freien Namen zeigt den Namen im Chip', async ({ page, request }) => {
    await page.goto(`/orga.html?turnierId=${turnierId}`);
    const z = zeile(page, 'Hallenzeiten reservieren');
    await expect(z.locator('.og-chip-person')).toHaveText('Zuweisen');
    await z.locator('.og-chip-person').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('oder freier Name').fill('Gast Frei');
    await dialog.getByRole('button', { name: 'Zuweisen' }).click();
    await expect(dialog).toBeHidden();
    await expect(zeile(page, 'Hallenzeiten reservieren').locator('.og-chip-person')).toHaveText('Gast Frei');
    const a = alleAufgaben(await ladeOrga(request)).find((x) => x.vorlage_key === 'grundlage_halle');
    expect(a.name_frei).toBe('Gast Frei');

    // Dialog ohne Eingabe zeigt einen Fehler
    await zeile(page, 'Abbau und Reinigung').locator('.og-chip-person').click();
    await page.getByRole('dialog').getByRole('button', { name: 'Zuweisen' }).click();
    await expect(page.getByRole('dialog').locator('.og-fehler')).toContainText('Namen eingeben');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
});

test('Filter „Nur meine Aufgaben“ zeigt nur Aufgaben des angemeldeten Benutzers, eigener Name als „Du“', async ({ page, request }) => {
    const orga = await ladeOrga(request);
    const aufgabe = alleAufgaben(orga).find((x) => x.vorlage_key === 'genehmigung');
    const mitglieder = await (await request.get(`/api/orga/mitglieder?turnierId=${turnierId}`)).json();
    const ich = mitglieder.find((m) => m.id === 'offline_user');
    test.skip(!ich, 'offline_user ist im Hallen-Server kein Vereinsmitglied');
    const z = await request.post(`/api/orga/aufgaben/${aufgabe.id}/zuweisen`, { data: { benutzerId: 'offline_user' } });
    expect(z.ok(), await z.text()).toBeTruthy();

    await page.goto(`/orga.html?turnierId=${turnierId}`);
    await expect(zeile(page, 'Genehmigung beim Landesverband').locator('.og-chip-ich')).toHaveText('Du');
    await expect(zeile(page, 'Hallenzeiten reservieren')).toBeVisible();
    await page.getByRole('button', { name: 'Nur meine Aufgaben' }).click();
    await expect(page.getByRole('button', { name: 'Nur meine Aufgaben' })).toHaveAttribute('aria-pressed', 'true');
    await expect(zeile(page, 'Genehmigung beim Landesverband')).toBeVisible();
    await expect(zeile(page, 'Hallenzeiten reservieren')).toHaveCount(0);
    await expect(page.locator('.og-phase')).toHaveCount(1);
    await page.getByRole('button', { name: 'Nur meine Aufgaben' }).click();
    await expect(zeile(page, 'Hallenzeiten reservieren')).toBeVisible();
});

test('überfällige Fälligkeit wird rot markiert und gezählt', async ({ page, request }) => {
    const neu = await request.post('/api/orga/aufgaben', {
        data: { turnierId, titel: 'Längst fällig', phase: 'vorbereitung', faellig_am: '2020-01-15' }
    });
    expect(neu.status()).toBe(201);
    await page.goto(`/orga.html?turnierId=${turnierId}`);
    const z = zeile(page, 'Längst fällig');
    await expect(z).toHaveClass(/og-ueberfaellig/);
    const chip = z.locator('.og-chip-faellig');
    await expect(chip).toHaveText('15.01.2020');
    await expect(chip).toHaveClass(/og-chip-rot/);
    await expect(z.locator('.og-chip-person')).toHaveClass(/og-chip-rot/);
    await expect(page.locator('#ogKarteUeberfaellig')).toHaveClass(/og-karte-aktiv/);
    await expect(kennzahl(page, 'ogUeberfaellig')).not.toHaveText('0');
});

test('Aufgabe anlegen, bearbeiten und mit Bestätigung löschen', async ({ page }) => {
    await page.goto(`/orga.html?turnierId=${turnierId}`);
    await page.getByRole('button', { name: 'Aufgabe hinzufügen' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Hinzufügen' }).click();
    await expect(dialog.locator('.og-fehler')).toHaveText('Titel eingeben.');
    await dialog.getByLabel('Titel').fill('Eigene Orga-Aufgabe');
    await dialog.getByLabel('Phase').selectOption('turniertag');
    await dialog.getByRole('button', { name: 'Hinzufügen' }).click();
    await expect(dialog).toBeHidden();
    const z = page.locator('.og-phase-turniertag .og-zeile').filter({ hasText: 'Eigene Orga-Aufgabe' });
    await expect(z).toBeVisible();

    await z.getByRole('button', { name: /bearbeiten/ }).click();
    await page.getByRole('dialog').getByLabel('Titel').fill('Umbenannte Orga-Aufgabe');
    await page.getByRole('dialog').getByRole('button', { name: 'Speichern' }).click();
    const z2 = page.locator('.og-zeile').filter({ hasText: 'Umbenannte Orga-Aufgabe' });
    await expect(z2).toBeVisible();

    await z2.getByRole('button', { name: /löschen/ }).click();
    await page.locator('#modalConfirmBtn').click();
    await expect(page.locator('.og-zeile').filter({ hasText: 'Umbenannte Orga-Aufgabe' })).toHaveCount(0);
});

test('„Nach Person“ gruppiert nach Zuständigen mit „Ohne Zuständigen“', async ({ page }) => {
    await page.goto(`/orga.html?turnierId=${turnierId}`);
    await page.getByRole('button', { name: 'Nach Person' }).click();
    await expect(page.getByRole('button', { name: 'Nach Person' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.og-person h2').filter({ hasText: 'Gast Frei' })).toBeVisible();
    await expect(page.locator('.og-person h2').filter({ hasText: 'Ohne Zuständigen' })).toBeVisible();
    const gast = page.locator('.og-person').filter({ has: page.locator('h2', { hasText: 'Gast Frei' }) });
    await expect(gast.locator('.og-zeile')).toHaveCount(1);
    await expect(gast).toContainText('Hallenzeiten reservieren');
    await page.getByRole('button', { name: 'Nach Phase' }).click();
    await expect(page.locator('.og-phase-grundlage')).toBeVisible();
});

test('Mitbringliste: Eintrag anlegen und löschen', async ({ page }) => {
    await page.goto(`/orga.html?turnierId=${turnierId}`);
    await zeile(page, 'Catering einkaufen').getByRole('link', { name: /Posten öffnen/ }).click();
    await expect(page.locator('#ogMitbringen')).toBeVisible();
    await expect(page.locator('#ogMitbringen h2')).toHaveText('Kuchen und Sonstiges');
    await page.locator('#ogMitbringTitel').fill('Marmorkuchen');
    await page.locator('#ogMitbringMenge').fill('2');
    await page.getByRole('button', { name: 'Eintragen' }).click();
    const eintrag = page.locator('#ogMitbringListe .og-zeile').filter({ hasText: 'Marmorkuchen' });
    await expect(eintrag).toBeVisible();
    await expect(eintrag).toContainText('2×');
    await expect(eintrag.locator('.og-chip-person')).not.toHaveText('');
    // Mitbringeinträge zählen nicht zum Fortschritt der Posten
    await expect(page.locator('#ogFortschrittText')).toHaveText(/^0 von 7$/);
    await eintrag.getByRole('button', { name: /löschen/ }).click();
    await page.locator('#modalConfirmBtn').click();
    await expect(page.locator('#ogMitbringListe .og-zeile').filter({ hasText: 'Marmorkuchen' })).toHaveCount(0);
});

test('Posten hinzufügen und „Alle auf mich“', async ({ page, request }) => {
    const mitglieder = await (await request.get(`/api/orga/mitglieder?turnierId=${turnierId}`)).json();
    test.skip(!mitglieder.some((m) => m.id === 'offline_user'), 'offline_user ist kein Vereinsmitglied');
    await page.goto(`/orga.html?turnierId=${turnierId}`);
    await zeile(page, 'Medaillen und Pokale').getByRole('link', { name: /Posten öffnen/ }).click();
    await page.getByRole('button', { name: 'Posten hinzufügen' }).click();
    await page.getByRole('dialog').getByLabel('Titel').fill('Urkundenmappen');
    await page.getByRole('dialog').getByLabel('Menge (optional)').fill('5');
    await page.getByRole('dialog').getByRole('button', { name: 'Hinzufügen' }).click();
    await expect(page.locator('#ogPosten .og-zeile').filter({ hasText: 'Urkundenmappen' })).toContainText('5×');
    await expect(page.locator('#ogFortschrittText')).toHaveText('0 von 5');
    await page.getByRole('button', { name: 'Alle auf mich' }).click();
    await expect(page.locator('#ogPosten .og-chip-ich')).toHaveCount(5);
});

test('Eigene Aufgabe: über den Pfeil Posten anlegen, abhaken, Aufgabe ist erledigt', async ({ page, request }) => {
    const neu = await request.post('/api/orga/aufgaben', { data: { turnierId, titel: 'Eigene mit Posten', phase: 'turniertag' } });
    expect(neu.status()).toBe(201);
    await page.goto(`/orga.html?turnierId=${turnierId}`);
    await zeile(page, 'Eigene mit Posten').getByRole('link', { name: /Posten öffnen/ }).click();
    await expect(page.locator('#ogPosten')).toContainText('Noch keine Posten');
    await page.getByRole('button', { name: 'Posten hinzufügen' }).click();
    await page.getByRole('dialog').getByLabel('Titel').fill('Einziger Posten');
    await page.getByRole('dialog').getByRole('button', { name: 'Hinzufügen' }).click();
    await expect(page.locator('#ogFortschrittText')).toHaveText('0 von 1');
    await page.locator('#ogPosten .og-punkt').click();
    await expect(page.locator('#ogFortschrittText')).toHaveText('1 von 1');
    await page.getByRole('link', { name: 'Zurück zur Orga' }).click();
    await expect(zeile(page, 'Eigene mit Posten')).toHaveClass(/og-status-erledigt/);
});

test('„Vorlage nachladen“ bringt eine gelöschte Vorlagen-Aufgabe zurück', async ({ page, request }) => {
    const orga = await ladeOrga(request);
    const weg = alleAufgaben(orga).find((a) => a.titel === 'Genehmigung beim Landesverband');
    expect(weg).toBeTruthy();
    expect((await request.delete(`/api/orga/aufgaben/${weg.id}`)).ok()).toBeTruthy();
    await page.goto(`/orga.html?turnierId=${turnierId}`);
    await expect(zeile(page, 'Genehmigung beim Landesverband')).toHaveCount(0);
    await page.getByRole('button', { name: 'Vorlage nachladen' }).click();
    await expect(zeile(page, 'Genehmigung beim Landesverband')).toBeVisible();
    await expect(page.getByText('1 Aufgabe aus der Vorlage ergänzt.')).toBeVisible();
    // zweiter Klick: nichts mehr zu ergänzen
    await page.getByRole('button', { name: 'Vorlage nachladen' }).click();
    await expect(page.getByText('Alle Aufgaben der Vorlage sind bereits vorhanden.')).toBeVisible();
});
