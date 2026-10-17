// End-to-End: Mattenende und Rückstand (nur Information) in matten.html und der Steuerung.
import { test, expect } from '@playwright/test';
import { legeTurnierAn, legeKlasseAn, loseAus } from './helpers/turnier-aufbau.js';
import { schliesseOverlayAutomatisch } from './helpers/pool-beginn-overlay.js';

// Zwei Matten: Matte 1 bekommt den kleinen Pool (3 Kämpfer), Matte 2 den großen (8 Kämpferinnen).
async function baueAuf(request) {
    const turnierId = await legeTurnierAn(request, { name: 'Zeitprognose Rueckstand', anzahlKampfflaechen: 2 });
    await legeKlasseAn(request, turnierId, { altersklasse: 'U18', geschlecht: 'männlich', gewichtsklasse: '-73kg', anzahl: 3, gewichtStart: 66 });
    await legeKlasseAn(request, turnierId, { altersklasse: 'U18', geschlecht: 'weiblich', gewichtsklasse: '-63kg', anzahl: 8, gewichtStart: 56, namenszusatz: 'W' });
    await loseAus(request, turnierId, ['U18']);
    const matten = await (await request.get(`/api/kampfflaechen?turnierId=${turnierId}`)).json();
    const details = await (await request.get(`/api/pools/details?turnierId=${turnierId}`)).json();
    const liste = (Array.isArray(details) ? details : details.pools).filter(p => !p.verspaetet);
    expect(liste.length).toBe(2);
    const nachGroesse = [...liste].sort((a, b) => (a.anzahl_teilnehmer ?? a.teilnehmer?.length ?? 0) - (b.anzahl_teilnehmer ?? b.teilnehmer?.length ?? 0));
    for (const [pool, matte] of [[nachGroesse[0], matten[0]], [nachGroesse[1], matten[1]]]) {
        const r = await request.put('/api/pools/kampfflaeche-zuordnen', { data: { poolId: pool.id, kampflaecheId: matte.id, position: 1 } });
        expect(r.ok(), await r.text()).toBeTruthy();
    }
    return { turnierId, matten };
}

test('API: die Matte mit mehr Kämpfen liegt hinter der kürzeren', async ({ request }) => {
    const { turnierId, matten } = await baueAuf(request);
    const antwort = await (await request.get(`/api/pools/zeitprognose?turnierId=${turnierId}`)).json();
    const nachId = Object.fromEntries(antwort.matten.map(m => [m.id, m]));
    const frueh = nachId[matten[0].id];
    const spaet = nachId[matten[1].id];
    expect(spaet.endeMs).toBeGreaterThan(frueh.endeMs);
    expect(spaet.rueckstand).not.toBeNull();
    expect(spaet.rueckstand.bezugMatteId).toBe(frueh.id);
    expect(frueh.rueckstand).toBeNull();
});

test('matten.html zeigt das Ende je Matte und den Rückstand nur an der späteren Matte', async ({ page, request }) => {
    const { turnierId } = await baueAuf(request);
    await page.goto(`/matten.html?turnierId=${turnierId}`);
    await expect(page.locator('.matte-ende').first()).toContainText(/Ende ca\. \d{2}:\d{2}/, { timeout: 15_000 });
    await expect(page.locator('.matte-rueckstand')).toHaveCount(1);
    await expect(page.locator('.matte-rueckstand')).toContainText(/\+\d+ Min\./);
});

test('Steuerung der späteren Matte nennt Ende und Rückstand', async ({ page, request }) => {
    const { turnierId, matten } = await baueAuf(request);
    await schliesseOverlayAutomatisch(page);
    await page.goto(`/steuerung.html?turnierId=${turnierId}&matId=${matten[1].id}`);
    await expect(page.locator('#verspaetungHinweis')).toContainText('Diese Matte endet', { timeout: 15_000 });
    await expect(page.locator('#verspaetungHinweis')).toContainText(/Min\. nach/);
});
