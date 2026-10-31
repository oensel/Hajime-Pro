// Turnier vom Hallen-Server in die Cloud zurückspielen (Startgeld Stufe 2, Task 7): Turnier 13 aus der Fake-Cloud
// (tests/helpers/fake-cloud.mjs) holen, einen Kämpfer anlegen und über den Knopf „In die Cloud zurückspielen“ der
// Turnierauswahl an die Cloud schicken. Die Attrappe schreibt die empfangene Datei mit (GET /test/rueckspiel).
import { test, expect } from '@playwright/test';
import knexLib from 'knex';
import { testDbVerbindung, FAKE_CLOUD_URL, FAKE_CLOUD_EMAIL, FAKE_CLOUD_PASSWORT, FAKE_CLOUD_EMAIL_2FA, FAKE_CLOUD_2FA_CODE } from './test-env.js';

const CLOUD_TURNIER = 13;

async function cloudToken(request) {
    const r = await request.post('/api/cloud/turniere', { data: { email: FAKE_CLOUD_EMAIL, password: FAKE_CLOUD_PASSWORT } });
    expect(r.ok()).toBe(true);
    return (await r.json()).token;
}

test.describe.serial('Turnier in die Cloud zurückspielen', () => {
    let turnierId;

    test.beforeAll(async ({ request }) => {
        await request.delete(`${FAKE_CLOUD_URL}/test/rueckspiel`);
    });

    test('Anmeldung mit Zwei-Faktor: ohne Code 422 mit Hinweis, mit Code das Token', async ({ request }) => {
        const ohne = await request.post('/api/cloud/turniere', { data: { email: FAKE_CLOUD_EMAIL_2FA, password: FAKE_CLOUD_PASSWORT } });
        expect(ohne.status()).toBe(422);
        const body = await ohne.json();
        expect(body.zweiFaktor).toBe(true);
        expect(body.error).toBe('Bitte den Code der Authenticator-App eingeben.');
        expect(body.token).toBeUndefined();

        const falsch = await request.post('/api/cloud/turniere', { data: { email: FAKE_CLOUD_EMAIL_2FA, password: FAKE_CLOUD_PASSWORT, code: '000000' } });
        expect(falsch.status()).toBe(422);

        const mit = await request.post('/api/cloud/turniere', { data: { email: FAKE_CLOUD_EMAIL_2FA, password: FAKE_CLOUD_PASSWORT, code: FAKE_CLOUD_2FA_CODE } });
        expect(mit.ok()).toBe(true);
        expect((await mit.json()).token).toBeTruthy();
    });

    test('ohne lokales Turnier zum Cloud-Turnier: 404, ohne Token: 400', async ({ request }) => {
        const token = await cloudToken(request);
        const ohneLokal = await request.post('/api/cloud/turniere/999/zurueckspielen', { data: { token } });
        expect(ohneLokal.status()).toBe(404);
        expect((await ohneLokal.json()).error).toBe('Zu diesem Cloud-Turnier gibt es hier kein Turnier.');

        const ohneToken = await request.post(`/api/cloud/turniere/${CLOUD_TURNIER}/zurueckspielen`, { data: {} });
        expect(ohneToken.status()).toBe(400);
    });

    test('Turnier holen und einen Kämpfer anlegen', async ({ request }) => {
        const token = await cloudToken(request);
        const geholt = await request.post(`/api/cloud/turniere/${CLOUD_TURNIER}/holen`, { data: { token } });
        expect(geholt.status(), await geholt.text()).toBe(201);
        turnierId = (await geholt.json()).turnierId;

        const tn = await request.post('/api/teilnehmer', {
            data: {
                turnier_id: turnierId, vorname: 'Rück', nachname: 'Spieler', verein: 'JC Vor Ort', geburtsjahr: 2012,
                geschlecht: 'm', gewicht: 48, altersklasse: 'U15', gewichtsklasse: '-50', lizenz_ablauf: '2099-12-31'
            }
        });
        expect(tn.status(), await tn.text()).toBe(201);
    });

    test('Oberfläche: Knopf, Anmeldung mit Code, Bestätigung, Meldung und Datei in der Cloud', async ({ page }) => {
        const lokaleTeilnehmer = (await (await page.request.get(`/api/teilnehmer?turnierId=${turnierId}`)).json());
        const anzahlLokal = Array.isArray(lokaleTeilnehmer) ? lokaleTeilnehmer.length : lokaleTeilnehmer.teilnehmer.length;
        expect(anzahlLokal).toBe(2);

        const knopf = page.locator(`button[data-aktion="zurueckspielen"][data-id="${turnierId}"]`);

        // Solange das Turnier nicht beendet ist, gibt es den Knopf nicht
        await page.goto('/turniere.html');
        await expect(page.locator(`[data-id="${turnierId}"][data-aktion="duplizieren"]`).first()).toBeVisible();
        await expect(knopf).toHaveCount(0);

        const db = knexLib({ client: 'pg', connection: testDbVerbindung });
        try {
            await db('turniere').where({ id: turnierId }).update({ status: 'abgeschlossen' });
        } finally {
            await db.destroy();
        }
        await page.goto('/turniere.html');
        await expect(knopf).toBeVisible();
        await knopf.click();

        const dialog = page.locator('#rueckspielModal');
        await expect(dialog).toBeVisible();
        await expect(dialog).toContainText('Ergebnisse hochladen');
        await expect(dialog.locator('#rueckspielCode')).toBeHidden();

        // Super-Admin-Konto: erst nach der Antwort der Cloud erscheint das Code-Feld
        await dialog.locator('#rueckspielEmail').fill(FAKE_CLOUD_EMAIL_2FA);
        await dialog.locator('#rueckspielPasswort').fill(FAKE_CLOUD_PASSWORT);
        await dialog.locator('#rueckspielAnmeldenBtn').click();
        await expect(dialog.locator('#rueckspielCode')).toBeVisible();
        await expect(dialog.locator('#rueckspielFehler')).toContainText('Code der Authenticator-App');
        await dialog.locator('#rueckspielCode').fill(FAKE_CLOUD_2FA_CODE);
        await dialog.locator('#rueckspielAnmeldenBtn').click();

        // Bestätigung mit den Zählern
        await expect(dialog.locator('#rueckspielBestaetigung')).toBeVisible();
        await expect(dialog.locator('#rueckspielBestaetigung')).toContainText('2 Teilnehmer');
        await dialog.locator('#rueckspielSendenBtn').click();

        await expect(dialog.locator('#rueckspielErgebnis')).toContainText('zurückgespielt');

        const { rueckspiele } = await (await page.request.get(`${FAKE_CLOUD_URL}/test/rueckspiel`)).json();
        expect(rueckspiele).toHaveLength(1);
        const { turnierId: cloudId, daten } = rueckspiele[0];
        expect(cloudId).toBe(CLOUD_TURNIER);
        expect(daten.turnier.urspruengliche_id).toBe(CLOUD_TURNIER);
        expect(daten.anzahl.teilnehmer).toBe(anzahlLokal);
        expect(daten.teilnehmer).toHaveLength(anzahlLokal);
        expect('live_token' in daten.turnier).toBe(false);
        expect(JSON.stringify(daten)).not.toContain('hjl_fake-live-token');
    });
});
