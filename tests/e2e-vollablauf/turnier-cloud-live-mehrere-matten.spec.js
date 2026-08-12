// End-to-End: kompletter Turnierablauf (Anlegen -> Veröffentlichen -> Teilnehmer -> Pools ->
// Matten-Zuordnung -> Scoring) GEGEN DEN ECHTEN CLOUD-SERVER (Postgres, siehe ONLINE_BASE_URL in
// test-env.js), OHNE dass irgendwo Export/Import stattfindet -- das Szenario "ein Server (egal ob
// lokal im WLAN oder tatsächlich im Internet erreichbar), alle Rechner vor Ort sprechen die ganze
// Zeit live und direkt mit genau diesem einen Server". Ergänzt turnier-vollablauf.spec.js (das nur
// den Cloud+separates-Offline-Gerät-mit-Datei-Sync-Ablauf abdeckt) und
// steuerung-drei-matten-gleichzeitig.spec.js (das dasselbe "mehrere Matten gleichzeitig, kein
// Ex-/Import"-Muster testet, aber gegen den LOKALEN Test-Server statt der echten Cloud).
//
// Registrierung/Turnier-Anlage laufen bewusst über dieselben, bereits bestehenden Helper wie
// turnier-vollablauf.spec.js (echte UI, echter jan@test.de-Account) -- Teilnehmer/Pools/Matten-
// Zuordnung dagegen per Direkt-API (wie in den tests/e2e/steuerung-*.spec.js-Dateien), das ist
// hier bewusst reine Testdaten-Vorbereitung, kein zu testender Szenario-Schritt für sich.
//
// Alle drei "Matten"-Clients melden sich (wie janPage) als jan@test.de an: tim/tom gehören einem
// ANDEREN Verein an und hätten keine Bearbeitungsrechte auf jans Turnier (vereinsbasierte
// Zugriffsrechte, siehe requireTournamentEditAccess in src/middleware/auth.js) -- realistisch
// entspricht das mehreren Laptops, die mit demselben Vereins-Login angemeldet sind.
import { test, expect } from '@playwright/test';
import { meldeAn, legeTurnierAn, veroeffentlicheTurnier } from './helpers.js';
import { ONLINE_BASE_URL } from './test-env.js';

const HEUTE = new Date();
const WETTKAMPFJAHR = HEUTE.getFullYear() + 1;
const TURNIER_DATUM = `${WETTKAMPFJAHR}-09-19`;

// Dieselben drei Wettkampfsysteme wie in steuerung-drei-matten-gleichzeitig.spec.js (DK8,
// Gruppen-Überkreuz, Jeder-gegen-Jeden) -- so deckt der Test nebenbei ab, dass alle drei
// Kaskaden-Engines auch gegen den echten Cloud-Server parallel sauber laufen.
const MATTEN_FIXTUR = [
    {
        bezeichnung: 'CloudMatte1-DoppelKO8',
        anzahlKaempfe: 11,
        erwarteterChampionKey: 'F',
        teilnehmer: [
            { vorname: 'CM1-Anna', nachname: 'Adler', verein: 'JC CM1-Alpha', gewicht: 60 },
            { vorname: 'CM1-Berta', nachname: 'Busch', verein: 'JC CM1-Beta', gewicht: 61 },
            { vorname: 'CM1-Clara', nachname: 'Conrad', verein: 'JC CM1-Gamma', gewicht: 62 },
            { vorname: 'CM1-Diana', nachname: 'Diehl', verein: 'JC CM1-Delta', gewicht: 63 },
            { vorname: 'CM1-Elena', nachname: 'Ebert', verein: 'JC CM1-Epsilon', gewicht: 64 },
            { vorname: 'CM1-Frida', nachname: 'Fuchs', verein: 'JC CM1-Zeta', gewicht: 65 },
            { vorname: 'CM1-Greta', nachname: 'Graf', verein: 'JC CM1-Eta', gewicht: 66 },
            { vorname: 'CM1-Hanna', nachname: 'Hoffmann', verein: 'JC CM1-Theta', gewicht: 67 }
        ]
    },
    {
        bezeichnung: 'CloudMatte2-GruppenUeberkreuz',
        anzahlKaempfe: 10,
        erwarteterChampionKey: 'F1',
        teilnehmer: [
            { vorname: 'CM2-Anna', nachname: 'Adler', verein: 'JC CM2-Alpha', gewicht: 60 },
            { vorname: 'CM2-Berta', nachname: 'Busch', verein: 'JC CM2-Beta', gewicht: 61 },
            { vorname: 'CM2-Clara', nachname: 'Conrad', verein: 'JC CM2-Gamma', gewicht: 62 },
            { vorname: 'CM2-Diana', nachname: 'Diehl', verein: 'JC CM2-Delta', gewicht: 63 },
            { vorname: 'CM2-Elena', nachname: 'Ebert', verein: 'JC CM2-Epsilon', gewicht: 64 },
            { vorname: 'CM2-Frida', nachname: 'Fuchs', verein: 'JC CM2-Zeta', gewicht: 65 }
        ]
    },
    {
        bezeichnung: 'CloudMatte3-JederGegenJeden',
        anzahlKaempfe: 6,
        erwarteterChampionKey: null,
        teilnehmer: [
            { vorname: 'CM3-Anna', nachname: 'Adler', verein: 'JC CM3-Alpha', gewicht: 60 },
            { vorname: 'CM3-Berta', nachname: 'Busch', verein: 'JC CM3-Beta', gewicht: 61 },
            { vorname: 'CM3-Clara', nachname: 'Conrad', verein: 'JC CM3-Gamma', gewicht: 62 },
            { vorname: 'CM3-Diana', nachname: 'Diehl', verein: 'JC CM3-Delta', gewicht: 63 }
        ]
    }
];

// Identisch zum Wartemuster in den tests/e2e/steuerung-*.spec.js-Dateien: Paarung
// (kaempfer1|kaempfer2) statt nur nameW beobachten, da sich derselbe Kämpfer in zwei
// verschiedenen Kämpfen hintereinander wiederholen kann, die Paarung selbst aber nie.
async function spieleMatteDurch(page, anzahlKaempfe) {
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

test.describe.serial('Kompletter Turnierablauf gegen einen echten Cloud-Server mit mehreren gleichzeitigen Live-Clients (kein Ex-/Import)', () => {
    let janPage;
    let mattenPages = [];
    let jan;
    let turnierId;
    let matten;

    test.beforeAll(async ({ browser }) => {
        janPage = await (await browser.newContext()).newPage();
        const mattenContexts = await Promise.all(MATTEN_FIXTUR.map(() => browser.newContext()));
        mattenPages = await Promise.all(mattenContexts.map(ctx => ctx.newPage()));
    });

    test.afterAll(async () => {
        await janPage.context().close();
        await Promise.all(mattenPages.map(p => p.context().close()));
    });

    test('Phase 1: jan meldet sich an, legt ein Turnier mit drei Kampfflächen an und veröffentlicht es', async ({ request }) => {
        jan = await meldeAn(janPage, ONLINE_BASE_URL, request, { email: 'jan@test.de', password: 'JanTest123' });

        turnierId = await legeTurnierAn(janPage, ONLINE_BASE_URL, {
            bezeichnung: 'Cloud-Live-Matten-Turnier', datum: TURNIER_DATUM, ort: 'Senden', plz: '48308',
            ausrichter: 'JC Senden', anzahlKampfflaechen: 3, bundesland: 'Nordrhein-Westfalen',
            einzelKlassenWerte: ['männlich_U18']
        });
        expect(turnierId).toBeTruthy();

        await veroeffentlicheTurnier(ONLINE_BASE_URL, janPage.request, jan.token, turnierId);
    });

    // --- PHASE 2: drei Pools + ihre Teilnehmer + Matten-Zuordnung direkt per API gegen den Cloud-
    // Server anlegen (reine Testdaten-Vorbereitung, siehe Kommentar am Dateianfang).
    test('Phase 2: drei Pools mit Teilnehmern werden angelegt und je einer eigenen Kampffläche zugeordnet', async ({ request }) => {
        test.setTimeout(60_000);
        const authHeaders = { Authorization: `Bearer ${jan.token}` };

        const mattenResp = await request.get(`${ONLINE_BASE_URL}/api/kampfflaechen?turnierId=${turnierId}`, { headers: authHeaders });
        const kampfflaechen = await mattenResp.json();
        expect(kampfflaechen).toHaveLength(3);

        matten = [];
        for (let i = 0; i < MATTEN_FIXTUR.length; i++) {
            const fixtur = MATTEN_FIXTUR[i];
            const matId = kampfflaechen[i].id;

            const poolResp = await request.post(`${ONLINE_BASE_URL}/api/pools`, {
                headers: authHeaders,
                data: { turnier_id: turnierId, bezeichnung: fixtur.bezeichnung, altersklasse: 'U18', geschlecht: 'männlich', gewichtsklasse: '-73kg' }
            });
            expect(poolResp.ok(), await poolResp.text()).toBeTruthy();
            const { poolId } = await poolResp.json();

            for (const t of fixtur.teilnehmer) {
                const tResp = await request.post(`${ONLINE_BASE_URL}/api/teilnehmer`, {
                    headers: authHeaders,
                    data: {
                        turnier_id: turnierId, vorname: t.vorname, nachname: t.nachname, verein: t.verein,
                        geburtsjahr: 2009, geschlecht: 'männlich', gewicht: t.gewicht,
                        altersklasse: 'U18', gewichtsklasse: '-73kg'
                    }
                });
                expect(tResp.ok(), await tResp.text()).toBeTruthy();
                const { teilnehmerId } = await tResp.json();

                const moveResp = await request.post(`${ONLINE_BASE_URL}/api/pools/verschieben`, {
                    headers: authHeaders, data: { teilnehmerId, zielPoolId: poolId }
                });
                expect(moveResp.ok(), await moveResp.text()).toBeTruthy();
            }

            const zuordnenResp = await request.put(`${ONLINE_BASE_URL}/api/pools/kampfflaeche-zuordnen`, {
                headers: authHeaders, data: { poolId, kampflaecheId: matId, position: 1 }
            });
            expect(zuordnenResp.ok(), await zuordnenResp.text()).toBeTruthy();

            matten.push({ matId, poolId, ...fixtur });
        }
    });

    // --- PHASE 3: drei "Laptops" (alle als jan@test.de angemeldet, siehe Kommentar am
    // Dateianfang) spielen ihre jeweilige Matte ECHT GLEICHZEITIG (Promise.all) live gegen den
    // Cloud-Server durch -- kein Export/Import an keiner Stelle.
    test('Phase 3: drei Kampfflächen melden sich an und spielen gleichzeitig live gegen den Cloud-Server', async ({ request }) => {
        test.setTimeout(120_000);

        for (const page of mattenPages) {
            await meldeAn(page, ONLINE_BASE_URL, request, { email: 'jan@test.de', password: 'JanTest123' });
        }

        for (let i = 0; i < matten.length; i++) {
            await mattenPages[i].goto(`${ONLINE_BASE_URL}/steuerung.html?turnierId=${turnierId}&matId=${matten[i].matId}`);
            await expect(mattenPages[i].locator('#matSelect')).toHaveValue(String(matten[i].matId));
        }

        await Promise.all(matten.map((m, i) => spieleMatteDurch(mattenPages[i], m.anzahlKaempfe)));
    });

    test('Phase 4: alle drei Matten sind auf dem Cloud-Server korrekt und ohne Vermischung fertig ausgetragen', async ({ request }) => {
        const authHeaders = { Authorization: `Bearer ${jan.token}` };

        for (const matte of matten) {
            const kaempfeResp = await request.get(`${ONLINE_BASE_URL}/api/kaempfe?kampfflaecheId=${matte.matId}`, { headers: authHeaders });
            const kaempfe = await kaempfeResp.json();
            expect(kaempfe, `Matte ${matte.bezeichnung}`).toHaveLength(matte.anzahlKaempfe);
            expect(kaempfe.every(k => k.status === 'beendet'), `Matte ${matte.bezeichnung}: nicht alle Kämpfe beendet`).toBe(true);

            // Cross-Contamination-Check: jeder Kämpfer eines Kampfes dieser Matte muss aus der
            // Teilnehmerliste GENAU dieser Matte stammen.
            const erlaubteNamen = new Set(matte.teilnehmer.map(t => `${t.nachname}, ${t.vorname}`));
            for (const k of kaempfe) {
                const name1 = `${k.kaempfer1_nachname}, ${k.kaempfer1_vorname}`;
                const name2 = `${k.kaempfer2_nachname}, ${k.kaempfer2_vorname}`;
                expect(erlaubteNamen.has(name1), `Kampf ${k.id} auf ${matte.bezeichnung}: fremder Kämpfer1 "${name1}"`).toBe(true);
                expect(erlaubteNamen.has(name2), `Kampf ${k.id} auf ${matte.bezeichnung}: fremder Kämpfer2 "${name2}"`).toBe(true);
            }

            if (matte.erwarteterChampionKey) {
                const finale = kaempfe.find(k => k.reihenfolge_nummer === matte.erwarteterChampionKey);
                expect(finale.sieger_id, `Matte ${matte.bezeichnung}: Finale ohne Sieger`).toBe(finale.kaempfer1_id);
            }
        }
    });
});
