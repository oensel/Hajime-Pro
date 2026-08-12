// End-to-End: Szenario 1 ("volle Cloud-Lösung") als EIN durchgängiger Test -- bislang waren
// "Fremdverein-Anmeldung" (turnier-vollablauf.spec.js, das danach aber auf ein Offline-Gerät
// exportiert) und "live gegen die Cloud spielen, kein Export" (turnier-cloud-live-mehrere-matten.
// spec.js, das aber die Teilnehmer selbst per API statt echter Fremdverein-Anmeldung anlegt) nie
// in einem einzigen Lauf verbunden. Dieser Test schließt genau diese Lücke:
//
//   Turnier veröffentlicht -> Anmeldung durch zwei ECHTE Fremdvereine (tim/tom, live per API mit
//   ihrem jeweils eigenen Zugangs-Token) -> jan (Gastgeber) markiert bezahlt + wiegt ein -> Pools
//   automatisch generieren (echte DJB-Gewichtsklassen-Logik) -> Matte verteilen -> EIN separater
//   "Matten-Rechner" spielt den Pool live gegen den Cloud-Server durch.
//
// An KEINER Stelle findet ein Export/Import statt -- alles läuft die ganze Zeit gegen denselben
// echten Online-Server (ONLINE_BASE_URL). Bewusst ein einzelner Pool/eine einzelne Kampffläche
// ("ja einem Rechner an der Wettkampffläche", siehe Nutzer-Formulierung) statt mehrerer -- die
// Mehrere-Matten-gleichzeitig-Frage ist bereits eigenständig in
// turnier-cloud-live-mehrere-matten.spec.js abgedeckt.
//
// Teilnehmer-Anmeldung läuft hier bewusst per Direkt-API (mit tim/tom's eigenem Bearer-Token)
// statt der vollen CSV-Import-UI-Simulation aus turnier-vollablauf.spec.js -- die Import-UI selbst
// ist bereits eigenständig ausführlich getestet (tests/e2e/teilnehmer-import-*.spec.js); hier geht
// es nur darum, dass eine ECHTE, andere, per Vereinszugehörigkeit beschränkte Identität
// (hatVereinsZugriffAufTurnier in vereinHelper.js) erfolgreich Teilnehmer anmelden kann, während
// alles Weitere live auf der Cloud bleibt.
import { test, expect } from '@playwright/test';
import { meldeAn, legeTurnierAn, veroeffentlicheTurnier, markiereAlleAlsBezahlt, waegeTeilnehmerEin, generierePoolsUndPruefeKampflos, verteilePoolsAufMatten } from './helpers.js';
import { ONLINE_BASE_URL } from './test-env.js';

const HEUTE = new Date();
const WETTKAMPFJAHR = HEUTE.getFullYear() + 1;
const TURNIER_DATUM = `${WETTKAMPFJAHR}-09-20`;
// "Jahrgänge 09-11" für U18 (siehe altersklassen.json) -> Geburtsjahr Wettkampfjahr-10 liegt sicher
// in der Mitte dieser Spanne.
const GEBURTSJAHR_U18 = WETTKAMPFJAHR - 10;
// Alle Teilnehmer bekommen bei Anmeldung UND beim offiziellen Wiegen absichtlich dasselbe (grobe)
// Zielgewicht: landen damit alle in derselben DJB-Gewichtsklasse "-73" (siehe altersklassen.json,
// männlich U18) -> genau ein Pool mit 8 Personen -> automatisch Doppel-KO-8 (siehe
// waehleWettkampfsystem in poolController.js). Die beiden Werte müssen sich aber unterscheiden:
// waage-modal.js zeigt die "Als gewogen markieren?"-Rückfrage nur bei einer TATSÄCHLICHEN
// Gewichtsänderung (gewichtGeaendert = gewichtFormatiert !== vorherigesGewicht) -- bei identischem
// Wert bliebe der Teilnehmer sonst fälschlich "nicht gewogen" stehen, obwohl jan das Formular
// abgeschickt hat.
const VORLAEUFIGES_GEWICHT = 68; // vom Verein bei der Anmeldung geschätzt
const ZIEL_GEWICHT = 70; // amtliches Ergebnis der Waage, beides fällt unter "-73"

test.describe.serial('Szenario 1 (volle Cloud-Lösung) als ein durchgängiger Test: Veröffentlichung -> Fremdverein-Anmeldung -> Pools -> Matte live, kein Export/Import', () => {
    let janPage, timPage, tomPage, mattePage;
    let jan, tim, tom;
    let turnierId;
    let poolId;
    let matId;

    test.beforeAll(async ({ browser }) => {
        janPage = await (await browser.newContext()).newPage();
        timPage = await (await browser.newContext()).newPage();
        tomPage = await (await browser.newContext()).newPage();
        mattePage = await (await browser.newContext()).newPage();
    });

    test.afterAll(async () => {
        await janPage.context().close();
        await timPage.context().close();
        await tomPage.context().close();
        await mattePage.context().close();
    });

    test('Phase 1: jan meldet sich an, legt das Turnier an und veröffentlicht es', async ({ request }) => {
        jan = await meldeAn(janPage, ONLINE_BASE_URL, request, { email: 'jan@test.de', password: 'JanTest123' });

        turnierId = await legeTurnierAn(janPage, ONLINE_BASE_URL, {
            bezeichnung: 'Cloud-Voller-Ablauf-Turnier', datum: TURNIER_DATUM, ort: 'Senden', plz: '48308',
            ausrichter: 'JC Senden', anzahlKampfflaechen: 1, bundesland: 'Nordrhein-Westfalen',
            einzelKlassenWerte: ['männlich_U18']
        });
        expect(turnierId).toBeTruthy();

        await veroeffentlicheTurnier(ONLINE_BASE_URL, janPage.request, jan.token, turnierId);
    });

    // --- PHASE 2: zwei ECHTE, unterschiedliche Fremdvereine (tim, tom) melden je 4 Teilnehmer
    // direkt per API mit ihrem eigenen Zugangs-Token an -- kein Export/Import, keine
    // Gastgeber-Rechte nötig (createTeilnehmer erlaubt jedem angemeldeten Vereinsmitglied die
    // Anmeldung eigener Athlet:innen für ein veröffentlichtes fremdes Turnier, siehe
    // teilnehmerController.js).
    test('Phase 2: tim und tom (zwei echte Fremdvereine) melden je 4 Teilnehmer live beim Cloud-Server an', async ({ request }) => {
        tim = await meldeAn(timPage, ONLINE_BASE_URL, request, { email: 'tim@test.de', password: 'TimTest123' });
        tom = await meldeAn(tomPage, ONLINE_BASE_URL, request, { email: 'tom@test.de', password: 'TomTest123' });

        const VORNAMEN = ['Finn', 'Luca', 'Paul', 'Ben', 'Noah', 'Elias', 'Jonas', 'Max'];
        const NACHNAMEN = ['Schmidt', 'Müller', 'Fischer', 'Weber', 'Meyer', 'Wagner', 'Becker', 'Schulz'];

        let n = 0;
        for (const [meldenderVerein, page, vereinName] of [[tim, timPage, tim.vereinName], [tom, tomPage, tom.vereinName]]) {
            for (let i = 0; i < 4; i++) {
                // gewicht muss bereits hier mitgeschickt werden: anders als beim CSV-Bulk-Import
                // (der ein leeres Gewicht ausdrücklich zulässt, siehe Kommentar in helpers.js)
                // verlangt der Einzel-Endpoint POST /api/teilnehmer eine daraus ableitbare
                // Gewichtsklasse und lehnt sonst mit 400 ab (siehe createTeilnehmer in
                // teilnehmerController.js) -- das End-/offizielle Wiegen samt "gewogen"-Status
                // bleibt trotzdem jans Aufgabe in Phase 3 (Gastvereine dürfen "gewogen" laut
                // Server ohnehin nicht selbst setzen).
                const tResp = await page.request.post(`${ONLINE_BASE_URL}/api/teilnehmer`, {
                    headers: { Authorization: `Bearer ${meldenderVerein.token}` },
                    data: {
                        turnier_id: turnierId, vorname: VORNAMEN[n], nachname: NACHNAMEN[n],
                        geburtsjahr: GEBURTSJAHR_U18, geschlecht: 'männlich', verein: vereinName,
                        altersklasse: 'U18', gewicht: VORLAEUFIGES_GEWICHT
                    }
                });
                expect(tResp.ok(), await tResp.text()).toBeTruthy();
                n++;
            }
        }

        const teilnehmerResp = await request.get(`${ONLINE_BASE_URL}/api/teilnehmer?turnierId=${turnierId}`, {
            headers: { Authorization: `Bearer ${jan.token}` }
        });
        const teilnehmer = await teilnehmerResp.json();
        expect(teilnehmer).toHaveLength(8);
    });

    // --- PHASE 3: jan (Gastgeber) markiert alle als bezahlt und wiegt sie ein -- weiterhin live
    // auf demselben Cloud-Server, kein Export/Import.
    test('Phase 3: jan markiert alle Teilnehmer als bezahlt und wiegt sie ein', async () => {
        test.setTimeout(60_000);

        await janPage.goto(`${ONLINE_BASE_URL}/teilnehmer.html?id=${turnierId}`);
        await expect(janPage.locator('#statGesamtTeilnehmer')).toHaveText('8');

        await markiereAlleAlsBezahlt(janPage, 8);

        const teilnehmerResp = await janPage.request.get(`${ONLINE_BASE_URL}/api/teilnehmer?turnierId=${turnierId}`, {
            headers: { Authorization: `Bearer ${jan.token}` }
        });
        const teilnehmer = await teilnehmerResp.json();

        let judopassLaufnummer = 1;
        for (const person of teilnehmer) {
            await waegeTeilnehmerEin(janPage, {
                vorname: person.vorname, nachname: person.nachname, verein: person.verein,
                gewicht: ZIEL_GEWICHT, judopassId: `E2E-CLOUD1-${judopassLaufnummer++}`
            });
        }
    });

    // --- PHASE 4: Pools automatisch generieren (echte DJB-Gewichtsklassen-Logik) und auf die
    // (einzige) Kampffläche verteilen -- weiterhin live, kein Export/Import.
    test('Phase 4: Pool wird automatisch generiert (kein Kampflos) und der Kampffläche zugeordnet', async ({ request }) => {
        test.setTimeout(60_000);

        const pools = await generierePoolsUndPruefeKampflos(janPage, ONLINE_BASE_URL, request, turnierId, jan.token);
        expect(pools).toHaveLength(1);
        expect(pools[0].anzahl_teilnehmer).toBe(8);
        poolId = pools[0].id;

        await verteilePoolsAufMatten(janPage, ONLINE_BASE_URL, turnierId);

        const mattenResp = await request.get(`${ONLINE_BASE_URL}/api/kampfflaechen?turnierId=${turnierId}`, {
            headers: { Authorization: `Bearer ${jan.token}` }
        });
        const [matte] = await mattenResp.json();
        matId = matte.id;

        const poolCheckResp = await request.get(`${ONLINE_BASE_URL}/api/pools/${poolId}`, {
            headers: { Authorization: `Bearer ${jan.token}` }
        });
        const pool = await poolCheckResp.json();
        expect(pool.kampfflaeche_id).toBe(matId);
    });

    // --- PHASE 5: EIN separater "Matten-Rechner" (eigener Browser-Kontext, meldet sich selbst an
    // -- vereinsbasierte Zugriffsrechte erlauben nur jans eigenem Verein das Werten, siehe
    // requireTournamentEditAccess in src/middleware/auth.js) spielt den kompletten Pool live gegen
    // den Cloud-Server durch. Kein Export/Import an dieser Stelle -- das ist der eigentliche
    // Unterschied zu turnier-vollablauf.spec.js (dort läuft diese Phase per Datei-Ex-/Import).
    test('Phase 5: die Wettkampffläche spielt den Pool live gegen den Cloud-Server durch', async ({ request }) => {
        test.setTimeout(60_000);

        await meldeAn(mattePage, ONLINE_BASE_URL, request, { email: 'jan@test.de', password: 'JanTest123' });
        await mattePage.goto(`${ONLINE_BASE_URL}/steuerung.html?turnierId=${turnierId}&matId=${matId}`);
        await expect(mattePage.locator('#matSelect')).toHaveValue(String(matId));

        let vorherigePaarung = 'Kämpfer 1|Kämpfer 2';
        for (let i = 0; i < 11; i++) {
            await mattePage.locator('#btnNaechsterKampfLive').click();
            await mattePage.waitForFunction(
                (vorher) => `${document.getElementById('nameW').value}|${document.getElementById('nameB').value}` !== vorher,
                vorherigePaarung
            );
            vorherigePaarung = await mattePage.evaluate(() =>
                `${document.getElementById('nameW').value}|${document.getElementById('nameB').value}`
            );

            await mattePage.evaluate(() => window.changeScore('W', 'ippon', 1));
            await expect(mattePage.locator('#btnErgebnisSendenLive')).toBeVisible();

            await mattePage.locator('#btnErgebnisSendenLive').click();
            await expect(mattePage.locator('#btnNaechsterKampfLive')).toBeVisible();
        }

        const kaempfeResp = await request.get(`${ONLINE_BASE_URL}/api/kaempfe?kampfflaecheId=${matId}`, {
            headers: { Authorization: `Bearer ${jan.token}` }
        });
        const kaempfe = await kaempfeResp.json();
        expect(kaempfe).toHaveLength(11);
        expect(kaempfe.every(k => k.status === 'beendet')).toBe(true);

        const finale = kaempfe.find(k => k.reihenfolge_nummer === 'F');
        expect(finale.sieger_id).toBe(finale.kaempfer1_id);
    });
});
