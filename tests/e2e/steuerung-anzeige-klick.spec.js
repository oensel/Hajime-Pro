// End-to-End: In der Live-Vorschau der Steuerung (iframe anzeige.html?controls=1) wirkt ein Klick auf eine Wertungszahl
// wie das "+", und nicht vergebene Shido-Karten/Behandlungs-Kreuze stehen blass an ihrem Platz und lassen sich anklicken.
// Auf dem Fernseher (anzeige.html ohne controls) bleibt alles wie bisher.
import { test, expect } from '@playwright/test';
import { schliesseOverlayAutomatisch } from './helpers/pool-beginn-overlay.js';

// Bis U15 gibt es zwei freie medizinische Versorgungen (DJB-WKO Art. 3.12.10), daher ein U15-Pool: alle drei Kreuze stehen da.
async function richteKampfEin(request) {
    const turnierResp = await request.post('/api/turniere', {
        data: { bezeichnung: 'Anzeige-Klick', ort: 'Teststadt', datum: '2027-06-12', ausrichter: 'JC Test', anzahl_kampfflaechen: 1 }
    });
    expect(turnierResp.ok(), await turnierResp.text()).toBeTruthy();
    const { turnierId } = await turnierResp.json();
    const [{ id: matId }] = await (await request.get(`/api/kampfflaechen?turnierId=${turnierId}`)).json();
    const { poolId } = await (await request.post('/api/pools', {
        data: { turnier_id: turnierId, bezeichnung: 'Klick Pool', altersklasse: 'U15', geschlecht: 'männlich', gewichtsklasse: '-50kg' }
    })).json();
    const zuordnung = [];
    for (const [i, vorname] of ['Anna', 'Berta'].entries()) {
        const t = await request.post('/api/teilnehmer', {
            data: {
                turnier_id: turnierId, vorname, nachname: `${vorname}x`, verein: `JC ${vorname}`,
                geburtsjahr: 2013, geschlecht: 'männlich', gewicht: 47 + i, altersklasse: 'U15', gewichtsklasse: '-50kg'
            }
        });
        zuordnung.push({ teilnehmerId: (await t.json()).teilnehmerId, zielPoolId: poolId });
    }
    for (const z of zuordnung) expect((await request.post('/api/pools/verschieben', { data: z })).ok()).toBeTruthy();
    const r = await request.put('/api/pools/kampfflaeche-zuordnen', { data: { poolId, kampflaecheId: matId, position: 1 } });
    expect(r.ok(), await r.text()).toBeTruthy();
    return { turnierId, matId };
}

test('Klick auf Zahl, Shido-Karte und Behandlungs-Kreuz wirkt wie die Knöpfe; der Fernseher bleibt unverändert', async ({ page, request, browser }) => {
    const { turnierId, matId } = await richteKampfEin(request);
    await schliesseOverlayAutomatisch(page);
    await page.goto(`/steuerung.html?turnierId=${turnierId}&matId=${matId}`);
    await expect(page.locator('#matSelect')).toHaveValue(String(matId));
    await page.locator('#btnNaechsterKampfLive').click();
    await expect(page.locator('#btnNaechsterKampfLive')).toBeHidden();

    const anzeige = page.frameLocator('iframe[src*="anzeige.html"]');
    // Zahl = "+"; die Weiß-/Blau-Zuordnung hängt an der Seite, daher die Seite W (Panel ".weiss") nehmen
    const yuko = anzeige.locator('.weiss #outYukoW');
    await yuko.click();
    await expect(yuko).toHaveText('1');
    await yuko.click();
    await expect(yuko).toHaveText('2');

    // Blasse Shido-Karte: nicht vergebene Karten sind sichtbar, mit gestricheltem Rahmen und transparenter Farbe
    const karte2 = anzeige.locator('#shidoW_2');
    const rahmen = (el) => getComputedStyle(el).borderTopStyle;
    await expect(karte2).toBeVisible();
    expect(await karte2.evaluate(rahmen)).toBe('dashed');
    await karte2.click(); // setzt Shido bis Karte 2
    await expect(anzeige.locator('#shidoW_1')).toHaveClass(/active/);
    await expect(karte2).toHaveClass(/active/);
    await expect(anzeige.locator('#shidoW_3')).not.toHaveClass(/active/);
    await expect.poll(() => karte2.evaluate(rahmen)).not.toBe('dashed');
    await karte2.click(); // letzte gefüllte Karte: eins zurück
    await expect(karte2).not.toHaveClass(/active/);
    await expect(anzeige.locator('#shidoW_1')).toHaveClass(/active/);

    // Behandlung: gleiches Verhalten, an der bisherigen Stelle
    const kreuz1 = anzeige.locator('#behandlungW_1');
    await expect(kreuz1).toBeVisible();
    await kreuz1.click();
    await expect(kreuz1).toHaveClass(/active/);
    await kreuz1.click();
    await expect(kreuz1).not.toHaveClass(/active/);

    // Drittes (rotes) Kreuz: 3. Behandlung, Kiken-gachi mit Banner; erneuter Klick nimmt sie zurück
    const kreuz3 = anzeige.locator('#behandlungW_3');
    await expect(kreuz3).toBeVisible();
    await kreuz3.click();
    await expect(kreuz3).toHaveClass(/active/);
    await expect(anzeige.locator('#bannerW')).toHaveText('AUFGABE');
    await kreuz3.click();
    await expect(kreuz3).not.toHaveClass(/active/);
    await expect(anzeige.locator('#behandlungW_2')).toHaveClass(/active/);
    await expect(anzeige.locator('#bannerW')).not.toHaveClass(/active/);

    // Fernseher: ohne controls keine Klick-Klasse, nicht vergebene Karten bleiben ausgeblendet
    const tv = await (await browser.newContext()).newPage();
    await tv.goto('/anzeige.html');
    await expect(tv.locator('body')).not.toHaveClass(/mit-steuerung/);
    await expect(tv.locator('#shidoW_1')).toBeHidden();
    await expect(tv.locator('#behandlungW_1')).toBeHidden();
    await tv.context().close();
});
