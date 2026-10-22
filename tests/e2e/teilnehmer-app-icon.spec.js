// End-to-End: Kopfleisten-Icon und Dialog der Teilnehmer-App (docs/specs/2026-10-22-teilnehmer-app-schalter-design.md).
import { test, expect } from '@playwright/test';
import knexLib from 'knex';
import { FAKE_CLOUD_URL, FAKE_CLOUD_EMAIL, FAKE_CLOUD_PASSWORT, testDbVerbindung } from './test-env.js';

test.describe.configure({ mode: 'serial' });

const FARBEN = { grau: 'rgb(158, 158, 158)', gruen: 'rgb(46, 125, 50)', gelb: 'rgb(249, 168, 37)', rot: 'rgb(198, 40, 40)' };
let turnierId;

async function mitDb(fn) {
    const db = knexLib({ client: 'pg', connection: testDbVerbindung });
    try {
        return await fn(db);
    } finally {
        await db.destroy();
    }
}

function luminanz(farbe) {
    const [r, g, b] = farbe.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number).map(v => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const kontrast = (a, b) => {
    const [hell, dunkel] = [luminanz(a), luminanz(b)].sort((x, y) => y - x);
    return (hell + 0.05) / (dunkel + 0.05);
};

const iconFarbe = (page) => page.locator('#teilnehmerAppBtn .material-icons').evaluate(e => getComputedStyle(e).color);

test.beforeAll(async ({ request }) => {
    await request.post(`${FAKE_CLOUD_URL}/test/modus`, { data: { ingest: 'ok', erreichbar: true } });
    const { token } = await (await request.post('/api/cloud/turniere', { data: { email: FAKE_CLOUD_EMAIL, password: FAKE_CLOUD_PASSWORT } })).json();
    const geholt = await request.post('/api/cloud/turniere/12/holen', { data: { token } });
    turnierId = (await geholt.json()).turnierId;
    await mitDb(async (db) => {
        const [{ id: matte }] = await db('kampfflaechen').insert({ turnier_id: turnierId, bezeichnung: 'Matte 1' }).returning('id');
        await db('pools').insert({
            turnier_id: turnierId, bezeichnung: 'U15 m -50', altersklasse: 'U15', geschlecht: 'm', gewichtsklasse: '-50', kampfflaeche_id: matte
        });
    });
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
    await request.post(`${FAKE_CLOUD_URL}/test/modus`, { data: { ingest: 'ok', erreichbar: true } });
    await raeumeAuf([turnierId]);
});

test('Icon ist grau, der Dialog zeigt die Texte und Einschalten braucht eine Bestätigung', async ({ page }) => {
    await page.goto(`/matten.html?turnierId=${turnierId}`);
    const knopf = page.locator('#teilnehmerAppBtn');
    await expect(knopf).toBeVisible();
    await expect.poll(() => iconFarbe(page)).toBe(FARBEN.grau);
    await expect(knopf).toHaveAttribute('title', 'Teilnehmer-App ausgeschaltet');

    await knopf.click();
    const dialog = page.locator('#teilnehmerAppDialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Teilnehmer-App');
    await expect(dialog).toContainText('Daten an die Teilnehmer-App senden');
    await expect(dialog).toContainText('Braucht eine Internetverbindung an diesem Rechner (z. B. USB-Tethering). Die Verbindung wird regelmäßig geprüft.');
    await expect(page.locator('#taWarnung')).toBeHidden();

    await page.locator('#taSchalter').check();
    await expect(page.locator('#taWarnung')).toBeVisible();
    await expect(page.locator('#taWarnung')).toHaveText('Beim Einschalten werden Namen, Vereine und Paarungen der Teilnehmer in die Cloud gesendet.');
    // Noch nicht eingeschaltet: ohne Bestätigung bleibt das Icon grau.
    expect((await (await page.request.get(`/api/live-app/status?turnierId=${turnierId}`)).json()).aktiv).toBe(false);
    await page.getByRole('button', { name: 'Einschalten' }).click();
    await expect.poll(() => iconFarbe(page), { timeout: 15000 }).toBe(FARBEN.gruen);
});

test('Icon wird gelb bei abgelehntem Senden, rot ohne Cloud und wieder grün', async ({ page, request }) => {
    await page.goto(`/matten.html?turnierId=${turnierId}`);
    await expect.poll(() => iconFarbe(page), { timeout: 15000 }).toBe(FARBEN.gruen);

    await request.post(`${FAKE_CLOUD_URL}/test/modus`, { data: { ingest: 'fehler' } });
    await mitDb(db => db('pools').where({ turnier_id: turnierId }).update({ bezeichnung: 'U15 m -50 gelb' }));
    await expect.poll(() => iconFarbe(page), { timeout: 20000 }).toBe(FARBEN.gelb);
    await expect(page.locator('#teilnehmerAppBtn')).toHaveAttribute('title', 'Cloud erreichbar, aber es können keine Daten gesendet werden');

    await request.post(`${FAKE_CLOUD_URL}/test/modus`, { data: { erreichbar: false } });
    await expect.poll(() => iconFarbe(page), { timeout: 20000 }).toBe(FARBEN.rot);

    await request.post(`${FAKE_CLOUD_URL}/test/modus`, { data: { ingest: 'ok', erreichbar: true } });
    await expect.poll(() => iconFarbe(page), { timeout: 45000 }).toBe(FARBEN.gruen);
});

test('Der Dialog ist im hellen und im dunklen Theme lesbar', async ({ page }) => {
    for (const theme of ['light', 'dark']) {
        await page.addInitScript((t) => { try { localStorage.setItem('hajime-theme', t); } catch { /* egal */ } }, theme);
        await page.goto(`/matten.html?turnierId=${turnierId}`);
        await page.locator('#teilnehmerAppBtn').click();
        await expect(page.locator('#teilnehmerAppDialog')).toBeVisible();
        const farben = await page.locator('#teilnehmerAppDialog .ta-dialog').evaluate((box) => {
            const hinten = getComputedStyle(box).backgroundColor;
            const vorn = (sel) => getComputedStyle(box.querySelector(sel)).color;
            return { hinten, titel: vorn('h3'), hinweis: vorn('.ta-hinweis'), schalter: vorn('.ta-schalter') };
        });
        expect(farben.hinten).not.toBe('rgba(0, 0, 0, 0)');
        for (const wert of [farben.titel, farben.hinweis, farben.schalter]) {
            expect(kontrast(wert, farben.hinten), `${theme}: ${wert} auf ${farben.hinten}`).toBeGreaterThanOrEqual(4.5);
        }
    }
});

test('Ausschalten im Dialog wirkt sofort; ohne Turnier oder ohne Cloud-Adresse gibt es kein Icon', async ({ page }) => {
    await page.goto(`/matten.html?turnierId=${turnierId}`);
    await page.locator('#teilnehmerAppBtn').click();
    await page.locator('#taSchalter').uncheck();
    await expect.poll(() => iconFarbe(page), { timeout: 15000 }).toBe(FARBEN.grau);

    await page.goto('/turniere.html');
    await page.evaluate(() => { try { localStorage.removeItem('aktiveTurnierId'); } catch { /* egal */ } });
    await page.reload();
    await expect(page.locator('#profileBtn')).toBeVisible();
    await expect(page.locator('#teilnehmerAppBtn')).toBeHidden();

    await page.route('**/api/live-app/status**', route => route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ verfuegbar: false, grund: 'cloud_nicht_konfiguriert', aktiv: false, zustand: 'grau', text: 'x' })
    }));
    await page.goto(`/matten.html?turnierId=${turnierId}`);
    await expect(page.locator('#profileBtn')).toBeVisible();
    await expect(page.locator('#teilnehmerAppBtn')).toBeHidden();
});
