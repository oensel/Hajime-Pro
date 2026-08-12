// End-to-End: ein komplettes Doppel-KO-8-System (8 Teilnehmer, 11 Kämpfe: H1-H4, H5-H6,
// Trostrunde T1-T4, Finale F -- siehe DoppelKo8Manager.js/DOPPEL_KO_8_TOPOLOGIE) wird EINMAL
// online (echter Server, echte Bracket-Kaskade via kampfController.js/DoppelKo8Manager.js) und
// EINMAL offline (JSON-Export/Import, Kaskade rein clientseitig über aktualisiereTurnierOffline()
// in scoreboard.js, siehe steuerung-offline-modus.spec.js) mit IDENTISCHEN Ausgangsdaten
// durchgespielt. Beide Durchläufe verwenden dieselbe deterministische Entscheidungsregel ("W",
// also kaempfer1, gewinnt jeden Kampf per Ippon" -- siehe Kommentar bei
// spieleKompletteBrackedDurch), wodurch das Endergebnis unabhängig von der genauen
// Abspielreihenfolge feststeht (jeder Kampf wird ausschließlich durch seine beiden tatsächlichen
// Teilnehmer entschieden, nicht durch die Reihenfolge, in der die 11 Kämpfe angefasst werden --
// online sortiert /api/kaempfe nach matten_reihenfolge, offline exportiert ohne Sortierung nach
// Kampf-ID, das ist also bewusst NICHT dieselbe Abspielreihenfolge).
//
// Der Vergleich am Ende ist der eigentliche Zweck dieser Datei: er beweist, dass die reine,
// server- UND clientseitig geteilte Kaskaden-Engine (src/shared/kampfProgression.js) in beiden
// Modi zu exakt demselben Turnierbaum (wer kämpft gegen wen, wer gewinnt, welche Punkte) führt --
// ein Abweichen hier würde bedeuten, dass eine an der Matte offline ausgetragene Runde beim
// Wieder-Einspielen ins Online-Turnier (offlineController.js:importMatResults) ein anderes
// Ergebnis liefern würde als hätte man von Anfang an online gespielt.
//
// Turnier/Teilnehmer/Pool-Aufbau läuft bewusst über direkte API-Aufrufe statt über die
// Verwaltungsseiten (turnier.html/teilnehmer.html/pools.html, siehe die teilnehmer-*.spec.js-
// Dateien für deren UI-Abdeckung) -- hier geht es einzig um die Scoreboard-/Kaskaden-Logik, die
// Turnier-Anlage ist reine Testdaten-Vorbereitung. IS_OFFLINE=true im Testserver hängt jede
// Anfrage automatisch an einen Mock-Benutzer (siehe requireAuth in src/middleware/auth.js), daher
// sind dafür keine Auth-Header nötig.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';

// Acht Teilnehmer, alle mit unterschiedlichem Verein (damit die Vereinstrennung in
// DoppelKo8Manager.initialisierePool() keine Rolle spielt) und streng aufsteigendem Gewicht.
// Das ergibt bei der Vereins-/Gewichts-Verteilung des Managers deterministisch das Raster
// [Anna, Elena, Berta, Frida, Clara, Greta, Diana, Hanna] (0-indiziert) und damit die
// Erstrunden-Paarungen H1=Anna/Elena, H2=Berta/Frida, H3=Clara/Greta, H4=Diana/Hanna.
const TEILNEHMER_FIXTUR = [
    { vorname: 'Anna', nachname: 'Adler', verein: 'JC Alpha', gewicht: 60 },
    { vorname: 'Berta', nachname: 'Busch', verein: 'JC Beta', gewicht: 61 },
    { vorname: 'Clara', nachname: 'Conrad', verein: 'JC Gamma', gewicht: 62 },
    { vorname: 'Diana', nachname: 'Diehl', verein: 'JC Delta', gewicht: 63 },
    { vorname: 'Elena', nachname: 'Ebert', verein: 'JC Epsilon', gewicht: 64 },
    { vorname: 'Frida', nachname: 'Fuchs', verein: 'JC Zeta', gewicht: 65 },
    { vorname: 'Greta', nachname: 'Graf', verein: 'JC Eta', gewicht: 66 },
    { vorname: 'Hanna', nachname: 'Hoffmann', verein: 'JC Theta', gewicht: 67 }
];

// Legt ein komplettes Turnier + eine Kampffläche + einen Pool mit den 8 Fixtur-Teilnehmern an und
// ordnet den Pool der Matte zu -- danach hat der Pool automatisch 11 Doppel-KO-8-Kämpfe (siehe
// regeneriereKampfplanFuerPool()/waehleWettkampfsystem() in poolController.js: bei genau 8
// zugeordneten Teilnehmern wird der Kampfplan bei jeder Zuordnung neu als "Doppel-KO-8" erzeugt).
async function richteDk8TurnierEin(request, bezeichnung) {
    const turnierResp = await request.post('/api/turniere', {
        data: { bezeichnung, ort: 'Teststadt', datum: '2027-03-20', ausrichter: 'JC Test', anzahl_kampfflaechen: 1 }
    });
    expect(turnierResp.ok(), await turnierResp.text()).toBeTruthy();
    const { turnierId } = await turnierResp.json();

    const mattenResp = await request.get(`/api/kampfflaechen?turnierId=${turnierId}`);
    const [{ id: matId }] = await mattenResp.json();

    const poolResp = await request.post('/api/pools', {
        data: { turnier_id: turnierId, bezeichnung: `${bezeichnung} Pool`, altersklasse: 'U18', geschlecht: 'männlich', gewichtsklasse: '-73kg' }
    });
    expect(poolResp.ok(), await poolResp.text()).toBeTruthy();
    const { poolId } = await poolResp.json();

    const teilnehmerIds = [];
    for (const t of TEILNEHMER_FIXTUR) {
        const tResp = await request.post('/api/teilnehmer', {
            data: {
                turnier_id: turnierId, vorname: t.vorname, nachname: t.nachname, verein: t.verein,
                geburtsjahr: 2009, geschlecht: 'männlich', gewicht: t.gewicht,
                altersklasse: 'U18', gewichtsklasse: '-73kg'
            }
        });
        expect(tResp.ok(), await tResp.text()).toBeTruthy();
        const { teilnehmerId } = await tResp.json();
        teilnehmerIds.push(teilnehmerId);
    }

    // Reihenfolge ist bewusst identisch zu TEILNEHMER_FIXTUR -- das ist Voraussetzung für ein
    // deterministisch identisches Raster zwischen dem Online- und dem Offline-Turnier (siehe
    // Kommentar oben an TEILNEHMER_FIXTUR sowie DoppelKo8Manager.js: die Teilnehmer werden ohne
    // eigenes ORDER BY gelesen, SQLite liefert ohne Sortierung Einfüge-/Rowid-Reihenfolge).
    for (const teilnehmerId of teilnehmerIds) {
        const moveResp = await request.post('/api/pools/verschieben', { data: { teilnehmerId, zielPoolId: poolId } });
        expect(moveResp.ok(), await moveResp.text()).toBeTruthy();
    }

    const zuordnenResp = await request.put('/api/pools/kampfflaeche-zuordnen', { data: { poolId, kampflaecheId: matId, position: 1 } });
    expect(zuordnenResp.ok(), await zuordnenResp.text()).toBeTruthy();

    return { turnierId, matId, poolId };
}

// Spielt alle 11 Kämpfe eines frisch geladenen Doppel-KO-8-Pools über die exakt gleiche
// steuerung.html-Bedienfolge durch, egal ob online oder offline (die Funktionen hinter den
// Buttons/window.changeScore nehmen online/offline-intern unterschiedliche Zweige, siehe
// naechstenKampfHolen()/ergebnisSenden() in scoreboard.js -- von außen/UI-seitig ist das
// ununterscheidbar, was diesen einen Vergleichstest überhaupt erst sinnvoll macht).
//
// Entscheidungsregel: "W" (kaempfer1, siehe naechstenKampfHolen()) gewinnt IMMER per Ippon. Das
// Endergebnis jedes einzelnen benannten Kampfes (H1..F) hängt nur von dessen beiden tatsächlichen
// Teilnehmern ab, die wiederum eindeutig aus dem (identischen) Ausgangsraster + dieser Regel
// folgen -- unabhängig davon, in welcher Reihenfolge die 11 Kämpfe nacheinander geholt werden.
async function spieleKompletteBrackedDurch(page, anzahlKaempfe = 11) {
    // Default-Werte von #nameW/#nameB vor dem ersten geladenen Kampf. Beide zusammen (nicht nur
    // nameW) beobachten: derselbe Kämpfer kann in zwei verschiedenen Kämpfen hintereinander als
    // Kämpfer 1 antreten (z.B. Gruppen-Überkreuz-Vorrunde, wo eine Person gegen mehrere
    // Gruppenmitglieder in Folge kämpft) -- die Paarung (kaempfer1, kaempfer2) selbst wiederholt
    // sich dagegen nie, jeder Kampf hat eine eindeutige Zwei-Personen-Kombination.
    const paarungAuslesen = () => page.evaluate(() =>
        `${document.getElementById('nameW').value}|${document.getElementById('nameB').value}`
    );
    let vorherigePaarung = 'Kämpfer 1|Kämpfer 2';
    for (let i = 0; i < anzahlKaempfe; i++) {
        await page.locator('#btnNaechsterKampfLive').click();
        // Wartet, bis naechstenKampfHolen() den Kampf tatsächlich geladen hat, bevor per
        // window.evaluate() (ohne Playwright-Actionability-Wartung) eingegriffen wird -- siehe
        // denselben Race-Condition-Kommentar in steuerung-anzeige-scoreboard.spec.js.
        await page.waitForFunction(
            (vorher) => `${document.getElementById('nameW').value}|${document.getElementById('nameB').value}` !== vorher,
            vorherigePaarung
        );
        vorherigePaarung = await paarungAuslesen();

        await page.evaluate(() => window.changeScore('W', 'ippon', 1));
        await expect(page.locator('#btnErgebnisSendenLive')).toBeVisible();

        await page.locator('#btnErgebnisSendenLive').click();
        await expect(page.locator('#btnNaechsterKampfLive')).toBeVisible();
    }
}

// Reduziert eine Kämpfe-Liste (egal ob aus GET /api/kaempfe oder aus einer Offline-Export-Datei)
// auf das für den Vergleich Relevante, geschlüsselt nach reihenfolge_nummer (H1..F) statt nach
// roher Kampf-/Teilnehmer-ID -- die IDs unterscheiden sich zwangsläufig zwischen dem Online- und
// dem Offline-Turnier (zwei komplett getrennte Turniere), die Namen und die Bracket-Struktur
// müssen es aber nicht.
function normalisiereKaempfe(kaempfe) {
    const namePro = (nachname, vorname) => (nachname ? `${nachname}, ${vorname}` : null);
    const byNr = {};
    for (const k of kaempfe) {
        byNr[k.reihenfolge_nummer] = {
            status: k.status,
            kaempfer1: namePro(k.kaempfer1_nachname, k.kaempfer1_vorname),
            kaempfer2: namePro(k.kaempfer2_nachname, k.kaempfer2_vorname),
            siegerSeite: k.sieger_id === k.kaempfer1_id ? 'kaempfer1' : (k.sieger_id === k.kaempfer2_id ? 'kaempfer2' : null),
            unterbewertung_kaempfer1: k.unterbewertung_kaempfer1,
            unterbewertung_kaempfer2: k.unterbewertung_kaempfer2
        };
    }
    return byNr;
}

test.describe.serial('Doppel-KO-8 komplett austragen: Online-Modus vs. Offline-Modus mit identischen Ausgangsdaten', () => {
    let onlinePage;
    let offlinePage;
    let onlineMatId;
    let offlineMatId;
    let onlineErgebnis;
    let offlineErgebnis;

    test.beforeAll(async ({ browser }) => {
        const onlineContext = await browser.newContext();
        const offlineContext = await browser.newContext({ acceptDownloads: true });
        onlinePage = await onlineContext.newPage();
        offlinePage = await offlineContext.newPage();
    });

    test.afterAll(async () => {
        await onlinePage.context().close();
        await offlinePage.context().close();
    });

    test('Online: komplettes Doppel-KO-8-Turnier über den echten Server austragen', async ({ request }) => {
        const { turnierId, matId } = await richteDk8TurnierEin(request, 'DK8-Online-Vergleich');
        onlineMatId = matId;

        await onlinePage.goto(`/steuerung.html?turnierId=${turnierId}&matId=${matId}`);
        await expect(onlinePage.locator('#matSelect')).toHaveValue(String(matId));

        await spieleKompletteBrackedDurch(onlinePage, 11);

        const kaempfeResp = await request.get(`/api/kaempfe?kampfflaecheId=${matId}`);
        const kaempfe = await kaempfeResp.json();
        expect(kaempfe).toHaveLength(11);
        expect(kaempfe.every(k => k.status === 'beendet')).toBe(true);

        onlineErgebnis = normalisiereKaempfe(kaempfe);

        // Anna (Raster-Slot 0, gewinnt H1, H5 und schließlich das Finale F als "W") ist Champion.
        expect(onlineErgebnis.F.siegerSeite).toBe('kaempfer1');
        expect(onlineErgebnis.F.kaempfer1).toBe('Adler, Anna');
    });

    test('Offline: identisches Doppel-KO-8-Turnier exportieren, komplett offline austragen und wieder exportieren', async ({ request }) => {
        const { matId } = await richteDk8TurnierEin(request, 'DK8-Offline-Vergleich');
        offlineMatId = matId;

        const exportResp = await request.get(`/api/offline/export?kampfflaecheId=${matId}`);
        expect(exportResp.ok(), await exportResp.text()).toBeTruthy();
        const offlineDaten = await exportResp.json();
        expect(offlineDaten.kaempfe).toHaveLength(11);

        // Frei erfundene turnierId (siehe identischer Kommentar in steuerung-offline-modus.spec.js):
        // vermeidet das blockierende Turnier-Auswahl-Modal, das sonst erscheint, weil im Zuge
        // dieser Datei (und ggf. anderer, zuvor gelaufener Spec-Dateien) längst echte Turniere in
        // der DB existieren -- unabhängig davon bleibt der Ablauf ab dem Offline-Import komplett
        // netzwerkfrei.
        await offlinePage.goto('/steuerung.html?turnierId=999999999');
        await offlinePage.locator('#offlineImportInput').setInputFiles({
            name: `ergebnisse_matte_${matId}.json`,
            mimeType: 'application/json',
            buffer: Buffer.from(JSON.stringify(offlineDaten))
        });
        await expect(offlinePage.locator('#connectionModeText')).toHaveText('Offline (Lokal)');

        await spieleKompletteBrackedDurch(offlinePage, 11);

        const [download] = await Promise.all([
            offlinePage.waitForEvent('download'),
            offlinePage.locator('#btnOfflineExport').click()
        ]);
        const exportiert = JSON.parse(fs.readFileSync(await download.path(), 'utf-8'));
        expect(exportiert.kaempfe).toHaveLength(11);
        expect(exportiert.kaempfe.every(k => k.status === 'beendet')).toBe(true);

        offlineErgebnis = normalisiereKaempfe(exportiert.kaempfe);

        expect(offlineErgebnis.F.siegerSeite).toBe('kaempfer1');
        expect(offlineErgebnis.F.kaempfer1).toBe('Adler, Anna');
    });

    test('Online- und Offline-Ergebnis stimmen für alle 11 Kämpfe exakt überein', () => {
        expect(offlineMatId).not.toBe(onlineMatId); // echte, getrennte Turniere -- kein Bug, der zufällig "passt"
        expect(offlineErgebnis).toEqual(onlineErgebnis);
    });
});
