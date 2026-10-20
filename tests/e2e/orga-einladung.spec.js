// End-to-End: Helfer-App „Meine Aufgaben“ (helfer.html#aufgaben) und Einladungsseite (einladung.html).
// Die Suite läuft im Hallen-Server-Betrieb (Einzelbenutzer offline_user, HELFER_APP_AKTIV=true, test-env.js):
//  - /zuweisen mit Name+E-Mail antwortet dort 'frei' ohne Einladung/Mail (Spec), daher legt dieser Test die Einladung
//    über den Dienst erzeugeEinladung direkt in der Test-Datenbank an (derselbe Link wie in der Cloud-Mail);
//  - /api/helfer/orga/meine liefert im Einzelbenutzerbetrieb immer die Aufgaben von offline_user (kein Login).
import { test, expect } from '@playwright/test';
import knexLib from 'knex';
import { testDbVerbindung } from './test-env.js';
import { erzeugeEinladung } from '../../src/services/orgaEinladung.js';
import { hashPassword } from '../../src/utils/password.js';

test.describe.configure({ mode: 'serial' });

const LAUF = Date.now();
const EMAIL_NEU = `max.einladung.${LAUF}@example.org`;
const EMAIL_ALT = `erika.einladung.${LAUF}@example.org`;
const ALT_PASSWORT = 'richtiges-passwort-1';
const TURNIER = `Orga-Einladung ${LAUF}`;

let db;
let vereinId;
let turnierId;
let aufgabeUeberfaellig;
let aufgabeWoche;
let aufgabeFuerMax;
const erzeugteBenutzer = [];

const tagVerschoben = (tage) => {
    const d = new Date(Date.now() + tage * 86400000);
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
};

test.beforeAll(async ({ request }) => {
    db = knexLib({ client: 'pg', connection: testDbVerbindung, pool: { min: 0, max: 2 } });
    const resp = await request.post('/api/turniere', {
        data: { planungs_tools: true, bezeichnung: TURNIER, ort: 'Halle', datum: '2032-06-12', ausrichter: 'Offline Club', anzahl_kampfflaechen: 1 }
    });
    expect(resp.ok(), await resp.text()).toBeTruthy();
    turnierId = (await resp.json()).turnierId;
    vereinId = (await db('turniere').where({ id: turnierId }).first('verein_id')).verein_id;

    const orga = await (await request.get(`/api/orga?turnierId=${turnierId}`)).json();
    const alle = orga.phasen.flatMap((p) => p.aufgaben).filter((a) => !a.eltern_id);
    [aufgabeUeberfaellig, aufgabeWoche, aufgabeFuerMax] = alle;

    const setze = async (a, titel, faellig) => {
        expect((await request.put(`/api/orga/aufgaben/${a.id}`, { data: { titel, faellig_am: faellig } })).ok()).toBeTruthy();
    };
    await setze(aufgabeUeberfaellig, 'Hallenschlüssel holen', tagVerschoben(-2));
    await setze(aufgabeWoche, 'Medaillen zählen', tagVerschoben(3));
    await setze(aufgabeFuerMax, 'Urkunden drucken', tagVerschoben(30));
    for (const a of [aufgabeUeberfaellig, aufgabeWoche]) {
        const z = await request.post(`/api/orga/aufgaben/${a.id}/zuweisen`, { data: { benutzerId: 'offline_user' } });
        expect(z.ok(), await z.text()).toBeTruthy();
    }
    // Für Max: freie Person mit E-Mail (Hallen-Server: nur gespeichert, keine Einladung); die Einlösung ordnet sie zu.
    const z = await request.post(`/api/orga/aufgaben/${aufgabeFuerMax.id}/zuweisen`, { data: { name: 'Max Muster', email: EMAIL_NEU } });
    expect(z.ok(), await z.text()).toBeTruthy();
});

test.afterAll(async () => {
    if (!db) return;
    try {
        const ids = (await db('benutzer').whereIn('email', [EMAIL_NEU, EMAIL_ALT]).select('id')).map((r) => r.id);
        await db('orga_einladungen').whereIn('email', [EMAIL_NEU, EMAIL_ALT]).del();
        if (ids.length) {
            await db('orga_aufgaben').whereIn('benutzer_id', ids).update({ benutzer_id: null });
            await db('benutzer_vereine').whereIn('benutzer_id', ids).del();
            await db('benutzer').whereIn('id', ids).del();
        }
    } finally {
        await db.destroy();
    }
});

const zeile = (page, titel) => page.locator('.hf-aufgabe').filter({ hasText: titel });
const gruppe = (page, name) => page.locator('.hf-gruppe').filter({ has: page.locator('.hf-gruppe-titel', { hasText: name }) });

test.describe('Meine Aufgaben', () => {
    test('Link #aufgaben öffnet den Reiter; Gruppen, Fälligkeit und Zähler', async ({ page }) => {
        await page.goto('/helfer.html#aufgaben');
        await expect(page.locator('h1')).toHaveText('Meine Aufgaben');
        await expect(page.locator('.hf-nav a[data-reiter="aufgaben"]')).toHaveAttribute('aria-current', 'page');

        const ueber = gruppe(page, 'Überfällig');
        await expect(ueber.locator('.hf-gruppe-titel')).toHaveCSS('color', /rgb/);
        await expect(zeile(page, 'Hallenschlüssel holen')).toContainText('seit 2 Tagen überfällig');
        await expect(zeile(page, 'Hallenschlüssel holen')).toContainText(TURNIER);
        await expect(gruppe(page, 'Diese Woche').locator('.hf-aufgabe').filter({ hasText: 'Medaillen zählen' })).toContainText('fällig in 3 Tagen');
        await expect(page.locator('#hfAufgabenZaehler')).toBeVisible();
    });

    test('Haken setzt erledigt, bleibt nach dem Neuladen; Erledigt ist eingeklappt', async ({ page }) => {
        await page.goto('/helfer.html#aufgaben');
        const haken = zeile(page, 'Medaillen zählen').getByRole('checkbox');
        await haken.click();   // die Zeile wandert in das eingeklappte „Erledigt“; Fokus folgt auf dessen Überschrift
        const erledigt = page.locator('details.hf-erledigt-gruppe');
        await expect(erledigt.locator('summary')).toBeFocused();
        await page.reload();
        await expect(erledigt).not.toHaveAttribute('open', '');
        await erledigt.locator('summary').click();
        await expect(erledigt.locator('.hf-aufgabe').filter({ hasText: 'Medaillen zählen' })).toBeVisible();
        // wieder öffnen (Rückgängig)
        await erledigt.locator('.hf-aufgabe').filter({ hasText: 'Medaillen zählen' }).getByRole('checkbox').click();
        await expect(gruppe(page, 'Diese Woche').locator('.hf-aufgabe').filter({ hasText: 'Medaillen zählen' })).toBeVisible();
    });

    test('Fehler beim Speichern: Haken wird zurückgenommen, Meldung an der Zeile', async ({ page }) => {
        await page.route('**/api/helfer/orga/aufgaben/*/erledigt', (route) =>
            route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ success: false, error: 'Kaputt.' }) }));
        await page.goto('/helfer.html#aufgaben');
        const haken = zeile(page, 'Medaillen zählen').getByRole('checkbox');
        await haken.click();
        await expect(zeile(page, 'Medaillen zählen').locator('.hf-fehler')).toHaveText('Kaputt.');
        await expect(zeile(page, 'Medaillen zählen').getByRole('checkbox')).not.toBeChecked();
    });

    test('Leerzustand lädt ein statt sich zu entschuldigen', async ({ page }) => {
        await page.route('**/api/helfer/orga/meine', (route) =>
            route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, aufgaben: [] }) }));
        await page.goto('/helfer.html#aufgaben');
        await expect(page.locator('.hf-leer')).toContainText('Wenn dir jemand eine Aufgabe zuweist, erscheint sie hier.');
    });

    test('375 px: keine Seitwärtsbewegung, Screenshot', async ({ page }, info) => {
        await page.setViewportSize({ width: 375, height: 760 });
        await page.goto('/helfer.html#aufgaben');
        await expect(zeile(page, 'Hallenschlüssel holen')).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
        const box = await zeile(page, 'Hallenschlüssel holen').getByRole('checkbox').boundingBox();
        expect(box.width).toBeGreaterThanOrEqual(44);
        expect(box.height).toBeGreaterThanOrEqual(44);
        await page.screenshot({ path: info.outputPath('aufgaben-375.png') });
    });
});

test.describe('Einladung', () => {
    test('Neues Konto: E-Mail vorbelegt, Validierung inline, Registrieren führt zu den Aufgaben', async ({ page }, info) => {
        const token = await erzeugeEinladung(db, { email: EMAIL_NEU, name: 'Max Muster', vereinId });
        await page.goto(`/einladung.html?token=${token}`);
        await expect(page.locator('h1')).toContainText('Du wurdest zu Offline Club eingeladen');
        const email = page.locator('#email');
        await expect(email).toHaveValue(EMAIL_NEU);
        await expect(email).toHaveAttribute('readonly', '');
        await page.screenshot({ path: info.outputPath('einladung-desktop.png') });

        const knopf = page.getByRole('button', { name: 'Konto anlegen' });
        await knopf.click();
        await expect(page.locator('#vornameFehler')).toHaveText('Bitte gib deinen Vornamen ein.');
        await expect(page.locator('#nachnameFehler')).toHaveText('Bitte gib deinen Nachnamen ein.');
        await expect(page.locator('#passwortFehler')).toHaveText('Bitte lege ein Passwort fest.');
        await page.fill('#vorname', 'Max');
        await expect(page.locator('#vornameFehler')).toBeEmpty();
        await page.fill('#nachname', 'Muster');
        await page.fill('#passwort', 'kurz');
        await knopf.click();
        await expect(page.locator('#passwortFehler')).toContainText('mindestens 8 Zeichen');

        await page.fill('#passwort', 'ein-gutes-passwort');
        await knopf.click();
        await page.waitForURL(/\/helfer\.html#aufgaben$/);
        await expect(page.locator('h1')).toHaveText('Meine Aufgaben');
        const gespeichert = await page.evaluate(() => ({ t: localStorage.getItem('dokume_token'), u: JSON.parse(localStorage.getItem('dokume_user') || 'null') }));
        expect(gespeichert.t).toBeTruthy();
        expect(gespeichert.u.email).toBe(EMAIL_NEU);

        const konto = await db('benutzer').where({ email: EMAIL_NEU }).first();
        expect(konto.email_bestaetigt_am).toBeTruthy();
        erzeugteBenutzer.push(konto.id);
        const a = await db('orga_aufgaben').where({ id: aufgabeFuerMax.id }).first('benutzer_id');
        expect(a.benutzer_id).toBe(konto.id);
    });

    test('Der Link ist danach verbraucht', async ({ page }) => {
        const token = await erzeugeEinladung(db, { email: EMAIL_NEU, name: 'Max Muster', vereinId });
        await db('orga_einladungen').where({ email: EMAIL_NEU }).update({ benutzt_am: db.fn.now() });
        await page.goto(`/einladung.html?token=${token}`);
        await expect(page.locator('h1')).toHaveText('Einladung nicht gültig');
        await expect(page.locator('main')).toContainText('erneut zu schicken');
        await expect(page.locator('form')).toHaveCount(0);
    });

    test('Abgelaufener und unbekannter Link zeigen den Hinweis', async ({ page }) => {
        const token = await erzeugeEinladung(db, { email: `abgelaufen.${LAUF}@example.org`, vereinId });
        await db('orga_einladungen').where({ email: `abgelaufen.${LAUF}@example.org` }).update({ laeuft_ab_am: db.raw("now() - interval '1 day'") });
        await page.goto(`/einladung.html?token=${token}`);
        await expect(page.locator('h1')).toHaveText('Einladung nicht gültig');
        await page.goto('/einladung.html?token=gibt-es-nicht');
        await expect(page.locator('h1')).toHaveText('Einladung nicht gültig');
        await page.goto('/einladung.html');
        await expect(page.locator('h1')).toHaveText('Einladung nicht gültig');
        await db('orga_einladungen').where({ email: `abgelaufen.${LAUF}@example.org` }).del();
    });

    test('Bestehendes Konto: nur Passwortfeld, falsches Passwort bleibt auf der Seite', async ({ page }) => {
        const id = `einladung-test-${LAUF}`;
        await db('benutzer').insert({
            id, email: EMAIL_ALT, vorname: 'Erika', nachname: 'Beispiel', password_hash: hashPassword(ALT_PASSWORT),
            email_bestaetigt_am: db.fn.now(), aktiver_verein_id: vereinId, created_at: db.fn.now(), updated_at: db.fn.now()
        });
        erzeugteBenutzer.push(id);
        const token = await erzeugeEinladung(db, { email: EMAIL_ALT, vereinId });
        await page.goto(`/einladung.html?token=${token}`);
        await expect(page.locator('#vorname')).toHaveCount(0);
        await expect(page.getByText('Mit deinem bestehenden Passwort bestätigen.')).toBeVisible();
        const knopf = page.getByRole('button', { name: 'Beitreten' });
        await page.fill('#passwort', 'falsch-falsch');
        await knopf.click();
        await expect(page.locator('#passwortFehler')).toContainText('Das Passwort stimmt nicht');
        await expect(page).toHaveURL(/\/einladung\.html\?token=/);
        await expect(knopf).toBeEnabled();
        // Eingabe löscht den Fehler
        await page.fill('#passwort', ALT_PASSWORT);
        await expect(page.locator('#passwortFehler')).toBeEmpty();
        await knopf.click();
        await page.waitForURL(/\/helfer\.html#aufgaben$/);
        expect(await page.evaluate(() => localStorage.getItem('dokume_token'))).toBeTruthy();
    });

    test('Zu viele Versuche (429): Meldung am Formular', async ({ page }) => {
        const token = await erzeugeEinladung(db, { email: `rate.${LAUF}@example.org`, vereinId });
        await page.route(`**/api/einladung/${token}`, (route) => {
            if (route.request().method() !== 'POST') return route.continue();
            return route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ success: false, error: 'Zu viele Anfragen.' }) });
        });
        await page.setViewportSize({ width: 375, height: 760 });
        await page.goto(`/einladung.html?token=${token}`);
        await page.fill('#vorname', 'Rita');
        await page.fill('#nachname', 'Rate');
        await page.fill('#passwort', 'langes-passwort-1');
        await page.getByRole('button', { name: 'Konto anlegen' }).click();
        await expect(page.locator('#formularFehler')).toContainText('Zu viele Versuche');
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
        await db('orga_einladungen').where({ email: `rate.${LAUF}@example.org` }).del();
    });
});
