// End-to-End: das Dashboard nennt je noch nicht begonnenem Pool (Alters-/Gewichtsklasse) den ungefähren Start.
import { test, expect } from '@playwright/test';
import { legeTurnierAn, legeKlasseAn, loseAus, verteileAufMatten } from './helpers/turnier-aufbau.js';

async function baueAuf(request) {
    const turnierId = await legeTurnierAn(request, { name: 'Zeitprognose Dashboard' });
    await legeKlasseAn(request, turnierId, { altersklasse: 'U18', geschlecht: 'männlich', gewichtsklasse: '-73kg', anzahl: 4, gewichtStart: 66 });
    await legeKlasseAn(request, turnierId, { altersklasse: 'U18', geschlecht: 'weiblich', gewichtsklasse: '-63kg', anzahl: 4, gewichtStart: 56, namenszusatz: 'W' });
    await loseAus(request, turnierId, ['U18']);
    await verteileAufMatten(request, turnierId);
    return turnierId;
}

test('API: noch nicht begonnene Pools tragen start_in_minuten, der hintere Pool später als der vordere', async ({ request }) => {
    const turnierId = await baueAuf(request);
    const daten = await (await request.get(`/api/pools/dashboard?turnierId=${turnierId}`)).json();
    const pools = daten.mats.flatMap(m => m.pools).filter(p => p.start_in_minuten != null);
    expect(pools.length).toBeGreaterThan(0);
    for (const p of pools) expect(p.start_in_minuten).toBeGreaterThanOrEqual(0);
    const jeMatte = daten.mats.map(m => m.pools.map(p => p.start_in_minuten).filter(s => s != null)).find(l => l.length > 1);
    if (jeMatte) expect(jeMatte[1]).toBeGreaterThan(jeMatte[0]);
});

test('Dashboard zeigt "Start in ca. N Min." an der Klasse', async ({ page, request }) => {
    const turnierId = await baueAuf(request);
    await page.goto(`/dashboard.html?turnierId=${turnierId}`);
    await expect(page.locator('.pool-progress-header').filter({ hasText: /Start (in ca\. \d+ Min\.|gleich)/ }).first()).toBeVisible({ timeout: 15_000 });
});
