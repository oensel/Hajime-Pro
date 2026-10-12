// End-to-End: Die Mattenleitung (steuerung.html) erfährt, wenn ein Pool durch einen Nachzügler neu aufgebaut wurde
// (neue Kampf-IDs), und ein geladener, nicht begonnener Kampf dieses Pools wird freigegeben.
import { test, expect } from '@playwright/test';
import { schliesseOverlayAutomatisch } from './helpers/pool-beginn-overlay.js';

async function richteTurnierEin(request) {
    const anlegen = async (turnierId, name, gewicht) => {
        const resp = await request.post('/api/teilnehmer', {
            data: {
                turnier_id: turnierId, vorname: name, nachname: 'Test', verein: 'JC Geaendert',
                geburtsjahr: 2016, geschlecht: 'männlich', gewicht, altersklasse: 'U11', gewichtsklasse: '-30',
                lizenz_ablauf: '2099-12-31', gewogen: true
            }
        });
        expect(resp.ok(), await resp.text()).toBeTruthy();
        return (await resp.json()).teilnehmerId;
    };
    const turnierResp = await request.post('/api/turniere', {
        data: { bezeichnung: `E2E Pool geändert ${Date.now()}`, ort: 'Halle', datum: '2027-06-15', ausrichter: 'JC Geaendert', anzahl_kampfflaechen: 1 }
    });
    const { turnierId } = await turnierResp.json();
    const [{ id: matId }] = await (await request.get(`/api/kampfflaechen?turnierId=${turnierId}`)).json();
    for (const [i, g] of [28, 29, 29.5, 30].entries()) await anlegen(turnierId, `Stamm${i}`, g);
    expect((await request.post('/api/pools/generieren', { data: { turnierId, altersklassen: ['U11'] } })).ok()).toBeTruthy();
    expect((await request.post('/api/pools/aufteilen', { data: { turnierId } })).ok()).toBeTruthy();
    const [pool] = await (await request.get(`/api/pools/details?turnierId=${turnierId}`)).json();
    const einsortieren = async () => {
        const spaet = await anlegen(turnierId, `Spaet${Date.now()}`, 29.2);
        const r = await request.post(`/api/pools/nachzuegler/${spaet}/einsortieren`, { data: { turnierId, poolId: pool.id } });
        expect(r.ok(), await r.text()).toBeTruthy();
    };
    return { turnierId, matId, einsortieren };
}

test('Nachzügler in einen Pool der Matte: Mattenleitung bekommt die Meldung "wurde geändert"', async ({ page, request }) => {
    const { turnierId, matId, einsortieren } = await richteTurnierEin(request);
    await schliesseOverlayAutomatisch(page);
    await page.goto(`/steuerung.html?turnierId=${turnierId}&matId=${matId}`);
    await expect(page.locator('#matSelect')).toHaveValue(String(matId));
    await page.evaluate(() => window.ladeMattenUebersicht()); // Ausgangszustand merken

    await einsortieren();
    await page.evaluate(() => window.ladeMattenUebersicht());
    await expect(page.locator('#centerNotification')).toContainText('wurde geändert', { timeout: 10_000 });
});

test('Geladener, nicht begonnener Kampf des neu aufgebauten Pools wird freigegeben', async ({ page, request }) => {
    const { turnierId, matId, einsortieren } = await richteTurnierEin(request);
    await schliesseOverlayAutomatisch(page);
    await page.goto(`/steuerung.html?turnierId=${turnierId}&matId=${matId}`);
    await expect(page.locator('#matSelect')).toHaveValue(String(matId));

    await page.locator('#btnNaechsterKampfLive').click();
    await expect(page.locator('#nameW')).not.toHaveValue('Kämpfer 1');
    await page.evaluate(() => window.ladeMattenUebersicht());

    await einsortieren();
    await page.evaluate(() => window.ladeMattenUebersicht());
    await expect(page.locator('#centerNotification')).toContainText('verworfen', { timeout: 10_000 });
    // Freigegeben: "Nächsten Kampf holen" erscheint wieder.
    await expect(page.locator('#btnNaechsterKampfLive')).toBeVisible();
});
