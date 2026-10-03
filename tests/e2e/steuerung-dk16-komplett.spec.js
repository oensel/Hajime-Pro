// End-to-End: analog zu steuerung-dk8-komplett.spec.js (siehe dortige
// Kommentare), hier für Doppel-KO-16 (16 Teilnehmer,
// 27 Kämpfe: H1-H8, H9-H12, H13-H14, Trostrunde T1-T12, Finale F1 -- siehe
// DoppelKo16Manager.js/DOPPEL_KO_16_TOPOLOGIE).
import { test, expect } from '@playwright/test';

// 16 Teilnehmer, alle mit unterschiedlichem Verein (Vereinstrennung in
// DoppelKo16Manager.initialisierePool() spielt damit keine Rolle) und streng aufsteigendem
// Gewicht -- ergibt ein deterministisches Erstrunden-Raster.
const TEILNEHMER_FIXTUR = [
    { vorname: 'Anna', nachname: 'Adler', verein: 'JC Alpha', gewicht: 60 },
    { vorname: 'Berta', nachname: 'Busch', verein: 'JC Beta', gewicht: 61 },
    { vorname: 'Clara', nachname: 'Conrad', verein: 'JC Gamma', gewicht: 62 },
    { vorname: 'Diana', nachname: 'Diehl', verein: 'JC Delta', gewicht: 63 },
    { vorname: 'Elena', nachname: 'Ebert', verein: 'JC Epsilon', gewicht: 64 },
    { vorname: 'Frida', nachname: 'Fuchs', verein: 'JC Zeta', gewicht: 65 },
    { vorname: 'Greta', nachname: 'Graf', verein: 'JC Eta', gewicht: 66 },
    { vorname: 'Hanna', nachname: 'Hoffmann', verein: 'JC Theta', gewicht: 67 },
    { vorname: 'Ida', nachname: 'Imhof', verein: 'JC Iota', gewicht: 68 },
    { vorname: 'Julia', nachname: 'Jansen', verein: 'JC Kappa', gewicht: 69 },
    { vorname: 'Klara', nachname: 'Krause', verein: 'JC Lambda', gewicht: 70 },
    { vorname: 'Lena', nachname: 'Lorenz', verein: 'JC My', gewicht: 71 },
    { vorname: 'Mia', nachname: 'Meyer', verein: 'JC Ny', gewicht: 72 },
    { vorname: 'Nora', nachname: 'Neumann', verein: 'JC Xi', gewicht: 73 },
    { vorname: 'Olivia', nachname: 'Ott', verein: 'JC Omikron', gewicht: 74 },
    { vorname: 'Paula', nachname: 'Peters', verein: 'JC Pi', gewicht: 75 }
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

    // Reihenfolge identisch zur Fixtur -- Voraussetzung für ein deterministisches
    // Raster (siehe DoppelKo16Manager.js: Teilnehmer werden
    // nach id sortiert gelesen, also in Einfüge-Reihenfolge).
    for (const teilnehmerId of teilnehmerIds) {
        const moveResp = await request.post('/api/pools/verschieben', { data: { teilnehmerId, zielPoolId: poolId } });
        expect(moveResp.ok(), await moveResp.text()).toBeTruthy();
    }

    const zuordnenResp = await request.put('/api/pools/kampfflaeche-zuordnen', { data: { poolId, kampflaecheId: matId, position: 1 } });
    expect(zuordnenResp.ok(), await zuordnenResp.text()).toBeTruthy();

    return { turnierId, matId, poolId };
}

// Identisch zu spieleKompletteBrackedDurch() in steuerung-dk8-komplett.spec.js: "W"
// (kaempfer1) gewinnt jeden Kampf per Ippon, unabhängig von der Abspielreihenfolge steht das
// Endergebnis jedes benannten Kampfes eindeutig fest.
async function spieleKompletteBrackedDurch(page, anzahlKaempfe) {
    // Paarung (kaempfer1|kaempfer2) statt nur nameW beobachten -- siehe ausführlichen Kommentar
    // in steuerung-dk8-komplett.spec.js: derselbe Kämpfer kann in zwei verschiedenen
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

test.describe.serial('Doppel-KO-16 komplett austragen über den Hallen-Server', () => {
    let onlinePage;
    let onlineMatId;
    let onlineErgebnis;

    test.beforeAll(async ({ browser }) => {
        const onlineContext = await browser.newContext();
        onlinePage = await onlineContext.newPage();
    });

    test.afterAll(async () => {
        await onlinePage.context().close();
    });

    test('Online: komplettes Doppel-KO-16-Turnier über den echten Server austragen', async ({ request }) => {
        test.setTimeout(60_000);
        const { turnierId, matId } = await richteTurnierEin(request, 'DK16-Online-Vergleich');
        onlineMatId = matId;

        await onlinePage.goto(`/steuerung.html?turnierId=${turnierId}&matId=${matId}`);
        await expect(onlinePage.locator('#matSelect')).toHaveValue(String(matId));

        await spieleKompletteBrackedDurch(onlinePage, 27);

        const kaempfeResp = await request.get(`/api/kaempfe?kampfflaecheId=${matId}`);
        const kaempfe = await kaempfeResp.json();
        expect(kaempfe).toHaveLength(27);
        expect(kaempfe.every(k => k.status === 'beendet')).toBe(true);

        onlineErgebnis = normalisiereKaempfe(kaempfe);

        expect(onlineErgebnis.F1.siegerSeite).toBe('kaempfer1');
        expect(onlineErgebnis.F1.kaempfer1).toBe('Adler, Anna');
    });
});
