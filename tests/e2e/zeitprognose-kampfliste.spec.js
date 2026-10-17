// End-to-End: Listen kommender Kämpfe zeigen die voraussichtliche Uhrzeit ("ca. HH:MM"), steigend entlang der Matte.
import { test, expect } from '@playwright/test';
import { legeTurnierAn, legeKlasseAn, loseAus, verteileAufMatten, holeKaempfeDerMatte } from './helpers/turnier-aufbau.js';
import { schliesseOverlayAutomatisch } from './helpers/pool-beginn-overlay.js';

async function baueAuf(request) {
    const turnierId = await legeTurnierAn(request, { name: 'Zeitprognose Liste' });
    await legeKlasseAn(request, turnierId, { altersklasse: 'U18', geschlecht: 'männlich', gewichtsklasse: '-73kg', anzahl: 4, gewichtStart: 66 });
    await loseAus(request, turnierId, ['U18']);
    await verteileAufMatten(request, turnierId);
    const [{ id: matId }] = await (await request.get(`/api/kampfflaechen?turnierId=${turnierId}`)).json();
    return { turnierId, matId };
}

test('Mattenansicht liefert steigende voraussichtlich_um je offenem Kampf', async ({ request }) => {
    const { matId } = await baueAuf(request);
    const kaempfe = (await holeKaempfeDerMatte(request, matId)).filter(k => k.status === 'bereit');
    expect(kaempfe.length).toBeGreaterThan(2);
    const zeiten = kaempfe.map(k => k.voraussichtlich_um);
    zeiten.forEach(z => expect(typeof z).toBe('number'));
    for (let i = 1; i < zeiten.length; i++) expect(zeiten[i]).toBeGreaterThan(zeiten[i - 1]);
});

test('Steuerung zeigt "ca. HH:MM" an jedem kommenden Kampf', async ({ page, request }) => {
    const { turnierId, matId } = await baueAuf(request);
    await schliesseOverlayAutomatisch(page);
    await page.goto(`/steuerung.html?turnierId=${turnierId}&matId=${matId}`);
    const zeiten = page.locator('#steuerungUpcomingList .st-k-zeit');
    await expect(zeiten.first()).toHaveText(/^ca\. \d{2}:\d{2}$/, { timeout: 15_000 });
    expect(await zeiten.count()).toBeGreaterThan(2);
});

test('Kampfansicht zeigt "ca. HH:MM" in der Warteliste', async ({ page, request }) => {
    const { turnierId, matId } = await baueAuf(request);
    await page.goto(`/kampf.html?turnierId=${turnierId}`);
    await page.locator('#mattenSelect').selectOption(String(matId));
    await expect(page.locator('#upcomingFightsList .fight-row-zeit').first()).toHaveText(/^ca\. \d{2}:\d{2}$/, { timeout: 15_000 });
});
