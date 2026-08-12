// End-to-End: analog zu steuerung-dk8-online-vs-offline.spec.js (siehe dortige ausführliche
// Kommentare zur Begründung des Vergleichsaufbaus), hier für Gruppen-Überkreuz (6 Teilnehmer,
// 10 Kämpfe: V_A_1-3/V_B_1-3, HF1/HF2, F1/F2 -- siehe GruppenUeberKreuzManager.js).
//
// Der Offline-Durchlauf dieses Tests ist der eigentliche Zweck der Datei: HF1/HF2 kommen aus
// einer Ranglistenberechnung über die Vorrunde (nicht aus einem einzelnen Quellkampf) und wurden
// bis vor Kurzem NUR serverseitig berechnet -- eine Matte, die während der Gruppenphase offline
// ging, blieb bei HF1/HF2 für immer stecken. Inzwischen liegt diese Berechnung in
// src/shared/gruppenUeberkreuzProgression.js, damit sowohl der Server
// (GruppenUeberKreuzManager.js) als auch der Offline-Client (scoreboard.js,
// aktualisiereTurnierOffline()) dieselbe Engine nutzen. Dieser Test spielt bewusst über die
// normale steuerung.html-Bedienfolge, NICHT über direkte API-Aufrufe -- nur so durchläuft der
// Offline-Zweig wirklich aktualisiereTurnierOffline() statt der Server-Route.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';

// 6 Teilnehmer, alle mit unterschiedlichem Verein, aufsteigendes Gewicht -- ergibt bei der
// Gruppenzuteilung von GruppenUeberKreuzManager._teileTeilnehmerAuf() deterministisch Gruppe A =
// [Anna, Clara, Elena] (Index 0/2/4), Gruppe B = [Berta, Diana, Frida] (Index 1/3/5).
const TEILNEHMER_FIXTUR = [
    { vorname: 'Anna', nachname: 'Adler', verein: 'JC Alpha', gewicht: 60 },
    { vorname: 'Berta', nachname: 'Busch', verein: 'JC Beta', gewicht: 61 },
    { vorname: 'Clara', nachname: 'Conrad', verein: 'JC Gamma', gewicht: 62 },
    { vorname: 'Diana', nachname: 'Diehl', verein: 'JC Delta', gewicht: 63 },
    { vorname: 'Elena', nachname: 'Ebert', verein: 'JC Epsilon', gewicht: 64 },
    { vorname: 'Frida', nachname: 'Fuchs', verein: 'JC Zeta', gewicht: 65 }
];

async function richteTurnierEin(request, bezeichnung) {
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

    // Reihenfolge identisch zur Fixtur -- Voraussetzung für eine deterministisch identische
    // Gruppenzuteilung zwischen Online- und Offline-Turnier (siehe GruppenUeberKreuzManager.js:
    // Teilnehmer werden ohne eigenes ORDER BY gelesen, SQLite liefert ohne Sortierung
    // Einfüge-/Rowid-Reihenfolge).
    for (const teilnehmerId of teilnehmerIds) {
        const moveResp = await request.post('/api/pools/verschieben', { data: { teilnehmerId, zielPoolId: poolId } });
        expect(moveResp.ok(), await moveResp.text()).toBeTruthy();
    }

    const zuordnenResp = await request.put('/api/pools/kampfflaeche-zuordnen', { data: { poolId, kampflaecheId: matId, position: 1 } });
    expect(zuordnenResp.ok(), await zuordnenResp.text()).toBeTruthy();

    return { turnierId, matId, poolId };
}

// Identisch zu spieleKompletteBrackedDurch() in steuerung-dk8-online-vs-offline.spec.js: "W"
// (kaempfer1) gewinnt jeden Kampf per Ippon. Im Offline-Zweig ist das hier der eigentliche Test:
// HF1/HF2 werden erst NACH den 6 Vorrundenkämpfen überhaupt spielbar (Ranglistenberechnung, siehe
// Kommentar am Dateianfang) -- bricht diese Berechnung offline nicht mehr durch, lädt
// "Nächster Kampf" hier nach der Vorrunde keinen weiteren Kampf mehr, und die Schleife bleibt bei
// 6 (statt 10) Kämpfen stehen bzw. die spätere expect(...).toHaveLength(10)-Prüfung schlägt fehl.
async function spieleKompletteBrackedDurch(page, anzahlKaempfe) {
    // Paarung (kaempfer1|kaempfer2) statt nur nameW beobachten: in der Vorrunde tritt dieselbe
    // Person mehrfach hintereinander als Kämpfer 1 gegen wechselnde Gruppenmitglieder an (siehe
    // ausführlichen Kommentar in steuerung-dk8-online-vs-offline.spec.js) -- die Paarung selbst
    // wiederholt sich nie.
    let vorherigePaarung = 'Kämpfer 1|Kämpfer 2';
    for (let i = 0; i < anzahlKaempfe; i++) {
        await page.locator('#btnNaechsterKampfLive').click();
        await page.waitForFunction(
            (vorher) => `${document.getElementById('nameW').value}|${document.getElementById('nameB').value}` !== vorher,
            vorherigePaarung
        );
        vorherigePaarung = await page.evaluate(() =>
            `${document.getElementById('nameW').value}|${document.getElementById('nameB').value}`
        );

        await page.evaluate(() => window.changeScore('W', 'ippon', 1));
        await expect(page.locator('#btnErgebnisSendenLive')).toBeVisible();

        await page.locator('#btnErgebnisSendenLive').click();
        await expect(page.locator('#btnNaechsterKampfLive')).toBeVisible();
    }
}

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

test.describe.serial('Gruppen-Überkreuz komplett austragen: Online-Modus vs. Offline-Modus mit identischen Ausgangsdaten', () => {
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

    test('Online: komplettes Gruppen-Überkreuz-Turnier über den echten Server austragen', async ({ request }) => {
        const { turnierId, matId } = await richteTurnierEin(request, 'GÜ-Online-Vergleich');
        onlineMatId = matId;

        await onlinePage.goto(`/steuerung.html?turnierId=${turnierId}&matId=${matId}`);
        await expect(onlinePage.locator('#matSelect')).toHaveValue(String(matId));

        await spieleKompletteBrackedDurch(onlinePage, 10);

        const kaempfeResp = await request.get(`/api/kaempfe?kampfflaecheId=${matId}`);
        const kaempfe = await kaempfeResp.json();
        expect(kaempfe).toHaveLength(10);
        expect(kaempfe.every(k => k.status === 'beendet')).toBe(true);

        onlineErgebnis = normalisiereKaempfe(kaempfe);

        expect(onlineErgebnis.F1.siegerSeite).toBe('kaempfer1');
        expect(onlineErgebnis.F1.kaempfer1).toBe('Adler, Anna');
    });

    test('Offline: identisches Gruppen-Überkreuz-Turnier exportieren, komplett offline austragen (inkl. Halbfinal-Ranglistenberechnung) und wieder exportieren', async ({ request }) => {
        const { matId } = await richteTurnierEin(request, 'GÜ-Offline-Vergleich');
        offlineMatId = matId;

        const exportResp = await request.get(`/api/offline/export?kampfflaecheId=${matId}`);
        expect(exportResp.ok(), await exportResp.text()).toBeTruthy();
        const offlineDaten = await exportResp.json();
        expect(offlineDaten.kaempfe).toHaveLength(10);

        await offlinePage.goto('/steuerung.html?turnierId=999999999');
        await offlinePage.locator('#offlineImportInput').setInputFiles({
            name: `ergebnisse_matte_${matId}.json`,
            mimeType: 'application/json',
            buffer: Buffer.from(JSON.stringify(offlineDaten))
        });
        await expect(offlinePage.locator('#connectionModeText')).toHaveText('Offline (Lokal)');

        await spieleKompletteBrackedDurch(offlinePage, 10);

        const [download] = await Promise.all([
            offlinePage.waitForEvent('download'),
            offlinePage.locator('#btnOfflineExport').click()
        ]);
        const exportiert = JSON.parse(fs.readFileSync(await download.path(), 'utf-8'));
        expect(exportiert.kaempfe).toHaveLength(10);
        expect(exportiert.kaempfe.every(k => k.status === 'beendet')).toBe(true);

        offlineErgebnis = normalisiereKaempfe(exportiert.kaempfe);

        expect(offlineErgebnis.F1.siegerSeite).toBe('kaempfer1');
        expect(offlineErgebnis.F1.kaempfer1).toBe('Adler, Anna');
    });

    test('Online- und Offline-Ergebnis stimmen für alle 10 Kämpfe exakt überein', () => {
        expect(offlineMatId).not.toBe(onlineMatId);
        expect(offlineErgebnis).toEqual(onlineErgebnis);
    });
});
