// End-to-End: Hinweiskasten "Teilnehmer-App verfügbar" auf matten.html (docs/specs/2026-10-22-teilnehmer-app-schalter-design.md).
import { test, expect } from '@playwright/test';
import knexLib from 'knex';
import { FAKE_CLOUD_URL, FAKE_CLOUD_EMAIL, FAKE_CLOUD_PASSWORT, testDbVerbindung } from './test-env.js';

test.describe.configure({ mode: 'serial' });

let turnierId;

async function mitDb(fn) {
    const db = knexLib({ client: 'pg', connection: testDbVerbindung });
    try {
        return await fn(db);
    } finally {
        await db.destroy();
    }
}

async function setzeCloud(request, werte) {
    await request.post(`${FAKE_CLOUD_URL}/test/modus`, { data: werte });
}

const hinweis = (page) => page.locator('#teilnehmerAppHinweis');

async function oeffneMatten(page) {
    await page.goto(`/matten.html?turnierId=${turnierId}`);
    await expect(page.locator('#teilnehmerAppBtn')).toBeVisible();
}

test.beforeAll(async ({ request }) => {
    await setzeCloud(request, { ingest: 'ok', erreichbar: true });
    const { token } = await (await request.post('/api/cloud/turniere', { data: { email: FAKE_CLOUD_EMAIL, password: FAKE_CLOUD_PASSWORT } })).json();
    turnierId = (await (await request.post('/api/cloud/turniere/12/holen', { data: { token } })).json()).turnierId;
});

// Räumt das geholte Turnier samt Matten/Pools auf, damit andere Specs (z. B. turnier-aus-cloud-holen) nicht über Duplikate stolpern.
async function raeumeAuf(ids) {
    await mitDb(async (db) => {
        for (const id of ids.filter(Boolean)) {
            try {
                await db('pools').where({ turnier_id: id }).del();
                await db('kampfflaechen').where({ turnier_id: id }).del();
                await db('turniere').where({ id }).del();
            } catch { /* abhängige Daten: das Turnier bleibt, schadet aber nur der Ordnung */ }
        }
    });
}

test.afterAll(async ({ request }) => {
    await request.post('/api/live-app/schalter', { data: { turnierId, aktiv: false } });
    await setzeCloud(request, { ingest: 'ok', erreichbar: true });
    await raeumeAuf([turnierId]);
});

test('Ohne verteilte Pools erscheint kein Hinweis, nach der Verteilung auf die Matten schon', async ({ page }) => {
    await oeffneMatten(page);
    await expect(page.locator('#mattenContainer')).toBeVisible();
    await expect(hinweis(page)).toBeHidden();

    await mitDb(async (db) => {
        const [{ id: matte }] = await db('kampfflaechen').insert({ turnier_id: turnierId, bezeichnung: 'Matte 1' }).returning('id');
        await db('pools').insert({
            turnier_id: turnierId, bezeichnung: 'U15 m -50', altersklasse: 'U15', geschlecht: 'm', gewichtsklasse: '-50', kampfflaeche_id: matte
        });
    });
    await oeffneMatten(page);
    await expect(hinweis(page)).toBeVisible();
    await expect(hinweis(page)).toContainText('Teilnehmer-App verfügbar');
    await expect(hinweis(page).getByRole('button', { name: 'Aktivieren' })).toBeVisible();
    await expect(hinweis(page).getByRole('button', { name: 'Später' })).toBeVisible();
});

test('Ohne erreichbare Cloud erscheint kein Hinweis', async ({ page, request }) => {
    await setzeCloud(request, { erreichbar: false });
    await expect.poll(async () => (await (await request.get(`/api/live-app/status?turnierId=${turnierId}`)).json()).cloudErreichbar).toBe(false);
    await oeffneMatten(page);
    await expect(hinweis(page)).toBeHidden();
    await setzeCloud(request, { erreichbar: true });
    await expect.poll(async () => (await (await request.get(`/api/live-app/status?turnierId=${turnierId}`)).json()).cloudErreichbar).toBe(true);
});

test('"Später" blendet den Hinweis für dieses Turnier dauerhaft aus', async ({ page }) => {
    await oeffneMatten(page);
    await expect(hinweis(page)).toBeVisible();
    await hinweis(page).getByRole('button', { name: 'Später' }).click();
    await expect(hinweis(page)).toBeHidden();
    expect(await page.evaluate((id) => localStorage.getItem(`teilnehmerAppSpaeter:${id}`), turnierId)).toBeTruthy();
    expect(await page.evaluate(() => localStorage.getItem('teilnehmerAppSpaeter:0'))).toBeNull();
    await oeffneMatten(page);
    await expect(page.locator('#mattenContainer')).toBeVisible();
    await expect(hinweis(page)).toBeHidden();
    await page.evaluate((id) => localStorage.removeItem(`teilnehmerAppSpaeter:${id}`), turnierId);
});

test('"Aktivieren" öffnet den Dialog im Bestätigungsschritt, danach ist der Hinweis weg', async ({ page }) => {
    await oeffneMatten(page);
    await hinweis(page).getByRole('button', { name: 'Aktivieren' }).click();
    await expect(page.locator('#teilnehmerAppDialog')).toBeVisible();
    await expect(page.locator('#taWarnung')).toBeVisible();
    await page.locator('#teilnehmerAppDialog').getByRole('button', { name: 'Einschalten' }).click();
    await expect.poll(async () => (await (await page.request.get(`/api/live-app/status?turnierId=${turnierId}`)).json()).aktiv).toBe(true);
    await page.locator('#taSchliessen').click();
    await oeffneMatten(page);
    await expect(page.locator('#mattenContainer')).toBeVisible();
    await expect(hinweis(page)).toBeHidden();
});

test('Hinweis und Texte sind im dunklen Theme lesbar', async ({ page, request }) => {
    await request.post('/api/live-app/schalter', { data: { turnierId, aktiv: false } });
    await page.addInitScript(() => { try { localStorage.setItem('hajime-theme', 'dark'); } catch { /* egal */ } });
    await oeffneMatten(page);
    await expect(hinweis(page)).toBeVisible();
    const farben = await hinweis(page).evaluate((box) => {
        const frame = (el) => getComputedStyle(el);
        let hinten = frame(box).backgroundColor;
        for (let e = box.parentElement; e && hinten === 'rgba(0, 0, 0, 0)'; e = e.parentElement) hinten = frame(e).backgroundColor;
        return { vorn: frame(box.querySelector('strong')).color, hinten };
    });
    const zahlen = (f) => f.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number);
    const lum = (f) => {
        const [r, g, b] = zahlen(f).map(v => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const [hell, dunkel] = [lum(farben.vorn), lum(farben.hinten)].sort((a, b) => b - a);
    expect((hell + 0.05) / (dunkel + 0.05), `${farben.vorn} auf ${farben.hinten}`).toBeGreaterThanOrEqual(4.5);
});
