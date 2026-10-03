// End-to-End: analog zu steuerung-dk8-komplett.spec.js (siehe dortige
// Kommentare), hier für Jeder-gegen-Jeden (4 Teilnehmer,
// 6 Kämpfe -- siehe JederGegenJedenManager.js). Anders als bei den Doppel-KO-Modi gibt es hier
// keine Bracket-Kaskade (jede Paarung steht von Anfang an fest, alle 6 Kämpfe starten bereits
// 'bereit'), geprüft wird also nur die Ergebnis-Erfassung -- nicht die Kaskaden-Engine wie bei den
// KO-Modi.
import { test, expect } from '@playwright/test';

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

    // Reihenfolge identisch zur Fixtur -- Voraussetzung für ein deterministisches
    // Paarungsraster (siehe JederGegenJedenManager.js:
    // Teilnehmer werden nach id sortiert gelesen,
    // also in Einfüge-Reihenfolge).
    for (const teilnehmerId of teilnehmerIds) {
        const moveResp = await request.post('/api/pools/verschieben', { data: { teilnehmerId, zielPoolId: poolId } });
        expect(moveResp.ok(), await moveResp.text()).toBeTruthy();
    }

    const zuordnenResp = await request.put('/api/pools/kampfflaeche-zuordnen', { data: { poolId, kampflaecheId: matId, position: 1 } });
    expect(zuordnenResp.ok(), await zuordnenResp.text()).toBeTruthy();

    return { turnierId, matId, poolId };
}

// Identisch zu spieleKompletteBrackedDurch() in steuerung-dk8-komplett.spec.js: "W"
// (kaempfer1) gewinnt jeden Kampf per Ippon.
async function spieleAlleKaempfeDurch(page, anzahlKaempfe) {
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

test.describe.serial('Jeder-gegen-Jeden komplett austragen über den Hallen-Server', () => {
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
});
