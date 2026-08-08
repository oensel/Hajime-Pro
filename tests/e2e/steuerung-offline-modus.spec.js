// End-to-End: steuerung.html im Offline-Modus (Kampfrichtertisch verliert die Verbindung zum
// Turnierserver, z.B. schlechtes Hallen-WLAN). Der Bediener lädt statt einer Live-API-Verbindung
// einen zuvor exportierten Mattendatensatz (siehe #offlineImportInput sowie
// offlineController.js:exportMatData für das reale Export-Format) direkt als JSON-Datei, trägt
// alle Kämpfe der Matte AUSSCHLIESSLICH mit clientseitiger Logik aus -- inklusive automatischer
// Bracket-Kaskade (aktualisiereTurnierOffline() nutzt dieselbe reine kampfProgression.js-Engine
// wie der Server, siehe dortigen Kommentar) -- und exportiert das Ergebnis am Ende wieder als
// JSON (#btnOfflineExport). Diese Datei wird später wieder ins Turnier zurückimportiert (siehe
// offlineController.js:importMatResults); ein Fehler in Sieger-/Punkte-Zuordnung oder in der
// Kaskade hier würde sich also direkt in falschen Turnierergebnissen niederschlagen.
//
// Anders als steuerung-anzeige-scoreboard.spec.js wird hier NICHTS über die Kämpfe-/
// Kampfflächen-API gemockt -- der Witz des Offline-Modus ist ja gerade, komplett ohne sie
// auszukommen. Die einzige reale Server-Interaktion ist der harmlose Turnier-Auswahl-Versuch
// beim allerersten Laden der Seite (ladeMatten() ohne turnierId-Parameter, siehe
// zeigeTurnierAuswahlModal() -- bei leerer Test-DB nur eine Hinweis-Meldung, kein Fehler), BEVOR
// die Offline-Datei geladen wird. Ab dem Import wird per page.on('request', ...) mitgeschnitten
// und am Ende verifiziert, dass tatsächlich keine einzige Kämpfe-/Kampfflächen-Anfrage mehr das
// Netzwerk verlässt.
//
// Testet nebenbei auch, dass die zuvor gefixte kaempfer1(=Weiß)/kaempfer2(=Blau/Rot)-Zuordnung in
// ergebnisSenden() (siehe steuerung-anzeige-scoreboard.spec.js) im Offline-Zweig genauso korrekt
// ist -- die beiden Halbfinals werden bewusst je einmal über W und einmal über B gewonnen.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';

const TURNIER_ID = 5001;
const MAT_ID = 42;
const POOL_ID = 77;

function baueOfflineExport() {
    const teilnehmer = [
        { id: 11, vorname: 'Anna', nachname: 'Adler', verein: 'JC Nord', pool_id: POOL_ID },
        { id: 12, vorname: 'Bea', nachname: 'Berger', verein: 'JC Süd', pool_id: POOL_ID },
        { id: 13, vorname: 'Carla', nachname: 'Conrad', verein: 'JC Ost', pool_id: POOL_ID },
        { id: 14, vorname: 'Dana', nachname: 'Diehl', verein: 'JC West', pool_id: POOL_ID }
    ];

    const poolFelder = {
        pool_kampfzeit: 180,
        pool_golden_score_aktiv: true,
        pool_golden_score_max_sekunden: 60
    };

    const kaempfe = [
        {
            id: 901, pool_id: POOL_ID, status: 'bereit', pool_bezeichnung: 'U18 -73kg (Offline) - Halbfinale',
            kaempfer1_id: 11, kaempfer1_vorname: 'Anna', kaempfer1_nachname: 'Adler', kaempfer1_verein: 'JC Nord',
            kaempfer2_id: 12, kaempfer2_vorname: 'Bea', kaempfer2_nachname: 'Berger', kaempfer2_verein: 'JC Süd',
            kaempfer1_quelle_kampf_id: null, kaempfer1_quelle_typ: null,
            kaempfer2_quelle_kampf_id: null, kaempfer2_quelle_typ: null,
            ...poolFelder
        },
        {
            id: 902, pool_id: POOL_ID, status: 'bereit', pool_bezeichnung: 'U18 -73kg (Offline) - Halbfinale',
            kaempfer1_id: 13, kaempfer1_vorname: 'Carla', kaempfer1_nachname: 'Conrad', kaempfer1_verein: 'JC Ost',
            kaempfer2_id: 14, kaempfer2_vorname: 'Dana', kaempfer2_nachname: 'Diehl', kaempfer2_verein: 'JC West',
            kaempfer1_quelle_kampf_id: null, kaempfer1_quelle_typ: null,
            kaempfer2_quelle_kampf_id: null, kaempfer2_quelle_typ: null,
            ...poolFelder
        },
        {
            // Finale: beide Kämpfer stehen erst fest, sobald die beiden Halbfinals (901/902)
            // beendet sind -- genau das prüft aktualisiereTurnierOffline() rein clientseitig.
            id: 903, pool_id: POOL_ID, status: 'angelegt', pool_bezeichnung: 'U18 -73kg (Offline) - Finale',
            kaempfer1_id: null, kaempfer2_id: null,
            kaempfer1_quelle_kampf_id: 901, kaempfer1_quelle_typ: 'sieger',
            kaempfer2_quelle_kampf_id: 902, kaempfer2_quelle_typ: 'sieger',
            ...poolFelder
        }
    ];

    return {
        version: '1.0',
        exportTimestamp: new Date().toISOString(),
        turnierId: TURNIER_ID,
        turnierBezeichnung: 'Offline-Test-Turnier',
        kampfflaecheId: MAT_ID,
        kampfflaecheBezeichnung: 'Matte 1 (Offline)',
        pools: [{ id: POOL_ID, bezeichnung: 'U18 -73kg (Offline)', kampfzeit_sekunden: 180, golden_score_aktiv: true, golden_score_max_sekunden: 60 }],
        teilnehmer,
        kaempfe
    };
}

test.describe.serial('steuerung.html im Offline-Modus: JSON-Import -> Kämpfe austragen -> JSON-Export', () => {
    let page;
    let anzeigePage;
    let netzwerkAnfragenNachImport;

    test.beforeAll(async ({ browser }) => {
        const context = await browser.newContext({ acceptDownloads: true });
        page = await context.newPage();
        anzeigePage = await context.newPage();

        // turnierId=999999999 ist bewusst frei erfunden: steuerung.html ohne turnierId-Parameter
        // versucht sonst per zeigeTurnierAuswahlModal() ein echtes Turnier aus der DB auszuwählen
        // (siehe ladeMatten()) -- bei einer leeren Test-DB bleibt das eine harmlose Meldung, sobald
        // aber (z.B. durch andere, zuvor gelaufene Spec-Dateien) echte Turniere existieren, würde
        // sich ein blockierendes Auswahl-Modal öffnen. Die erfundene ID lässt ladeMatten() den
        // (leeren) Kampfflächen-Fetch für ein nicht existierendes Turnier machen und danach in
        // Ruhe auf den Offline-Import warten, unabhängig vom sonstigen DB-Zustand.
        await Promise.all([
            page.goto('/steuerung.html?turnierId=999999999'),
            anzeigePage.goto('/anzeige.html')
        ]);
    });

    test.afterAll(async () => {
        await page.context().close();
    });

    test('JSON-Mattendatensatz laden schaltet die Steuerung in den Offline-Modus', async () => {
        await expect(page.locator('#connectionModeText')).toHaveText('Online (WLAN)');
        await expect(page.locator('#btnOfflineExport')).toBeHidden();

        await page.locator('#offlineImportInput').setInputFiles({
            name: 'ergebnisse_matte_42.json',
            mimeType: 'application/json',
            buffer: Buffer.from(JSON.stringify(baueOfflineExport()))
        });

        await expect(page.locator('#connectionModeText')).toHaveText('Offline (Lokal)');
        await expect(page.locator('#btnOfflineExport')).toBeVisible();
        await expect(page.locator('#matSelect')).toHaveValue(String(MAT_ID));
        await expect(page.locator('#centerNotification')).toContainText('Offline-Daten für Matte 1 (Offline) geladen!');

        // Ab hier darf keine einzige Kämpfe-/Kampfflächen-Anfrage mehr das Netzwerk verlassen --
        // genau das soll der Offline-Modus leisten.
        netzwerkAnfragenNachImport = [];
        page.on('request', req => {
            const url = req.url();
            if (url.includes('/api/kaempfe') || url.includes('/api/kampfflaechen')) {
                netzwerkAnfragenNachImport.push(url);
            }
        });
    });

    test('Halbfinale 1 (Kampf 901): Anna gewinnt gegen Bea per Ippon', async () => {
        await page.locator('#btnNaechsterKampfLive').click();
        await expect(page.locator('#nameW')).toHaveValue('Adler, Anna');
        await expect(page.locator('#nameB')).toHaveValue('Berger, Bea');

        await page.evaluate(() => window.changeScore('W', 'ippon', 1));
        await expect(anzeigePage.locator('#bannerW')).toHaveText('IPPON');
        await expect(page.locator('#btnErgebnisSendenLive')).toBeVisible();

        await page.locator('#btnErgebnisSendenLive').click();
        await expect(page.locator('#btnNaechsterKampfLive')).toBeVisible();
    });

    test('Halbfinale 2 (Kampf 902): Dana gewinnt gegen Carla per Ippon', async () => {
        await page.locator('#btnNaechsterKampfLive').click();
        await expect(page.locator('#nameW')).toHaveValue('Conrad, Carla');
        await expect(page.locator('#nameB')).toHaveValue('Diehl, Dana');

        // Diesmal gewinnt B (kaempfer2) -- deckt die Gegenrichtung der sieger_id/
        // unterbewertung_kaempferX-Zuordnung ab.
        await page.evaluate(() => window.changeScore('B', 'ippon', 1));
        await expect(anzeigePage.locator('#bannerB')).toHaveText('IPPON');

        await page.locator('#btnErgebnisSendenLive').click();
        await expect(page.locator('#btnNaechsterKampfLive')).toBeVisible();
    });

    test('Finale (Kampf 903) wird offline automatisch mit den beiden Halbfinal-Siegern befüllt', async () => {
        await page.locator('#btnNaechsterKampfLive').click();

        // Kaskade lief rein clientseitig (aktualisiereTurnierOffline()) -- keine Server-Anfrage
        // nötig, um zu wissen, dass Anna (901) und Dana (902) gewonnen haben.
        await expect(page.locator('#nameW')).toHaveValue('Adler, Anna');
        await expect(page.locator('#nameB')).toHaveValue('Diehl, Dana');
        await expect(page.locator('#poolName')).toHaveValue('U18 -73kg (Offline) - Finale');

        await page.evaluate(() => window.changeScore('W', 'ippon', 1));
        await page.locator('#btnErgebnisSendenLive').click();
        await expect(page.locator('#btnNaechsterKampfLive')).toBeVisible();

        expect(netzwerkAnfragenNachImport, `Unerwartete Netzwerkanfragen im Offline-Modus:\n${netzwerkAnfragenNachImport.join('\n')}`).toEqual([]);
    });

    test('"Ergebnisse exportieren (JSON)" liefert eine korrekte, vollständige Datei inkl. kaskadiertem Finale', async () => {
        const [download] = await Promise.all([
            page.waitForEvent('download'),
            page.locator('#btnOfflineExport').click()
        ]);

        expect(download.suggestedFilename()).toBe(`ergebnisse_matte_${MAT_ID}.json`);

        const pfad = await download.path();
        const exportiert = JSON.parse(fs.readFileSync(pfad, 'utf-8'));

        expect(exportiert.turnierId).toBe(TURNIER_ID);
        expect(exportiert.kampfflaecheId).toBe(MAT_ID);
        expect(exportiert.kaempfe).toHaveLength(3);

        const hf1 = exportiert.kaempfe.find(k => k.id === 901);
        expect(hf1.status).toBe('beendet');
        expect(hf1.sieger_id).toBe(11); // Anna (kaempfer1/Weiß)
        expect(hf1.unterbewertung_kaempfer1).toBe(10);
        expect(hf1.unterbewertung_kaempfer2).toBe(0);

        const hf2 = exportiert.kaempfe.find(k => k.id === 902);
        expect(hf2.status).toBe('beendet');
        expect(hf2.sieger_id).toBe(14); // Dana (kaempfer2/Blau-Rot)
        expect(hf2.unterbewertung_kaempfer1).toBe(0);
        expect(hf2.unterbewertung_kaempfer2).toBe(10);

        const finale = exportiert.kaempfe.find(k => k.id === 903);
        expect(finale.status).toBe('beendet');
        // Aus den Halbfinal-Siegern kaskadierte Kämpfer -- keine Platzhalter mehr.
        expect(finale.kaempfer1_id).toBe(11); // Anna aus Halbfinale 1
        expect(finale.kaempfer2_id).toBe(14); // Dana aus Halbfinale 2
        expect(finale.kaempfer1_nachname).toBe('Adler');
        expect(finale.kaempfer2_nachname).toBe('Diehl');
        expect(finale.sieger_id).toBe(11);
        expect(finale.unterbewertung_kaempfer1).toBe(10);
        expect(finale.unterbewertung_kaempfer2).toBe(0);
    });
});
