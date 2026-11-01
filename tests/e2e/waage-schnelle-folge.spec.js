// Waage im Akkord: Speichern, Dialog sofort schließen, nächsten Kämpfer anlegen. Am Client-Gerät wartet das Speichern
// auf die Bestätigung des Hallen-Servers (bis über eine Sekunde); das späte Zurücksetzen des Formulars darf die schon
// getippten Eingaben des nächsten Kämpfers nicht löschen. Die Verzögerung wird hier am Datenzugriff nachgestellt.
import { test, expect } from '@playwright/test';

test('Langsames Speichern leert nicht das Formular des nächsten Kämpfers', async ({ page, request }) => {
    const turnierResp = await request.post('/api/turniere', {
        data: { bezeichnung: 'Waage Akkord', ort: 'Teststadt', datum: '2027-04-10', ausrichter: 'JC Test', anzahl_kampfflaechen: 1,
            altersklassen: { 'männlich_U13': 'djb' } }
    });
    expect(turnierResp.ok(), await turnierResp.text()).toBeTruthy();
    const turnierId = (await turnierResp.json()).turnierId;

    page.on('dialog', d => d.accept());
    await page.goto(`/teilnehmer.html?turnierId=${turnierId}`);
    await page.waitForLoadState('networkidle');
    await page.waitForFunction(() => typeof window.oeffneWaageModal === 'function' && !!window.Datenzugriff);
    await page.evaluate(() => {
        const original = window.Datenzugriff.speichereTeilnehmer;
        window.Datenzugriff.speichereTeilnehmer = async (...args) => {
            await new Promise(r => setTimeout(r, 1500));
            return original(...args);
        };
    });

    const fuelle = async (vorname, gewicht) => {
        await page.fill('#vorname', vorname);
        await page.fill('#nachname', 'Akkord');
        await page.fill('#verein', 'JC Test');
        await page.fill('#geburtsjahr', '2015');
        await page.selectOption('#geschlecht', 'männlich');
        await page.fill('#gewicht', gewicht);
        await page.fill('#judopass_id', `AK-${vorname}`);
        await page.fill('#lizenz_ablauf', '2027-12-31');
    };

    await page.locator('#addBtn').click();
    await fuelle('Erster', '33,4');
    await page.locator('#submitBtn').click();
    await page.locator('#modalConfirmBtn').click();
    // sofort schließen und den nächsten anlegen, während das Speichern noch läuft
    await page.locator('#waageModalClose').click();
    await page.locator('#addBtn').click();
    await fuelle('Zweiter', '36,7');

    await expect(page.locator('#snackbarText')).toHaveText('Athlet Erster erfolgreich eingewogen!');
    await expect(page.locator('#vorname')).toHaveValue('Zweiter');
    await expect(page.locator('#gewicht')).toHaveValue('36,7');
    await expect(page.locator('#submitBtn')).toBeEnabled();
});
