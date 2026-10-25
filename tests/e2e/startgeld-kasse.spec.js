// End-to-End Startgeld-Zahlweg (Stufe 1): Turnierformular (angebotene Zahlwege, Abrechnungsbasis).
import { test, expect } from '@playwright/test';
import knexLib from 'knex';
import { testDbVerbindung } from './test-env.js';

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

// Kasse an der Waage: Bar-Zahler und Vereine ohne Zahlweg, "Alles bar kassiert" (Offline-Server, Fixtures direkt in der DB).
test.describe.serial('Kasse an der Waage', () => {
    const ts = Date.now();
    const barVerein = `JC B ${ts}`;
    const ohneVerein = `JC Ohne ${ts}`;
    const ueVerein = `JC Ue ${ts}`;
    const ausrichter = `JC Kasse ${ts}`;
    let db;
    let turnierId;
    let freiId;

    test.beforeAll(async () => {
        db = knexLib({ client: 'pg', connection: testDbVerbindung, pool: { min: 0, max: 2 } });
        const [v] = await db('vereine').insert({ name: ausrichter }).returning('id');
        const vereinId = typeof v === 'object' ? v.id : v;
        const [t] = await db('turniere').insert({
            bezeichnung: `E2E Kasse ${ts}`, ort: 'Halle', datum: '2027-09-12', ausrichter, verein_id: vereinId,
            status: 'veroeffentlicht', startgeld: 8, anmeldeschluss: '2027-09-01', iban: 'DE89370400440532013000',
            kontoinhaber: 'JC Kasse', verwendungszweck: 'Startgeld'
        }).returning('id');
        turnierId = typeof t === 'object' ? t.id : t;
        const [f] = await db('turniere').insert({
            bezeichnung: `E2E Kasse frei ${ts}`, ort: 'Halle', datum: '2027-10-12', ausrichter, verein_id: vereinId, status: 'veroeffentlicht'
        }).returning('id');
        freiId = typeof f === 'object' ? f.id : f;
        await db('turnier_zahlwege').insert([
            { turnier_id: turnierId, verein_name: barVerein, zahlweg: 'bar', rechnung_email: 'a@b.de', rechnung_ansprechperson: 'A', rechnung_anschrift: 'Weg 1' },
            { turnier_id: turnierId, verein_name: ueVerein, zahlweg: 'ueberweisung', rechnung_email: 'a@b.de', rechnung_ansprechperson: 'A', rechnung_anschrift: 'Weg 1' }
        ]);
        let n = 0;
        const mk = async (tid, verein, anzahl) => {
            for (let i = 0; i < anzahl; i += 1) {
                n += 1;
                await db('turnier_teilnehmer').insert({
                    turnier_id: tid, judopass_id: `K-${ts}-${n}`, vorname: 'Vo', nachname: `Na${n}`, geschlecht: 'm', verein,
                    gewicht: 40, altersklasse: 'U15', gewichtsklasse: '-44', lizenz_ablauf: '2099-01-01', geburtsjahr: 2012
                });
            }
        };
        await mk(turnierId, barVerein, 3);
        await mk(turnierId, ohneVerein, 1);
        await mk(turnierId, ueVerein, 2);
        await mk(turnierId, ausrichter, 1);
    });

    test.afterAll(async () => { await db.destroy(); });

    test('Kasse listet Bar-Zahler und Vereine ohne Zahlweg, nicht Überweiser und Ausrichter', async ({ page }) => {
        await page.goto(`/teilnehmer.html?turnierId=${turnierId}`);
        await page.locator('#kasseBtn').click();
        const zeilen = page.locator('#kasseTabelleBody tr');
        await expect(zeilen).toHaveCount(2);
        const bar = zeilen.filter({ hasText: barVerein });
        await expect(bar).toContainText('Bar');
        await expect(bar.locator('td').nth(2)).toHaveText('3');
        await expect(bar.locator('td').nth(3)).toHaveText('3');
        const ohne = zeilen.filter({ hasText: ohneVerein });
        await expect(ohne).toContainText('ohne Zahlweg');
        await expect(page.locator('#kasseTabelleBody')).not.toContainText(ueVerein);
        await page.keyboard.press('Escape');
        await expect(page.locator('#kasseModal')).toBeHidden();
    });

    test('Alles bar kassiert setzt die Kämpfer des Vereins auf bezahlt', async ({ page }) => {
        await page.goto(`/teilnehmer.html?turnierId=${turnierId}`);
        await page.locator('#kasseBtn').click();
        const bar = page.locator('#kasseTabelleBody tr').filter({ hasText: barVerein });
        await bar.getByRole('button', { name: 'Alles bar kassiert' }).click();
        await expect(bar.locator('td').nth(3)).toHaveText('0');
        await expect(bar.getByRole('button', { name: 'Alles bar kassiert' })).toBeDisabled();
        await expect.poll(async () => (await db('turnier_teilnehmer').where({ turnier_id: turnierId, verein: barVerein, startgeld_bezahlt: true })).length).toBe(3);
        // Verein ohne Zahlweg bleibt offen
        await expect(page.locator('#kasseTabelleBody tr').filter({ hasText: ohneVerein }).locator('td').nth(3)).toHaveText('1');
        await page.keyboard.press('Escape');
        // Teilnehmerliste zeigt die Kämpfer als bezahlt
        await expect(page.locator('#teilnehmerTableBody [data-toggle="bezahlt"].active')).toHaveCount(3);
    });

    test('Ohne Startgeld gibt es keinen Kassen-Knopf', async ({ page }) => {
        await page.goto(`/teilnehmer.html?turnierId=${freiId}`);
        await expect(page.locator('#teilnehmerTableBody')).toBeAttached();
        await page.waitForTimeout(500);
        await expect(page.locator('#kasseBtn')).toBeHidden();
    });
});
