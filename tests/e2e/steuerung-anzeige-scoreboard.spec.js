// End-to-End: Die Live-Kampfsteuerung (steuerung.html, "Kampfrichtertisch") und die öffentliche
// Anzeigetafel (anzeige.html, zweiter Bildschirm/Fernseher an der Matte) synchronisieren sich
// AUSSCHLIESSLICH über den BroadcastChannel 'judo_scoreboard' (siehe scoreboard.js) — NICHT über
// das zusätzliche Live-Vorschau-iframe, das steuerung.html selbst einbettet (das ist nur eine
// Komfort-Vorschau für den Kampfrichtertisch). Im echten Betrieb öffnet die Person am
// Kampfrichtertisch daher zwei getrennte Fenster/Tabs; dieser Test bildet genau das nach, indem er
// steuerung.html UND anzeige.html parallel in zwei Seiten desselben Browser-Contexts öffnet (siehe
// beforeAll) und danach jede Steuerungs-Aktion gegen die separat geladene anzeige.html verifiziert
// — das ist der wichtigste Baustein dieser Suite, da genau dieses Zwei-Fenster-Setup am
// Wettkampftag tatsächlich zum Einsatz kommt.
//
// Alle Backend-Daten (Kampfflächen, Kämpfe, PUT-Ergebnisse) werden über page.route gemockt statt
// über echte Turnier-/Teilnehmer-Anlage erzeugt — die Steuerung ist bewusst so gebaut, dass sie
// nur mit der Kämpfe-API spricht (siehe naechstenKampfHolen()/ergebnisSenden() in scoreboard.js),
// wodurch sich dieser Test auf die Scoreboard-Logik selbst konzentrieren kann.
//
// Kampfzeit-abhängige Szenarien (Golden Score, Time-/Hantei-Overlay) nutzen Playwrights
// Clock-API (page.clock), um die 1-Sekunden-Intervalle aus toggleTimer() virtuell statt in
// Echtzeit ablaufen zu lassen — das hält die Suite schnell und deterministisch.
//
// Für Ippon/Waza-Ari/Yuko/Shido/Behandlung gibt es in steuerung.html selbst keine Buttons — die
// echten +/- Bedienelemente werden erst zur Laufzeit in das eingebettete Vorschau-iframe injiziert
// (injiziereBedienButtons() in scoreboard.js) und rufen von dort aus window.parent.changeScore/
// changeShido/changeBehandlung auf. Diese Buttons haben keine stabilen IDs (nur generische
// "+"/"–"-Beschriftungen), ein Locator darauf wäre eng an die interne DOM-Struktur gekoppelt und
// bei jedem Refactoring dieser Buttons brüchig. Da window.changeScore/changeShido/changeBehandlung
// exakt zu diesem Zweck (Aufruf aus einem anderen Frame) global exponiert sind (siehe Ende von
// scoreboard.js), rufen wir sie hier direkt über page.evaluate auf — das ist derselbe Codepfad wie
// ein echter Klick auf die iframe-Buttons, nur ohne die brüchige DOM-Kopplung. Für Aktionen mit
// stabilen IDs (Nächsten Kampf holen, Start/Stopp, Nicht angetreten, Sieger Hantei, Ergebnis
// senden, direktes Hansoku-make im iframe) werden dagegen echte Klicks verwendet.
import { test, expect } from '@playwright/test';
import { schliesseOverlayAutomatisch } from './helpers/pool-beginn-overlay.js';

const TURNIER_ID = 9001;
const MAT_ID = 3;

function baueKampf(id, overrides = {}) {
    return {
        id,
        status: 'bereit',
        kaempfer1_id: id * 10 + 1,
        kaempfer2_id: id * 10 + 2,
        kaempfer1_vorname: 'Weiss',
        kaempfer1_nachname: `Fighter${id}A`,
        kaempfer1_verein: 'JC Weiss',
        kaempfer2_vorname: 'Blau',
        kaempfer2_nachname: `Fighter${id}B`,
        kaempfer2_verein: 'JC Blau',
        pool_bezeichnung: `Testpool ${id}`,
        pool_kampfzeit: 240,
        pool_golden_score_aktiv: true,
        pool_golden_score_max_sekunden: 60,
        mannschaftskampf_id: null,
        matten_reihenfolge: id,
        ...overrides
    };
}

test.describe.serial('Steuerung + Anzeigetafel: Scoreboard-Kernfunktionen (steuerung.html <-> separat geöffnete anzeige.html)', () => {
    let steuerungPage;
    let anzeigePage;
    let kaempfeDB;
    const consoleErrors = [];

    test.beforeAll(async ({ browser }) => {
        const context = await browser.newContext();
        kaempfeDB = [];

        // Signalton zählen statt abspielen (Zähler pro Seite in window.__dingCount)
        await context.addInitScript(() => {
            window.__dingCount = 0;
            HTMLMediaElement.prototype.play = function () {
                if (String(this.currentSrc || this.src).includes('dingding')) window.__dingCount++;
                return Promise.resolve();
            };
        });

        await context.route('**/api/kampfflaechen*', async route => {
            await route.fulfill({ json: [{ id: MAT_ID, bezeichnung: 'Testmatte 1' }] });
        });

        // GET /api/kaempfe?kampfflaecheId=... — Playwrights einfaches "*" matcht keinen "/",
        // trifft also nur die Query-String-Variante ohne zusätzliches Pfadsegment (siehe
        // '**/api/kaempfe/*' weiter unten für die PUT-Variante mit :id).
        await context.route('**/api/kaempfe*', async route => {
            if (route.request().method() !== 'GET') {
                await route.fallback();
                return;
            }
            await route.fulfill({ json: kaempfeDB });
        });

        // Wird nach jedem Laden eines Kampfes automatisch aufgerufen (siehe changeFighterColorSlider
        // am Ende von naechstenKampfHolen()) — rein informativ fürs Backend, für diesen Test ohne
        // Bedeutung, muss aber beantwortet werden, damit kein Konsolenfehler entsteht.
        await context.route('**/api/kaempfe/*/color', async route => {
            await route.fulfill({ json: { success: true } });
        });

        await context.route('**/api/kaempfe/*', async route => {
            if (route.request().method() !== 'PUT') {
                await route.fallback();
                return;
            }
            const id = Number(new URL(route.request().url()).pathname.split('/').pop());
            const body = route.request().postDataJSON();
            const kampf = kaempfeDB.find(k => k.id === id);
            if (kampf) Object.assign(kampf, body);
            await route.fulfill({ json: { success: true } });
        });

        steuerungPage = await context.newPage();

        await schliesseOverlayAutomatisch(steuerungPage);
        anzeigePage = await context.newPage();
        await schliesseOverlayAutomatisch(anzeigePage);

        for (const [name, page] of [['steuerung', steuerungPage], ['anzeige', anzeigePage]]) {
            page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(`[${name}] ${msg.text()}`); });
            page.on('pageerror', err => consoleErrors.push(`[${name}] ${err.message}`));
        }

        // Virtuelle Uhr NUR auf der Steuerung installieren — nur dort laufen die
        // Kampfzeit-Intervalle (siehe toggleTimer()); anzeige.html besitzt keinen eigenen Timer.
        await steuerungPage.clock.install();

        await Promise.all([
            steuerungPage.goto(`/steuerung.html?turnierId=${TURNIER_ID}&matId=${MAT_ID}`),
            anzeigePage.goto('/anzeige.html')
        ]);
    });

    test.afterAll(async () => {
        await steuerungPage.context().close();
    });

    test('steuerung.html und separat geöffnete anzeige.html synchronisieren sich per BroadcastChannel', async () => {
        // Kein Login-Modal (STEUERUNG_PASSWORD ist in der Testsuite leer, siehe test-env.js).
        await expect(steuerungPage.locator('#globalLoginModal')).toHaveCount(0);
        await expect(steuerungPage.locator('#matSelect')).toHaveValue(String(MAT_ID));

        await steuerungPage.locator('#nameW').fill('Synchronisationstest Weiss');
        await steuerungPage.locator('#clubW').fill('JC Sync');
        await steuerungPage.locator('#poolName').fill('Sync-Pool U21');

        await expect(anzeigePage.locator('#outNameW')).toHaveText('Synchronisationstest Weiss');
        await expect(anzeigePage.locator('#outClubW')).toHaveText('JC Sync');
        await expect(anzeigePage.locator('#outMeta')).toHaveText('Sync-Pool U21');
    });

    test('"Nächsten Kampf holen" lädt den Kampf aus der (gemockten) API und zeigt ihn synchron auf Steuerung und Anzeige', async () => {
        kaempfeDB.push(baueKampf(1, { pool_bezeichnung: 'U18 männlich -73kg', pool_kampfzeit: 240 }));

        await steuerungPage.locator('#btnNaechsterKampfLive').click();

        await expect(steuerungPage.locator('#nameW')).toHaveValue('Fighter1A, Weiss');
        await expect(steuerungPage.locator('#nameB')).toHaveValue('Fighter1B, Blau');
        await expect(steuerungPage.locator('#poolName')).toHaveValue('U18 männlich -73kg');

        await expect(anzeigePage.locator('#outNameW')).toHaveText('Fighter1A, Weiss');
        await expect(anzeigePage.locator('#outNameB')).toHaveText('Fighter1B, Blau');
        await expect(anzeigePage.locator('#outMeta')).toHaveText('U18 männlich -73kg');
        await expect(anzeigePage.locator('#outTimer')).toHaveText('04:00');

        // Laden allein startet den Kampf nicht: "gestartet" wird erst mit dem ersten START gemeldet.
        expect(kaempfeDB.find(k => k.id === 1).status).toBe('bereit');
    });

    test('1.-3. Shido: Karten füllen sich schrittweise, der 3. Shido löst automatisch Hansoku-make für den Gegner aus', async () => {
        await steuerungPage.locator('#btnStartStopLive').click();
        await expect(steuerungPage.locator('#btnStartStopLive')).toHaveText('STOPP');
        // Der erste START meldet den Kampf als "gestartet" (PUT im Hintergrund).
        await expect.poll(() => kaempfeDB.find(k => k.id === 1).status).toBe('gestartet');

        await steuerungPage.evaluate(() => window.changeShido('B', 1));
        await expect(anzeigePage.locator('#shidoB_1')).toHaveClass(/active/);
        await expect(anzeigePage.locator('#shidoB_2')).not.toHaveClass(/active/);
        await expect(anzeigePage.locator('#bannerB')).not.toHaveClass(/active/);

        await steuerungPage.evaluate(() => window.changeShido('B', 1));
        await expect(anzeigePage.locator('#shidoB_2')).toHaveClass(/active/);
        await expect(anzeigePage.locator('#shidoB_3')).not.toHaveClass(/active/);
        await expect(anzeigePage.locator('#bannerB')).not.toHaveClass(/active/);

        await steuerungPage.evaluate(() => window.changeShido('B', 1));
        await expect(anzeigePage.locator('#shidoB_3')).toHaveClass(/active/);
        await expect(anzeigePage.locator('#bannerB')).toHaveClass(/active/);
        await expect(anzeigePage.locator('#bannerB')).toHaveText('HANSOKU-MAKE');

        // Kampf ist beendet -> stopAllTimers() hat den Timer bereits gestoppt.
        await expect(steuerungPage.locator('#btnStartStopLive')).toHaveText('START');

        await steuerungPage.locator('#btnErgebnisSendenLive').click();
        await expect(steuerungPage.locator('#btnNaechsterKampfLive')).toBeVisible();
        const fight1 = kaempfeDB.find(k => k.id === 1);
        expect(fight1.status).toBe('beendet');
        // kaempfer1 ist Weiß (siehe naechstenKampfHolen()) -> B (kaempfer2) hat gefoult, W gewinnt.
        // Regressionsschutz für einen zuvor vertauschten sieger_id/unterbewertung_kaempferX-Mapping-
        // Fehler in ergebnisSenden() (kaempfer1 wurde dort fälschlich als Blau/Rot behandelt).
        expect(fight1.sieger_id).toBe(fight1.kaempfer1_id);
        expect(fight1.unterbewertung_kaempfer1).toBe(10);
        expect(fight1.unterbewertung_kaempfer2).toBe(0);
    });

    test('Direktes Hansoku-make (Art. 18.2) ohne vorherige Shidos, inkl. Rückgängig-Toggle', async () => {
        kaempfeDB.push(baueKampf(2, { pool_bezeichnung: 'U15 weiblich -44kg' }));
        await steuerungPage.locator('#btnNaechsterKampfLive').click();
        await expect(steuerungPage.locator('#nameW')).toHaveValue('Fighter2A, Weiss');

        // Der Hansoku-make-Button hat (im Gegensatz zu Score/Shido/Behandlung) eine stabile ID im
        // injizierten Vorschau-iframe — hier ausnahmsweise ein echter Klick statt page.evaluate.
        const iframe = steuerungPage.frameLocator('iframe[title="Live-Vorschau Anzeigetafel"]');
        const hansokuBtnW = iframe.locator('#iframeBtnHansokuW');
        await expect(hansokuBtnW).toBeVisible();

        await hansokuBtnW.click();
        await expect(anzeigePage.locator('#bannerW')).toHaveText('HANSOKU-MAKE');
        await expect(anzeigePage.locator('#ovTime')).toBeHidden();

        // Erneuter Klick auf denselben Button macht die Disqualifikation rückgängig.
        await hansokuBtnW.click();
        await expect(anzeigePage.locator('#bannerW')).not.toHaveClass(/active/);

        // Erneut auslösen, damit der Kampf tatsächlich beendet werden kann.
        await hansokuBtnW.click();
        await expect(anzeigePage.locator('#bannerW')).toHaveText('HANSOKU-MAKE');

        await steuerungPage.locator('#btnErgebnisSendenLive').click();
        await expect(steuerungPage.locator('#btnNaechsterKampfLive')).toBeVisible();
        expect(kaempfeDB.find(k => k.id === 2).status).toBe('beendet');
    });

    test('Golden Score: Gleichstand bei Zeitablauf aktiviert Golden Score, erste Wertung gewinnt sofort ohne Ippon-Banner', async () => {
        kaempfeDB.push(baueKampf(3, {
            pool_bezeichnung: 'Senioren -90kg', pool_kampfzeit: 2,
            pool_golden_score_aktiv: true, pool_golden_score_max_sekunden: 30
        }));
        await steuerungPage.locator('#btnNaechsterKampfLive').click();
        await expect(anzeigePage.locator('#outTimer')).toHaveText('00:02');

        await steuerungPage.locator('#btnStartStopLive').click();
        await steuerungPage.clock.fastForward(2500);

        // Gleichstand (0:0) nach Ablauf der regulären Zeit -> TIME-Overlay statt sofortigem Sieg.
        await expect(anzeigePage.locator('#ovTime')).toBeVisible();
        await expect(anzeigePage.locator('#outGsIndicator')).toBeHidden();

        // Erneutes Drücken von START aktiviert bei Gleichstand automatisch Golden Score.
        await steuerungPage.locator('#btnStartStopLive').click();
        await expect(anzeigePage.locator('#ovTime')).toBeHidden();
        await expect(anzeigePage.locator('#outGsIndicator')).toBeVisible();

        // Erste Wertung im Golden Score entscheidet sofort (triggerGoldenScoreWin statt triggerIpponWin).
        await steuerungPage.evaluate(() => window.changeScore('W', 'yuko', 1));
        await expect(anzeigePage.locator('#outYukoW')).toHaveText('1');
        await expect(anzeigePage.locator('#bannerW')).not.toHaveClass(/active/);
        await expect(anzeigePage.locator('#bannerB')).not.toHaveClass(/active/);
        await expect(steuerungPage.locator('#btnErgebnisSendenLive')).toBeVisible();

        // Der "Golden Score"-Schriftzug bleibt über den Sieg hinaus sichtbar -- state.isGoldenScore
        // wird ausschließlich in resetTimer() zurückgesetzt (siehe scoreboard.js), keiner der
        // triggerXWin()-Sieg-Handler rührt das Flag an. Er verschwindet also erst mit "Ergebnis
        // senden" (das intern resetTimer() aufruft) bzw. beim Laden des nächsten Kampfes.
        await expect(anzeigePage.locator('#outGsIndicator')).toBeVisible();

        await steuerungPage.locator('#btnErgebnisSendenLive').click();
        await expect(steuerungPage.locator('#btnNaechsterKampfLive')).toBeVisible();
        const fight3 = kaempfeDB.find(k => k.id === 3);
        expect(fight3.status).toBe('beendet');
        expect(fight3.sieger_id).toBe(fight3.kaempfer1_id); // W (kaempfer1) hat die Wertung erzielt.
        expect(fight3.unterbewertung_kaempfer1).toBe(5);
        expect(fight3.unterbewertung_kaempfer2).toBe(0);
    });

    test('Golden Score ohne Entscheidung erreicht ihr Zeitlimit -> automatischer Wechsel zur Hantei-Entscheidung', async () => {
        kaempfeDB.push(baueKampf(4, {
            pool_bezeichnung: 'U21 -66kg', pool_kampfzeit: 2,
            pool_golden_score_aktiv: true, pool_golden_score_max_sekunden: 2
        }));
        await steuerungPage.locator('#btnNaechsterKampfLive').click();

        await steuerungPage.locator('#btnStartStopLive').click();
        await steuerungPage.clock.fastForward(2500);
        await expect(anzeigePage.locator('#ovTime')).toBeVisible();

        await steuerungPage.locator('#btnStartStopLive').click(); // aktiviert Golden Score
        await expect(anzeigePage.locator('#outGsIndicator')).toBeVisible();

        await steuerungPage.clock.fastForward(2500); // erreicht das 2-Sekunden-Golden-Score-Limit ohne Wertung
        await expect(anzeigePage.locator('#ovHantei')).toBeVisible();

        await expect(steuerungPage.locator('#btnHanteiSiegB')).toBeVisible();
        await steuerungPage.locator('#btnHanteiSiegB').click();
        await expect(anzeigePage.locator('#bannerB')).toHaveText('HANTEI-SIEG');
        await expect(anzeigePage.locator('#ovHantei')).toBeHidden();

        // Auch wenn Golden Score selbst ohne Entscheidung ausgelaufen ist und in die
        // Kampfrichter-Entscheidung übergeht, bleibt der Hinweis "Golden Score" bis zum
        // tatsächlichen Kampfende sichtbar (siehe Kommentar im Golden-Score-Sieg-Test oben).
        await expect(anzeigePage.locator('#outGsIndicator')).toBeVisible();

        await steuerungPage.locator('#btnErgebnisSendenLive').click();
        await expect(steuerungPage.locator('#btnNaechsterKampfLive')).toBeVisible();
        expect(kaempfeDB.find(k => k.id === 4).status).toBe('beendet');
    });

    test('Golden Score für den Pool deaktiviert: Gleichstand führt direkt zur Hantei-Entscheidung', async () => {
        kaempfeDB.push(baueKampf(5, {
            pool_bezeichnung: 'U15 männlich -50kg', pool_kampfzeit: 2,
            pool_golden_score_aktiv: false, pool_golden_score_max_sekunden: null
        }));
        await steuerungPage.locator('#btnNaechsterKampfLive').click();
        await expect(steuerungPage.locator('#gsLimitContainer')).toBeHidden();

        await steuerungPage.locator('#btnStartStopLive').click();
        await steuerungPage.clock.fastForward(2500);

        await expect(anzeigePage.locator('#ovHantei')).toBeVisible();
        await expect(anzeigePage.locator('#ovTime')).toBeHidden();

        await expect(steuerungPage.locator('#btnHanteiSiegW')).toBeVisible();
        await steuerungPage.locator('#btnHanteiSiegW').click();
        await expect(anzeigePage.locator('#bannerW')).toHaveText('HANTEI-SIEG');

        // Rückgängig-Toggle: erneuter Klick nimmt die Entscheidung zurück, Hantei-Overlay erscheint wieder.
        await steuerungPage.locator('#btnHanteiSiegW').click();
        await expect(anzeigePage.locator('#ovHantei')).toBeVisible();
        await expect(anzeigePage.locator('#bannerW')).not.toHaveClass(/active/);

        await steuerungPage.locator('#btnHanteiSiegW').click();
        await expect(anzeigePage.locator('#bannerW')).toHaveText('HANTEI-SIEG');

        await steuerungPage.locator('#btnErgebnisSendenLive').click();
        await expect(steuerungPage.locator('#btnNaechsterKampfLive')).toBeVisible();
        expect(kaempfeDB.find(k => k.id === 5).status).toBe('beendet');
    });

    test('Time-Overlay ohne Gleichstand: regulärer Zeitablauf entscheidet direkt anhand des Punktestands', async () => {
        kaempfeDB.push(baueKampf(6, { pool_bezeichnung: 'Senioren -100kg', pool_kampfzeit: 2, pool_golden_score_aktiv: true }));
        await steuerungPage.locator('#btnNaechsterKampfLive').click();
        // naechstenKampfHolen() setzt Namen/Scores erst NACH einem awaited fetch() zurück — ohne
        // diese Wartemarke würde der direkt folgende window.evaluate()-Aufruf (der, anders als ein
        // Klick auf einen zwischenzeitlich disabled-Button, keine Playwright-Actionability-Wartung
        // hat) mit dem asynchronen Laden des Kampfes um die Ausführungsreihenfolge konkurrieren.
        await expect(steuerungPage.locator('#nameW')).toHaveValue('Fighter6A, Weiss');

        await steuerungPage.evaluate(() => window.changeScore('W', 'yuko', 1));
        await expect(anzeigePage.locator('#outYukoW')).toHaveText('1');

        await steuerungPage.locator('#btnStartStopLive').click();
        await steuerungPage.clock.fastForward(2500);

        // Kein Gleichstand -> bleibt bei TIME, Golden Score wird nicht angeboten.
        await expect(anzeigePage.locator('#ovTime')).toBeVisible();
        await expect(anzeigePage.locator('#outGsIndicator')).toBeHidden();
        await expect(steuerungPage.locator('#btnErgebnisSendenLive')).toBeVisible();

        await steuerungPage.locator('#btnErgebnisSendenLive').click();
        await expect(steuerungPage.locator('#btnNaechsterKampfLive')).toBeVisible();
        expect(kaempfeDB.find(k => k.id === 6).status).toBe('beendet');
    });

    test('Signalton "dingding": Ende der Kampfzeit und Ippon durch Haltegriff, nicht bei manuellem Ippon', async () => {
        const dings = () => steuerungPage.evaluate(() => window.__dingCount);

        // Ippon durch Haltegriff (20 s Osaekomi), manueller Ippon bleibt ohne dingding
        kaempfeDB.push(baueKampf(21, { pool_bezeichnung: 'Ton -60kg', pool_kampfzeit: 240 }));
        await steuerungPage.locator('#btnNaechsterKampfLive').click();
        await expect(steuerungPage.locator('#nameW')).toHaveValue('Fighter21A, Weiss');
        const start = await dings();

        await steuerungPage.evaluate(() => window.changeScore('W', 'ippon', 1));
        await expect(anzeigePage.locator('#bannerW')).toHaveClass(/active/);
        expect(await dings()).toBe(start);
        await steuerungPage.evaluate(() => window.changeScore('W', 'ippon', -1));
        await expect(anzeigePage.locator('#bannerW')).not.toHaveClass(/active/);

        await steuerungPage.locator('#btnStartStopLive').click();
        await steuerungPage.evaluate(() => window.toggleOsae('W'));
        await steuerungPage.clock.runFor(21_000);
        await expect(anzeigePage.locator('#bannerW')).toHaveText('IPPON');
        expect(await dings()).toBe(start + 1);
        await steuerungPage.locator('#btnErgebnisSendenLive').click();
        await expect(steuerungPage.locator('#btnNaechsterKampfLive')).toBeVisible();

        // Ende der regulären Kampfzeit
        kaempfeDB.push(baueKampf(22, { pool_bezeichnung: 'Ton -60kg', pool_kampfzeit: 2 }));
        await steuerungPage.locator('#btnNaechsterKampfLive').click();
        await expect(steuerungPage.locator('#nameW')).toHaveValue('Fighter22A, Weiss');
        await steuerungPage.evaluate(() => window.changeScore('W', 'yuko', 1));
        await steuerungPage.locator('#btnStartStopLive').click();
        await steuerungPage.clock.fastForward(2500);
        await expect(anzeigePage.locator('#ovTime')).toBeVisible();
        expect(await dings()).toBe(start + 2);
        await steuerungPage.locator('#btnErgebnisSendenLive').click();
        await expect(steuerungPage.locator('#btnNaechsterKampfLive')).toBeVisible();
    });

    test('1.-2. medizinische Versorgung zeigt Kreuzsymbole, die 3. beendet den Kampf durch Kiken-gachi', async () => {
        kaempfeDB.push(baueKampf(7, { pool_bezeichnung: 'U18 weiblich -57kg' }));
        await steuerungPage.locator('#btnNaechsterKampfLive').click();
        // Siehe Kommentar im Time-Overlay-Test oben: erst auf das Laden warten, bevor per
        // window.evaluate() (ohne Actionability-Wartung) in den Kampf eingegriffen wird.
        await expect(steuerungPage.locator('#nameW')).toHaveValue('Fighter7A, Weiss');

        await steuerungPage.evaluate(() => window.changeBehandlung('W', 1));
        await expect(anzeigePage.locator('#behandlungW_1')).toHaveClass(/active/);
        await expect(anzeigePage.locator('#behandlungW_2')).not.toHaveClass(/active/);
        await expect(anzeigePage.locator('#bannerW')).not.toHaveClass(/active/);

        await steuerungPage.evaluate(() => window.changeBehandlung('W', 1));
        await expect(anzeigePage.locator('#behandlungW_2')).toHaveClass(/active/);
        await expect(anzeigePage.locator('#bannerW')).not.toHaveClass(/active/);

        // 3. Versorgung: automatischer Sieg des Gegners durch Kiken-gachi (Aufgabe).
        await steuerungPage.evaluate(() => window.changeBehandlung('W', 1));
        await expect(anzeigePage.locator('#bannerW')).toHaveText('AUFGABE');

        await steuerungPage.locator('#btnErgebnisSendenLive').click();
        await expect(steuerungPage.locator('#btnNaechsterKampfLive')).toBeVisible();
        expect(kaempfeDB.find(k => k.id === 7).status).toBe('beendet');
    });

    test('"Nicht angetreten": Gegner gewinnt automatisch, nur vor Kampfbeginn möglich', async () => {
        kaempfeDB.push(baueKampf(8, { pool_bezeichnung: 'U21 -78kg' }));
        await steuerungPage.locator('#btnNaechsterKampfLive').click();

        await steuerungPage.locator('#btnLiveNaW').click();
        await expect(anzeigePage.locator('#bannerW')).toHaveText('NICHT ANGETRETEN');
        // Die Gegenseite kann nicht mehr ebenfalls "Nicht angetreten" markieren, solange W aktiv ist.
        await expect(steuerungPage.locator('#btnLiveNaB')).toBeDisabled();

        await steuerungPage.locator('#btnErgebnisSendenLive').click();
        await expect(steuerungPage.locator('#btnNaechsterKampfLive')).toBeVisible();
        const fight8 = kaempfeDB.find(k => k.id === 8);
        expect(fight8.status).toBe('beendet');
        // W (kaempfer1) ist nicht angetreten -> B (kaempfer2) gewinnt automatisch.
        expect(fight8.sieger_id).toBe(fight8.kaempfer2_id);
        expect(fight8.unterbewertung_kaempfer1).toBe(0);
        expect(fight8.unterbewertung_kaempfer2).toBe(10);
    });

    test('keine unerwarteten Konsolenfehler während der gesamten Suite', () => {
        expect(consoleErrors, `Unerwartete Konsolenfehler:\n${consoleErrors.join('\n')}`).toEqual([]);
    });
});
