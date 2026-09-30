// Ersetzt die früheren steuerung-*-online-vs-offline.spec.js (JSON-Offline-Modus): jedes
// Turniersystem wird mit identischen Ausgangsdaten EINMAL am Server-Frontend (Sync-Modus) und
// EINMAL komplett offline an einem Client-Gerät (lokale PouchDB + Offline-Kaskade, danach
// Replikation) ausgetragen. Beide Wege müssen zu exakt demselben Turnierbaum führen — das beweist,
// dass die geteilte Kaskaden-Engine (src/shared/) offline am Gerät und maßgeblich am Server
// dieselben Paarungen bildet.
//
// Entscheidungsregel wie in den alten Specs: "W" (kaempfer1) gewinnt jeden Kampf per Ippon — das
// Ergebnis jedes benannten Kampfes hängt damit nur von seinen beiden Teilnehmern ab, nicht von der
// Abspielreihenfolge. Gruppen-Überkreuz prüft dabei zusätzlich die Halbfinal-Ranglistenberechnung
// offline (HF1/HF2 werden erst nach der Vorrunde spielbar).
import { test, expect } from '@playwright/test';
import { legeTurnierAn, syncLeerlauf, warteLeerlauf, clientTrennen, clientVerbinden, clientStatus, CLIENT_BASE_URL } from './helpers.js';

const TEILNEHMER = [
    ['Anna', 'Adler', 'JC Alpha'], ['Berta', 'Busch', 'JC Beta'], ['Clara', 'Conrad', 'JC Gamma'],
    ['Diana', 'Diehl', 'JC Delta'], ['Elena', 'Ebert', 'JC Epsilon'], ['Frida', 'Fuchs', 'JC Zeta'],
    ['Greta', 'Graf', 'JC Eta'], ['Hanna', 'Hoffmann', 'JC Theta'], ['Ida', 'Imhof', 'JC Iota'],
    ['Julia', 'Jansen', 'JC Kappa'], ['Klara', 'Krause', 'JC Lambda'], ['Lena', 'Lorenz', 'JC My'],
    ['Mia', 'Meyer', 'JC Ny'], ['Nora', 'Neumann', 'JC Xi'], ['Olivia', 'Ott', 'JC Omikron'], ['Paula', 'Peters', 'JC Pi']
];

const SYSTEME = [
    { name: 'Jeder-gegen-Jeden', teilnehmer: 4, kaempfe: 6 },
    { name: 'Gruppen-Überkreuz', teilnehmer: 6, kaempfe: 9 },
    { name: 'Doppel-KO-8', teilnehmer: 8, kaempfe: 11 },
    { name: 'Doppel-KO-16', teilnehmer: 16, kaempfe: 27 }
];

// Turnier + Matte + Pool; der Kampfplan (Modus) ergibt sich aus der Teilnehmerzahl (siehe
// waehleWettkampfsystem in poolController.js). Reihenfolge der Zuordnung identisch zur Fixtur —
// Voraussetzung für ein deterministisch identisches Raster in beiden Durchläufen.
async function richteTurnierEin(request, bezeichnung, anzahl) {
    const turnierId = await legeTurnierAn(request, bezeichnung);
    const [{ id: matId }] = await (await request.get(`/api/kampfflaechen?turnierId=${turnierId}`)).json();
    const poolResp = await request.post('/api/pools', {
        data: { turnier_id: turnierId, bezeichnung: `${bezeichnung} Pool`, altersklasse: 'U18', geschlecht: 'männlich', gewichtsklasse: '-73kg' }
    });
    expect(poolResp.ok(), await poolResp.text()).toBeTruthy();
    const { poolId } = await poolResp.json();
    for (const [i, [vorname, nachname, verein]] of TEILNEHMER.slice(0, anzahl).entries()) {
        const tResp = await request.post('/api/teilnehmer', {
            data: { turnier_id: turnierId, vorname, nachname, verein, geburtsjahr: 2009, geschlecht: 'männlich', gewicht: 60 + i, altersklasse: 'U18', gewichtsklasse: '-73kg' }
        });
        expect(tResp.ok(), await tResp.text()).toBeTruthy();
        const { teilnehmerId } = await tResp.json();
        const r = await request.post('/api/pools/verschieben', { data: { teilnehmerId, zielPoolId: poolId } });
        expect(r.ok(), await r.text()).toBeTruthy();
    }
    const z = await request.put('/api/pools/kampfflaeche-zuordnen', { data: { poolId, kampflaecheId: matId, position: 1 } });
    expect(z.ok(), await z.text()).toBeTruthy();
    return { turnierId, matId };
}

async function spieleAlleKaempfeDurch(page, anzahl) {
    let vorher = 'Kämpfer 1|Kämpfer 2';
    for (let i = 0; i < anzahl; i++) {
        await page.locator('#btnNaechsterKampfLive').click();
        await page.waitForFunction(
            (v) => `${document.getElementById('nameW').value}|${document.getElementById('nameB').value}` !== v, vorher
        );
        vorher = await page.evaluate(() => `${document.getElementById('nameW').value}|${document.getElementById('nameB').value}`);
        await page.evaluate(() => window.changeScore('W', 'ippon', 1));
        await expect(page.locator('#btnErgebnisSendenLive')).toBeVisible();
        await page.locator('#btnErgebnisSendenLive').click();
        await expect(page.locator('#btnNaechsterKampfLive')).toBeVisible();
    }
}

// Auf das Vergleichbare reduziert, geschlüsselt nach reihenfolge_nummer statt roher IDs (die sich
// zwischen den beiden Turnieren zwangsläufig unterscheiden).
function normalisiere(kaempfe) {
    const name = (nachname, vorname) => (nachname ? `${nachname}, ${vorname}` : null);
    const byNr = {};
    for (const k of kaempfe) {
        byNr[k.reihenfolge_nummer] = {
            status: k.status,
            kaempfer1: name(k.kaempfer1_nachname, k.kaempfer1_vorname),
            kaempfer2: name(k.kaempfer2_nachname, k.kaempfer2_vorname),
            siegerSeite: k.sieger_id === k.kaempfer1_id ? 'kaempfer1' : (k.sieger_id === k.kaempfer2_id ? 'kaempfer2' : null),
            unterbewertung_kaempfer1: k.unterbewertung_kaempfer1,
            unterbewertung_kaempfer2: k.unterbewertung_kaempfer2
        };
    }
    return byNr;
}

for (const system of SYSTEME) {
    test(`${system.name}: Server-Frontend und offline am Client-Gerät führen zum identischen Ergebnis`, async ({ page, request }) => {
        test.setTimeout(300_000);

        // 1) Referenz: am Server-Frontend austragen.
        const referenz = await richteTurnierEin(request, `${system.name} Server`, system.teilnehmer);
        await warteLeerlauf(request);
        await page.goto(`/steuerung.html?turnierId=${referenz.turnierId}&matId=${referenz.matId}`);
        await expect(page.locator('#matSelect')).toHaveValue(String(referenz.matId));
        await spieleAlleKaempfeDurch(page, system.kaempfe);
        await warteLeerlauf(request);
        const serverKaempfe = await (await request.get(`/api/kaempfe?kampfflaecheId=${referenz.matId}`)).json();
        expect(serverKaempfe).toHaveLength(system.kaempfe);
        expect(serverKaempfe.every(k => k.status === 'beendet' || k.status === 'freilos')).toBe(true);
        const erwartet = normalisiere(serverKaempfe);

        // 2) Identisches Turnier komplett offline am Client-Gerät austragen.
        const offline = await richteTurnierEin(request, `${system.name} Client`, system.teilnehmer);
        await syncLeerlauf(request);
        expect((await request.put(`${CLIENT_BASE_URL}/api/sync/client/matte`, { data: { matte_id: offline.matId } })).ok()).toBeTruthy();
        await clientTrennen(request);
        await page.goto(`${CLIENT_BASE_URL}/steuerung.html?turnierId=${offline.turnierId}&matId=${offline.matId}`);
        await expect(page.locator('#matSelect')).toHaveValue(String(offline.matId));
        await spieleAlleKaempfeDurch(page, system.kaempfe);
        const lokal = await (await request.get(`${CLIENT_BASE_URL}/api/kaempfe?kampfflaecheId=${offline.matId}`)).json();
        expect(normalisiere(lokal)).toEqual(erwartet);

        // 3) Verbinden: der Server rechnet maßgeblich nach und kommt zum selben Ergebnis.
        await clientVerbinden(request);
        await syncLeerlauf(request);
        const nachSync = await (await request.get(`/api/kaempfe?kampfflaecheId=${offline.matId}`)).json();
        expect(normalisiere(nachSync)).toEqual(erwartet);
        expect((await clientStatus(request)).ausstehend).toBe(0);
    });
}
