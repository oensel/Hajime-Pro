// End-to-End: Teilnehmer über teilnehmer.html aus mehreren unterschiedlichen Dateien (CSV UND
// XLSX) in ein Turnier importieren, das AUSSCHLIESSLICH Mannschafts-Altersklassen (U15 männlich +
// U15 weiblich) austrägt und gar keine Einzelwettkampf-Altersklassen anbietet — Gegenstück zu
// teilnehmer-import-einzel.spec.js (reines Einzel) und teilnehmer-import-einzel-team.spec.js
// (Einzel + Mannschaft gemischt). Prüft insbesondere, dass der Import-Ziel-Dialog (siehe
// ermittleImportZiel in teilnehmer.js) hier komplett entfällt, weil das Ziel durch die fehlenden
// Einzel-Altersklassen bereits eindeutig feststeht, und dass die üblichen Verwaltungs-Workflows
// (Badges, Icon-Toggles, Editier-Modal, QR-Scan, Sammel-Aktionen, Menü-Freischaltung) auch für ein
// reines Mannschaftsturnier funktionieren.
//
// Die einzelnen Themen laufen als eigene, kleine test()-Blöcke statt als ein einziger Riesentest
// (bessere Fehlerlokalisierung, lesbarere Testberichte). Sie sind aber inhaltlich eine
// zusammenhängende Kette (spätere Tests bauen auf den in früheren Tests importierten/bearbeiteten
// Daten auf) und teilen sich deshalb bewusst EINE Page/Session über test.describe.serial +
// beforeAll statt jeweils eigenes Turnier + eigene Datei-Imports zu wiederholen — das würde die
// Laufzeit vervielfachen, ohne zusätzliche Abdeckung zu bringen (siehe playwright.config.js:
// die Suite läuft ohnehin mit einem Worker gegen eine gemeinsame Test-Datenbank).
import { test, expect } from '@playwright/test';
import * as XLSX from 'xlsx';

const TURNIER_NAME = `E2E-Import-Mannschaft-Turnier ${Date.now()}`;

// Muss zum weiter unten gesetzten Turnier-Datum passen (ermittleAltersklasse in
// teilnehmerController.js leitet das Wettkampfjahr aus turnier.datum ab).
const WETTKAMPFJAHR = 2027;
const GEBURTSJAHR_U15 = WETTKAMPFJAHR - 13; // Alter 13 -> Standardklasse U15 (Alter 13-14)

// --- Kleine, deterministische Namens-Generatoren für abwechslungsreiche Testdaten ---
const VORNAMEN_M = ['Kilian', 'Matteo', 'Jannik', 'Levi', 'Emil', 'Theo', 'Bruno', 'Milo', 'Anton', 'Aaron', 'Moritz', 'Vincent', 'Linus', 'Oskar', 'Henri'];
const VORNAMEN_W = ['Johanna', 'Charlotte', 'Amelie', 'Lilly', 'Pauline', 'Josephine', 'Helena', 'Antonia', 'Victoria', 'Luisa', 'Romy', 'Mathilda', 'Emilia', 'Wilma', 'Rosalie'];
const NACHNAMEN = ['Lehmann', 'Huber', 'Kaiser', 'Fuchs', 'Vogel', 'Keller', 'Günther', 'Frank', 'Berger', 'Winter', 'Sommer', 'Herrmann', 'Albrecht', 'Franke', 'Peters'];

function generiereName(index, geschlecht) {
    const vornamen = geschlecht === 'weiblich' ? VORNAMEN_W : VORNAMEN_M;
    return {
        vorname: vornamen[index % vornamen.length],
        nachname: NACHNAMEN[index % NACHNAMEN.length]
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

// Mitglieder-Zeilen einer Mannschaft, jeweils mit Team-Name.
// ohneTeamNameBeiIndex: 0-basierter Index, dessen Zeile absichtlich OHNE Team-Name gebaut wird, um
// die Pflichtfeld-Regel "Bei Mannschaften ist der Team-Name ein Pflichtfeld" zu prüfen.
function baueMannschaftsZeilen(verein, teamName, geschlecht, anzahl, gewichte, ohneTeamNameBeiIndex = -1) {
    const zeilen = [];
    for (let i = 0; i < anzahl; i++) {
        const { vorname, nachname } = generiereName(i, geschlecht);
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

// Klickt auf "Importieren" und fängt den dadurch ausgelösten nativen Datei-Dialog
// (importFileInput.click()) über das Playwright-"filechooser"-Event ab, um die Datei direkt aus
// dem Speicher statt von der Festplatte zu liefern. Anders als in teilnehmer-import-einzel-
// team.spec.js gibt es hier KEIN Import-Ziel-Modal abzuwarten: unser Turnier trägt ausschließlich
// Mannschafts-Altersklassen aus, also liefert ermittleImportZiel() in teilnehmer.js das Ziel
// "mannschaft" sofort ohne Rückfrage (siehe dortige Bedingung
// "turnierHatMannschaftKlassen && !turnierHatEinzelKlassen"). Der Listener MUSS trotzdem vor dem
// Klick registriert werden (nicht erst danach) — der Klick-Handler löst importFileInput.click()
// bereits asynchron aus, sodass ein erst danach registrierter Listener das Event regelmäßig
// verpasst und waitForEvent('filechooser') bis zum Timeout hängen bleibt.
async function liefereDatei(page, datei) {
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.locator('#importBtn').click();
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

test.describe.serial('Teilnehmer-Import und -Verwaltung, reines Mannschaftsturnier (teilnehmer.html)', () => {
    // Von beforeAll gesetzt, über alle Tests dieser Datei hinweg dieselbe Page/Session (siehe
    // Kommentar oben zur Begründung). Die restlichen Variablen werden vom Import-Test befüllt und
    // von den nachfolgenden Themen-Tests gelesen.
    let page;
    let turnierId;
    let psvMannschaft;
    let jcEssenM, jcEssenW, jcEssen;
    let fcMgM, fcMgW, fcMg;
    let tsEinfeldM, tsEinfeldW, tsEinfeldMannschaft;
    let ftnM, ftnW, ftnMannschaft;
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

    // Führt einen kompletten Import-Durchlauf aus (Datei liefern -> Vorschau prüfen -> starten ->
    // auf die Status-Meldung warten). Die erwarteten Zahlen/Texte spiegeln exakt die
    // Meldungslogik aus importTeilnehmer()/previewTeilnehmerImport() in teilnehmerController.js,
    // damit ein Abweichen dort den Test tatsächlich bricht.
    async function importiereUndPruefe(datei, { erwarteGueltig, erwarteFehlerhaft = 0, erwarteMannschaften, erwarteSkipHinweis = null }) {
        await liefereDatei(page, datei);

        const importVorschauModal = page.locator('#importVorschauModal');
        const importVorschauSummary = page.locator('#importVorschauSummary');
        await expect(importVorschauModal).toBeVisible();
        await expect(importVorschauSummary).toContainText(`Es wurden ${erwarteGueltig} gültige und ${erwarteFehlerhaft} fehlerhafte Zeile(n) gefunden`);

        await page.locator('#importVorschauStartenBtn').click();
        await expect(importVorschauModal).toBeHidden();

        const gesamt = erwarteGueltig + erwarteFehlerhaft;
        let erwarteterText = `${erwarteGueltig} von ${gesamt} Teilnehmern importiert.`;
        if (erwarteFehlerhaft > 0) erwarteterText += ` ${erwarteFehlerhaft} übersprungen.`;
        erwarteterText += ` ${erwarteMannschaften} Mannschaft(en) angelegt/aktualisiert.`;
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

    test('Turnier mit ausschließlich Mannschafts-Altersklassen (U15 männlich/weiblich) anlegen', async () => {
        await page.goto('/turnier.html');
        await page.locator('#bezeichnung').fill(TURNIER_NAME);
        await page.locator('#datum').fill(`${WETTKAMPFJAHR}-09-18`);
        await page.locator('#ort').fill('Senden');
        await page.locator('#plz').fill('48308');
        await page.locator('#ausrichter').fill('JC Senden');
        await page.locator('#anzahl_kampfflaechen').fill('4');
        await page.locator('#bundesland').selectOption('Nordrhein-Westfalen');

        // Bewusst KEINE Einzelwettkampf-Altersklasse ankreuzen — dieses Turnier trägt
        // ausschließlich Mannschaftskämpfe aus.
        await page.locator('input[name="mannschaft_altersklasse_cb"][value="männlich_U15"]').check();
        await page.locator('input[name="mannschaft_altersklasse_cb"][value="weiblich_U15"]').check();

        await page.locator('#submitBtn').click();
        await expect(page.locator('#snackbarText')).toHaveText('Turnier erfolgreich angelegt!');
        await expect(page).toHaveURL(/\/turnier\.html\?id=\d+/);

        turnierId = new URL(page.url()).searchParams.get('id');

        await page.goto(`/teilnehmer.html?id=${turnierId}`);
        await expect(page.locator('#importBtn')).toBeVisible();
    });

    test('Mehrere CSV-/XLSX-Dateien importieren (Mannschaft) inkl. Pflichtfeld-Validierung (Team-Name)', async () => {
        // Fünf Datei-Uploads mit jeweils eigenem Vorschau-/Start-Roundtrip brauchen mehr als das
        // Playwright-Standard-Timeout von 30s.
        test.setTimeout(120_000);

        // --- PSV Münster: U15 männlich, 12 Mitglieder + 1 Zeile OHNE Team-Name (CSV) ---
        // Prüft gezielt die Pflichtfeld-Regel "Bei Mannschaften ist der Team-Name ein Pflichtfeld":
        // die Zeile ohne Team-Name muss als fehlerhaft erkannt und beim Import übersprungen werden.
        psvMannschaft = baueMannschaftsZeilen('PSV Münster', 'U15 männlich', 'männlich', 13, [40, 48, 58, 65], 4);
        await importiereUndPruefe(csvDatei('psv-mannschaft.csv', psvMannschaft), {
            erwarteGueltig: 12, erwarteFehlerhaft: 1, erwarteMannschaften: 1, erwarteSkipHinweis: 'Team-Name'
        });

        // --- JC Essen: U15 männlich + U15 weiblich (XLSX) ---
        jcEssenM = baueMannschaftsZeilen('JC Essen', 'U15 männlich', 'männlich', 12, [40, 48, 58, 65]);
        jcEssenW = baueMannschaftsZeilen('JC Essen', 'U15 weiblich', 'weiblich', 12, [38, 46, 55, 60]);
        jcEssen = [...jcEssenM, ...jcEssenW];
        await importiereUndPruefe(xlsxDatei('jc-essen.xlsx', jcEssen), { erwarteGueltig: jcEssen.length, erwarteMannschaften: 2 });

        // --- 1. FC Mönchengladbach: U15 männlich + U15 weiblich (CSV) ---
        fcMgM = baueMannschaftsZeilen('1. FC Mönchengladbach', 'U15 männlich', 'männlich', 12, [40, 48, 58, 65]);
        fcMgW = baueMannschaftsZeilen('1. FC Mönchengladbach', 'U15 weiblich', 'weiblich', 12, [38, 46, 55, 60]);
        fcMg = [...fcMgM, ...fcMgW];
        await importiereUndPruefe(csvDatei('fc-mg.csv', fcMg), { erwarteGueltig: fcMg.length, erwarteMannschaften: 2 });

        // --- TS Einfeld: U15 männlich + U15 weiblich (XLSX) ---
        tsEinfeldM = baueMannschaftsZeilen('TS Einfeld', 'U15 männlich', 'männlich', 12, [40, 48, 58, 65]);
        tsEinfeldW = baueMannschaftsZeilen('TS Einfeld', 'U15 weiblich', 'weiblich', 12, [38, 46, 55, 60]);
        tsEinfeldMannschaft = [...tsEinfeldM, ...tsEinfeldW];
        await importiereUndPruefe(xlsxDatei('ts-einfeld-mannschaft.xlsx', tsEinfeldMannschaft), { erwarteGueltig: tsEinfeldMannschaft.length, erwarteMannschaften: 2 });

        // --- FTN: U15 männlich + U15 weiblich (CSV) ---
        ftnM = baueMannschaftsZeilen('FTN', 'U15 männlich', 'männlich', 12, [40, 48, 58, 65]);
        ftnW = baueMannschaftsZeilen('FTN', 'U15 weiblich', 'weiblich', 12, [38, 46, 55, 60]);
        ftnMannschaft = [...ftnM, ...ftnW];
        await importiereUndPruefe(csvDatei('ftn-mannschaft.csv', ftnMannschaft), { erwarteGueltig: ftnMannschaft.length, erwarteMannschaften: 2 });

        // --- GESAMTZAHL PRÜFEN: Summe aller tatsächlich importierten (nicht der hochgeladenen) Zeilen ---
        erwarteteGesamtzahl =
            12 /* PSV-Mannschaft ohne die übersprungene Zeile */
            + jcEssen.length
            + fcMg.length
            + tsEinfeldMannschaft.length
            + ftnMannschaft.length;

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

    test('Neuen Teilnehmer manuell anlegen und einer bestehenden Mannschaft zuordnen', async () => {
        // Das Team-Name-Feld im Anlegen/Bearbeiten-Popup (siehe teamNameRow in teilnehmer.html)
        // ist nur bei Turnieren mit Mannschafts-Altersklassen sichtbar — dieses Turnier trägt
        // welche aus, das Feld muss also erscheinen.
        await page.locator('#addBtn').click();
        const waageModal = page.locator('#waageModal');
        await expect(waageModal).toBeVisible();
        await expect(page.locator('#waageModalTitle')).toHaveText('Teilnehmer hinzufügen');

        const teamNameRow = page.locator('#teamNameRow');
        const teamNameFeld = page.locator('#mannschaft_name');
        await expect(teamNameRow).toBeVisible();
        await expect(teamNameFeld).toHaveValue(''); // frisches Formular -> noch keine Zuordnung

        const neuVorname = 'Paula';
        const neuNachname = 'Nachmelderin';
        const altersklasseFeld = page.locator('#altersklasse');
        const speichernBtn = page.locator('#submitBtn');

        await page.locator('#vorname').fill(neuVorname);
        await page.locator('#nachname').fill(neuNachname);
        await page.locator('#judopass_id').fill('JP-NACH-0001');
        await page.locator('#verein').fill('JC Essen');
        await page.locator('#geburtsjahr').fill(String(GEBURTSJAHR_U15));
        await page.locator('#lizenz_ablauf').fill('2030-12-31');

        // Geschlecht wählen -> Altersklasse wird automatisch anhand des Geburtsjahres ermittelt.
        await page.locator('#geschlecht').selectOption('weiblich');
        await expect(altersklasseFeld).toHaveValue('U15');

        await page.locator('#gewicht').fill('45');
        await expect(speichernBtn).toBeEnabled(); // Team-Name ist optional, Speichern hängt nicht daran

        // Bestehenden Team-Namen von JC Essen erneut verwenden (siehe jcEssenW oben) statt eine
        // zweite, doppelte Mannschaft "U15 weiblich" für denselben Verein anzulegen.
        await teamNameFeld.fill('U15 weiblich');

        await speichernBtn.click();
        // Gewicht wurde manuell eingetragen (nicht via QR-Scan) und offline_user gilt als
        // ausrichtender Verein -> "Als gewogen markieren?"-Rückfrage (siehe waage-modal.js) muss
        // bestätigt werden, bevor die eigentliche Speicherung überhaupt losläuft.
        await expect(page.locator('#customConfirmModal')).toBeVisible();
        await page.locator('#modalConfirmBtn').click();
        await expect(page.locator('#snackbarText')).toHaveText(`Athlet ${neuVorname} erfolgreich eingewogen!`);
        await page.locator('#waageModalClose').click();
        await expect(waageModal).toBeHidden();

        // --- IN DER LISTE PRÜFEN: neuer Teilnehmer erscheint mit dem zugeordneten Team-Namen ---
        const neueZeile = findeZeile(neuVorname, neuNachname, 'JC Essen');
        await expect(neueZeile).toHaveCount(1);
        await expect(neueZeile.locator('td').nth(5)).toContainText('U15 weiblich');

        // --- KEINE DOPPELTE MANNSCHAFT: genau eine "U15 weiblich" bei JC Essen, jetzt mit 13
        // statt 12 Mitgliedern (12 aus dem Import + Paula) ---
        const mannschaftenResp = await page.request.get(`/api/mannschaften?turnierId=${turnierId}`);
        const mannschaften = await mannschaftenResp.json();
        const jcEssenWTeams = mannschaften.filter(m => m.verein === 'JC Essen' && m.bezeichnung === 'U15 weiblich');
        expect(jcEssenWTeams).toHaveLength(1);
        expect(jcEssenWTeams[0].mitglieder).toHaveLength(13);
    });

    test('Person-Icon blendet Einzelwettkampf-Badge neben dem Team-Namen ein/aus', async () => {
        // blendet das Einzelwettkampf-Badge in der Klasse-Spalte ein bzw. aus (siehe
        // data-toggle="auch_einzelwettkampf" und renderKlasseBadges in teilnehmer.js). Direkt nach
        // dem Import ist auch_einzelwettkampf false (Default der Migration
        // add_auch_einzelwettkampf_zu_teilnehmer) -> Mannschaftsmitglieder zeigen zunächst NUR das
        // Team-Badge; das eigentliche Einzelwettkampf-Badge (".klasse-badge" ohne die Klasse
        // "team") erscheint erst nach dem Umschalten — unabhängig davon, dass dieses Turnier gar
        // keine Einzelwettkampf-Altersklassen austrägt (der Toggle selbst ist ein reines
        // Teilnehmer-Flag, siehe teilnehmerController.js).
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
        // unberührten Teilnehmer (1. FC Mönchengladbach, erstes U15-weiblich-Mitglied), damit die
        // Ausgangswerte garantiert noch den Import-Defaults entsprechen (gewogen=false, Lizenz
        // nicht bestätigt, unbezahlt).
        const [toggleVorname, toggleNachname] = fcMgW[0];
        const toggleZeile = findeZeile(toggleVorname, toggleNachname, '1. FC Mönchengladbach');
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
        // Judopass-Nr. nachtragen und speichern. Verwendet einen bisher unberührten Teilnehmer
        // (FTN, erstes U15-männlich-Mitglied, importiertes Gewicht 40kg, keine Passnr.).
        const [editVorname, editNachname] = ftnM[0];
        const editZeile = findeZeile(editVorname, editNachname, 'FTN');
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

        // Aus dem Import vorbelegt: Gewicht 40kg, keine Judopass-Nr., Lizenz technisch abgelaufen
        // (1970-01-01, siehe importTeilnehmer) -> aktualisiereSpeicherButtonStatus() in
        // waage-modal.js hält den (immer sichtbaren) Speichern-Button deshalb zunächst deaktiviert
        // (fehlende Passnr. UND ungültige Lizenz).
        await expect(gewichtFeld).toHaveValue('40,00');
        await expect(judopassFeld).toHaveValue('');
        await expect(speichernBtn).toBeVisible();
        await expect(speichernBtn).toBeDisabled();

        // Alters- und Gewichtsklasse müssen bereits aus dem Import korrekt vorbelegt sein: U15 männlich.
        await expect(altersklasseFeld).toHaveValue('U15');

        // Gewicht um 1kg erhöhen -> befehleGewichtsklassenDropdown() in waage-modal.js wählt die
        // Gewichtsklasse automatisch neu. Die Altersklasse bleibt unverändert (U15).
        await gewichtFeld.fill('41');
        await expect(altersklasseFeld).toHaveValue('U15');

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
        await judopassFeld.fill('JP-FTN-0001');
        await expect(speichernBtn).toBeEnabled();

        await speichernBtn.click();
        // Gewicht wurde geändert und offline_user gilt als ausrichtender Verein -> "Als gewogen
        // markieren?"-Rückfrage (siehe waage-modal.js) muss bestätigt werden, bevor die
        // eigentliche Speicherung überhaupt losläuft.
        await expect(page.locator('#customConfirmModal')).toBeVisible();
        await page.locator('#modalConfirmBtn').click();
        await expect(page.locator('#snackbarText')).toHaveText(`Athlet ${editVorname} erfolgreich aktualisiert!`);
        await expect(waageModal).toBeHidden();

        // --- IN DER LISTE PRÜFEN: Gewicht angepasst, Startgeld bezahlt, Lizenz jetzt bestätigt/grün ---
        const geaenderteZeile = findeZeile(editVorname, editNachname, 'FTN');
        await expect(geaenderteZeile).toHaveCount(1);
        await expect(geaenderteZeile.locator('td').nth(7)).toContainText('41,00 kg');
        await expect(geaenderteZeile.locator('[data-toggle="bezahlt"]')).toHaveClass(/active/);
        await expect(geaenderteZeile.locator('[data-toggle="lizenz"]')).toHaveClass(/active/);
    });

    test('QR-Scan: bekannter Teilnehmer lädt bestehenden Datensatz', async () => {
        // Treffer über die Judopass-Nr. (siehe verarbeiteGescannteDaten -> Suche über
        // scanJudopassId in waage-modal.js). Der zuvor im Editier-Test bearbeitete
        // FTN-Teilnehmer hat inzwischen die Passnr. "JP-FTN-0001" -> beim Scan muss
        // automatisch GENAU dieser bereits vorhandene Datensatz (inkl. seines echten,
        // gespeicherten Gewichts 41kg) geladen werden, nicht ein leeres/neues Formular.
        const [editVorname, editNachname] = ftnM[0];

        await stelleQrScanBereit(page, {
            vorname: editVorname,
            nachname: editNachname,
            judopass_id: 'JP-FTN-0001',
            lizenz_ablauf: '2032-05-01'
        });
        await page.locator('#scanBtn').click();
        const waageModal = page.locator('#waageModal');
        await expect(waageModal).toBeVisible();

        await expect(page.locator('#vorname')).toHaveValue(editVorname);
        await expect(page.locator('#nachname')).toHaveValue(editNachname);
        await expect(page.locator('#verein')).toHaveValue('FTN');
        await expect(page.locator('#judopass_id')).toHaveValue('JP-FTN-0001');
        await expect(page.locator('#gewicht')).toHaveValue('41,00'); // stammt aus dem bestehenden Datensatz, nicht aus dem QR-Code
        await expect(page.locator('#lizenz_ablauf')).toHaveValue('2032-05-01'); // aus dem QR-Code übernommener, gültiger Lizenzablauf
        await expect(page.locator('#lizenz_ablauf')).toHaveClass(/lizenz-valid/);

        await page.locator('#waageModalClose').click();
        await expect(waageModal).toBeHidden();
    });

    test('QR-Scan: unbekannter Teilnehmer legt neuen Datensatz an', async () => {
        // Geschlecht und Gewicht liefert der QR-Code bewusst NICHT (ein Judopass enthält kein
        // Wiege-Ergebnis) -> beide werden hier manuell nachgetragen und müssen automatisch die
        // korrekte Alters-/Gewichtsklasse auswählen (siehe
        // bestimmeUndWaehleAltersklasse/befehleGewichtsklassenDropdown). Die Altersklasse wird
        // dabei rein aus dem Geburtsdatum hergeleitet (siehe ermittleAltersklasse in
        // teilnehmerController.js) — unabhängig davon, dass dieses Turnier keine Einzelwettkampf-
        // Altersklassen konfiguriert hat (turnierAltersklassenKeys bleibt dadurch clientseitig
        // "null" = keine Einschränkung, siehe teilnehmer.js).
        const neuVorname = 'Helene';
        const neuNachname = 'Neuling';
        const neuVerein = 'Neuer Verein Grün-Weiß';
        await stelleQrScanBereit(page, {
            vorname: neuVorname,
            nachname: neuNachname,
            judopass_id: 'JP-NEU-9001',
            geburtsdatum: `${GEBURTSJAHR_U15}-06-15`, // Alter passend zu U15 (siehe WETTKAMPFJAHR oben)
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
        await expect(altersklasseFeld).toHaveValue('U15');

        // Gewicht manuell eintragen -> Gewichtsklasse wird automatisch anhand von
        // Altersklasse+Geschlecht ermittelt.
        await gewichtFeld.fill('44');
        await expect(gewichtsklasseFeld).not.toHaveValue('');
        await expect(speichernBtn).toBeEnabled();

        await speichernBtn.click();
        await expect(page.locator('#snackbarText')).toHaveText(`Athlet ${neuVorname} erfolgreich eingewogen!`);

        await page.locator('#waageModalClose').click();
        await expect(waageModal).toBeHidden();

        // --- IN DER LISTE PRÜFEN: der neu angelegte Teilnehmer erscheint mit korrekter Klasse/Gewicht ---
        const neueZeile = findeZeile(neuVorname, neuNachname, neuVerein);
        await expect(neueZeile).toHaveCount(1);
        await expect(neueZeile.locator('td').nth(6)).toContainText('U15w');
        await expect(neueZeile.locator('td').nth(7)).toContainText('44,00 kg');
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
        const gesamtVorBulk = erwarteteGesamtzahl + 2; // +2: "Paula Nachmelderin" (manuell) und "Helene Neuling" (QR-Scan)
        const anzahlProSammelAktion = gesamtVorBulk - 1; // alle außer der jeweils einen Ausnahme

        // Drei unterschiedliche, bislang unberührte Teilnehmer aus drei verschiedenen Vereinen als
        // Ausnahme je Kriterium, damit sich die drei Aktionen nicht gegenseitig beeinflussen.
        const ausgenommenGewogen = [tsEinfeldM[5][0], tsEinfeldM[5][1], 'TS Einfeld'];
        const ausgenommenLizenz = [tsEinfeldW[5][0], tsEinfeldW[5][1], 'TS Einfeld'];
        const ausgenommenBezahlt = [jcEssenW[5][0], jcEssenW[5][1], 'JC Essen'];

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

    test('Menüpunkt "Pools" bleibt ausgeblendet, "Mannschaften" wird freigeschaltet', async () => {
        // "Pools" verwaltet ausschließlich Einzelwettkampf-Pools (siehe menu.js: einzelKeys-
        // Prüfung) — dieses Turnier trägt keine Einzel-Altersklassen aus, der Menüpunkt muss also
        // komplett verborgen bleiben, unabhängig von der kampfbereit-Zählung.
        // "Mannschaften" muss sichtbar sein, weil das Turnier Mannschafts-Altersklassen austrägt
        // (siehe menu.js: hatMannschaftsKlassen-Prüfung).
        const navPools = page.locator('#nav-pools');
        const navMannschaften = page.locator('#nav-mannschaften');
        await expect(navPools).not.toBeVisible();
        await expect(navMannschaften).toBeVisible();
        await expect(navMannschaften).not.toHaveClass(/disabled/);
    });
});
