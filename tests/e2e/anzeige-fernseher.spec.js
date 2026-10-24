// End-to-End: Die Anzeigetafel am Fernseher (anzeige.html als eigenes Fenster, Klasse .anzeige-tv) zeigt große Namen, kürzt zu lange
// Namen auf "Nachname, V.", blendet IPPON als Overlay und Osaekomi im Zeitbalken ein. Die eingebettete Live-Vorschau der Steuerung
// (anzeige.html?controls=1 im iframe) behält dagegen ihr bisheriges Layout, weil ihre Bedienknöpfe daran verankert sind.
// Die Backend-Daten sind wie in steuerung-anzeige-scoreboard.spec.js gemockt (die Steuerung spricht nur mit der Kämpfe-API).
import { test, expect } from '@playwright/test';
import { schliesseOverlayAutomatisch } from './helpers/pool-beginn-overlay.js';

const TURNIER_ID = 9002;
const MAT_ID = 4;

function baueKampf(id, overrides = {}) {
    return {
        id,
        status: 'bereit',
        kaempfer1_id: id * 10 + 1,
        kaempfer2_id: id * 10 + 2,
        kaempfer1_vorname: 'Mia',
        kaempfer1_nachname: 'Schneider',
        kaempfer1_verein: 'JC Musterstadt',
        kaempfer2_vorname: 'Lena',
        kaempfer2_nachname: 'Fuchs',
        kaempfer2_verein: 'DJK Beispielort',
        pool_bezeichnung: 'U15 weiblich -44kg',
        pool_kampfzeit: 240,
        pool_golden_score_aktiv: false,
        pool_golden_score_max_sekunden: 0,
        mannschaftskampf_id: null,
        matten_reihenfolge: id,
        ...overrides
    };
}

test.describe.serial('Anzeigetafel am Fernseher (anzeige.html) gegenüber der Live-Vorschau der Steuerung', () => {
    let steuerungPage;
    let anzeigePage;
    let kaempfeDB;

    test.beforeAll(async ({ browser }) => {
        const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
        kaempfeDB = [];

        await context.route('**/api/kampfflaechen*', route => route.fulfill({ json: [{ id: MAT_ID, bezeichnung: 'Matte 4' }] }));
        await context.route('**/api/kaempfe*', async route => {
            if (route.request().method() !== 'GET') { await route.fallback(); return; }
            await route.fulfill({ json: kaempfeDB });
        });
        await context.route('**/api/kaempfe/*/color', route => route.fulfill({ json: { success: true } }));
        await context.route('**/api/kaempfe/*', async route => {
            if (route.request().method() !== 'PUT') { await route.fallback(); return; }
            const id = Number(new URL(route.request().url()).pathname.split('/').pop());
            const kampf = kaempfeDB.find(k => k.id === id);
            if (kampf) Object.assign(kampf, route.request().postDataJSON());
            await route.fulfill({ json: { success: true } });
        });

        steuerungPage = await context.newPage();
        await schliesseOverlayAutomatisch(steuerungPage);
        anzeigePage = await context.newPage();
        await schliesseOverlayAutomatisch(anzeigePage);
        await steuerungPage.clock.install();
        await Promise.all([
            steuerungPage.goto(`/steuerung.html?turnierId=${TURNIER_ID}&matId=${MAT_ID}`),
            anzeigePage.goto('/anzeige.html')
        ]);
    });

    test.afterAll(async () => {
        await steuerungPage.context().close();
    });

    // Passt der Text eines Elements in seine Breite (nicht abgeschnitten)?
    const passt = (page, selector) => page.locator(selector).evaluate(el => el.scrollWidth <= el.clientWidth + 1);

    test('Kurze Namen bleiben vollständig, große Schrift; die Vorschau der Steuerung trägt die Fernseher-Klasse nicht', async () => {
        kaempfeDB.push(baueKampf(1));
        await steuerungPage.locator('#btnNaechsterKampfLive').click();

        await expect(anzeigePage.locator('body')).toHaveClass(/anzeige-tv/);
        await expect(anzeigePage.locator('#outNameW')).toHaveText('Schneider, Mia');
        await expect(anzeigePage.locator('#outNameB')).toHaveText('Fuchs, Lena');
        expect(await passt(anzeigePage, '#outNameW')).toBe(true);

        // Fernseher: Name 10,5 % der Bildschirmhöhe (vorher 6 %) und Karte deutlich größer als bisher (7 % der Höhe)
        const nameSchrift = await anzeigePage.locator('#outNameW').evaluate(el => parseFloat(getComputedStyle(el).fontSize));
        expect(nameSchrift).toBeGreaterThan(1080 * 0.09);
        await steuerungPage.evaluate(() => window.changeShido('W', 1));
        await expect(anzeigePage.locator('#shidoW_1')).toBeVisible();
        const karte = await anzeigePage.locator('#shidoW_1').boundingBox();
        expect(karte.height).toBeGreaterThan(1080 * 0.12);
        await steuerungPage.evaluate(() => window.changeShido('W', -1));

        // Vorschau in der Steuerung: eigenes Layout (Klasse fehlt), Namen wie bisher
        const vorschau = steuerungPage.frames().find(f => f.url().includes('anzeige.html'));
        expect(vorschau).toBeTruthy();
        await expect(vorschau.locator('body')).not.toHaveClass(/anzeige-tv/);
        const vorschauSchrift = await vorschau.locator('#outNameW').evaluate(el => parseFloat(getComputedStyle(el).fontSize));
        expect(vorschauSchrift).toBeLessThan(nameSchrift);
    });

    test('Zu lange Namen werden auf "Nachname, V." gekürzt und passen in die Breite; Vereine werden verkleinert', async () => {
        kaempfeDB.length = 0;
        kaempfeDB.push(baueKampf(2, {
            kaempfer1_vorname: 'Patrick', kaempfer1_nachname: 'Lückmann', kaempfer1_verein: 'JC Musterstadt',
            kaempfer2_vorname: 'Fabien', kaempfer2_nachname: 'Diederichs-Späh',
            kaempfer2_verein: 'Judo-Club Sportfreunde Musterstadt-Neustadt e. V. Abteilung Wettkampf'
        }));
        await steuerungPage.locator('#btnNaechsterKampfLive').click();

        await expect(anzeigePage.locator('#outNameW')).toHaveText('Lückmann, P.');
        await expect(anzeigePage.locator('#outNameB')).toHaveText('Diederichs-Späh, F.');
        expect(await passt(anzeigePage, '#outNameW')).toBe(true);
        expect(await passt(anzeigePage, '#outNameB')).toBe(true);

        // Der lange Vereinsname bleibt vollständig und wird kleiner gesetzt, statt mit "…" abgeschnitten zu werden
        await expect(anzeigePage.locator('#outClubB')).toHaveText('Judo-Club Sportfreunde Musterstadt-Neustadt e. V. Abteilung Wettkampf');
        expect(await passt(anzeigePage, '#outClubB')).toBe(true);
        const vereinSchrift = await anzeigePage.locator('#outClubB').evaluate(el => parseFloat(getComputedStyle(el).fontSize));
        const normaleSchrift = await anzeigePage.locator('#outClubW').evaluate(el => parseFloat(getComputedStyle(el).fontSize));
        expect(vereinSchrift).toBeLessThan(normaleSchrift);

        // Die Vorschau der Steuerung zeigt weiter die vollen Namen
        const vorschau = steuerungPage.frames().find(f => f.url().includes('anzeige.html'));
        await expect(vorschau.locator('#outNameW')).toHaveText('Lückmann, Patrick');
        await expect(vorschau.locator('#outNameB')).toHaveText('Diederichs-Späh, Fabien');
    });

    test('Osaekomi steht am Fernseher im Zeitbalken auf der Seite des Haltenden', async () => {
        kaempfeDB.length = 0;
        kaempfeDB.push(baueKampf(3));
        await steuerungPage.locator('#btnNaechsterKampfLive').click();
        await expect(anzeigePage.locator('#outNameW')).toHaveText('Schneider, Mia');

        await steuerungPage.locator('#btnStartStopLive').click();
        await steuerungPage.evaluate(() => window.toggleOsae('W'));
        await steuerungPage.clock.runFor(5000);

        const osae = anzeigePage.locator('#outOsaeW');
        await expect(osae).toBeVisible();
        await expect(osae).toContainText('05');
        const balken = await anzeigePage.locator('.timer-bar').boundingBox();
        const feld = await osae.boundingBox();
        expect(feld.y).toBeGreaterThanOrEqual(balken.y - 1);
        expect(feld.y + feld.height).toBeLessThanOrEqual(balken.y + balken.height + 1);
        // Weiß steht rechts: das Feld liegt in der rechten Bildschirmhälfte
        expect(feld.x).toBeGreaterThan(1920 / 2);

        // Blau/Rot (Kämpfer 2) hält: links
        await steuerungPage.evaluate(() => { window.toggleOsae('W'); window.toggleOsae('B'); });
        await steuerungPage.clock.runFor(3000);
        const feldB = await anzeigePage.locator('#outOsaeB').boundingBox();
        expect(feldB.x + feldB.width).toBeLessThan(1920 / 2);
    });

    test('IPPON: Overlay am Fernseher, Banner in der Vorschau; "Nicht angetreten" kurz am Fernseher, voll in der Vorschau', async () => {
        await steuerungPage.evaluate(() => window.changeScore('W', 'ippon', 1));
        await expect(anzeigePage.locator('#ovIppon')).toBeVisible();
        await expect(anzeigePage.locator('#bannerW')).not.toHaveClass(/active/);
        const vorschau = steuerungPage.frames().find(f => f.url().includes('anzeige.html'));
        await expect(vorschau.locator('#bannerW')).toHaveText('IPPON');
        await expect(vorschau.locator('#ovIppon')).toBeHidden();
        const ovSchrift = await anzeigePage.locator('#ovIppon').evaluate(el => parseFloat(getComputedStyle(el).fontSize));
        expect(ovSchrift).toBeGreaterThan(1080 * 0.3);

        await steuerungPage.locator('#btnErgebnisSendenLive').click();
        await expect(steuerungPage.locator('#btnNaechsterKampfLive')).toBeVisible();
        kaempfeDB.length = 0;
        kaempfeDB.push(baueKampf(4));
        await steuerungPage.locator('#btnNaechsterKampfLive').click();
        await steuerungPage.locator('#btnLiveNaW').click();
        await expect(anzeigePage.locator('#bannerW')).toHaveText('N. ANGETRETEN');
        // Der Text füllt höchstens 90 % der Breite der Meldung (Luft links und rechts, auch bei längerem Namen der Seite)
        const anteil = await anzeigePage.locator('#bannerW').evaluate(el => {
            const bereich = document.createRange();
            bereich.selectNodeContents(el);
            return bereich.getBoundingClientRect().width / el.getBoundingClientRect().width;
        });
        expect(anteil).toBeLessThan(0.9);
        await expect(vorschau.locator('#bannerW')).toHaveText('NICHT ANGETRETEN');
    });
});
