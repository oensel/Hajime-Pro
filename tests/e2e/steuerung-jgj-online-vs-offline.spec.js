// End-to-End: analog zu steuerung-dk8-online-vs-offline.spec.js (siehe dortige ausführliche
// Kommentare zur Begründung des Vergleichsaufbaus), hier für Jeder-gegen-Jeden (4 Teilnehmer,
// 6 Kämpfe -- siehe JederGegenJedenManager.js). Anders als bei den Doppel-KO-Modi gibt es hier
// keine Bracket-Kaskade (jede Paarung steht von Anfang an fest, alle 6 Kämpfe starten bereits
// 'bereit'), der Vergleich prüft also nur, dass Ergebnis-Erfassung und -Export online wie offline
// zum selben Datensatz führen -- nicht die Kaskaden-Engine wie bei den KO-Modi.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';

// 4 Teilnehmer, alle mit unterschiedlichem Verein, aufsteigendes Gewicht.
const TEILNEHMER_FIXTUR = [
    { vorname: 'Anna', nachname: 'Adler', verein: 'JC Alpha', gewicht: 60 },
    { vorname: 'Berta', nachname: 'Busch', verein: 'JC Beta', gewicht: 61 },
    { vorname: 'Clara', nachname: 'Conrad', verein: 'JC Gamma', gewicht: 62 },
    { vorname: 'Diana', nachname: 'Diehl', verein: 'JC Delta', gewicht: 63 }
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

    // Reihenfolge identisch zur Fixtur -- Voraussetzung für ein deterministisch identisches
    // Paarungsraster zwischen Online- und Offline-Turnier (siehe JederGegenJedenManager.js:
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
// (kaempfer1) gewinnt jeden Kampf per Ippon.
async function spieleAlleKaempfeDurch(page, anzahlKaempfe) {
    // Paarung (kaempfer1|kaempfer2) statt nur nameW beobachten -- siehe ausführlichen Kommentar
    // in steuerung-dk8-online-vs-offline.spec.js: derselbe Kämpfer kann in zwei verschiedenen
    // Kämpfen hintereinander als Kämpfer 1 antreten, die Paarung selbst nie.
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

test.describe.serial('Jeder-gegen-Jeden komplett austragen: Online-Modus vs. Offline-Modus mit identischen Ausgangsdaten', () => {
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

    test('Online: komplettes Jeder-gegen-Jeden-Turnier über den echten Server austragen', async ({ request }) => {
        const { turnierId, matId } = await richteTurnierEin(request, 'JGJ-Online-Vergleich');
        onlineMatId = matId;

        await onlinePage.goto(`/steuerung.html?turnierId=${turnierId}&matId=${matId}`);
        await expect(onlinePage.locator('#matSelect')).toHaveValue(String(matId));

        await spieleAlleKaempfeDurch(onlinePage, 6);

        const kaempfeResp = await request.get(`/api/kaempfe?kampfflaecheId=${matId}`);
        const kaempfe = await kaempfeResp.json();
        expect(kaempfe).toHaveLength(6);
        expect(kaempfe.every(k => k.status === 'beendet')).toBe(true);

        onlineErgebnis = normalisiereKaempfe(kaempfe);
    });

    test('Offline: identisches Jeder-gegen-Jeden-Turnier exportieren, komplett offline austragen und wieder exportieren', async ({ request }) => {
        const { matId } = await richteTurnierEin(request, 'JGJ-Offline-Vergleich');
        offlineMatId = matId;

        const exportResp = await request.get(`/api/offline/export?kampfflaecheId=${matId}`);
        expect(exportResp.ok(), await exportResp.text()).toBeTruthy();
        const offlineDaten = await exportResp.json();
        expect(offlineDaten.kaempfe).toHaveLength(6);

        await offlinePage.goto('/steuerung.html?turnierId=999999999');
        await offlinePage.locator('#offlineImportInput').setInputFiles({
            name: `ergebnisse_matte_${matId}.json`,
            mimeType: 'application/json',
            buffer: Buffer.from(JSON.stringify(offlineDaten))
        });
        await expect(offlinePage.locator('#connectionModeText')).toHaveText('Offline (Lokal)');

        await spieleAlleKaempfeDurch(offlinePage, 6);

        const [download] = await Promise.all([
            offlinePage.waitForEvent('download'),
            offlinePage.locator('#btnOfflineExport').click()
        ]);
        const exportiert = JSON.parse(fs.readFileSync(await download.path(), 'utf-8'));
        expect(exportiert.kaempfe).toHaveLength(6);
        expect(exportiert.kaempfe.every(k => k.status === 'beendet')).toBe(true);

        offlineErgebnis = normalisiereKaempfe(exportiert.kaempfe);
    });

    test('Online- und Offline-Ergebnis stimmen für alle 6 Kämpfe exakt überein', () => {
        expect(offlineMatId).not.toBe(onlineMatId);
        expect(offlineErgebnis).toEqual(onlineErgebnis);
    });
});
