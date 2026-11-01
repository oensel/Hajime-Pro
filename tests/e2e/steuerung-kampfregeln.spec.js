// End-to-End: Wertungsregeln der Steuerung nach IJF-Wettkampfregeln (2026) und DJB-Wettkampfordnung, jeweils
// gegen die separat geöffnete Anzeigetafel geprüft. Haltegriff (IJF Art. 7: 5 s Yuko, 10 s Waza-ari, 20 s Ippon),
// Waza-ari-awasete-ippon, Haltegriff über das Ende der Kampfzeit (Art. 8.4), Haltegriff im Golden Score (keine
// automatische Wertung, entscheidet der Kampfrichter), Wertungs-Rangfolge bei Zeitablauf und medizinische
// Versorgung je Altersklasse (DJB-WKO Art. 3.12.10, IJF Art. 20).
// Wie steuerung-anzeige-scoreboard.spec.js: Kämpfe-API per page.route gemockt, Kampfzeit über page.clock.
import { test, expect } from '@playwright/test';
import { schliesseOverlayAutomatisch } from './helpers/pool-beginn-overlay.js';

const TURNIER_ID = 9002;
const MAT_ID = 4;

function baueKampf(overrides = {}) {
    return {
        id: 1,
        status: 'bereit',
        kaempfer1_id: 11,
        kaempfer2_id: 12,
        kaempfer1_vorname: 'Weiss', kaempfer1_nachname: 'Regel', kaempfer1_verein: 'JC Weiss',
        kaempfer2_vorname: 'Blau', kaempfer2_nachname: 'Regel', kaempfer2_verein: 'JC Blau',
        pool_bezeichnung: 'Regeltest',
        pool_altersklasse: 'U18',
        pool_kampfzeit: 240,
        pool_golden_score_aktiv: true,
        pool_golden_score_max_sekunden: null,
        mannschaftskampf_id: null,
        matten_reihenfolge: 1,
        ...overrides
    };
}

// Steuerung und Anzeige in einem frischen Browser-Context öffnen und den Kampf laden.
async function oeffne(browser, kampf) {
    const context = await browser.newContext();
    const kaempfe = [kampf];
    await context.addInitScript(() => {
        window.__dingCount = 0;
        HTMLMediaElement.prototype.play = function () {
            if (String(this.currentSrc || this.src).includes('dingding')) window.__dingCount++;
            return Promise.resolve();
        };
    });
    await context.route('**/api/kampfflaechen*', route => route.fulfill({ json: [{ id: MAT_ID, bezeichnung: 'Regelmatte' }] }));
    await context.route('**/api/kaempfe*', route => route.request().method() === 'GET' ? route.fulfill({ json: kaempfe }) : route.fallback());
    await context.route('**/api/kaempfe/*/color', route => route.fulfill({ json: { success: true } }));
    await context.route('**/api/kaempfe/*', async route => {
        if (route.request().method() !== 'PUT') return route.fallback();
        Object.assign(kampf, route.request().postDataJSON());
        await route.fulfill({ json: { success: true } });
    });

    const steuerung = await context.newPage();
    const anzeige = await context.newPage();
    await schliesseOverlayAutomatisch(steuerung);
    await schliesseOverlayAutomatisch(anzeige);
    await steuerung.clock.install();
    await Promise.all([
        steuerung.goto(`/steuerung.html?turnierId=${TURNIER_ID}&matId=${MAT_ID}`),
        anzeige.goto('/anzeige.html')
    ]);
    await expect(steuerung.locator('#matSelect')).toHaveValue(String(MAT_ID));
    await steuerung.locator('#btnNaechsterKampfLive').click();
    await expect(steuerung.locator('#nameW')).toHaveValue('Regel, Weiss');
    return { context, steuerung, anzeige, kampf };
}

const zustand = (page) => page.evaluate(() => ({ ...window.hajimeScoreboardState }));

async function starte(steuerung) {
    await steuerung.locator('#btnStartStopLive').click();
    await expect(steuerung.locator('#btnStartStopLive')).toHaveText('STOPP');
}

test.describe('Steuerung: Kampfregeln nach IJF und DJB-WKO', () => {
    test('Haltegriff (IJF Art. 7): 5 s Yuko, 10 s Waza-ari, 20 s Ippon mit Signalton', async ({ browser }) => {
        const { context, steuerung, anzeige } = await oeffne(browser, baueKampf());
        await starte(steuerung);
        await steuerung.evaluate(() => window.toggleOsae('W'));

        await steuerung.clock.runFor(5_000);
        await expect(anzeige.locator('#outYukoW')).toHaveText('1');
        await expect(anzeige.locator('#outWazaW')).toHaveText('0');

        await steuerung.clock.runFor(5_000);
        await expect(anzeige.locator('#outWazaW')).toHaveText('1');
        await expect(anzeige.locator('#outYukoW')).toHaveText('0'); // das Yuko des Haltegriffs geht im Waza-ari auf

        await steuerung.clock.runFor(10_000);
        await expect(anzeige.locator('#outIpponW')).toHaveText('1');
        await expect(anzeige.locator('#outWazaW')).toHaveText('0');
        const s = await zustand(steuerung);
        expect(s.overlayMode).toBe('ippon');
        expect(s.osaeRunningW).toBe(false);
        expect(await steuerung.evaluate(() => window.__dingCount)).toBe(1);
        await context.close();
    });

    test('Waza-ari-awasete-ippon: zweites Waza-ari von Hand und Waza-ari plus 10 s Haltegriff ergeben Ippon', async ({ browser }) => {
        const { context, steuerung, anzeige } = await oeffne(browser, baueKampf());
        await starte(steuerung);
        await steuerung.evaluate(() => window.changeScore('B', 'waza', 1));
        await expect(anzeige.locator('#outWazaB')).toHaveText('1');
        await steuerung.evaluate(() => window.changeScore('B', 'waza', 1));
        await expect(anzeige.locator('#outIpponB')).toHaveText('1');
        await expect(anzeige.locator('#outWazaB')).toHaveText('0');
        expect((await zustand(steuerung)).overlayMode).toBe('ippon');
        await context.close();

        const zweiter = await oeffne(browser, baueKampf());
        await starte(zweiter.steuerung);
        await zweiter.steuerung.evaluate(() => window.changeScore('W', 'waza', 1));
        await zweiter.steuerung.evaluate(() => window.toggleOsae('W'));
        await zweiter.steuerung.clock.runFor(10_000);
        await expect(zweiter.anzeige.locator('#outIpponW')).toHaveText('1');
        expect((await zustand(zweiter.steuerung)).overlayMode).toBe('ippon');
        await zweiter.context.close();
    });

    test('Haltegriff über das Ende der Kampfzeit (IJF Art. 8.4): der Kampf läuft bis zum Toketa weiter', async ({ browser }) => {
        const { context, steuerung, anzeige, kampf } = await oeffne(browser, baueKampf({ pool_kampfzeit: 3 }));
        await starte(steuerung);
        await steuerung.clock.runFor(1_000);
        await steuerung.evaluate(() => window.toggleOsae('B'));

        // Kampfzeit abgelaufen, Haltegriff läuft weiter: noch kein Zeit-Overlay, kein Signalton
        await steuerung.clock.runFor(3_000);
        await expect(anzeige.locator('#outTimer')).toHaveText('00:00');
        expect((await zustand(steuerung)).overlayMode).toBe('none');
        expect((await zustand(steuerung)).osaeRunningB).toBe(true);

        // Waza-ari nach 10 s, dann Toketa: jetzt erst endet der Kampf, Blau gewinnt durch die Wertung
        await steuerung.clock.runFor(7_000);
        await expect(anzeige.locator('#outWazaB')).toHaveText('1');
        expect((await zustand(steuerung)).overlayMode).toBe('none');
        await steuerung.evaluate(() => window.toggleOsae('B'));
        expect((await zustand(steuerung)).overlayMode).toBe('time');
        expect(await steuerung.evaluate(() => window.__dingCount)).toBe(1);

        await steuerung.locator('#btnErgebnisSendenLive').click();
        await expect.poll(() => kampf.status).toBe('beendet');
        expect(kampf.sieger_id).toBe(kampf.kaempfer2_id);
        await context.close();
    });

    test('Haltegriff im Golden Score vergibt keine Wertung von selbst, die Wertung des Kampfrichters entscheidet', async ({ browser }) => {
        const { context, steuerung, anzeige } = await oeffne(browser, baueKampf({ pool_kampfzeit: 2 }));
        await starte(steuerung);
        await steuerung.clock.runFor(2_500);
        expect((await zustand(steuerung)).overlayMode).toBe('time');
        // Gleichstand: START aktiviert Golden Score und lässt die Zeit gleich weiterlaufen
        await starte(steuerung);
        await expect(anzeige.locator('#outGsIndicator')).toBeVisible();

        await steuerung.evaluate(() => window.toggleOsae('W'));
        await steuerung.clock.runFor(25_000);
        let s = await zustand(steuerung);
        expect([s.yukoW, s.wazaW, s.ipponW]).toEqual([0, 0, 0]);
        expect(s.overlayMode).toBe('none');
        expect(s.osaeW).toBe(25);
        await expect(anzeige.locator('#outYukoW')).toHaveText('0');

        // Der Kampfrichter sagt die Wertung an: sie beendet den Kampf (erste Wertung im Golden Score)
        await steuerung.evaluate(() => window.changeScore('W', 'yuko', 1));
        s = await zustand(steuerung);
        expect(s.overlayMode).toBe('goldenscoresieg');
        expect(s.osaeRunningW).toBe(false);
        await expect(anzeige.locator('#outYukoW')).toHaveText('1');
        await context.close();
    });

    test('Zeitablauf: Waza-ari schlägt beliebig viele Yuko, Shido entscheidet nicht', async ({ browser }) => {
        const { context, steuerung, kampf } = await oeffne(browser, baueKampf({ pool_kampfzeit: 2 }));
        await starte(steuerung);
        await steuerung.evaluate(() => {
            window.changeScore('W', 'yuko', 1); window.changeScore('W', 'yuko', 1); window.changeScore('W', 'yuko', 1);
            window.changeScore('B', 'waza', 1);
            window.changeShido('B', 1); window.changeShido('B', 1);
        });
        await steuerung.clock.runFor(2_500);
        expect((await zustand(steuerung)).overlayMode).toBe('time');
        await steuerung.locator('#btnErgebnisSendenLive').click();
        await expect.poll(() => kampf.status).toBe('beendet');
        expect(kampf.sieger_id).toBe(kampf.kaempfer2_id);
        await context.close();
    });

    test('Medizinische Versorgung ab U18 (IJF Art. 20): nur das rote Kreuz, der erste Arztruf ist Kiken-gachi', async ({ browser }) => {
        const { context, steuerung, anzeige, kampf } = await oeffne(browser, baueKampf({ pool_altersklasse: 'U18' }));
        await expect(anzeige.locator('#behandlungW_1')).toHaveCSS('display', 'none');
        await expect(anzeige.locator('#behandlungW_2')).toHaveCSS('display', 'none');
        // In der Vorschau der Steuerung bleibt nur das rote Kreuz anklickbar
        const vorschau = steuerung.frameLocator('iframe[title="Live-Vorschau Anzeigetafel"]');
        await expect(vorschau.locator('#behandlungW_1')).toHaveCSS('display', 'none');
        await expect(vorschau.locator('#behandlungW_3')).toBeVisible();

        await starte(steuerung);
        await vorschau.locator('#behandlungW_3').click();
        await expect(anzeige.locator('#bannerW')).toHaveText('AUFGABE');
        await expect(anzeige.locator('#behandlungW_3')).toHaveClass(/active/);
        expect((await zustand(steuerung)).overlayMode).toBe('kiken');

        // Zurücknehmen: ein Klick auf das gesetzte Kreuz hebt die Aufgabe wieder auf
        await vorschau.locator('#behandlungW_3').click();
        expect((await zustand(steuerung)).behandlungW).toBe(0);
        expect((await zustand(steuerung)).overlayMode).toBe('none');

        await steuerung.evaluate(() => window.changeBehandlung('W', 1));
        await steuerung.locator('#btnErgebnisSendenLive').click();
        await expect.poll(() => kampf.status).toBe('beendet');
        expect(kampf.sieger_id).toBe(kampf.kaempfer2_id);
        await context.close();
    });

    test('Medizinische Versorgung bis U15 (DJB-WKO Art. 3.12.10): zwei Untersuchungen frei, die dritte ist Kiken-gachi', async ({ browser }) => {
        const { context, steuerung, anzeige } = await oeffne(browser, baueKampf({ pool_altersklasse: 'U15' }));
        await starte(steuerung);
        await steuerung.evaluate(() => { window.changeBehandlung('B', 1); window.changeBehandlung('B', 1); });
        await expect(anzeige.locator('#behandlungB_2')).toHaveClass(/active/);
        await expect(anzeige.locator('#behandlungB_2')).toBeVisible();
        expect((await zustand(steuerung)).overlayMode).toBe('none');

        await steuerung.evaluate(() => window.changeBehandlung('B', 1));
        await expect(anzeige.locator('#bannerB')).toHaveText('AUFGABE');
        expect((await zustand(steuerung)).overlayMode).toBe('kiken');
        await context.close();
    });
});
