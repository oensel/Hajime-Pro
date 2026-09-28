// End-to-End: Teilnehmer über teilnehmer.html aus mehreren unterschiedlichen Dateien (CSV UND
// XLSX, Import-Ziel "Einzel" UND "Mannschaft") importieren und den gesamten Verwaltungs-Workflow
// (Badges, Icon-Toggles, Editier-Modal, QR-Scan, Sammel-Aktionen, Menü-Freischaltung) prüfen.
//
// Die einzelnen Themen laufen als eigene, kleine test()-Blöcke statt als ein einziger Riesentest
// (bessere Fehlerlokalisierung, lesbarere Testberichte). Sie sind aber inhaltlich eine
// zusammenhängende Kette (spätere Tests bauen auf den in früheren Tests importierten/bearbeiteten
// Daten auf) und teilen sich deshalb bewusst EINE Page/Session über test.describe.serial +
// beforeAll statt jeweils eigenes Turnier + eigene 9-Datei-Imports zu wiederholen — das würde die
// Laufzeit vervielfachen, ohne zusätzliche Abdeckung zu bringen (siehe playwright.config.js:
// die Suite läuft ohnehin mit einem Worker gegen eine gemeinsame SQLite-Datei).
import { test, expect } from '@playwright/test';
import * as XLSX from 'xlsx';

const TURNIER_NAME = `E2E-Import-Turnier ${Date.now()}`;

// Muss zum weiter unten gesetzten Turnier-Datum passen (ermittleAltersklasse in
// teilnehmerController.js leitet das Wettkampfjahr aus turnier.datum ab).
const WETTKAMPFJAHR = 2027;
const GEBURTSJAHR_U9 = WETTKAMPFJAHR - 6;   // Alter 6 -> Standardklasse U9 (Alter 5-7)
const GEBURTSJAHR_U11 = WETTKAMPFJAHR - 9;  // Alter 9 -> Standardklasse U11 (Alter 8-10)
const GEBURTSJAHR_U15 = WETTKAMPFJAHR - 13; // Alter 13 -> Standardklasse U15 (Alter 13-14)

// --- Kleine, deterministische Namens-Generatoren für abwechslungsreiche Testdaten ---
const VORNAMEN_M = ['Finn', 'Luca', 'Paul', 'Ben', 'Noah', 'Elias', 'Jonas', 'Max', 'Leon', 'Felix', 'Tom', 'David', 'Julian', 'Nico', 'Tim'];
const VORNAMEN_W = ['Mia', 'Emma', 'Lena', 'Sofia', 'Lea', 'Anna', 'Laura', 'Nele', 'Marie', 'Lina', 'Ida', 'Frieda', 'Clara', 'Greta', 'Sarah'];
const NACHNAMEN = ['Schmidt', 'Müller', 'Fischer', 'Weber', 'Meyer', 'Wagner', 'Becker', 'Schulz', 'Hoffmann', 'Koch', 'Richter', 'Klein', 'Wolf', 'Neumann', 'Schwarz', 'Zimmermann', 'Braun', 'Krüger', 'Hofmann', 'Lange'];

function generiereName(index, geschlechtFuerVorname) {
    const vornamen = geschlechtFuerVorname === 'weiblich' ? VORNAMEN_W : VORNAMEN_M;
    return {
        vorname: vornamen[index % vornamen.length],
        nachname: NACHNAMEN[(index * 7 + 3) % NACHNAMEN.length]
    };
}

// Eigene, von den Einzelwettkampf-Pools komplett getrennte Namenslisten für Mannschaftsmitglieder
// (siehe generiereTeamName): ein reiner Index-Versatz reicht NICHT aus, um Kollisionen mit
// baueEinzelZeilen sicher auszuschließen, da sich vorname (Periode 15) und nachname (Periode 20)
// unabhängig wiederholen und bei jedem Index, der ≡40 (mod 60, dem kgV von 15 und 20) ist, exakt
// dieselbe Namens-Kombination wie bei Index 40 liefern — unabhängig davon, wie groß der Versatz
// gewählt wird. Komplett eigene Wortlisten schließen das strukturell aus.
// Mindestens so lang wie die größte Mannschaftsdatei (13 Zeilen, siehe psvMannschaft weiter unten),
// sonst würde der Index bei Modulo umlaufen und wieder denselben Namen wie ein früheres
// Mannschaftsmitglied erzeugen (z.B. Index 12 % 12 === Index 0 bei nur 12 Namen).
const TEAM_VORNAMEN_M = ['Kilian', 'Matteo', 'Jannik', 'Levi', 'Emil', 'Theo', 'Bruno', 'Milo', 'Anton', 'Aaron', 'Moritz', 'Vincent', 'Linus', 'Oskar', 'Henri'];
const TEAM_VORNAMEN_W = ['Johanna', 'Charlotte', 'Amelie', 'Lilly', 'Pauline', 'Josephine', 'Helena', 'Antonia', 'Victoria', 'Luisa', 'Romy', 'Mathilda', 'Emilia', 'Wilma', 'Rosalie'];
const TEAM_NACHNAMEN = ['Lehmann', 'Huber', 'Kaiser', 'Fuchs', 'Vogel', 'Keller', 'Günther', 'Frank', 'Berger', 'Winter', 'Sommer', 'Herrmann', 'Albrecht', 'Franke', 'Peters'];

function generiereTeamName(index, geschlechtFuerVorname) {
    const vornamen = geschlechtFuerVorname === 'weiblich' ? TEAM_VORNAMEN_W : TEAM_VORNAMEN_M;
    return {
        vorname: vornamen[index % vornamen.length],
        nachname: TEAM_NACHNAMEN[index % TEAM_NACHNAMEN.length]
    };
}

// Entspricht der Spaltenreihenfolge der Import-Vorlage (siehe IMPORT_SYSTEMFELDER in
// teilnehmerController.js): Vorname, Name, Passnr, Geburtsdatum, Geburtsjahr, Geschlecht, Verein,
// Team-Name, Graduierung, Gewicht. Geburtsjahr statt Geburtsdatum genügt (siehe dortiger
// Kommentar: Altersklassen basieren nur auf dem Jahrgang).
const CSV_HEADER = ['Vorname', 'Name', 'Passnr', 'Geburtsdatum', 'Geburtsjahr', 'Geschlecht', 'Verein', 'Team-Name', 'Graduierung', 'Gewicht'];

function zeile({ vorname, nachname, geburtsjahr, geschlecht, verein, teamName = '', gewicht = '' }) {
    return [vorname, nachname, '', '', String(geburtsjahr), geschlecht, verein, teamName, '', gewicht === '' ? '' : String(gewicht)];
}

// Einzelwettkampf-Meldungen eines Vereins: U11 bleibt geschlechtsgetrennt, U9 läuft als
// gemeinsame Mixed-Klasse (U9 existiert im DJB-Standard nicht geschlechtsgetrennt, siehe
// altersklassen.json) — die Namen selbst wechseln trotzdem ab, damit nicht nur männliche Namen
// vorkommen.
function baueEinzelZeilen(verein, { u11m = 0, u11w = 0, u9 = 0 }) {
    const zeilen = [];
    for (let i = 0; i < u11m; i++) {
        const { vorname, nachname } = generiereName(zeilen.length, 'männlich');
        zeilen.push(zeile({ vorname, nachname, geburtsjahr: GEBURTSJAHR_U11, geschlecht: 'männlich', verein, gewicht: 25 + (i % 15) }));
    }
    for (let i = 0; i < u11w; i++) {
        const { vorname, nachname } = generiereName(zeilen.length, 'weiblich');
        zeilen.push(zeile({ vorname, nachname, geburtsjahr: GEBURTSJAHR_U11, geschlecht: 'weiblich', verein, gewicht: 24 + (i % 15) }));
    }
    for (let i = 0; i < u9; i++) {
        const geschlechtFuerName = i % 2 === 0 ? 'männlich' : 'weiblich';
        const { vorname, nachname } = generiereName(zeilen.length, geschlechtFuerName);
        // Gewicht auch für U9 setzen (nicht nur, damit die Klasse-Badges vollständig sind): die
        // Kampfbereitschafts-Kriterien in teilnehmerController.js (aendereStatusFelder) verlangen
        // u.a. ein Gewicht > 0 — ohne dieses Feld könnten U9-Teilnehmer nie "bereit" werden, egal
        // wie oft man sie als gewogen/bezahlt/lizenziert markiert (siehe Sammel-Aktionen weiter unten).
        zeilen.push(zeile({ vorname, nachname, geburtsjahr: GEBURTSJAHR_U9, geschlecht: 'mixed', verein, gewicht: 18 + (i % 10) }));
    }
    return zeilen;
}

// Mitglieder-Zeilen einer Mannschaft (Import-Ziel "mannschaft"), jeweils mit Team-Name.
// ohneTeamNameBeiIndex: 0-basierter Index, dessen Zeile absichtlich OHNE Team-Name gebaut wird, um
// die Pflichtfeld-Regel "Bei Mannschaften ist der Team-Name ein Pflichtfeld" zu prüfen.
// Nutzt bewusst generiereTeamName() (eigene Wortlisten) statt generiereName(): ein Verein mit
// vielen Einzel-Meldungen (z.B. 20x U11m) darf niemals denselben Vor-/Nachnamen wie eines seiner
// Mannschaftsmitglieder erzeugen — sonst wäre die Zeile in der Tabelle später nicht mehr eindeutig
// über Name+Verein identifizierbar (siehe pruefeTeamNameInListe weiter unten).
function baueMannschaftsZeilen(verein, teamName, geschlecht, anzahl, gewichte, ohneTeamNameBeiIndex = -1) {
    const zeilen = [];
    for (let i = 0; i < anzahl; i++) {
        const { vorname, nachname } = generiereTeamName(i, geschlecht);
        zeilen.push(zeile({
            vorname, nachname, geburtsjahr: GEBURTSJAHR_U15, geschlecht, verein,
            teamName: i === ohneTeamNameBeiIndex ? '' : teamName,
            gewicht: gewichte[i % gewichte.length]
        }));
    }
    return zeilen;
}

function baueCsv(zeilen) {
    return [CSV_HEADER, ...zeilen]
        .map(z => z.map(w => `"${String(w ?? '').replace(/"/g, '""')}"`).join(','))
        .join('\r\n');
}

function baueXlsxBuffer(zeilen) {
    const blatt = XLSX.utils.aoa_to_sheet([CSV_HEADER, ...zeilen]);
    const arbeitsmappe = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(arbeitsmappe, blatt, 'Teilnehmer');
    return XLSX.write(arbeitsmappe, { type: 'buffer', bookType: 'xlsx' });
}

function csvDatei(name, zeilen) {
    return { name, mimeType: 'text/csv', buffer: Buffer.from(baueCsv(zeilen), 'utf-8') };
}

function xlsxDatei(name, zeilen) {
    return { name, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: baueXlsxBuffer(zeilen) };
}

// Wählt im Import-Ziel-Modal (erscheint, weil unser Turnier sowohl Einzel- als auch
// Mannschafts-Altersklassen austrägt, siehe ermittleImportZiel in teilnehmer.js) den gewünschten
// Bereich, fängt den dadurch ausgelösten nativen Datei-Dialog (importFileInput.click()) über das
// Playwright-"filechooser"-Event ab und liefert die Datei direkt aus dem Speicher statt von der
// Festplatte.
async function waehleZielUndLiefereDatei(page, ziel, datei) {
    await expect(page.locator('#importZielModal')).toBeVisible();
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.locator(ziel === 'mannschaft' ? '#importZielMannschaftBtn' : '#importZielEinzelBtn').click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(datei);
}

// Simuliert das Scannen eines QR-Passes, ohne eine echte Webcam zu benötigen: navigator.
// mediaDevices.getUserMedia() wird durch einen echten (aber inhaltsleeren) MediaStream aus einem
// Canvas ersetzt, damit video.play()/readyState im Scanner (siehe qr-scanner.js) normal
// funktionieren, und window.jsQR (global aus /js/qr/jsQR.js geladen) durch einen Stub ersetzt, der
// beim ersten verarbeiteten Frame sofort die übergebenen Nutzdaten als "erkannten" QR-Inhalt
// liefert. Ab da läuft der komplette echte Verarbeitungspfad (qr-scanner.js -> waage-modal.js:
// verarbeiteGescannteDaten) unverändert durch — nur die optische Erkennung selbst ist gestubbt.
async function stelleQrScanBereit(page, nutzdaten) {
    await page.evaluate((daten) => {
        navigator.mediaDevices.getUserMedia = async () => {
            const canvas = document.createElement('canvas');
            canvas.width = 4;
            canvas.height = 4;
            return canvas.captureStream(10);
        };

        // Ein im (headless) Browser via captureStream() erzeugter Leer-Stream erreicht ohne
        // echtes Bildmaterial/Compositing praktisch nie video.readyState === HAVE_ENOUGH_DATA UND
        // videoWidth/videoHeight bleiben 0 (der Tick-Loop in qr-scanner.js würde entweder ewig
        // warten oder beim canvas.getImageData() mit Breite/Höhe 0 eine Exception werfen) ->
        // beides wird deshalb direkt auf dem Element fest gesetzt.
        const video = document.getElementById('previewVideo');
        if (video && !Object.getOwnPropertyDescriptor(video, 'readyState')) {
            Object.defineProperty(video, 'readyState', { get: () => 4, configurable: true });
            Object.defineProperty(video, 'videoWidth', { get: () => 4, configurable: true });
            Object.defineProperty(video, 'videoHeight', { get: () => 4, configurable: true });
        }

        window.jsQR = () => ({ data: JSON.stringify(daten) });
    }, nutzdaten);
}

test.describe.serial('Teilnehmer-Import und -Verwaltung (teilnehmer.html)', () => {
    // Von beforeAll gesetzt, über alle Tests dieser Datei hinweg dieselbe Page/Session (siehe
    // Kommentar oben zur Begründung). Die restlichen Variablen werden vom Import-Test befüllt und
    // von den nachfolgenden Themen-Tests gelesen.
    let page;
    let turnierId;
    let arminiaEinzel, psvEinzel, psvMannschaft;
    let jcEssenM, jcEssenW, jcEssen;
    let fcMgM, fcMgW, fcMg;
    let tsEinfeldEinzel, tsEinfeldM, tsEinfeldW, tsEinfeldMannschaft;
    let ftnEinzel, ftnM, ftnW, ftnMannschaft;
    let erwarteteGesamtzahl;

    // Findet die eindeutige Tabellenzeile eines Athleten über Vorname+Nachname+Verein (die einzige
    // stabile Kombination, die wir clientseitig kennen — die DB-ID vergibt der Server erst beim
    // Import).
    function findeZeile(vorname, nachname, verein) {
        return page.locator('#teilnehmerTableBody tr')
            .filter({ hasText: nachname })
            .filter({ hasText: vorname })
            .filter({ hasText: verein });
    }

    // Führt einen kompletten Import-Durchlauf aus (Ziel wählen -> Datei liefern -> Vorschau prüfen
    // -> starten -> auf die Status-Meldung warten). Die erwarteten Zahlen/Texte spiegeln exakt die
    // Meldungslogik aus importTeilnehmer()/previewTeilnehmerImport() in teilnehmerController.js,
    // damit ein Abweichen dort den Test tatsächlich bricht.
    async function importiereUndPruefe(ziel, datei, { erwarteGueltig, erwarteFehlerhaft = 0, erwarteMannschaften = null, erwarteSkipHinweis = null }) {
        await page.locator('#importBtn').click();
        await waehleZielUndLiefereDatei(page, ziel, datei);

        const importVorschauModal = page.locator('#importVorschauModal');
        const importVorschauSummary = page.locator('#importVorschauSummary');
        await expect(importVorschauModal).toBeVisible();
        await expect(importVorschauSummary).toContainText(`Es wurden ${erwarteGueltig} gültige und ${erwarteFehlerhaft} fehlerhafte Zeile(n) gefunden`);

        await page.locator('#importVorschauStartenBtn').click();
        await expect(importVorschauModal).toBeHidden();

        const gesamt = erwarteGueltig + erwarteFehlerhaft;
        let erwarteterText = `${erwarteGueltig} von ${gesamt} Teilnehmern importiert.`;
        if (erwarteFehlerhaft > 0) erwarteterText += ` ${erwarteFehlerhaft} übersprungen.`;
        if (erwarteMannschaften !== null) erwarteterText += ` ${erwarteMannschaften} Mannschaft(en) angelegt/aktualisiert.`;
        await expect(page.locator('#importStatus')).toHaveText(erwarteterText);

        if (erwarteSkipHinweis) {
            const importSkippedList = page.locator('#importSkippedList');
            await expect(importSkippedList).toBeVisible();
            await expect(importSkippedList).toContainText(erwarteSkipHinweis);
        }
    }

    // --- TEAM-NAME MUSS IN DER LISTE AUFTAUCHEN: für jede importierte Mannschaft wird anhand
    // ihres ersten Mitglieds (Vorname/Nachname/Verein identifizieren die Zeile eindeutig) geprüft,
    // dass die Team-Spalte (siehe renderKlasseBadges/Team-Spalte in teilnehmer.js) tatsächlich die
    // Team-Bezeichnung aus der importierten Datei zeigt.
    async function pruefeTeamNameInListe({ zeile: [vorname, nachname], verein, erwarteterTeamName }) {
        const zeile = findeZeile(vorname, nachname, verein);
        await expect(zeile, `Zeile für ${vorname} ${nachname} (${verein}) nicht eindeutig gefunden`).toHaveCount(1);
        await expect(zeile.locator('td').nth(5)).toContainText(erwarteterTeamName);
    }

    // Markiert per Kopf-Checkbox ALLE Teilnehmer, wählt genau einen (unberührten) davon wieder ab
    // und führt dann die übergebene Sammel-Aktion aus.
    async function markiereAlleAusserEinem(button, [ausnahmeVorname, ausnahmeNachname, ausnahmeVerein], erwarteteNachricht) {
        await page.locator('#selectAllCheckbox').check();
        const ausnahmeZeile = findeZeile(ausnahmeVorname, ausnahmeNachname, ausnahmeVerein);
        await ausnahmeZeile.locator('.row-checkbox').uncheck();

        await button.click();
        await expect(page.locator('#customConfirmModal')).toBeVisible();
        await page.locator('#modalConfirmBtn').click();
        await expect(page.locator('#snackbarText')).toHaveText(erwarteteNachricht);
    }

    test.beforeAll(async ({ browser }) => {
        const context = await browser.newContext();
        page = await context.newPage();
    });

    test.afterAll(async () => {
        await page.close();
    });

    test('Turnier mit Einzel- und Mannschafts-Altersklassen anlegen', async () => {
        await page.goto('/turnier.html');
        await page.locator('#bezeichnung').fill(TURNIER_NAME);
        await page.locator('#datum').fill(`${WETTKAMPFJAHR}-09-18`);
        await page.locator('#ort').fill('Senden');
        await page.locator('#plz').fill('48308');
        await page.locator('#ausrichter').fill('JC Senden');
        await page.locator('#anzahl_kampfflaechen').fill('4');
        await page.locator('#bundesland').selectOption('Nordrhein-Westfalen');

        await page.locator('input[name="altersklasse_cb"][value="männlich_U11"]').check();
        await page.locator('input[name="altersklasse_cb"][value="weiblich_U11"]').check();

        // U9 existiert nicht als DJB-Standardklasse (nur U11+, siehe altersklassen.json) -> als
        // freie Klasse bei "mixed" hinzufügen, identisch zum Vorgehen in turnier-anlegen.spec.js.
        const einzelContainer = page.locator('#altersklassenContainer');
        const mixedBlock = einzelContainer.locator('.turnier-ak-gender-block').filter({
            has: page.locator('.turnier-ak-gender-title', { hasText: 'mixed' })
        });
        await mixedBlock.locator('.turnier-ak-add-btn').click();
        const promptModal = page.locator('#customPromptModal');
        await expect(promptModal).toBeVisible();
        await page.locator('#promptModalInput').fill('U9');
        await page.locator('#promptModalConfirmBtn').click();
        await expect(promptModal).toBeHidden();
        await expect(page.locator('input[name="altersklasse_cb"][value="mixed_U9"]')).toBeChecked();

        await page.locator('input[name="mannschaft_altersklasse_cb"][value="männlich_U15"]').check();
        await page.locator('input[name="mannschaft_altersklasse_cb"][value="weiblich_U15"]').check();

        await page.locator('#submitBtn').click();
        await expect(page.locator('#snackbarText')).toHaveText('Turnier erfolgreich angelegt!');
        await expect(page).toHaveURL(/\/turnier\.html\?id=\d+/);

        turnierId = new URL(page.url()).searchParams.get('id');

        await page.goto(`/teilnehmer.html?id=${turnierId}`);
        await expect(page.locator('#importBtn')).toBeVisible();
    });

    test('Mehrere CSV-/XLSX-Dateien importieren (Einzel und Mannschaft) inkl. Pflichtfeld-Validierung', async () => {
        // Neun Datei-Uploads mit jeweils eigenem Vorschau-/Start-Roundtrip brauchen mehr als das
        // Playwright-Standard-Timeout von 30s.
        test.setTimeout(120_000);

        // --- Arminia Appelhülsen: nur Einzelwettkampf (CSV) ---
        arminiaEinzel = baueEinzelZeilen('Arminia Appelhülsen', { u11m: 10, u11w: 10, u9: 5 });
        await importiereUndPruefe('einzel', csvDatei('arminia.csv', arminiaEinzel), { erwarteGueltig: arminiaEinzel.length });

        // --- PSV Münster: Einzelwettkampf (XLSX) ---
        psvEinzel = baueEinzelZeilen('PSV Münster', { u11m: 20, u11w: 20, u9: 10 });
        await importiereUndPruefe('einzel', xlsxDatei('psv-einzel.xlsx', psvEinzel), { erwarteGueltig: psvEinzel.length });

        // --- PSV Münster: Mannschaft U15 männlich, 12 Mitglieder + 1 Zeile OHNE Team-Name (CSV) ---
        // Prüft gezielt die Pflichtfeld-Regel "Bei Mannschaften ist der Team-Name ein Pflichtfeld":
        // die Zeile ohne Team-Name muss als fehlerhaft erkannt und beim Import übersprungen werden.
        psvMannschaft = baueMannschaftsZeilen('PSV Münster', 'U15 männlich', 'männlich', 13, [40, 48, 58, 65], 4);
        await importiereUndPruefe('mannschaft', csvDatei('psv-mannschaft.csv', psvMannschaft), {
            erwarteGueltig: 12, erwarteFehlerhaft: 1, erwarteMannschaften: 1, erwarteSkipHinweis: 'Team-Name'
        });

        // --- JC Essen: nur Mannschaften U15 männlich + U15 weiblich (XLSX) ---
        jcEssenM = baueMannschaftsZeilen('JC Essen', 'U15 männlich', 'männlich', 12, [40, 48, 58, 65]);
        jcEssenW = baueMannschaftsZeilen('JC Essen', 'U15 weiblich', 'weiblich', 12, [38, 46, 55, 60]);
        jcEssen = [...jcEssenM, ...jcEssenW];
        await importiereUndPruefe('mannschaft', xlsxDatei('jc-essen.xlsx', jcEssen), { erwarteGueltig: jcEssen.length, erwarteMannschaften: 2 });

        // --- 1. FC Mönchengladbach: nur Mannschaften U15 männlich + U15 weiblich (CSV) ---
        fcMgM = baueMannschaftsZeilen('1. FC Mönchengladbach', 'U15 männlich', 'männlich', 12, [40, 48, 58, 65]);
        fcMgW = baueMannschaftsZeilen('1. FC Mönchengladbach', 'U15 weiblich', 'weiblich', 12, [38, 46, 55, 60]);
        fcMg = [...fcMgM, ...fcMgW];
        await importiereUndPruefe('mannschaft', csvDatei('fc-mg.csv', fcMg), { erwarteGueltig: fcMg.length, erwarteMannschaften: 2 });

        // --- TS Einfeld: Einzelwettkampf (XLSX) + Mannschaften U15 männlich/weiblich (CSV) ---
        tsEinfeldEinzel = baueEinzelZeilen('TS Einfeld', { u11m: 20, u11w: 20, u9: 10 });
        await importiereUndPruefe('einzel', xlsxDatei('ts-einfeld-einzel.xlsx', tsEinfeldEinzel), { erwarteGueltig: tsEinfeldEinzel.length });

        tsEinfeldM = baueMannschaftsZeilen('TS Einfeld', 'U15 männlich', 'männlich', 12, [40, 48, 58, 65]);
        tsEinfeldW = baueMannschaftsZeilen('TS Einfeld', 'U15 weiblich', 'weiblich', 12, [38, 46, 55, 60]);
        tsEinfeldMannschaft = [...tsEinfeldM, ...tsEinfeldW];
        await importiereUndPruefe('mannschaft', csvDatei('ts-einfeld-mannschaft.csv', tsEinfeldMannschaft), { erwarteGueltig: tsEinfeldMannschaft.length, erwarteMannschaften: 2 });

        // --- FTN: Einzelwettkampf (CSV) + Mannschaften U15 männlich/weiblich (XLSX) ---
        ftnEinzel = baueEinzelZeilen('FTN', { u11m: 20, u11w: 20, u9: 10 });
        await importiereUndPruefe('einzel', csvDatei('ftn-einzel.csv', ftnEinzel), { erwarteGueltig: ftnEinzel.length });

        ftnM = baueMannschaftsZeilen('FTN', 'U15 männlich', 'männlich', 12, [40, 48, 58, 65]);
        ftnW = baueMannschaftsZeilen('FTN', 'U15 weiblich', 'weiblich', 12, [38, 46, 55, 60]);
        ftnMannschaft = [...ftnM, ...ftnW];
        await importiereUndPruefe('mannschaft', xlsxDatei('ftn-mannschaft.xlsx', ftnMannschaft), { erwarteGueltig: ftnMannschaft.length, erwarteMannschaften: 2 });

        // --- GESAMTZAHL PRÜFEN: Summe aller tatsächlich importierten (nicht der hochgeladenen) Zeilen ---
        erwarteteGesamtzahl =
            arminiaEinzel.length + psvEinzel.length + 12 /* PSV-Mannschaft ohne die übersprungene Zeile */
            + jcEssen.length + fcMg.length
            + tsEinfeldEinzel.length + tsEinfeldMannschaft.length
            + ftnEinzel.length + ftnMannschaft.length;

        await expect(page.locator('#statGesamtTeilnehmer')).toHaveText(String(erwarteteGesamtzahl));
        await expect(page.locator('#teilnehmerTableBody tr')).toHaveCount(erwarteteGesamtzahl);
    });

    test('Alle frisch importierten Teilnehmer haben Status "angemeldet"', async () => {
        // (siehe defaultTo('angemeldet') in der Migration teilnehmer_status_lifecycle sowie
        // TEILNEHMER_STATUS_LABELS in teilnehmer.js — jede Zeile zeigt den Status als <select>, da
        // 'angemeldet' Teil von STATUS_MANUELL_SETZBAR ist).
        const statusWerte = await page.locator('[data-status-select]').evaluateAll(nodes => nodes.map(n => n.value));
        expect(statusWerte).toHaveLength(erwarteteGesamtzahl);
        expect(statusWerte.every(wert => wert === 'angemeldet')).toBe(true);
    });

    test('Team-Name erscheint in der Teilnehmerliste', async () => {
        await pruefeTeamNameInListe({ zeile: psvMannschaft[0], verein: 'PSV Münster', erwarteterTeamName: 'U15 männlich' });
        await pruefeTeamNameInListe({ zeile: jcEssenM[0], verein: 'JC Essen', erwarteterTeamName: 'U15 männlich' });
        await pruefeTeamNameInListe({ zeile: jcEssenW[0], verein: 'JC Essen', erwarteterTeamName: 'U15 weiblich' });
        await pruefeTeamNameInListe({ zeile: fcMgM[0], verein: '1. FC Mönchengladbach', erwarteterTeamName: 'U15 männlich' });
        await pruefeTeamNameInListe({ zeile: fcMgW[0], verein: '1. FC Mönchengladbach', erwarteterTeamName: 'U15 weiblich' });
        await pruefeTeamNameInListe({ zeile: tsEinfeldM[0], verein: 'TS Einfeld', erwarteterTeamName: 'U15 männlich' });
        await pruefeTeamNameInListe({ zeile: tsEinfeldW[0], verein: 'TS Einfeld', erwarteterTeamName: 'U15 weiblich' });
        await pruefeTeamNameInListe({ zeile: ftnM[0], verein: 'FTN', erwarteterTeamName: 'U15 männlich' });
        await pruefeTeamNameInListe({ zeile: ftnW[0], verein: 'FTN', erwarteterTeamName: 'U15 weiblich' });
    });

    test('Person-Icon blendet Einzelwettkampf-Badge neben dem Team-Namen ein/aus', async () => {
        // blendet das Einzelwettkampf-Badge in der Klasse-Spalte ein bzw. aus (siehe
        // data-toggle="auch_einzelwettkampf" und renderKlasseBadges in teilnehmer.js). Direkt nach
        // dem Import ist auch_einzelwettkampf false (Default der Migration
        // add_auch_einzelwettkampf_zu_teilnehmer) -> Mannschaftsmitglieder zeigen zunächst NUR das
        // Team-Badge; das eigentliche Einzelwettkampf-Badge (".klasse-badge" ohne die Klasse
        // "team") erscheint erst nach dem Umschalten.
        const [testVorname, testNachname] = jcEssenM[0];
        const testZeile = findeZeile(testVorname, testNachname, 'JC Essen');
        await expect(testZeile).toHaveCount(1);

        const klasseZelle = testZeile.locator('td').nth(6);
        const teamBadge = klasseZelle.locator('.klasse-badge.team');
        const einzelBadge = klasseZelle.locator('.klasse-badge:not(.team)');
        const personIcon = testZeile.locator('[data-toggle="auch_einzelwettkampf"]');

        // Vorher: nur das Mannschafts-Badge, kein Einzelwettkampf-Badge, Icon nicht aktiv.
        await expect(teamBadge).toHaveCount(1);
        await expect(einzelBadge).toHaveCount(0);
        await expect(personIcon).not.toHaveClass(/active/);
        await expect(personIcon).toHaveAttribute('title', /Nimmt nur an der Mannschaft teil/);

        // Klick blendet das Einzelwettkampf-Badge zusätzlich ein.
        await personIcon.click();
        await expect(personIcon).toHaveClass(/active/);
        await expect(personIcon).toHaveAttribute('title', /Nimmt zusätzlich am Einzelwettkampf teil/);
        await expect(einzelBadge).toHaveCount(1);
        await expect(teamBadge).toHaveCount(1); // Team-Badge bleibt zusätzlich sichtbar

        // Erneuter Klick blendet es wieder aus.
        await personIcon.click();
        await expect(personIcon).not.toHaveClass(/active/);
        await expect(personIcon).toHaveAttribute('title', /Nimmt nur an der Mannschaft teil/);
        await expect(einzelBadge).toHaveCount(0);
        await expect(teamBadge).toHaveCount(1);
    });

    test('Schnell-Toggle-Icons "gewogen"/"lizenz"/"bezahlt" schalten in beide Richtungen um', async () => {
        // Jedes Icon sendet per Klick ein PUT /api/teilnehmer/:id/status mit dem jeweils
        // umgekehrten Feld (siehe .icon-toggle-Handler in teilnehmer.js) und muss sowohl die aktive
        // Klasse (grün) als auch den Tooltip-Text entsprechend umschalten. Verwendet einen bisher
        // unberührten Teilnehmer (PSV Münster, erster U11-männlich-Import), damit die
        // Ausgangswerte garantiert noch den Import-Defaults entsprechen (gewogen=false, Lizenz
        // nicht bestätigt, unbezahlt).
        const [toggleVorname, toggleNachname] = psvEinzel[0];
        const toggleZeile = findeZeile(toggleVorname, toggleNachname, 'PSV Münster');
        await expect(toggleZeile).toHaveCount(1);

        const gewogenIcon = toggleZeile.locator('[data-toggle="gewogen"]');
        const lizenzIcon = toggleZeile.locator('[data-toggle="lizenz"]');
        const bezahltIcon = toggleZeile.locator('[data-toggle="bezahlt"]');

        // Vorher: alle drei aus dem Import unverändert -> keines der Icons aktiv.
        await expect(gewogenIcon).not.toHaveClass(/active/);
        await expect(gewogenIcon).toHaveAttribute('title', 'Als gewogen markieren');
        await expect(lizenzIcon).not.toHaveClass(/active/);
        await expect(lizenzIcon).toHaveAttribute('title', 'Lizenz bestätigen');
        await expect(bezahltIcon).not.toHaveClass(/active/);
        await expect(bezahltIcon).toHaveAttribute('title', 'Als bezahlt markieren');

        // Klick auf "Gewogen"
        await gewogenIcon.click();
        await expect(gewogenIcon).toHaveClass(/active/);
        await expect(gewogenIcon).toHaveAttribute('title', 'Als nicht gewogen markieren');

        // Klick auf "Lizenz"
        await lizenzIcon.click();
        await expect(lizenzIcon).toHaveClass(/active/);
        await expect(lizenzIcon).toHaveAttribute('title', 'Lizenz-Bestätigung zurücknehmen');

        // Klick auf "Bezahlt"
        await bezahltIcon.click();
        await expect(bezahltIcon).toHaveClass(/active/);
        await expect(bezahltIcon).toHaveAttribute('title', 'Als unbezahlt markieren');

        // Erneute Klicks nehmen alle drei wieder zurück.
        await gewogenIcon.click();
        await expect(gewogenIcon).not.toHaveClass(/active/);
        await expect(gewogenIcon).toHaveAttribute('title', 'Als gewogen markieren');

        await lizenzIcon.click();
        await expect(lizenzIcon).not.toHaveClass(/active/);
        await expect(lizenzIcon).toHaveAttribute('title', 'Lizenz bestätigen');

        await bezahltIcon.click();
        await expect(bezahltIcon).not.toHaveClass(/active/);
        await expect(bezahltIcon).toHaveAttribute('title', 'Als bezahlt markieren');
    });

    test('Teilnehmer im Editier-Modal bearbeiten (Gewicht, Lizenz, Startgeld, Judopass-Nr.)', async () => {
        // Gewicht +1kg, Lizenz erst in die Vergangenheit (rot/abgelaufen) dann in die Zukunft
        // (grün/gültig) setzen, Startgeld als bezahlt markieren, die beim Import leer gebliebene
        // Judopass-Nr. nachtragen und speichern.
        const [editVorname, editNachname] = arminiaEinzel[0]; // Einzel-U11-Import, Gewicht 25kg, keine Passnr.
        const editZeile = findeZeile(editVorname, editNachname, 'Arminia Appelhülsen');
        await expect(editZeile).toHaveCount(1);

        await editZeile.locator('.icon-edit').click();
        const waageModal = page.locator('#waageModal');
        await expect(waageModal).toBeVisible();
        await expect(page.locator('#waageModalTitle')).toHaveText('Teilnehmer bearbeiten');

        const gewichtFeld = page.locator('#gewicht');
        const lizenzFeld = page.locator('#lizenz_ablauf');
        const judopassFeld = page.locator('#judopass_id');
        const startgeldCheckbox = page.locator('#startgeld_bezahlt');
        const speichernBtn = page.locator('#submitBtn');
        const altersklasseFeld = page.locator('#altersklasse');
        const gewichtsklasseFeld = page.locator('#gewichtsklasse');

        // Aus dem Import vorbelegt: Gewicht 25kg, keine Judopass-Nr., Lizenz technisch abgelaufen
        // (1970-01-01, siehe importTeilnehmer) -> aktualisiereSpeicherButtonStatus() in
        // waage-modal.js hält den (immer sichtbaren) Speichern-Button deshalb zunächst deaktiviert
        // (fehlende Passnr. UND ungültige Lizenz).
        await expect(gewichtFeld).toHaveValue('25');
        await expect(judopassFeld).toHaveValue('');
        await expect(speichernBtn).toBeVisible();
        await expect(speichernBtn).toBeDisabled();

        // Alters- und Gewichtsklasse müssen bereits aus dem Import korrekt vorbelegt sein: U11
        // männlich, 25kg fällt nach den DJB-Gewichtsklassen (siehe altersklassen.json, "-23","-25",
        // "-27",...) in "-25" (kleinste Klasse, die 25kg noch aufnimmt).
        await expect(altersklasseFeld).toHaveValue('U11');
        await expect(gewichtsklasseFeld).toHaveValue('-25');

        // Gewicht um 1kg erhöhen -> befehleGewichtsklassenDropdown() in waage-modal.js wählt die
        // Gewichtsklasse automatisch neu: 26kg passt nicht mehr in "-25", die nächstgrößere Klasse
        // ist "-27". Die Altersklasse bleibt unverändert (U11).
        await gewichtFeld.fill('26');
        await expect(gewichtsklasseFeld).toHaveValue('-27');
        await expect(altersklasseFeld).toHaveValue('U11');

        // Lizenz auf ein Datum in der Vergangenheit setzen -> muss rot (abgelaufen) markiert werden.
        await lizenzFeld.fill('2020-01-01');
        await expect(lizenzFeld).toHaveClass(/lizenz-expired/);
        await expect(lizenzFeld).not.toHaveClass(/lizenz-valid/);
        await expect(speichernBtn).toBeDisabled();

        // Lizenz auf ein Datum in der Zukunft setzen -> muss grün (gültig) markiert werden.
        await lizenzFeld.fill('2030-12-31');
        await expect(lizenzFeld).toHaveClass(/lizenz-valid/);
        await expect(lizenzFeld).not.toHaveClass(/lizenz-expired/);

        // Startgeld als bezahlt markieren.
        await startgeldCheckbox.check();

        // Fehlende Judopass-Nr. (Lizenz-Nr.) nachtragen -> jetzt sind alle Pflichtfelder gefüllt UND
        // die Lizenz gültig, der Speichern-Button wird erst jetzt aktiv.
        await judopassFeld.fill('JP-ARM-0001');
        await expect(speichernBtn).toBeEnabled();

        await speichernBtn.click();
        // Gewicht wurde geändert (25->26) und offline_user gilt als ausrichtender Verein ->
        // "Als gewogen markieren?"-Rückfrage (siehe waage-modal.js) muss bestätigt werden, bevor
        // die eigentliche Speicherung überhaupt losläuft.
        await expect(page.locator('#customConfirmModal')).toBeVisible();
        await page.locator('#modalConfirmBtn').click();
        await expect(page.locator('#snackbarText')).toHaveText(`Athlet ${editVorname} erfolgreich aktualisiert!`);
        await expect(waageModal).toBeHidden();

        // --- IN DER LISTE PRÜFEN: Gewicht angepasst, Startgeld bezahlt, Lizenz jetzt bestätigt/grün ---
        const geaenderteZeile = findeZeile(editVorname, editNachname, 'Arminia Appelhülsen');
        await expect(geaenderteZeile).toHaveCount(1);
        await expect(geaenderteZeile.locator('td').nth(7)).toContainText('26,00 kg');
        await expect(geaenderteZeile.locator('[data-toggle="bezahlt"]')).toHaveClass(/active/);
        await expect(geaenderteZeile.locator('[data-toggle="lizenz"]')).toHaveClass(/active/);
    });

    test('QR-Scan: bekannter Teilnehmer lädt bestehenden Datensatz', async () => {
        // Treffer über die Judopass-Nr. (siehe verarbeiteGescannteDaten -> Suche über
        // scanJudopassId in waage-modal.js). Der zuvor im Editier-Test bearbeitete
        // Arminia-Teilnehmer hat inzwischen die Passnr. "JP-ARM-0001" -> beim Scan muss
        // automatisch GENAU dieser bereits vorhandene Datensatz (inkl. seines echten,
        // gespeicherten Gewichts 26kg) geladen werden, nicht ein leeres/neues Formular.
        const [editVorname, editNachname] = arminiaEinzel[0];

        await stelleQrScanBereit(page, {
            vorname: editVorname,
            nachname: editNachname,
            judopass_id: 'JP-ARM-0001',
            lizenz_ablauf: '2032-05-01'
        });
        await page.locator('#scanBtn').click();
        const waageModal = page.locator('#waageModal');
        await expect(waageModal).toBeVisible();

        await expect(page.locator('#vorname')).toHaveValue(editVorname);
        await expect(page.locator('#nachname')).toHaveValue(editNachname);
        await expect(page.locator('#verein')).toHaveValue('Arminia Appelhülsen');
        await expect(page.locator('#judopass_id')).toHaveValue('JP-ARM-0001');
        await expect(page.locator('#gewicht')).toHaveValue('26'); // stammt aus dem bestehenden Datensatz, nicht aus dem QR-Code
        await expect(page.locator('#lizenz_ablauf')).toHaveValue('2032-05-01'); // aus dem QR-Code übernommener, gültiger Lizenzablauf
        await expect(page.locator('#lizenz_ablauf')).toHaveClass(/lizenz-valid/);

        await page.locator('#waageModalClose').click();
        await expect(waageModal).toBeHidden();
    });

    test('QR-Scan: unbekannter Teilnehmer legt neuen Datensatz an', async () => {
        // Geschlecht und Gewicht liefert der QR-Code bewusst NICHT (ein Judopass enthält kein
        // Wiege-Ergebnis) -> beide werden hier manuell nachgetragen und müssen automatisch die
        // korrekte Alters-/Gewichtsklasse auswählen (siehe
        // bestimmeUndWaehleAltersklasse/befehleGewichtsklassenDropdown).
        const neuVorname = 'Helene';
        const neuNachname = 'Neuling';
        const neuVerein = 'Neuer Verein Grün-Weiß';
        await stelleQrScanBereit(page, {
            vorname: neuVorname,
            nachname: neuNachname,
            judopass_id: 'JP-NEU-9001',
            geburtsdatum: `${GEBURTSJAHR_U11}-06-15`, // Alter passend zu U11 (siehe WETTKAMPFJAHR oben)
            verein: neuVerein,
            lizenz_ablauf: '2032-05-01'
        });
        await page.locator('#scanBtn').click();
        const waageModal = page.locator('#waageModal');
        await expect(waageModal).toBeVisible();

        const judopassFeld = page.locator('#judopass_id');
        const lizenzFeld = page.locator('#lizenz_ablauf');
        const altersklasseFeld = page.locator('#altersklasse');
        const gewichtsklasseFeld = page.locator('#gewichtsklasse');
        const gewichtFeld = page.locator('#gewicht');
        const speichernBtn = page.locator('#submitBtn');

        await expect(page.locator('#vorname')).toHaveValue(neuVorname);
        await expect(page.locator('#nachname')).toHaveValue(neuNachname);
        await expect(page.locator('#verein')).toHaveValue(neuVerein);
        await expect(judopassFeld).toHaveValue('JP-NEU-9001');
        await expect(lizenzFeld).toHaveClass(/lizenz-valid/);
        await expect(altersklasseFeld).toHaveValue(''); // Geschlecht noch nicht gesetzt -> noch keine Auto-Auswahl
        await expect(speichernBtn).toBeDisabled(); // Geschlecht/Gewicht fehlen noch

        // Geschlecht manuell wählen -> Altersklasse wird automatisch anhand des gescannten Geburtsdatums ermittelt.
        await page.locator('#geschlecht').selectOption('weiblich');
        await expect(altersklasseFeld).toHaveValue('U11');

        // Gewicht manuell eintragen -> Gewichtsklasse wird automatisch anhand von
        // Altersklasse+Geschlecht (DJB-Liste weiblich U11: "-22","-24","-26","-28","-30",... siehe
        // altersklassen.json) ermittelt.
        await gewichtFeld.fill('30');
        await expect(gewichtsklasseFeld).toHaveValue('-30');
        await expect(speichernBtn).toBeEnabled();

        await speichernBtn.click();
        await expect(page.locator('#snackbarText')).toHaveText(`Athlet ${neuVorname} erfolgreich eingewogen!`);

        await page.locator('#waageModalClose').click();
        await expect(waageModal).toBeHidden();

        // --- IN DER LISTE PRÜFEN: der neu angelegte Teilnehmer erscheint mit korrekter Klasse/Gewicht ---
        const neueZeile = findeZeile(neuVorname, neuNachname, neuVerein);
        await expect(neueZeile).toHaveCount(1);
        await expect(neueZeile.locator('td').nth(6)).toContainText('U11w');
        await expect(neueZeile.locator('td').nth(7)).toContainText('30,00 kg');
    });

    test('Sammel-Aktionen "gewogen"/"lizenz"/"bezahlt" setzen Status auf "kampfbereit"', async () => {
        test.setTimeout(60_000);

        // Jeweils per Kopf-Checkbox ALLE Teilnehmer auswählen, aber genau einen (unberührten)
        // davon wieder abwählen, bevor die jeweilige Sammel-Aktion ausgeführt wird. Da
        // "kampfbereit" laut aendereStatusFelder in teilnehmerController.js
        // Gewicht+Gewogen+Lizenz+Bezahlt zusammen voraussetzt, bleiben am Ende genau die drei
        // ausgenommenen Teilnehmer im Status "Angemeldet" — allen anderen fehlt danach kein
        // Kriterium mehr, sie wechseln serverseitig automatisch auf "bereit" (dieselbe Logik, die
        // auch die einzelnen Icon-Klicks im Toggle-Test oben ausgelöst hat).
        const gesamtVorBulk = erwarteteGesamtzahl + 1; // +1: der per QR-Scan neu angelegte Teilnehmer "Helene Neuling"
        const anzahlProSammelAktion = gesamtVorBulk - 1; // alle außer der jeweils einen Ausnahme

        // Drei unterschiedliche, bislang unberührte Teilnehmer aus drei verschiedenen Vereinen als
        // Ausnahme je Kriterium, damit sich die drei Aktionen nicht gegenseitig beeinflussen.
        const ausgenommenGewogen = [tsEinfeldEinzel[5][0], tsEinfeldEinzel[5][1], 'TS Einfeld'];
        const ausgenommenLizenz = [ftnEinzel[5][0], ftnEinzel[5][1], 'FTN'];
        const ausgenommenBezahlt = [arminiaEinzel[5][0], arminiaEinzel[5][1], 'Arminia Appelhülsen'];

        await markiereAlleAusserEinem(
            page.locator('#bulkMarkWeighedBtn'), ausgenommenGewogen,
            `${anzahlProSammelAktion} Teilnehmer erfolgreich als gewogen markiert.`
        );
        await markiereAlleAusserEinem(
            page.locator('#bulkMarkLizenzBtn'), ausgenommenLizenz,
            `Lizenz für ${anzahlProSammelAktion} Teilnehmer erfolgreich bestätigt.`
        );
        await markiereAlleAusserEinem(
            page.locator('#bulkMarkPaidBtn'), ausgenommenBezahlt,
            `${anzahlProSammelAktion} Teilnehmer erfolgreich aktualisiert.`
        );

        // --- DIE DREI AUSNAHMEN MÜSSEN "ANGEMELDET" GEBLIEBEN SEIN ---
        for (const [vorname, nachname, verein] of [ausgenommenGewogen, ausgenommenLizenz, ausgenommenBezahlt]) {
            await expect(findeZeile(vorname, nachname, verein).locator('[data-status-select]')).toHaveValue('angemeldet');
        }

        // --- ALLE ANDEREN MÜSSEN AUF "BEREIT" (kampfbereit) GEWECHSELT SEIN ---
        const statusWerteNachBulk = await page.locator('[data-status-select]').evaluateAll(nodes => nodes.map(n => n.value));
        expect(statusWerteNachBulk.filter(s => s === 'angemeldet')).toHaveLength(3);
        expect(statusWerteNachBulk.filter(s => s === 'kampfbereit')).toHaveLength(gesamtVorBulk - 3);
    });

    test('Menüpunkte "Pools" und "Mannschaften" werden freigeschaltet', async () => {
        // "Pools" ist gesperrt, bis mindestens 2 Teilnehmer kampfbereit sind (siehe
        // pruefePoolsMenuSperre in menu.js) — das ist nach den Sammel-Aktionen weit übererfüllt.
        // "Mannschaften" ist für den Gastgeber-Verein nie an diese Bedingung gekoppelt, muss aber
        // ebenfalls sichtbar sein.
        const navPools = page.locator('#nav-pools');
        const navMannschaften = page.locator('#nav-mannschaften');
        await expect(navPools).toBeVisible();
        await expect(navPools).not.toHaveClass(/disabled/);
        await expect(navMannschaften).toBeVisible();
        await expect(navMannschaften).not.toHaveClass(/disabled/);
    });
});
