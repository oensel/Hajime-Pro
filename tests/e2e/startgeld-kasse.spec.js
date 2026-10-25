// End-to-End Startgeld-Zahlweg (Stufe 1): Turnierformular (angebotene Zahlwege, Abrechnungsbasis).
import { test, expect } from '@playwright/test';

test.describe.serial('Turnierformular: Zahlweg-Felder', () => {
    let turnierId;

    test('Nur Bar angeboten und Basis Teilnahme Waage bleiben nach dem Speichern erhalten', async ({ page }) => {
        await page.goto('/turnier.html');
        await page.locator('#bezeichnung').fill(`E2E Zahlweg ${Date.now()}`);
        await page.locator('#datum').fill('2027-07-10');
        await page.locator('#ort').fill('Senden');
        await page.locator('#ausrichter').fill('JC Zahlweg');
        await page.locator('#startgeld').fill('8');
        await page.locator('#kontoinhaber').fill('JC Zahlweg e.V.');
        await page.locator('#iban').fill('DE89370400440532013000');
        await page.locator('#verwendungszweck').fill('Startgeld');
        await page.locator('#zahlwegUeberweisung').uncheck();
        await page.locator('#abrechnungsbasis').selectOption('teilnahme_waage');
        await page.locator('#submitBtn').click();
        await expect(page.locator('#snackbarText')).toHaveText('Turnier erfolgreich angelegt!');
        await expect(page).toHaveURL(/\/turnier\.html\?id=\d+/);
        turnierId = Number(new URL(page.url()).searchParams.get('id'));

        await page.reload();
        await expect(page.locator('#bezeichnung')).not.toHaveValue('');
        await expect(page.locator('#zahlwegUeberweisung')).not.toBeChecked();
        await expect(page.locator('#zahlwegBar')).toBeChecked();
        await expect(page.locator('#abrechnungsbasis')).toHaveValue('teilnahme_waage');
    });

    test('Ohne angebotenen Zahlweg lässt sich ein Turnier mit Startgeld nicht speichern', async ({ page, request }) => {
        await page.goto(`/turnier.html?id=${turnierId}`);
        await expect(page.locator('#bezeichnung')).not.toHaveValue('');
        await page.locator('#zahlwegBar').uncheck();
        await page.locator('#submitBtn').click();
        await expect(page.locator('#snackbarText')).toContainText('mindestens ein Zahlweg');

        // Auch der Server lehnt es ab
        const resp = await request.put(`/api/turniere/${turnierId}`, {
            data: { bezeichnung: 'x', ort: 'y', datum: '2027-07-10', ausrichter: 'z', startgeld: 8, iban: 'DE89370400440532013000', kontoinhaber: 'k', verwendungszweck: 'v', angebotene_zahlwege: '' }
        });
        expect(resp.status()).toBe(400);
        const ok = await request.get(`/api/turniere/${turnierId}`);
        expect((await ok.json()).angebotene_zahlwege).toBe('bar');
    });

    test('Ohne Startgeld braucht es keinen Zahlweg', async ({ request }) => {
        const resp = await request.post('/api/turniere', {
            data: { bezeichnung: `E2E Frei ${Date.now()}`, ort: 'Halle', datum: '2027-08-10', ausrichter: 'JC', angebotene_zahlwege: '' }
        });
        expect(resp.ok(), await resp.text()).toBeTruthy();
    });
});
