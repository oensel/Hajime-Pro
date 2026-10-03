// End-to-End: kompletter Turnierablauf über zwei echte Serverprozesse (Online gegen die echte
// Cloud-Postgres-DB, Offline gegen ein eigenes eingebettetes PostgreSQL) — siehe Plan
// C:\Users\Bastian\.claude\plans\swirling-booping-hamming.md für den vollständigen Kontext.
//
// Phase 1 (dieser Stand): jan@test.de meldet sich mit seinem bestehenden, bereits freigegebenen
// Account bei JC Senden an und legt Turnier (U11m/U11w/U13m/U13w Einzel + U13m-Team/U13w-Team) an
// und veröffentlicht es. Weitere Phasen (Anmeldung tim/tom, Bezahlt-Status, Offline-Import, Waage,
// Pools/Matten, Scoreboard, Rücksynchronisation) folgen als weitere test()-Schritte in genau
// dieser Datei, sobald Phase 1 gegen den echten Server verifiziert ist.
//
// jan/tim/tom@test.de sind ECHTE, bereits bestehende Accounts des Nutzers — siehe
// Vorfall-Kommentar in helpers.js. Dieser Test registriert sie nicht und legt für sie keinen
// Verein an, sondern loggt sich nur mit den vom Nutzer übergebenen Zugangsdaten ein.
import { test, expect } from '@playwright/test';
import {
    meldeAn, legeTurnierAn, legeMannschaftsPoolAn, aktiviereMannschaftsAltersklassen, veroeffentlicheTurnier,
    baueVollablaufRoster, importiereTeilnehmerDatei, markiereAuchEinzelwettkampf,
    markiereAlleAlsBezahlt, verschiebeTurnierAufTag, exportiereTurnierDaten,
    importiereTurnierOffline, ermittleZielgewicht, waegeTeilnehmerEin, fuegeWalkInTeilnehmerHinzu,
    markiereAlleAlsGewogen, synchronisiereMannschaftsPositionen,
    generierePoolsUndPruefeKampflos, verteileMannschaftenAutomatisch, verteilePoolsAufMatten,
    spieleMatteAmServerDurch, importiereErgebnisseOnline
} from './helpers.js';
import { ONLINE_BASE_URL, OFFLINE_BASE_URL } from './test-env.js';

// Turnierdatum liegt zunächst in der Zukunft (Anmeldung muss offen sein, solange tim/tom
// importieren, siehe ladeImportKontext in teilnehmerController.js: "Anmeldung nicht geöffnet"
// sobald der effektive Status nicht mehr "veroeffentlicht" ist) und wird erst kurz vor Phase 4
// (Turnier-Export) von jan auf "heute" vorgezogen — erst dann gilt der effektive Status als
// "in_durchfuehrung" (siehe ermittleEffektivenStatus in turnierController.js), was Export-/
// Import-Buttons freischaltet und zugleich die spätere Matten-/Scoreboard-Phase als "echten
// Wettkampftag" einleitet.
const HEUTE = new Date();
const WETTKAMPFJAHR = HEUTE.getFullYear() + 1;
const TURNIER_DATUM = `${WETTKAMPFJAHR}-09-18`;
const TURNIER_DATUM_WETTKAMPFTAG = HEUTE.toISOString().slice(0, 10);

test.describe.serial('Kompletter Turnierablauf', () => {
    let janPage, timPage, tomPage, offlinePage, mattePage;
    let jan, tim, tom;
    let turnierId;
    let offlineTurnierId;
    let timRoster, tomRoster;

    test.beforeAll(async ({ browser }) => {
        janPage = await (await browser.newContext()).newPage();
        timPage = await (await browser.newContext()).newPage();
        tomPage = await (await browser.newContext()).newPage();
        offlinePage = await (await browser.newContext()).newPage();
        // Eigener Kontext für das Scoreboard (steuerung.html), siehe spieleMatteAmServerDurch.
        mattePage = await (await browser.newContext()).newPage();
    });

    test.afterAll(async () => {
        await janPage.context().close();
        await timPage.context().close();
        await tomPage.context().close();
        await offlinePage.context().close();
        await mattePage.context().close();
    });

    test('Phase 1a: jan@test.de meldet sich mit seinem bestehenden Account an', async ({ request }) => {
        jan = await meldeAn(janPage, ONLINE_BASE_URL, request, { email: 'jan@test.de', password: 'JanTest123' });
    });

    test('Phase 1b: jan legt das Turnier mit den Einzelwettkampf-Altersklassen an', async () => {
        turnierId = await legeTurnierAn(janPage, ONLINE_BASE_URL, {
            bezeichnung: 'Vollablauf-Turnier',
            datum: TURNIER_DATUM,
            ort: 'Senden',
            plz: '48308',
            ausrichter: 'JC Senden',
            anzahlKampfflaechen: 2,
            bundesland: 'Nordrhein-Westfalen',
            einzelKlassenWerte: ['männlich_U11', 'weiblich_U11', 'männlich_U13', 'weiblich_U13']
        });

        expect(turnierId).toBeTruthy();
    });

    test('Phase 1c: jan legt die U13-Mannschafts-Pools an (kein DJB-Preset, Gewichtsklassen-Vorschlag aus dem Einzelwettkampf übernommen)', async () => {
        await legeMannschaftsPoolAn(janPage, ONLINE_BASE_URL, turnierId, {
            bezeichnung: 'U13m Team', geschlecht: 'männlich', altersklasse: 'U13'
        });
        await legeMannschaftsPoolAn(janPage, ONLINE_BASE_URL, turnierId, {
            bezeichnung: 'U13w Team', geschlecht: 'weiblich', altersklasse: 'U13'
        });

        const poolsResp = await janPage.request.get(`${ONLINE_BASE_URL}/api/mannschaften/pools?turnierId=${turnierId}`, {
            headers: { Authorization: `Bearer ${jan.token}` }
        });
        const pools = await poolsResp.json();
        expect(pools.map(p => p.bezeichnung).sort()).toEqual(['U13m Team', 'U13w Team']);

        // Trägt am Turnier nach, dass es Mannschafts-Altersklassen austrägt (kein DJB-Preset für
        // U13, siehe legeMannschaftsPoolAn) — sonst bietet teilnehmer.js beim Import gar nicht erst
        // die Wahl zwischen Einzel- und Mannschafts-Ziel an (siehe aktiviereMannschaftsAltersklassen).
        await aktiviereMannschaftsAltersklassen(ONLINE_BASE_URL, janPage.request, jan.token, turnierId, ['männlich_U13', 'weiblich_U13']);
    });

    test('Phase 1d: jan veröffentlicht das Turnier', async () => {
        await veroeffentlichteTurnierUndPruefe();
    });

    async function veroeffentlichteTurnierUndPruefe() {
        await veroeffentlicheTurnier(ONLINE_BASE_URL, janPage.request, jan.token, turnierId);

        const turnierResp = await janPage.request.get(`${ONLINE_BASE_URL}/api/turniere/${turnierId}`, {
            headers: { Authorization: `Bearer ${jan.token}` }
        });
        const turnier = await turnierResp.json();
        expect(turnier.status).toBe('veroeffentlicht');
    }

    // --- PHASE 2/3: tim (Polizeisportverein Münster) und tom (SV Arminia Appelhülsen) melden
    // jeweils 50 Teilnehmer an (7 U11m + 7 U11w + 6 U13m + 6 U13w nur Einzel, sowie 12 U13m + 12
    // U13w, die zusätzlich einer Mannschaft angehören) — identischer Ablauf für beide Vereine,
    // daher als eine parametrisierte Hilfsfunktion statt doppeltem Test-Code.
    async function meldeVereinAn(page, { email, password }, seed) {
        const user = await meldeAn(page, ONLINE_BASE_URL, page.request, { email, password });
        const roster = baueVollablaufRoster(user.vereinName, WETTKAMPFJAHR, user.vereinName, seed);

        await page.goto(`${ONLINE_BASE_URL}/teilnehmer.html?id=${turnierId}`);
        // teilnehmer.js lädt die Turnier-Altersklassen-Konfiguration (u.a.
        // turnierHatMannschaftKlassen, siehe ermittleImportZiel) asynchron nach — ohne diese
        // Wartemarke könnte #importBtn geklickt werden, bevor der Fetch zurück ist, wodurch der
        // Einzel/Mannschaft-Auswahldialog fälschlich übersprungen würde.
        await page.waitForLoadState('networkidle');
        await importiereTeilnehmerDatei(page, 'einzel', `${user.vereinName}-einzel.xlsx`, roster.einzelZeilen);
        await importiereTeilnehmerDatei(page, 'mannschaft', `${user.vereinName}-mannschaft.xlsx`, roster.mannschaftZeilen);
        await markiereAuchEinzelwettkampf(page, roster.personen.filter(p => p.imTeam));

        return { user, roster };
    }

    test('Phase 2: tim@test.de meldet 50 Teilnehmer an (12m/12w davon auch für eine Mannschaft)', async () => {
        test.setTimeout(120_000);
        const { user, roster } = await meldeVereinAn(timPage, { email: 'tim@test.de', password: 'TimTest123' }, 0);
        tim = user;
        timRoster = roster;

        await expect(timPage.locator('#statGesamtTeilnehmer')).toHaveText('50');
    });

    test('Phase 3: tom@test.de meldet 50 Teilnehmer an (12m/12w davon auch für eine Mannschaft)', async () => {
        test.setTimeout(120_000);
        const { user, roster } = await meldeVereinAn(tomPage, { email: 'tom@test.de', password: 'TomTest123' }, 50);
        tom = user;
        tomRoster = roster;

        await expect(tomPage.locator('#statGesamtTeilnehmer')).toHaveText('50');
    });

    // --- PHASE 4: jan (Gastgeber) markiert alle 100 Teilnehmer beider Vereine als bezahlt und
    // lädt die Turnier-Gesamtdaten herunter (nur der ausrichtende Verein darf den Bezahlt-Status
    // setzen, siehe teilnehmerController.js — tim/tom könnten das nicht selbst tun).
    let turnierExportPfad;

    test('Phase 4: jan markiert alle Teilnehmer als bezahlt und lädt die Turnierdaten herunter', async () => {
        await janPage.goto(`${ONLINE_BASE_URL}/teilnehmer.html?id=${turnierId}`);
        await expect(janPage.locator('#statGesamtTeilnehmer')).toHaveText('100');

        await markiereAlleAlsBezahlt(janPage, 100);

        // Erst jetzt auf "heute" vorziehen: die Anmeldung (Phase 2/3) musste bis hierhin offen
        // bleiben (effektiver Status "veroeffentlicht"), Turnier-Export erfordert dagegen
        // "in_durchfuehrung" o.ä. (siehe verschiebeTurnierAufTag).
        await verschiebeTurnierAufTag(ONLINE_BASE_URL, janPage.request, jan.token, turnierId, TURNIER_DATUM_WETTKAMPFTAG);

        turnierExportPfad = await exportiereTurnierDaten(janPage, ONLINE_BASE_URL, turnierId, 'phase4-online-nach-offline');
        expect(turnierExportPfad).toBeTruthy();
    });

    // --- PHASE 5: die heruntergeladene Turnier-Gesamtdatei wird auf dem Offline-Server
    // eingelesen (eigener Prozess/eigenes PostgreSQL, siehe playwright.vollablauf.config.js) — ab hier
    // simuliert offlinePage die Matte/den Laptop vor Ort ohne Internetverbindung.
    test('Phase 5: Turnierdaten werden auf dem Offline-Server eingelesen', async () => {
        offlineTurnierId = await importiereTurnierOffline(offlinePage, OFFLINE_BASE_URL, turnierExportPfad);
        expect(offlineTurnierId).toBeTruthy();

        await expect(offlinePage.locator('#statGesamtTeilnehmer')).toHaveText('100');

        const pfad = await exportiereTurnierDaten(offlinePage, OFFLINE_BASE_URL, offlineTurnierId, 'phase5-nach-offline-import');
        expect(pfad).toBeTruthy();
    });

    // --- PHASE 6: Waage-Simulation — alle 100 gemeldeten Teilnehmer + 3 neue FC-Kleingarten-
    // Walk-ins werden eingewogen (Gewicht + Judopass-Nr. + Lizenz, Startgeld war schon bezahlt).
    // Gewichte sind bewusst NICHT realistisch gestreut, sondern auf wenige feste DJB-
    // Gewichtsklassen konzentriert (siehe ermittleZielgewicht/GEWICHTS_BINS in helpers.js), damit
    // bei der Pool-Generierung (Phase 7) keine "kampflos"-Einzelpools entstehen.
    test('Phase 6: alle Teilnehmer + 3 Walk-ins von FC Kleingarten werden eingewogen', async () => {
        test.setTimeout(10 * 60 * 1000);

        await offlinePage.goto(`${OFFLINE_BASE_URL}/teilnehmer.html?id=${offlineTurnierId}`);

        let judopassLaufnummer = 1;
        for (const person of [...timRoster.personen, ...tomRoster.personen]) {
            const gewicht = ermittleZielgewicht(person.geschlecht, person.zielAltersklasse, person.gruppenIndex);
            await waegeTeilnehmerEin(offlinePage, {
                vorname: person.vorname, nachname: person.nachname, verein: person.verein,
                gewicht, judopassId: `E2E-${judopassLaufnummer++}`
            });
        }

        // 3 Walk-ins von FC Kleingarten — passend in bereits bestehende Gewichts-Bins einsortiert
        // (kein neuer Einzelpool): 1x U11 männlich, 1x U13 männlich, 1x U13 weiblich.
        const walkInGeburtsjahrU11 = WETTKAMPFJAHR - 9;
        const walkInGeburtsjahrU13 = WETTKAMPFJAHR - 12;
        await fuegeWalkInTeilnehmerHinzu(offlinePage, {
            vorname: 'Kai', nachname: 'Kleingarten', verein: 'FC Kleingarten',
            geburtsjahr: walkInGeburtsjahrU11, geschlecht: 'männlich',
            gewicht: ermittleZielgewicht('männlich', 'U11', 0), judopassId: `E2E-${judopassLaufnummer++}`
        });
        await fuegeWalkInTeilnehmerHinzu(offlinePage, {
            vorname: 'Finja', nachname: 'Kleingarten', verein: 'FC Kleingarten',
            geburtsjahr: walkInGeburtsjahrU13, geschlecht: 'weiblich',
            gewicht: ermittleZielgewicht('weiblich', 'U13', 1), judopassId: `E2E-${judopassLaufnummer++}`
        });
        await fuegeWalkInTeilnehmerHinzu(offlinePage, {
            vorname: 'Milan', nachname: 'Kleingarten', verein: 'FC Kleingarten',
            geburtsjahr: walkInGeburtsjahrU13, geschlecht: 'männlich',
            gewicht: ermittleZielgewicht('männlich', 'U13', 2), judopassId: `E2E-${judopassLaufnummer++}`
        });

        await expect(offlinePage.locator('#statGesamtTeilnehmer')).toHaveText('103');

        await markiereAlleAlsGewogen(offlinePage, 103);

        await synchronisiereMannschaftsPositionen(OFFLINE_BASE_URL, offlinePage.request, offlineTurnierId, [...timRoster.personen, ...tomRoster.personen]);

        const pfad = await exportiereTurnierDaten(offlinePage, OFFLINE_BASE_URL, offlineTurnierId, 'phase6-nach-waegen');
        expect(pfad).toBeTruthy();
    });

    // --- PHASE 7: Pool-Einteilung (Einzel + Mannschaft) und Matten-Einteilung, alles auf dem
    // Offline-Server (die Matte läuft ohne Internetverbindung).
    test('Phase 7: Pools werden generiert (keine Kampflos-Pools) und auf die Matten verteilt', async () => {
        test.setTimeout(60_000);

        await generierePoolsUndPruefeKampflos(offlinePage, OFFLINE_BASE_URL, offlinePage.request, offlineTurnierId);
        await verteileMannschaftenAutomatisch(offlinePage, OFFLINE_BASE_URL, offlineTurnierId);
        await verteilePoolsAufMatten(offlinePage, OFFLINE_BASE_URL, offlineTurnierId);

        const pfad = await exportiereTurnierDaten(offlinePage, OFFLINE_BASE_URL, offlineTurnierId, 'phase7-nach-pool-matten-verteilung');
        expect(pfad).toBeTruthy();
    });

    // --- PHASE 8: an Matte 1 und 2 per Scoreboard alle Kämpfe (Einzel + Mannschaft) direkt am
    // Hallen-Server abhandeln, siehe spieleMatteAmServerDurch.

    test('Phase 8: an Matte 1 und 2 werden alle Kämpfe im Scoreboard abgehandelt', async () => {
        test.setTimeout(10 * 60 * 1000);

        const kfResp = await offlinePage.request.get(`${OFFLINE_BASE_URL}/api/kampfflaechen?turnierId=${offlineTurnierId}`);
        const kampfflaechen = await kfResp.json();
        expect(kampfflaechen.length).toBe(2);

        for (const kf of kampfflaechen) {
            const gespielt = await spieleMatteAmServerDurch(mattePage, OFFLINE_BASE_URL, offlineTurnierId, kf.id);
            expect(gespielt, `Matte ${kf.id}: keine Kämpfe gespielt`).toBeGreaterThan(0);
        }

        const pfad = await exportiereTurnierDaten(offlinePage, OFFLINE_BASE_URL, offlineTurnierId, 'phase8-nach-matten-durchspielen');
        expect(pfad).toBeTruthy();

        // Manuelle Inspektion: mit PAUSE_AFTER_PHASE8=1 (und --headed, sonst sind keine
        // Browserfenster sichtbar) hält der Testlauf hier an — alle bisher geöffneten Fenster
        // (jan/tim/tom/offline/matte) bleiben sichtbar, bis im Playwright-Inspector auf
        // "Resume" geklickt wird. Ohne Klick läuft der Test (inkl. Phase 9/10 und Cleanup) nie zu
        // Ende — Fenster also nur ansehen und den Prozess danach im Terminal abbrechen (Strg+C),
        // nicht "Resume" drücken, sonst räumt der Teardown die Online-Testdaten weg wie gewohnt.
        if (process.env.PAUSE_AFTER_PHASE8) {
            await offlinePage.goto(`${OFFLINE_BASE_URL}/pools.html?id=${offlineTurnierId}`);
            await mattePage.pause();
        }
    });

    // --- PHASE 9: alle Kämpfe im Offline-Turnier sind abgeschlossen — die Ergebnisse liefen in
    // Phase 8 direkt beim Hallen-Server ein (mannschaftskaempfe-Sieger rechnet er dabei selbst,
    // triggerPoolUpdate in kampfController.js).
    test('Phase 9: alle Kämpfe des Offline-Turniers sind abgeschlossen', async () => {
        const kaempfeResp = await offlinePage.request.get(`${OFFLINE_BASE_URL}/api/pools/details?turnierId=${offlineTurnierId}`);
        const pools = await kaempfeResp.json();
        const unbeendet = pools.flatMap(p => p.kaempfe).filter(k => k.status !== 'beendet' && k.status !== 'freilos');
        expect(unbeendet, `${unbeendet.length} Kämpfe sind noch nicht abgeschlossen`).toEqual([]);

        const pfad = await exportiereTurnierDaten(offlinePage, OFFLINE_BASE_URL, offlineTurnierId, 'phase9-alle-kaempfe-beendet');
        expect(pfad).toBeTruthy();
    });

    // --- PHASE 10: die kompletten (jetzt abgeschlossenen) Turnierdaten vom Offline-Server
    // herunterladen und ins bestehende Online-Turnier hochladen — Turnier wird dabei automatisch
    // auf Status "abgeschlossen" gesetzt.
    test('Phase 10: die Turnierdaten werden vom Offline-Server heruntergeladen und ins Online-Turnier importiert', async () => {
        const finalerExportPfad = await exportiereTurnierDaten(offlinePage, OFFLINE_BASE_URL, offlineTurnierId, 'phase10-offline-nach-online');
        await importiereErgebnisseOnline(janPage, ONLINE_BASE_URL, turnierId, finalerExportPfad);

        const turnierResp = await janPage.request.get(`${ONLINE_BASE_URL}/api/turniere/${turnierId}`, {
            headers: { Authorization: `Bearer ${jan.token}` }
        });
        const turnier = await turnierResp.json();
        expect(turnier.status).toBe('abgeschlossen');
        expect(turnier.teilnehmer_anzahl).toBe(103);

        // Manuelle Inspektion: mit PAUSE_AFTER_PHASE10=1 (und --headed) hält der Testlauf hier an,
        // NACH dem Online-Reimport aber VOR dem globalTeardown (der das Test-Turnier aus der
        // echten Cloud-DB wieder löscht) — janPage zeigt die fertige Siegerliste des soeben
        // importierten Online-Turniers. Genau wie bei PAUSE_AFTER_PHASE8: nicht auf "Resume"
        // klicken (das würde direkt in den Teardown laufen), stattdessen nach dem Ansehen den
        // Prozess im Terminal mit Strg+C abbrechen — dann bleiben die Testdaten allerdings in der
        // Online-DB liegen und müssen beim nächsten normalen (unpausierten) Lauf wieder mit
        // aufgeräumt werden (das passiert automatisch, siehe MARKER_PREFIX-Fallback in
        // global-teardown.js).
        if (process.env.PAUSE_AFTER_PHASE10) {
            await janPage.goto(`${ONLINE_BASE_URL}/siegerliste.html?turnierId=${turnierId}`);
            await janPage.pause();
        }
    });
});
