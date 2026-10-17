// Helferplan aus der Cloud aktualisieren (Helferverwaltung, Spec Abschnitt 8): Turnier aus der Fake-Cloud
// (tests/helpers/fake-cloud.mjs, Turnier 13 mit Helferplan) holen, Stand der Cloud ändern, über den Knopf
// auf helfer-plan.html nur den Helferplan ersetzen. Turnier, Teilnehmer und Pools bleiben unverändert.
import { test, expect } from '@playwright/test';
import { FAKE_CLOUD_URL, FAKE_CLOUD_EMAIL, FAKE_CLOUD_PASSWORT, testDbVerbindung } from './test-env.js';

const CLOUD_TURNIER = 13;

async function setzeCloudStand(request, stand) {
    const r = await request.post(`${FAKE_CLOUD_URL}/test/helferplan-stand`, { data: { stand } });
    expect(r.ok()).toBe(true);
}

async function cloudToken(request) {
    const r = await request.post('/api/cloud/turniere', { data: { email: FAKE_CLOUD_EMAIL, password: FAKE_CLOUD_PASSWORT } });
    expect(r.ok()).toBe(true);
    return (await r.json()).token;
}

function namenJeTaetigkeit(plan) {
    const ergebnis = {};
    for (const t of plan.taetigkeiten) {
        ergebnis[t.bezeichnung] = t.slots.flatMap(s => s.einsaetze.map(e => e.name));
    }
    return ergebnis;
}

async function wettkampfStand(turnierId) {
    const { default: knexLib } = await import('knex');
    const db = knexLib({ client: 'pg', connection: testDbVerbindung });
    try {
        const turnier = await db('turniere').where({ id: turnierId }).first('bezeichnung', 'datum', 'beginn_min', 'ende_min', 'waagen_anzahl', 'updated_at');
        const pools = await db('pools').where({ turnier_id: turnierId }).orderBy('id').select('id', 'bezeichnung', 'kampfflaeche_id');
        const teilnehmer = await db('turnier_teilnehmer').where({ turnier_id: turnierId }).orderBy('id').select('id', 'vorname', 'nachname', 'pool_id');
        const kampfflaechen = await db('kampfflaechen').where({ turnier_id: turnierId }).orderBy('id').select('id', 'bezeichnung');
        return { turnier, pools, teilnehmer, kampfflaechen };
    } finally {
        await db.destroy();
    }
}

test.describe.serial('Helferplan aus der Cloud aktualisieren', () => {
    let turnierId;

    test.beforeAll(async ({ request }) => {
        await setzeCloudStand(request, 1);
    });

    test.afterAll(async ({ request }) => {
        await setzeCloudStand(request, 1);
    });

    test('ohne lokales Turnier zum Cloud-Turnier: 404, ohne Token: 400', async ({ request }) => {
        const token = await cloudToken(request);
        const ohneLokal = await request.post('/api/cloud/turniere/999/helferplan', { data: { token } });
        expect(ohneLokal.status()).toBe(404);
        expect((await ohneLokal.json()).error).toMatch(/kein Turnier/i);

        const ohneToken = await request.post(`/api/cloud/turniere/${CLOUD_TURNIER}/helferplan`, { data: {} });
        expect(ohneToken.status()).toBe(400);
    });

    test('Holen übernimmt Helferplan, Turnierzeit und Waagenanzahl', async ({ request }) => {
        const token = await cloudToken(request);
        const r = await request.post(`/api/cloud/turniere/${CLOUD_TURNIER}/holen`, { data: { token } });
        expect(r.status()).toBe(201);
        turnierId = (await r.json()).turnierId;

        const stand = await wettkampfStand(turnierId);
        expect(stand.turnier.beginn_min).toBe(540);
        expect(stand.turnier.ende_min).toBe(1020);
        expect(stand.turnier.waagen_anzahl).toBe(1);

        const plan = await (await request.get(`/api/helfer-plan/${turnierId}`)).json();
        const namen = namenJeTaetigkeit(plan);
        expect(namen['Kampfgericht Matte 2']).toEqual(['Anna Alt']);
        expect(namen['Kuchenverkauf']).toEqual(['Bernd Alt']);
    });

    test('Knopf ersetzt nur den Helferplan durch den neuen Stand der Cloud', async ({ page, request }) => {
        const vorher = await wettkampfStand(turnierId);
        await setzeCloudStand(request, 2);

        await page.goto(`/helfer-plan.html?turnierId=${turnierId}`);
        await expect(page.locator('.hp-zeile', { hasText: 'Kuchenverkauf' })).toBeVisible();

        const knopf = page.locator('#hpCloudAktualisieren');
        await expect(knopf).toBeVisible();
        await knopf.click();

        // falsches Passwort: Meldung im Dialog, nichts ersetzt
        await page.fill('#hpCloudEmail', FAKE_CLOUD_EMAIL);
        await page.fill('#hpCloudPasswort', 'falsch');
        await page.click('#hpCloudOk');
        await expect(page.locator('#hpCloudFehler')).toContainText('Ungültige Anmeldedaten');
        await expect(page.locator('.hp-zeile', { hasText: 'Kuchenverkauf' })).toBeVisible();

        await page.fill('#hpCloudPasswort', FAKE_CLOUD_PASSWORT);
        await page.click('#hpCloudOk');
        await expect(page.locator('#hpCloudModal')).toBeHidden();
        await expect(page.locator('.hp-zeile', { hasText: 'Parkplatz' })).toBeVisible();
        await expect(page.locator('.hp-zeile', { hasText: 'Kuchenverkauf' })).toHaveCount(0);

        const plan = await (await request.get(`/api/helfer-plan/${turnierId}`)).json();
        const namen = namenJeTaetigkeit(plan);
        expect(namen['Kampfgericht Matte 2']).toEqual(['Clara Neu']);
        expect(namen['Parkplatz']).toEqual(['Dieter Neu']);
        expect(JSON.stringify(plan)).not.toContain('Anna Alt');

        const nachher = await wettkampfStand(turnierId);
        expect(nachher).toEqual(vorher);
        expect(nachher.teilnehmer).toHaveLength(1);
        expect(nachher.pools).toHaveLength(1);
    });
});
