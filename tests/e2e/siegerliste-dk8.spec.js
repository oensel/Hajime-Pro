// End-to-End: Die Siegerliste (siegerliste.html) zeigt für einen ausgetragenen Doppel-KO-8-Pool
// die korrekten Platzierungen -- 1./2. Platz aus dem Finale (F), gemeinsamer 3. Platz aus BEIDEN
// Bronze-Kämpfen (T3+T4, siehe berechnePoolStandings()/isDoppelKo-Zweig in siegerliste.js:58-87)
// sowie die daraus abgeleitete Vereinswertung (5/3/1 Punkte je Platz 1/2/3, siegerliste.js:122-140).
// Anders als scoreboard.js hat siegerliste.js KEINEN Offline-Zweig (rein API-abhängig, siehe
// GET /api/pools/details) -- ein Offline-Vergleich wie bei den Steuerung-Tests ist hier also nicht
// anwendbar. Wichtig auch: die Platzierungen werden rein aus dem Live-Status der Kämpfe F/T3/T4
// berechnet, NICHT erst nachdem der Pool über "Pool abschließen" auf 'abgeschlossen' gesetzt wurde
// (siehe dritten Test unten) -- das wird hier bewusst mitgeprüft, weil siegerliste.js:69/80 nur
// status 'beendet'/'freilos' der einzelnen Kämpfe verlangt, nicht den Pool-Gesamtstatus.
//
// Turnier-Aufbau und Bracket-Austragung sind identisch zu (und bewusst dupliziert aus)
// steuerung-dk8-online-vs-offline.spec.js -- siehe dortige Kommentare zur Determinismus-Begründung
// (kein Math.random in DoppelKo8Manager.js/bracketTopologie.js; "W" (kaempfer1) gewinnt jeden
// Kampf per Ippon" führt bei diesem Ausgangsraster deterministisch zu Anna als Champion, Clara als
// Finalgegnerin und Elena+Greta als gemeinsame Bronze-Platzierte).
import { test, expect } from '@playwright/test';

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

async function richteDk8TurnierEin(request, bezeichnung) {
    const turnierResp = await request.post('/api/turniere', {
        data: { bezeichnung, ort: 'Teststadt', datum: '2027-03-20', ausrichter: 'JC Test', anzahl_kampfflaechen: 1 }
    });
    expect(turnierResp.ok(), await turnierResp.text()).toBeTruthy();
    const { turnierId } = await turnierResp.json();

    const mattenResp = await request.get(`/api/kampfflaechen?turnierId=${turnierId}`);
    const [{ id: matId }] = await mattenResp.json();

    const poolBezeichnung = `${bezeichnung} Pool`;
    const poolResp = await request.post('/api/pools', {
        data: { turnier_id: turnierId, bezeichnung: poolBezeichnung, altersklasse: 'U18', geschlecht: 'männlich', gewichtsklasse: '-73kg' }
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

    // Reihenfolge identisch zu TEILNEHMER_FIXTUR -- Voraussetzung für das deterministische Raster
    // (siehe Kommentar oben sowie DoppelKo8Manager.js: Teilnehmer werden ohne eigenes ORDER BY
    // gelesen, SQLite liefert ohne Sortierung Einfüge-/Rowid-Reihenfolge).
    for (const teilnehmerId of teilnehmerIds) {
        const moveResp = await request.post('/api/pools/verschieben', { data: { teilnehmerId, zielPoolId: poolId } });
        expect(moveResp.ok(), await moveResp.text()).toBeTruthy();
    }

    const zuordnenResp = await request.put('/api/pools/kampfflaeche-zuordnen', { data: { poolId, kampflaecheId: matId, position: 1 } });
    expect(zuordnenResp.ok(), await zuordnenResp.text()).toBeTruthy();

    return { turnierId, matId, poolId, poolBezeichnung };
}

// Spielt alle 11 Doppel-KO-8-Kämpfe durch, "W" (kaempfer1) gewinnt dabei immer per Ippon -- siehe
// Determinismus-Begründung oben. Identisch zum gleichnamigen Helper in
// steuerung-dk8-online-vs-offline.spec.js.
async function spieleKompletteBrackedDurch(page, anzahlKaempfe = 11) {
    let vorherigerName = 'Kämpfer 1';
    for (let i = 0; i < anzahlKaempfe; i++) {
        await page.locator('#btnNaechsterKampfLive').click();
        await expect(page.locator('#nameW')).not.toHaveValue(vorherigerName);
        vorherigerName = await page.locator('#nameW').inputValue();

        await page.evaluate(() => window.changeScore('W', 'ippon', 1));
        await expect(page.locator('#btnErgebnisSendenLive')).toBeVisible();

        await page.locator('#btnErgebnisSendenLive').click();
        await expect(page.locator('#btnNaechsterKampfLive')).toBeVisible();
    }
}

test.describe.serial('Siegerliste: Platzierungen und Vereinswertung nach einem Doppel-KO-8-Turnier', () => {
    let page;
    let turnierId;
    let poolId;
    let poolBezeichnung;

    test.beforeAll(async ({ browser, request }) => {
        const context = await browser.newContext();
        page = await context.newPage();

        const setup = await richteDk8TurnierEin(request, 'Siegerliste-DK8-Test');
        turnierId = setup.turnierId;
        poolId = setup.poolId;
        poolBezeichnung = setup.poolBezeichnung;

        await page.goto(`/steuerung.html?turnierId=${turnierId}&matId=${setup.matId}`);
        await expect(page.locator('#matSelect')).toHaveValue(String(setup.matId));
        await spieleKompletteBrackedDurch(page, 11);
    });

    test.afterAll(async () => {
        await page.context().close();
    });

    test('Zeigt Platz 1/2 aus dem Finale und den gemeinsamen Platz 3 aus beiden Bronze-Kämpfen', async () => {
        await page.goto(`/siegerliste.html?turnierId=${turnierId}`);

        const zeile = page.locator('#platzierungenTableBody tr').filter({ hasText: poolBezeichnung });
        await expect(zeile).toHaveCount(1);

        await expect(zeile.locator('.siegerliste-platz1')).toHaveText('Adler, Anna (JC Alpha)');
        await expect(zeile.locator('.siegerliste-platz2')).toHaveText('Conrad, Clara (JC Gamma)');
        // Gemeinsamer 3. Platz: beide Bronze-Sieger (T3 und T4) stehen in derselben Zelle.
        await expect(zeile.locator('.siegerliste-platz3')).toContainText('Ebert, Elena (JC Epsilon)');
        await expect(zeile.locator('.siegerliste-platz3')).toContainText('Graf, Greta (JC Eta)');

        // Alle 11 Kämpfe sind beendet -> Pool-Status ist 'kaempfe_beendet' (noch nicht manuell
        // "abgeschlossen", siehe DoppelKo8Manager.aktualisiereTurnier()), Label "Ergebnisse prüfen".
        await expect(zeile.locator('.pool-status-badge')).toHaveText('Ergebnisse prüfen');
        await expect(zeile.locator('.pool-status-badge')).toHaveClass(/beendet/);
    });

    test('Vereinswertung: 5/3/1 Punkte für Platz 1/2/3, korrekt sortiert (Punktegleichstand alphabetisch nach Verein)', async () => {
        // Nur die vier Vereine der tatsächlich platzierten Athletinnen tauchen auf -- Berta/Diana/
        // Frida/Hanna (und ihre Vereine) haben nirgends platziert und bleiben unberücksichtigt
        // (siehe berechneVereinswertung() in siegerliste.js: addieren() läuft nur über platz1/2/3).
        const zeilen = page.locator('#vereinswertungTableBody tr');
        await expect(zeilen).toHaveCount(4);

        await expect(zeilen.nth(0)).toContainText('JC Alpha');
        await expect(zeilen.nth(0)).toContainText('5');
        await expect(zeilen.nth(0).locator('.siegerliste-rang')).toHaveClass(/rang-1/);

        await expect(zeilen.nth(1)).toContainText('JC Gamma');
        await expect(zeilen.nth(1)).toContainText('3');
        await expect(zeilen.nth(1).locator('.siegerliste-rang')).toHaveClass(/rang-2/);

        // JC Epsilon (Elena) vor JC Eta (Greta) bei Punktegleichstand (1:1) -- "Ep" < "Et" alphabetisch.
        await expect(zeilen.nth(2)).toContainText('JC Epsilon');
        await expect(zeilen.nth(2)).toContainText('1');
        await expect(zeilen.nth(2).locator('.siegerliste-rang')).toHaveClass(/rang-3/);

        await expect(zeilen.nth(3)).toContainText('JC Eta');
        await expect(zeilen.nth(3)).toContainText('1');
        // Ab Rang 4 gibt es keine rang-X-Klasse mehr (nur Rang 1-3 werden hervorgehoben).
        await expect(zeilen.nth(3).locator('.siegerliste-rang')).not.toHaveClass(/rang-\d/);
    });

    test('"Pool abschließen" ändert nur den Status-Badge, die Platzierungen bleiben unverändert', async ({ request }) => {
        const abschliessenResp = await request.post(`/api/pools/${poolId}/abschliessen`);
        expect(abschliessenResp.ok(), await abschliessenResp.text()).toBeTruthy();

        await page.reload();
        const zeile = page.locator('#platzierungenTableBody tr').filter({ hasText: poolBezeichnung });

        await expect(zeile.locator('.pool-status-badge')).toHaveText('Abgeschlossen');
        await expect(zeile.locator('.siegerliste-platz1')).toHaveText('Adler, Anna (JC Alpha)');
        await expect(zeile.locator('.siegerliste-platz2')).toHaveText('Conrad, Clara (JC Gamma)');
        await expect(zeile.locator('.siegerliste-platz3')).toContainText('Ebert, Elena (JC Epsilon)');
        await expect(zeile.locator('.siegerliste-platz3')).toContainText('Graf, Greta (JC Eta)');
    });
});
