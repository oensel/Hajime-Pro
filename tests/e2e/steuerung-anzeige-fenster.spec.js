// End-to-End: „Anzeige auf TV“ in der Steuerung öffnet die Anzeigetafel als eigenes Fenster (im Desktop-Client platziert der
// Hauptprozess es auf dem zweiten Bildschirm, siehe desktop/anzeigeFenster.js) und das Fenster zeigt dieselben Daten wie die Steuerung.
import { test, expect } from '@playwright/test';
import { schliesseOverlayAutomatisch } from './helpers/pool-beginn-overlay.js';

test('Anzeige auf TV öffnet anzeige.html als eigenes Fenster im Fernseher-Modus', async ({ page, request }) => {
    const turnierResp = await request.post('/api/turniere', {
        data: { bezeichnung: 'Anzeige-Fenster', ort: 'Teststadt', datum: '2027-08-14', ausrichter: 'JC Test', anzahl_kampfflaechen: 1 }
    });
    expect(turnierResp.ok(), await turnierResp.text()).toBeTruthy();
    const { turnierId } = await turnierResp.json();
    const [{ id: matId }] = await (await request.get(`/api/kampfflaechen?turnierId=${turnierId}`)).json();

    await schliesseOverlayAutomatisch(page);
    await page.goto(`/steuerung.html?turnierId=${turnierId}&matId=${matId}`);
    await expect(page.locator('#matSelect')).toHaveValue(String(matId));

    const [fenster] = await Promise.all([
        page.waitForEvent('popup'),
        page.locator('#btnAnzeigeFenster').click()
    ]);
    await fenster.waitForLoadState('domcontentloaded');
    expect(new URL(fenster.url()).pathname).toBe('/anzeige.html');
    // Eigenes Top-Level-Fenster: Fernseher-Modus (nicht die eingebettete Vorschau der Steuerung)
    await expect(fenster.locator('body')).toHaveClass(/anzeige-tv/);

    // Ein zweiter Klick bringt dasselbe Fenster nach vorn, es entsteht kein weiteres
    const seiten = page.context().pages().length;
    await page.locator('#btnAnzeigeFenster').click();
    await page.waitForTimeout(300);
    expect(page.context().pages().length).toBe(seiten);
});
