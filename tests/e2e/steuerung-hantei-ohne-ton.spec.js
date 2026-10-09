// End-to-End: Die Hantei-Entscheidung in steuerung.html löst keinen Ton aus (Signalton gibt es nur beim Ablauf der Kampfzeit, bei
// Ippon durch Haltegriff und bei den übrigen Entscheidungen, nicht beim "Sieger Hantei").
import { test, expect } from '@playwright/test';
import { schliesseOverlayAutomatisch } from './helpers/pool-beginn-overlay.js';

test('Hantei-Sieg erzeugt keinen Ton', async ({ page, request }) => {
    const turnierResp = await request.post('/api/turniere', {
        data: { bezeichnung: 'Hantei ohne Ton', ort: 'Teststadt', datum: '2027-08-14', ausrichter: 'JC Test', anzahl_kampfflaechen: 1 }
    });
    expect(turnierResp.ok(), await turnierResp.text()).toBeTruthy();
    const { turnierId } = await turnierResp.json();
    const [{ id: matId }] = await (await request.get(`/api/kampfflaechen?turnierId=${turnierId}`)).json();

    // Tonausgabe zählen: Web-Audio (Hupe) und Audio-Element (Signalton)
    await page.addInitScript(() => {
        window.__toene = 0;
        const Ctx = window.AudioContext || window.webkitAudioContext;
        window.AudioContext = window.webkitAudioContext = function () { window.__toene++; return new Ctx(); };
        const play = HTMLMediaElement.prototype.play;
        HTMLMediaElement.prototype.play = function () { window.__toene++; return play.call(this); };
    });
    await schliesseOverlayAutomatisch(page);
    await page.goto(`/steuerung.html?turnierId=${turnierId}&matId=${matId}`);
    await expect(page.locator('#matSelect')).toHaveValue(String(matId));

    // Zustand "Zeit abgelaufen, Gleichstand, Entscheidung offen" herstellen und "Sieger Hantei" wählen
    await page.evaluate(() => window.update());
    await page.evaluate(() => { window.hajimeScoreboardState.overlayMode = 'hantei'; });
    const vorher = await page.evaluate(() => window.__toene);
    await page.evaluate(() => window.triggerHanteiSieg('W'));
    expect(await page.evaluate(() => window.hajimeScoreboardState.overlayMode)).toBe('hanteisieg');
    expect(await page.evaluate(() => window.hajimeScoreboardState.hanteiSiegerW)).toBe(true);
    expect(await page.evaluate(() => window.__toene)).toBe(vorher); // kein neuer Ton

    // Gegenprobe: eine andere Entscheidung (Hansoku-make) behält ihren Ton
    await page.evaluate(() => window.triggerHanteiSieg('W')); // Entscheidung zurücknehmen
    const davor = await page.evaluate(() => window.__toene);
    await page.evaluate(() => window.triggerDirectHansokumake('B'));
    await expect.poll(() => page.evaluate(() => window.__toene)).toBeGreaterThan(davor);
});
