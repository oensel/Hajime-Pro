// End-to-End: In steuerung.html ist START nach einem Ippon ausgegraut und wieder bedienbar, sobald der Ippon
// zurückgenommen wird. "RESET ALL" sitzt ganz rechts in der Meta-Leiste (neben Klasse und Gewicht) der eingebetteten Anzeige.
import { test, expect } from '@playwright/test';
import { schliesseOverlayAutomatisch } from './helpers/pool-beginn-overlay.js';

const TEILNEHMER = ['Anna', 'Berta', 'Clara'];

async function richteTurnierEin(request) {
    const turnierResp = await request.post('/api/turniere', {
        data: { bezeichnung: 'Ippon-Sperre', ort: 'Teststadt', datum: '2027-06-12', ausrichter: 'JC Test', anzahl_kampfflaechen: 1 }
    });
    expect(turnierResp.ok(), await turnierResp.text()).toBeTruthy();
    const { turnierId } = await turnierResp.json();
    const [{ id: matId }] = await (await request.get(`/api/kampfflaechen?turnierId=${turnierId}`)).json();
    const { poolId } = await (await request.post('/api/pools', {
        data: { turnier_id: turnierId, bezeichnung: 'Ippon Pool', altersklasse: 'U18', geschlecht: 'männlich', gewichtsklasse: '-73kg' }
    })).json();
    const ids = [];
    for (const vorname of TEILNEHMER) {
        const t = await request.post('/api/teilnehmer', {
            data: {
                turnier_id: turnierId, vorname, nachname: `${vorname}x`, verein: `JC ${vorname}`,
                geburtsjahr: 2009, geschlecht: 'männlich', gewicht: 70, altersklasse: 'U18', gewichtsklasse: '-73kg'
            }
        });
        ids.push((await t.json()).teilnehmerId);
    }
    for (const teilnehmerId of ids) expect((await request.post('/api/pools/verschieben', { data: { teilnehmerId, zielPoolId: poolId } })).ok()).toBeTruthy();
    expect((await request.put('/api/pools/kampfflaeche-zuordnen', { data: { poolId, kampflaecheId: matId, position: 1 } })).ok()).toBeTruthy();
    return { turnierId, matId };
}

test('Ippon graut START aus, Zurücknehmen schaltet es wieder frei; RESET ALL sitzt in der Meta-Leiste', async ({ page, request }) => {
    const { turnierId, matId } = await richteTurnierEin(request);
    await schliesseOverlayAutomatisch(page);
    await page.goto(`/steuerung.html?turnierId=${turnierId}&matId=${matId}`);
    await expect(page.locator('#matSelect')).toHaveValue(String(matId));

    // RESET ALL gibt es nicht mehr in der Bedienleiste, sondern in der Meta-Leiste der Anzeige (ganz rechts)
    await expect(page.locator('#btnResetLive')).toHaveCount(0);
    const anzeige = page.frameLocator('iframe[title="Live-Vorschau Anzeigetafel"]');
    const resetAll = anzeige.locator('.top-meta-bar #iframeBtnResetAll');
    await expect(resetAll).toBeVisible();
    const meta = await anzeige.locator('#outMeta').boundingBox();
    const reset = await resetAll.boundingBox();
    expect(reset.x).toBeGreaterThan(meta.x + meta.width);

    await page.locator('#btnNaechsterKampfLive').click();
    await expect(page.locator('#nameW')).not.toHaveValue('Kämpfer 1');
    const start = page.locator('#btnStartStopLive');
    await expect(start).toBeEnabled();

    await page.evaluate(() => window.changeScore('W', 'ippon', 1));
    await expect(start).toBeDisabled();
    await page.evaluate(() => window.changeScore('W', 'ippon', -1));
    await expect(start).toBeEnabled();

    await page.evaluate(() => window.changeScore('B', 'ippon', 1));
    await expect(start).toBeDisabled();
    await page.keyboard.press('w'); // Tastenkürzel für START/STOPP darf die Zeit ebenfalls nicht starten
    await expect(start).toHaveText('START');
    await page.evaluate(() => window.changeScore('B', 'ippon', -1));
    await expect(start).toBeEnabled();
});
