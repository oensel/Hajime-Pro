// End-to-End: ein komplettes Doppel-KO-8-System (8 Teilnehmer, 11 Kämpfe: H1-H4, H5-H6,
// Trostrunde T1-T4, Finale F -- siehe DoppelKo8Manager.js/DOPPEL_KO_8_TOPOLOGIE) wird über
// steuerung.html gegen den echten Server (Bracket-Kaskade via kampfController.js/
// DoppelKo8Manager.js) durchgespielt. Entscheidungsregel: "W" (kaempfer1) gewinnt jeden Kampf per
// Ippon (siehe spieleKompletteBrackedDurch), damit steht das Endergebnis unabhängig von der
// Abspielreihenfolge fest.
//
// Das Gegenstück für Client-Geräte mit lokaler Dokument-DB (Kaskade offline über
// src/shared/kaskadeDokumente.js) ist tests/e2e-sync/client-vs-server-vergleich.spec.js.
//
// Turnier/Teilnehmer/Pool-Aufbau läuft bewusst über direkte API-Aufrufe statt über die
// Verwaltungsseiten (turnier.html/teilnehmer.html/pools.html, siehe die teilnehmer-*.spec.js-
// Dateien für deren UI-Abdeckung) -- hier geht es einzig um die Scoreboard-/Kaskaden-Logik, die
// Turnier-Anlage ist reine Testdaten-Vorbereitung. IS_OFFLINE=true im Testserver hängt jede
// Anfrage automatisch an einen Mock-Benutzer (siehe requireAuth in src/middleware/auth.js), daher
// sind dafür keine Auth-Header nötig.
import { test, expect } from '@playwright/test';
import { schliesseOverlayAutomatisch } from './helpers/pool-beginn-overlay.js';

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
    // deterministisches Raster (siehe
    // Kommentar oben an TEILNEHMER_FIXTUR sowie DoppelKo8Manager.js: die Teilnehmer werden nach
    // id sortiert gelesen, also in Einfüge-Reihenfolge).
    for (const teilnehmerId of teilnehmerIds) {
        const moveResp = await request.post('/api/pools/verschieben', { data: { teilnehmerId, zielPoolId: poolId } });
        expect(moveResp.ok(), await moveResp.text()).toBeTruthy();
    }

    const zuordnenResp = await request.put('/api/pools/kampfflaeche-zuordnen', { data: { poolId, kampflaecheId: matId, position: 1 } });
    expect(zuordnenResp.ok(), await zuordnenResp.text()).toBeTruthy();

    return { turnierId, matId, poolId };
}

// Spielt alle 11 Kämpfe eines frisch geladenen Doppel-KO-8-Pools über die exakt gleiche
// steuerung.html-Bedienfolge durch (naechstenKampfHolen()/ergebnisSenden() in scoreboard.js).
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

// Reduziert eine Kämpfe-Liste aus GET /api/kaempfe auf das für die Prüfung Relevante,
// geschlüsselt nach reihenfolge_nummer (H1..F) statt nach roher Kampf-/Teilnehmer-ID.
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

test.describe.serial('Doppel-KO-8 komplett austragen über den Hallen-Server', () => {
    let onlinePage;
    let onlineMatId;
    let onlineErgebnis;

    test.beforeAll(async ({ browser }) => {
        const onlineContext = await browser.newContext();
        onlinePage = await onlineContext.newPage();
        await schliesseOverlayAutomatisch(onlinePage);
    });

    test.afterAll(async () => {
        await onlinePage.context().close();
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
});
