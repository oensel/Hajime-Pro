// End-to-End: Töne gibt es in steuerung.html nur beim Ablauf der Kampfzeit und bei Ippon durch Haltegriff (Osaekomi) in der regulären Kampfzeit.
// Hantei-Sieg, Hansoku-make, Aufgabe (3. Behandlung), von Hand vergebene Wertungen und Ippon sowie Osaekomi im Golden Score bleiben still (die Hupe gibt es nicht mehr).
import { test, expect } from '@playwright/test';
import { schliesseOverlayAutomatisch } from './helpers/pool-beginn-overlay.js';

test('Hantei-Sieg, Hansoku-make und Aufgabe erzeugen keinen Ton', async ({ page, request }) => {
    const turnierResp = await request.post('/api/turniere', {
        data: { bezeichnung: 'Hantei ohne Ton', ort: 'Teststadt', datum: '2027-08-14', ausrichter: 'JC Test', anzahl_kampfflaechen: 1 }
    });
    expect(turnierResp.ok(), await turnierResp.text()).toBeTruthy();
    const { turnierId } = await turnierResp.json();
    const [{ id: matId }] = await (await request.get(`/api/kampfflaechen?turnierId=${turnierId}`)).json();

    // Tonausgabe zählen: Web-Audio und Audio-Element (Signalton)
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

    // Auch die übrigen Entscheidungen bleiben still: Hansoku-make (direkt), Aufgabe durch die 3. Behandlung, von Hand vergebener Ippon
    await page.evaluate(() => window.triggerHanteiSieg('W')); // Entscheidung zurücknehmen
    const davor = await page.evaluate(() => window.__toene);
    await page.evaluate(() => window.triggerDirectHansokumake('B'));
    expect(await page.evaluate(() => window.hajimeScoreboardState.overlayMode)).toBe('hansokumake');
    await page.evaluate(() => window.triggerDirectHansokumake('B')); // zurücknehmen
    await page.evaluate(() => { window.changeBehandlung('W', 1); window.changeBehandlung('W', 1); window.changeBehandlung('W', 1); });
    expect(await page.evaluate(() => window.hajimeScoreboardState.overlayMode)).toBe('kiken');
    await page.evaluate(() => { window.changeBehandlung('W', -1); window.changeBehandlung('W', -1); window.changeBehandlung('W', -1); });
    await page.evaluate(() => window.changeScore('B', 'ippon', 1));
    expect(await page.evaluate(() => window.hajimeScoreboardState.overlayMode)).toBe('ippon');
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.__toene)).toBe(davor);
});

test('Osaekomi im Golden Score: das Waza-Ari nach 10 Sekunden entscheidet den Kampf ohne Ton (Regeln der Landesverbände unterscheiden sich)', async ({ page, request }) => {
    const turnierResp = await request.post('/api/turniere', {
        data: { bezeichnung: 'Osaekomi Golden Score Ton', ort: 'Teststadt', datum: '2027-08-15', ausrichter: 'JC Test', anzahl_kampfflaechen: 1 }
    });
    expect(turnierResp.ok(), await turnierResp.text()).toBeTruthy();
    const { turnierId } = await turnierResp.json();
    const [{ id: matId }] = await (await request.get(`/api/kampfflaechen?turnierId=${turnierId}`)).json();

    await page.addInitScript(() => {
        window.__toene = 0;
        const play = HTMLMediaElement.prototype.play;
        HTMLMediaElement.prototype.play = function () { window.__toene++; return play.call(this); };
    });
    await schliesseOverlayAutomatisch(page);
    await page.clock.install();
    await page.goto(`/steuerung.html?turnierId=${turnierId}&matId=${matId}`);
    await expect(page.locator('#matSelect')).toHaveValue(String(matId));

    await page.evaluate(() => { window.hajimeScoreboardState.isGoldenScore = true; window.update(); });
    const vorher = await page.evaluate(() => window.__toene);
    await page.evaluate(() => window.toggleOsae('W'));
    await page.clock.runFor(11_000);
    expect(await page.evaluate(() => window.hajimeScoreboardState.wazaW)).toBe(1);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.__toene)).toBe(vorher);
});
