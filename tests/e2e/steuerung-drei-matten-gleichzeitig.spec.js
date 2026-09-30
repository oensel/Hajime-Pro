// End-to-End: Hybrid-Modus-Szenario -- ein Server läuft lokal (im Testlauf technisch SQLite,
// IS_OFFLINE=true, siehe tests/e2e/test-env.js), und DREI Kampfflächen ("eigene Laptops im
// selben WLAN") sprechen gleichzeitig live per Netzwerk-Requests mit ihm, OHNE jemals zu
// exportieren/importieren -- exakt der in scoreboard.js/kampf.js verwendete Online-Zweig
// (naechstenKampfHolen()/ergebnisSenden() mit echten fetch()-Aufrufen), nur eben gegen einen
// lokalen statt einen Cloud-Server. Anders als die steuerung-*-komplett.spec.js-Dateien
// (die jeweils NUR eine Matte nacheinander bedienen) spielen hier drei Matten ECHT GLEICHZEITIG
// (Promise.all über drei unabhängige Browser-Kontexte = drei unabhängige Laptops), um
// Race-Conditions/Cross-Contamination bei parallelen Schreibzugriffen auf denselben Server
// aufzudecken -- z.B. falls sich die Kaskaden-Berechnung (triggerPoolUpdate) oder die Matten-
// Warteschlangen-Planung (planeKaempfeFuerKampfflaeche) zweier Kampfflächen gegenseitig in die
// Quere kämen.
//
// Drei unterschiedliche Wettkampfsysteme auf den drei Matten (statt dreimal dasselbe), damit der
// Test nebenbei auch belegt, dass unterschiedliche Kaskaden-Engines (kampfProgression.js für
// Doppel-KO-8, gruppenUeberkreuzProgression.js für Gruppen-Überkreuz, keine Kaskade für
// Jeder-gegen-Jeden) parallel auf demselben Server sauber nebeneinander laufen.
import { test, expect } from '@playwright/test';

const MATTEN_FIXTUR = [
    {
        bezeichnung: 'Matte1-DoppelKO8',
        anzahlKaempfe: 11,
        erwarteterChampionKey: 'F',
        teilnehmer: [
            { vorname: 'M1-Anna', nachname: 'Adler', verein: 'JC M1-Alpha', gewicht: 60 },
            { vorname: 'M1-Berta', nachname: 'Busch', verein: 'JC M1-Beta', gewicht: 61 },
            { vorname: 'M1-Clara', nachname: 'Conrad', verein: 'JC M1-Gamma', gewicht: 62 },
            { vorname: 'M1-Diana', nachname: 'Diehl', verein: 'JC M1-Delta', gewicht: 63 },
            { vorname: 'M1-Elena', nachname: 'Ebert', verein: 'JC M1-Epsilon', gewicht: 64 },
            { vorname: 'M1-Frida', nachname: 'Fuchs', verein: 'JC M1-Zeta', gewicht: 65 },
            { vorname: 'M1-Greta', nachname: 'Graf', verein: 'JC M1-Eta', gewicht: 66 },
            { vorname: 'M1-Hanna', nachname: 'Hoffmann', verein: 'JC M1-Theta', gewicht: 67 }
        ]
    },
    {
        bezeichnung: 'Matte2-GruppenUeberkreuz',
        anzahlKaempfe: 9,
        erwarteterChampionKey: 'F1',
        teilnehmer: [
            { vorname: 'M2-Anna', nachname: 'Adler', verein: 'JC M2-Alpha', gewicht: 60 },
            { vorname: 'M2-Berta', nachname: 'Busch', verein: 'JC M2-Beta', gewicht: 61 },
            { vorname: 'M2-Clara', nachname: 'Conrad', verein: 'JC M2-Gamma', gewicht: 62 },
            { vorname: 'M2-Diana', nachname: 'Diehl', verein: 'JC M2-Delta', gewicht: 63 },
            { vorname: 'M2-Elena', nachname: 'Ebert', verein: 'JC M2-Epsilon', gewicht: 64 },
            { vorname: 'M2-Frida', nachname: 'Fuchs', verein: 'JC M2-Zeta', gewicht: 65 }
        ]
    },
    {
        bezeichnung: 'Matte3-JederGegenJeden',
        anzahlKaempfe: 6,
        erwarteterChampionKey: null, // kein einzelner benannter "Finale"-Kampf in diesem Modus
        teilnehmer: [
            { vorname: 'M3-Anna', nachname: 'Adler', verein: 'JC M3-Alpha', gewicht: 60 },
            { vorname: 'M3-Berta', nachname: 'Busch', verein: 'JC M3-Beta', gewicht: 61 },
            { vorname: 'M3-Clara', nachname: 'Conrad', verein: 'JC M3-Gamma', gewicht: 62 },
            { vorname: 'M3-Diana', nachname: 'Diehl', verein: 'JC M3-Delta', gewicht: 63 }
        ]
    }
];

// Legt EIN Turnier mit drei Kampfflächen an und je einen Pool pro Matte aus MATTEN_FIXTUR.
async function richteTurnierMitDreiMattenEin(request) {
    const turnierResp = await request.post('/api/turniere', {
        data: { bezeichnung: 'Drei-Matten-Test', ort: 'Teststadt', datum: '2027-03-20', ausrichter: 'JC Test', anzahl_kampfflaechen: 3 }
    });
    expect(turnierResp.ok(), await turnierResp.text()).toBeTruthy();
    const { turnierId } = await turnierResp.json();

    const mattenResp = await request.get(`/api/kampfflaechen?turnierId=${turnierId}`);
    const kampfflaechen = await mattenResp.json();
    expect(kampfflaechen).toHaveLength(3);

    const matten = [];
    for (let i = 0; i < MATTEN_FIXTUR.length; i++) {
        const fixtur = MATTEN_FIXTUR[i];
        const matId = kampfflaechen[i].id;

        const poolResp = await request.post('/api/pools', {
            data: { turnier_id: turnierId, bezeichnung: fixtur.bezeichnung, altersklasse: 'U18', geschlecht: 'männlich', gewichtsklasse: '-73kg' }
        });
        expect(poolResp.ok(), await poolResp.text()).toBeTruthy();
        const { poolId } = await poolResp.json();

        for (const t of fixtur.teilnehmer) {
            const tResp = await request.post('/api/teilnehmer', {
                data: {
                    turnier_id: turnierId, vorname: t.vorname, nachname: t.nachname, verein: t.verein,
                    geburtsjahr: 2009, geschlecht: 'männlich', gewicht: t.gewicht,
                    altersklasse: 'U18', gewichtsklasse: '-73kg'
                }
            });
            expect(tResp.ok(), await tResp.text()).toBeTruthy();
            const { teilnehmerId } = await tResp.json();

            const moveResp = await request.post('/api/pools/verschieben', { data: { teilnehmerId, zielPoolId: poolId } });
            expect(moveResp.ok(), await moveResp.text()).toBeTruthy();
        }

        const zuordnenResp = await request.put('/api/pools/kampfflaeche-zuordnen', { data: { poolId, kampflaecheId: matId, position: 1 } });
        expect(zuordnenResp.ok(), await zuordnenResp.text()).toBeTruthy();

        matten.push({ matId, poolId, ...fixtur });
    }

    return { turnierId, matten };
}

// Identisch zum Wartemuster in den steuerung-*-komplett.spec.js-Dateien: Paarung
// (kaempfer1|kaempfer2) statt nur nameW beobachten, da sich derselbe Kämpfer in zwei
// verschiedenen Kämpfen hintereinander wiederholen kann, die Paarung selbst aber nie.
async function spieleMatteDurch(page, anzahlKaempfe) {
    let vorherigePaarung = 'Kämpfer 1|Kämpfer 2';
    for (let i = 0; i < anzahlKaempfe; i++) {
        await page.locator('#btnNaechsterKampfLive').click();
        // polling per Intervall statt requestAnimationFrame (Standard): headless Chromium unter Linux
        // liefert für nicht im Vordergrund liegende Seiten keine Animation-Frames -- bei drei
        // gleichzeitigen Kontexten würde die Bedingung sonst nie erneut geprüft.
        await page.waitForFunction(
            (vorher) => `${document.getElementById('nameW').value}|${document.getElementById('nameB').value}` !== vorher,
            vorherigePaarung,
            { polling: 100 }
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

test('Drei Kampfflächen spielen gleichzeitig live gegen denselben lokalen Server (Hybrid-Modus, kein Ex-/Import)', async ({ browser, request }) => {
    test.setTimeout(60_000);

    const { turnierId, matten } = await richteTurnierMitDreiMattenEin(request);

    // Drei unabhängige Browser-Kontexte = drei unabhängige Laptops, jeder mit eigenem Cookie-/
    // Storage-Zustand, alle gegen denselben Server.
    const contexts = await Promise.all(matten.map(() => browser.newContext()));
    const pages = await Promise.all(contexts.map(ctx => ctx.newPage()));

    try {
        for (let i = 0; i < matten.length; i++) {
            await pages[i].goto(`/steuerung.html?turnierId=${turnierId}&matId=${matten[i].matId}`);
            await expect(pages[i].locator('#matSelect')).toHaveValue(String(matten[i].matId));
        }

        // Echte Gleichzeitigkeit: alle drei Matten spielen parallel durch, nicht nacheinander --
        // die einzelnen await-Punkte innerhalb spieleMatteDurch() lassen den Node-Event-Loop
        // zwischen den drei Promises hin- und herschalten, wodurch ihre Netzwerk-Requests am
        // Server tatsächlich verschachtelt eintreffen.
        await Promise.all(matten.map((m, i) => spieleMatteDurch(pages[i], m.anzahlKaempfe)));

        for (const matte of matten) {
            const kaempfeResp = await request.get(`/api/kaempfe?kampfflaecheId=${matte.matId}`);
            const kaempfe = await kaempfeResp.json();
            expect(kaempfe, `Matte ${matte.bezeichnung}`).toHaveLength(matte.anzahlKaempfe);
            expect(kaempfe.every(k => k.status === 'beendet'), `Matte ${matte.bezeichnung}: nicht alle Kämpfe beendet`).toBe(true);

            // Cross-Contamination-Check: JEDER Kämpfer eines Kampfes dieser Matte muss aus der
            // Teilnehmerliste GENAU dieser Matte stammen -- kein Namen-/ID-Verwischen zwischen
            // den drei gleichzeitig laufenden Pools.
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
    } finally {
        await Promise.all(contexts.map(ctx => ctx.close()));
    }
});
