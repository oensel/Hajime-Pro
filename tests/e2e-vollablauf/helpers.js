// Wiederverwendbare Bausteine für den "kompletten Turnierablauf"-Test (siehe
// turnier-vollablauf.spec.js). Registrierung/Login laufen über die echte UI (login.html), da das
// selbst Teil des zu testenden Szenarios ist; Vereinsbeitritt läuft dagegen direkt per API
// (request-Fixture mit Bearer-Token) — analog zum bestehenden Muster in
// tests/e2e/registrierung.spec.js — weil das reine Testdaten-Vorbereitung ist, kein vom Nutzer
// genannter Szenario-Schritt.
import { expect } from '@playwright/test';
import * as XLSX from 'xlsx';
import path from 'path';
import { mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { MARKER_PREFIX, merkeId } from './run-state.js';

// Playwright legt Downloads standardmäßig in einem flüchtigen Temp-Ordner ab (download.path()),
// der beim Schließen des Browser-Kontexts wieder aufgeräumt wird — für die manuelle Inspektion
// der herunter-/hochgeladenen Turnier-Dateien (siehe exportiereTurnierDaten) landen sie deshalb
// stattdessen dauerhaft hier. Enthält reale, aus der echten Cloud-DB exportierte Teilnehmerdaten
// -> bewusst NICHT eingecheckt (siehe .gitignore).
const DOWNLOADS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'downloads');
mkdirSync(DOWNLOADS_DIR, { recursive: true });

export { MARKER_PREFIX };

// --- LOGIN (echte UI, siehe login.html) ---
//
// jan@test.de / tim@test.de / tom@test.de sind ECHTE, bereits bestehende und bereits
// freigegebene Accounts des Nutzers auf der Cloud-DB (nicht Testdaten dieses Laufs!) — dieser
// Test registriert sie NICHT und legt für sie auch keinen Verein an, sondern loggt sich nur mit
// den vom Nutzer übergebenen Zugangsdaten ein. Siehe Vorfall-Historie: eine frühere Fassung
// versuchte fälschlich, diese drei Adressen zu REGISTRIEREN, was serverseitig erwartungsgemäß mit
// 409 scheiterte (die Accounts existierten schon) — der zugehörige Cleanup-Fallback löschte
// daraufhin die echten Accounts anhand ihrer bloßen E-Mail-Adresse. Diese Datei fasst deshalb
// NIRGENDS mehr `benutzer`/`vereine` dieser drei Adressen an, weder lesend-schreibend noch löschend
// — nur Turniere (inkl. aller darunterhängenden Daten) werden von diesem Testlauf angelegt/wieder
// entfernt (siehe run-state.js/global-teardown.js).

/**
 * Loggt einen bestehenden, bereits freigegebenen Benutzer über login.html ein und liest im
 * Anschluss das JWT sowie den vollständigen Benutzer (inkl. Vereins-Zugehörigkeit) aus.
 */
export async function meldeAn(page, baseUrl, request, { email, password }) {
    await page.goto(`${baseUrl}/login.html`);
    await expect(page.locator('#loginForm')).toBeVisible();

    await page.locator('#loginEmail').fill(email);
    await page.locator('#loginPassword').fill(password);
    await page.locator('#loginForm button[type="submit"]').click();

    // Bereits einem Verein zugehörige Konten landen auf turniere.html (siehe
    // handleAuthSuccess in login.html) — NICHT auf verein_auswahl.html wie bei einer
    // Neuregistrierung ohne Verein.
    await expect(page).toHaveURL(/\/turniere\.html$/);

    const token = await page.evaluate(() => localStorage.getItem('dokume_token'));
    expect(token, `JWT-Token fehlt nach Login von ${email}`).toBeTruthy();

    const meResp = await request.get(`${baseUrl}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
    expect(meResp.ok(), await meResp.text()).toBeTruthy();
    const { user } = await meResp.json();

    expect(user.verein_id, `${email} sollte bereits einem freigegebenen Verein angehören`).toBeTruthy();
    expect(user.verein_freigegeben, `${email} sollte bereits freigegeben sein`).toBe(true);

    return { token, benutzerId: user.id, vereinId: user.verein_id, vereinName: user.verein_name };
}

// --- KNEX-VERBINDUNG ZUR ECHTEN ONLINE-DB (für Direkt-Freigabe und ggf. Verifikation) ---
export async function oeffneOnlineKnex() {
    const path = await import('path');
    const { fileURLToPath } = await import('url');
    const { createRequire } = await import('module');
    const knexLib = (await import('knex')).default;

    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const projectRoot = path.resolve(__dirname, '../..');
    const require = createRequire(import.meta.url);
    const knexConfig = require(path.resolve(projectRoot, 'knexfile.cjs'));
    return knexLib(knexConfig.online);
}

// --- TURNIER ANLEGEN (echte UI, siehe turnier.html) — expliziter Szenario-Schritt ---

/**
 * Legt ein Turnier über turnier.html an (Bezeichnung erhält MARKER_PREFIX für das Cleanup) und
 * aktiviert die übergebenen Einzelwettkampf-Altersklassen-Checkboxen
 * (name="altersklasse_cb", value="<geschlecht>_<id>", z.B. "männlich_U11"). Mannschafts-
 * Altersklassen werden hier bewusst NICHT aktiviert (siehe turnier-vollablauf.spec.js: für U13
 * gibt es keine DJB-Mannschafts-Vorlage, die Team-Pools werden separat auf mannschaften.html mit
 * frei editierten Gewichtsklassen angelegt).
 */
export async function legeTurnierAn(page, baseUrl, { bezeichnung, datum, ort, plz, ausrichter, anzahlKampfflaechen, bundesland, einzelKlassenWerte }) {
    await page.goto(`${baseUrl}/turnier.html`);
    await page.locator('#bezeichnung').fill(`${MARKER_PREFIX} ${bezeichnung}`);
    await page.locator('#datum').fill(datum);
    await page.locator('#ort').fill(ort);
    await page.locator('#plz').fill(plz);
    await page.locator('#ausrichter').fill(ausrichter);
    await page.locator('#anzahl_kampfflaechen').fill(String(anzahlKampfflaechen));
    await page.locator('#bundesland').selectOption(bundesland);

    for (const wert of einzelKlassenWerte) {
        await page.locator(`input[name="altersklasse_cb"][value="${wert}"]`).check();
    }

    await page.locator('#submitBtn').click();
    await expect(page.locator('#snackbarText')).toHaveText('Turnier erfolgreich angelegt!');
    await expect(page).toHaveURL(/\/turnier\.html\?id=\d+/);

    const turnierId = new URL(page.url()).searchParams.get('id');
    merkeId('turnierIds', parseInt(turnierId, 10));
    return turnierId;
}

/**
 * Legt einen Mannschafts-Pool über mannschaften.html an (#poolModal/#poolForm) — für U13 (keine
 * DJB-Mannschafts-Vorlage vorhanden, siehe altersklassen.json) übernimmt das Formular automatisch
 * die Einzelwettkampf-Gewichtsklassen dieser Altersklasse/dieses Geschlechts als Vorschlag
 * (ermittleGewichtsklassenVorschlag in mannschaften.js) — dieser Vorschlag wird unverändert
 * übernommen, sofern kein eigener gewichtsklassenCsv übergeben wird.
 */
export async function legeMannschaftsPoolAn(page, baseUrl, turnierId, { bezeichnung, geschlecht, altersklasse, modus = 'Jeder-gegen-Jeden', gewichtsklassenCsv = null }) {
    await page.goto(`${baseUrl}/mannschaften.html?id=${turnierId}`);
    await page.locator('#neuerPoolBtn').click();
    await expect(page.locator('#poolModal')).toBeVisible();

    await page.locator('#poolBezeichnung').fill(bezeichnung);
    await page.locator('#poolGeschlecht').selectOption(geschlecht);
    await page.locator('#poolAltersklasse').selectOption(altersklasse);
    await page.locator('#poolModus').selectOption(modus);
    if (gewichtsklassenCsv) {
        await page.locator('#poolGewichtsklassen').fill(gewichtsklassenCsv);
    }

    await page.locator('#poolForm button[type="submit"]').click();
    await expect(page.locator('#poolModal')).toBeHidden();
}

/**
 * Trägt die übergebenen Mannschafts-Altersklassen-Keys (z.B. "männlich_U13") am Turnier nach.
 * NÖTIG, damit teilnehmer.js beim Import überhaupt den Einzel/Mannschaft-Auswahldialog anbietet
 * (turnierHatMannschaftKlassen prüft ausschließlich turnier.mannschafts_altersklassen, NICHT ob
 * bereits Mannschafts-Pools existieren — siehe ermittleImportZiel in teilnehmer.js) — für U13 gibt
 * es dafür keine Checkbox auf turnier.html (nur U15/U18 haben ein DJB-Preset, siehe
 * altersklassen.json), daher der Nachtrag per direktem PUT statt über das Anlage-Formular.
 * updateTurnier() ist ein Voll-Ersatz (kein Merge) — lädt deshalb zuerst den aktuellen Stand und
 * schreibt ihn samt der Ergänzung komplett zurück.
 */
export async function aktiviereMannschaftsAltersklassen(baseUrl, request, token, turnierId, keys) {
    const getResp = await request.get(`${baseUrl}/api/turniere/${turnierId}`, { headers: { Authorization: `Bearer ${token}` } });
    expect(getResp.ok(), await getResp.text()).toBeTruthy();
    const turnier = await getResp.json();

    const putResp = await request.put(`${baseUrl}/api/turniere/${turnierId}`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { ...turnier, mannschafts_altersklassen: keys }
    });
    expect(putResp.ok(), await putResp.text()).toBeTruthy();
}

/** Veröffentlicht ein Turnier (POST /api/turniere/:id/veroeffentlichen) — der vom Nutzer explizit
 * genannte "Freigabe"-Schritt. Läuft über turnier.html, sofern dort ein Button existiert;
 * andernfalls direkt per API (beides identisch autorisiert, requireTournamentEditAccess +
 * requireVereinFreigabe). */
export async function veroeffentlicheTurnier(baseUrl, request, token, turnierId) {
    const resp = await request.post(`${baseUrl}/api/turniere/${turnierId}/veroeffentlichen`, {
        headers: { Authorization: `Bearer ${token}` }
    });
    expect(resp.ok(), await resp.text()).toBeTruthy();
}

// --- TEILNEHMER-ROSTER GENERIEREN (für den XLSX-Bulk-Import) ---
//
// Entspricht der Spaltenreihenfolge der Import-Vorlage (siehe IMPORT_SYSTEMFELDER in
// teilnehmerController.js, sowie das exakt gleiche Format in
// tests/e2e/teilnehmer-import-einzel-team.spec.js): Vorname, Name, Passnr, Geburtsdatum,
// Geburtsjahr, Geschlecht, Verein, Team-Name, Graduierung, Gewicht. Gewicht bleibt in ALLEN Zeilen
// bewusst leer (pflicht: false, siehe teilnehmerController.js) — das entspricht dem realen Ablauf
// (Verein meldet ohne verbindliches Gewicht an, der Ausrichter trägt es erst beim Einwiegen ein,
// siehe Phase 6 "Waage-Simulation").
const CSV_HEADER = ['Vorname', 'Name', 'Passnr', 'Geburtsdatum', 'Geburtsjahr', 'Geschlecht', 'Verein', 'Team-Name', 'Graduierung', 'Gewicht'];

const VORNAMEN_M = ['Finn', 'Luca', 'Paul', 'Ben', 'Noah', 'Elias', 'Jonas', 'Max', 'Leon', 'Felix', 'Kilian', 'Matteo', 'Jannik', 'Levi', 'Emil', 'Theo', 'Bruno', 'Milo', 'Anton', 'Aaron', 'Moritz', 'Vincent', 'Linus', 'Oskar', 'Henri'];
const VORNAMEN_W = ['Mia', 'Emma', 'Lena', 'Sofia', 'Lea', 'Anna', 'Laura', 'Nele', 'Marie', 'Lina', 'Johanna', 'Charlotte', 'Amelie', 'Lilly', 'Pauline', 'Josephine', 'Helena', 'Antonia', 'Victoria', 'Luisa', 'Romy', 'Mathilda', 'Emilia', 'Wilma', 'Rosalie'];
const NACHNAMEN = ['Schmidt', 'Müller', 'Fischer', 'Weber', 'Meyer', 'Wagner', 'Becker', 'Schulz', 'Hoffmann', 'Koch', 'Richter', 'Klein', 'Wolf', 'Neumann', 'Schwarz', 'Zimmermann', 'Braun', 'Krüger', 'Hofmann', 'Lange', 'Lehmann', 'Huber', 'Kaiser', 'Fuchs', 'Vogel', 'Keller', 'Günther', 'Frank', 'Berger', 'Winter'];

function zeile({ vorname, nachname, geburtsjahr, geschlecht, verein, teamName = '', gewicht = '' }) {
    return [vorname, nachname, '', '', String(geburtsjahr), geschlecht, verein, teamName, '', gewicht === '' ? '' : String(gewicht)];
}

function baueXlsxBuffer(zeilen) {
    const blatt = XLSX.utils.aoa_to_sheet([CSV_HEADER, ...zeilen]);
    const arbeitsmappe = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(arbeitsmappe, blatt, 'Teilnehmer');
    return XLSX.write(arbeitsmappe, { type: 'buffer', bookType: 'xlsx' });
}

function xlsxDatei(name, zeilen) {
    return { name, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: baueXlsxBuffer(zeilen) };
}

/**
 * Baut das komplette 50-Personen-Roster eines Vereins für den Vollablauf-Test: 7 U11m + 7 U11w +
 * 6 U13m (nur Einzel) + 6 U13w (nur Einzel) + 12 U13m (auch Team) + 12 U13w (auch Team) = 50.
 * `seed` verschiebt die Namensauswahl (unterschiedliche Vor-/Nachnamen je Verein, keine
 * Kollisionsgefahr, da Vorname+Nachname+Verein die eindeutige Kennung ist und der Verein sich
 * unterscheidet). Gibt sowohl die fertigen Import-Zeilen (getrennt nach Ziel "einzel"/"mannschaft",
 * siehe verarbeiteImportZeile in teilnehmerController.js — Team-Name wird nur bei Ziel
 * "mannschaft" überhaupt verarbeitet) als auch die reinen Personendaten zurück (für den
 * Namens-Lookup in Phase 6, "Waage-Simulation").
 */
export function baueVollablaufRoster(verein, wettkampfjahr, teamNamePraefix, seed = 0) {
    const geburtsjahrU11 = wettkampfjahr - 9;  // Alter 9 -> U11 (Alter 8-10)
    const geburtsjahrU13 = wettkampfjahr - 12; // Alter 12 -> U13 (Alter 11-12)

    let n = seed;
    const naechsterName = (geschlecht) => {
        const vornamen = geschlecht === 'weiblich' ? VORNAMEN_W : VORNAMEN_M;
        const ergebnis = { vorname: vornamen[n % vornamen.length], nachname: NACHNAMEN[(n * 7 + 3) % NACHNAMEN.length] };
        n++;
        return ergebnis;
    };

    // gruppenIndex zählt separat je (geschlecht, zielAltersklasse) hoch — Grundlage für die
    // deterministische Gewichts-Bin-Zuordnung in Phase 6 ("Waage-Simulation"), siehe
    // ermittleZielgewicht: dieselbe Position (z.B. "3. männlicher U13" dieses Vereins) landet bei
    // jedem Verein in derselben Gewichts-Bin, wodurch über beide Vereine hinweg garantiert jede
    // benutzte DJB-Gewichtsklasse ≥2 Personen bekommt (keine "kampflos"-Pools).
    const gruppenZaehler = {};
    const personen = [];
    const erzeuge = (anzahl, geschlecht, geburtsjahr, zielAltersklasse, imTeam) => {
        for (let i = 0; i < anzahl; i++) {
            const { vorname, nachname } = naechsterName(geschlecht);
            const gruppenKey = `${geschlecht}_${zielAltersklasse}`;
            const gruppenIndex = gruppenZaehler[gruppenKey] || 0;
            gruppenZaehler[gruppenKey] = gruppenIndex + 1;
            personen.push({ vorname, nachname, geschlecht, geburtsjahr, verein, zielAltersklasse, imTeam, gruppenIndex });
        }
    };

    erzeuge(7, 'männlich', geburtsjahrU11, 'U11', false);
    erzeuge(7, 'weiblich', geburtsjahrU11, 'U11', false);
    erzeuge(6, 'männlich', geburtsjahrU13, 'U13', false);
    erzeuge(6, 'weiblich', geburtsjahrU13, 'U13', false);
    erzeuge(12, 'männlich', geburtsjahrU13, 'U13', true);
    erzeuge(12, 'weiblich', geburtsjahrU13, 'U13', true);

    const einzelZeilen = personen.filter(p => !p.imTeam).map(p => zeile(p));
    const mannschaftZeilen = personen.filter(p => p.imTeam).map(p => zeile({
        ...p, teamName: `${teamNamePraefix} ${p.geschlecht === 'männlich' ? 'U13m' : 'U13w'}`
    }));

    return { personen, einzelZeilen, mannschaftZeilen };
}

// --- GEWICHTS-BINS FÜR DIE WAAGE-SIMULATION (Phase 6) ---
//
// Konzentriert die Gewichte bewusst auf wenige feste DJB-Gewichtsklassen statt sie realistisch zu
// streuen — generierePools() (poolController.js, Strategie "starre DJB-Gewichtsklassen", der
// Standardmodus) legt pro tatsächlich vorkommender Gewichtsklasse einen eigenen Pool an; eine
// Gewichtsklasse mit nur 1 Person würde als "kampflos" markiert (siehe dortiger Einzelpool-Log).
// Werte so gewählt, dass sie eindeutig in die jeweils genannte Klasse fallen (kleinste
// "-X"-Grenze >= Gewicht, siehe befehleGewichtsklassenDropdown in waage-modal.js).
const GEWICHTS_BINS = {
    'männlich_U11': [20, 33],       // -> "-23", "-34"
    'weiblich_U11': [19, 32],       // -> "-22", "-33"
    'männlich_U13': [25, 33, 39, 48], // -> "-28", "-34", "-40", "-50"
    'weiblich_U13': [24, 32, 38, 46]  // -> "-27", "-33", "-40", "-48"
};

/** Liefert das deterministische Ziel-Gewicht einer Person anhand ihrer Gruppenposition (siehe
 * baueVollablaufRoster) — dieselbe Bin-Zuordnung für alle Vereine, siehe Kommentar dort. */
export function ermittleZielgewicht(geschlecht, zielAltersklasse, gruppenIndex) {
    const bins = GEWICHTS_BINS[`${geschlecht}_${zielAltersklasse}`];
    return bins[gruppenIndex % bins.length];
}

// --- TEILNEHMER-IMPORT (echte UI, siehe teilnehmer.html) — expliziter Szenario-Schritt ---

/**
 * Führt einen kompletten Import-Durchlauf über teilnehmer.html aus: Ziel wählen (das
 * #importZielModal erscheint, weil unser Turnier sowohl Einzel- als auch Mannschafts-
 * Altersklassen anbietet), Datei liefern, Vorschau bestätigen, Import starten. `ziel` ist
 * 'einzel' oder 'mannschaft'.
 */
export async function importiereTeilnehmerDatei(page, ziel, dateiName, zeilen) {
    await page.locator('#importBtn').click();
    await expect(page.locator('#importZielModal')).toBeVisible();

    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.locator(ziel === 'mannschaft' ? '#importZielMannschaftBtn' : '#importZielEinzelBtn').click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(xlsxDatei(dateiName, zeilen));

    const importVorschauModal = page.locator('#importVorschauModal');
    await expect(importVorschauModal).toBeVisible();
    await page.locator('#importVorschauStartenBtn').click();
    await expect(importVorschauModal).toBeHidden();

    await expect(page.locator('#importStatus')).toContainText(`${zeilen.length} von ${zeilen.length} Teilnehmern importiert.`);
}

/**
 * Zieht das Turnierdatum auf den übergebenen Tag vor (voller Ersatz, siehe
 * aktiviereMannschaftsAltersklassen) — der reale Auslöser für "Wettkampftag" im effektiven Status
 * (ermittleEffektivenStatus in turnierController.js: `datum <= heute` -> "in_durchfuehrung"),
 * wovon u.a. Turnier-Export/-Import-Buttons sowie das Schließen der Online-Anmeldung abhängen.
 */
export async function verschiebeTurnierAufTag(baseUrl, request, token, turnierId, datum) {
    const getResp = await request.get(`${baseUrl}/api/turniere/${turnierId}`, { headers: { Authorization: `Bearer ${token}` } });
    expect(getResp.ok(), await getResp.text()).toBeTruthy();
    const turnier = await getResp.json();

    const putResp = await request.put(`${baseUrl}/api/turniere/${turnierId}`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { ...turnier, datum }
    });
    expect(putResp.ok(), await putResp.text()).toBeTruthy();
}

/**
 * Wählt per Kopf-Checkbox ALLE Teilnehmer aus und markiert sie über die Sammel-Aktion
 * "bulkMarkPaidBtn" als bezahlt (nur der ausrichtende Verein darf das — siehe
 * teilnehmerController.js#aendereStatusFelder — jan ist Gastgeber, ausdrücklich vom Nutzer für
 * diesen Schritt gewählt).
 */
export async function markiereAlleAlsBezahlt(page, erwarteteAnzahl) {
    await page.locator('#selectAllCheckbox').check();
    await page.locator('#bulkMarkPaidBtn').click();
    await expect(page.locator('#customConfirmModal')).toBeVisible();
    await page.locator('#modalConfirmBtn').click();
    await expect(page.locator('#snackbarText')).toHaveText(`${erwarteteAnzahl} Teilnehmer erfolgreich aktualisiert.`);
}

/**
 * Lädt die Turnier-Gesamtdaten über turnier.html herunter (#exportTurnierBtn, echter
 * Datei-Download) und liefert den lokalen Pfad der heruntergeladenen JSON-Datei zurück — für den
 * anschließenden Offline-Import (Phase 5) bzw. Online-Reimport (Phase 10). `label` unterscheidet
 * die beiden Aufrufstellen im Dateinamen (siehe DOWNLOADS_DIR): sonst würde der zweite Download
 * (Phase 10, Offline→Online) den ersten (Phase 4, Online→Offline) überschreiben, da Playwright
 * beide unter demselben, vom Server vorgeschlagenen Dateinamen anliefert.
 */
export async function exportiereTurnierDaten(page, baseUrl, turnierId, label = 'export') {
    await page.goto(`${baseUrl}/turnier.html?id=${turnierId}`);
    const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.locator('#exportTurnierBtn').click()
    ]);

    const zielPfad = path.join(DOWNLOADS_DIR, `${label}_${download.suggestedFilename()}`);
    await download.saveAs(zielPfad);
    return zielPfad;
}

// --- OFFLINE-IMPORT (echte UI, siehe turniere.html) — expliziter Szenario-Schritt ---

/**
 * Importiert die per exportiereTurnierDaten() heruntergeladene Turnier-Gesamtdatei auf dem
 * OFFLINE-Server (turniere.html#importTurnierBtn, nur im Offline-Betrieb sichtbar) — ersetzt
 * dabei alle bisherigen Turniere auf diesem Gerät (siehe Bestätigungstext in turniere.html) und
 * gibt die NEUE (offline-lokale) Turnier-ID zurück, unter der das importierte Turnier ab jetzt auf
 * dem Offline-Server geführt wird.
 */
export async function importiereTurnierOffline(page, baseUrl, dateiPfad) {
    await page.goto(`${baseUrl}/turniere.html`);
    await expect(page.locator('#importTurnierBtn')).toBeVisible();

    await page.locator('#importTurnierFileInput').setInputFiles(dateiPfad);

    await expect(page.locator('#customConfirmModal')).toBeVisible();
    await page.locator('#modalConfirmBtn').click();

    await expect(page).toHaveURL(/\/teilnehmer\.html\?turnierId=\d+/);
    return new URL(page.url()).searchParams.get('turnierId');
}

/**
 * Markiert die genannten Mannschaftsmitglieder zusätzlich als "auch Einzelwettkampf"
 * (data-toggle="auch_einzelwettkampf", PUT /api/teilnehmer/:id/status {auch_einzelwettkampf:true})
 * — ohne das bleiben sie bei der Pool-Generierung außen vor (siehe generierePools in
 * poolController.js: ein Mannschaftsmitglied zählt nur mit gesetztem auch_einzelwettkampf auch für
 * Einzelpools). Das darf jeder Verein für seine eigenen Kämpfer selbst tun (aendereStatusFelder in
 * teilnehmerController.js macht dafür explizit eine Ausnahme vom Gastgeber-Verein-Erfordernis).
 */
export async function markiereAuchEinzelwettkampf(page, personen) {
    for (const { vorname, nachname, verein } of personen) {
        const zeile = page.locator('#teilnehmerTableBody tr')
            .filter({ hasText: nachname }).filter({ hasText: vorname }).filter({ hasText: verein });
        await expect(zeile, `Zeile für ${vorname} ${nachname} (${verein}) nicht eindeutig gefunden`).toHaveCount(1);
        await zeile.locator('[data-toggle="auch_einzelwettkampf"]').click();
    }
}

// --- WAAGE-SIMULATION (Phase 6, echte UI, siehe teilnehmer.html#waageModal) ---
//
// Im Offline-Betrieb ist istGastgeberVerein immer true (siehe waage-modal.js), Gewicht/Judopass-Nr./
// Lizenz sind also für JEDEN Teilnehmer editierbar/pflicht — entspricht der Realität, dass an der
// Matte vor Ort nur eine Instanz (der Ausrichter) einwiegt.
const LIZENZ_ABLAUF_ZUKUNFT = `${new Date().getFullYear() + 2}-12-31`;

function findeTeilnehmerZeile(page, { vorname, nachname, verein }) {
    return page.locator('#teilnehmerTableBody tr')
        .filter({ hasText: nachname }).filter({ hasText: vorname }).filter({ hasText: verein });
}

/**
 * Wiegt einen bereits importierten Teilnehmer ein: öffnet das Editier-Modal, trägt Gewicht +
 * Judopass-Nr. + Lizenz-Ablauf (Startgeld ist bereits aus Phase 4 bezahlt) ein und speichert.
 */
export async function waegeTeilnehmerEin(page, { vorname, nachname, verein, gewicht, judopassId }) {
    const zeile = findeTeilnehmerZeile(page, { vorname, nachname, verein });
    await expect(zeile, `Zeile für ${vorname} ${nachname} (${verein}) nicht eindeutig gefunden`).toHaveCount(1);
    await zeile.locator('.icon-edit').click();

    const modal = page.locator('#waageModal');
    await expect(modal).toBeVisible();

    await page.locator('#gewicht').fill(String(gewicht));
    await page.locator('#judopass_id').fill(judopassId);
    await page.locator('#lizenz_ablauf').fill(LIZENZ_ABLAUF_ZUKUNFT);
    await page.locator('#startgeld_bezahlt').check();

    const submitBtn = page.locator('#submitBtn');
    await expect(submitBtn).toBeEnabled();
    await submitBtn.click();

    // Gewicht wurde geändert und der Offline-Betrieb gilt immer als ausrichtender Verein ->
    // "Als gewogen markieren?"-Rückfrage (siehe waage-modal.js) muss bestätigt werden, bevor die
    // eigentliche Speicherung überhaupt losläuft.
    await expect(page.locator('#customConfirmModal')).toBeVisible();
    await page.locator('#modalConfirmBtn').click();

    await expect(modal).toBeHidden();
}

/**
 * Legt einen neuen Walk-in-Teilnehmer direkt am Wiegetisch an (#addBtn -> leeres
 * #waageModal) — z.B. die 3 kurzfristigen FC-Kleingarten-Meldungen.
 */
export async function fuegeWalkInTeilnehmerHinzu(page, { vorname, nachname, verein, geburtsjahr, geschlecht, gewicht, judopassId }) {
    await page.locator('#addBtn').click();
    const modal = page.locator('#waageModal');
    await expect(modal).toBeVisible();

    await page.locator('#vorname').fill(vorname);
    await page.locator('#nachname').fill(nachname);
    await page.locator('#verein').fill(verein);
    await page.locator('#geburtsjahr').fill(String(geburtsjahr));
    await page.locator('#geschlecht').selectOption(geschlecht);
    await page.locator('#gewicht').fill(String(gewicht));
    await page.locator('#judopass_id').fill(judopassId);
    await page.locator('#lizenz_ablauf').fill(LIZENZ_ABLAUF_ZUKUNFT);
    await page.locator('#startgeld_bezahlt').check();

    const submitBtn = page.locator('#submitBtn');
    await expect(submitBtn).toBeEnabled();
    await submitBtn.click();

    // Gewicht wurde eingetragen (nicht via QR-Scan) und der Offline-Betrieb gilt immer als
    // ausrichtender Verein -> "Als gewogen markieren?"-Rückfrage (siehe waage-modal.js) muss
    // bestätigt werden, bevor die eigentliche Speicherung überhaupt losläuft.
    await expect(page.locator('#customConfirmModal')).toBeVisible();
    await page.locator('#modalConfirmBtn').click();

    // Anders als beim Bearbeiten eines Bestandsteilnehmers bleibt das Modal bei einer NEUEN
    // Person nach dem Speichern bewusst offen (Formular wird zurückgesetzt, "Kampfbereit
    // bestätigen" erscheint) — für die Erfassung des nächsten Athleten am Wiegetisch ohne erneutes
    // Öffnen, siehe Kommentar bei setzeFormularZurueck()/kampfbereitBtn in waage-modal.js.
    await expect(page.locator('#snackbarText')).toHaveText(`Athlet ${vorname} erfolgreich eingewogen!`);
    await page.locator('#waageModalClose').click();
    await expect(modal).toBeHidden();
}

/**
 * Markiert per Kopf-Checkbox ALLE Teilnehmer als gewogen (Sammel-Aktion #bulkMarkWeighedBtn) —
 * schneller als ein "gewogen"-Icon-Klick je Person, funktional identisch (siehe
 * teilnehmer.js#bulkMarkWeighedBtn).
 */
export async function markiereAlleAlsGewogen(page, erwarteteAnzahl) {
    await page.locator('#selectAllCheckbox').check();
    await page.locator('#bulkMarkWeighedBtn').click();
    await expect(page.locator('#customConfirmModal')).toBeVisible();
    await page.locator('#modalConfirmBtn').click();
    await expect(page.locator('#snackbarText')).toHaveText(`${erwarteteAnzahl} Teilnehmer erfolgreich als gewogen markiert.`);
}

// --- POOL-/MATTEN-EINTEILUNG (Phase 7, echte UI) ---

/**
 * Generiert die Einzelwettkampf-Pools (pools.html#generatePoolsBtn -> POST /api/pools/generieren,
 * Standard-Modus "starre DJB-Gewichtsklassen": ein Pool je tatsächlich vorkommender
 * Gewichtsklasse) und prüft anschließend über GET /api/pools/details, dass kein Pool "kampflos"
 * (nur 1 Teilnehmer, siehe ermittleZielgewicht/GEWICHTS_BINS) geblieben ist.
 *
 * `token` ist optional und nur gegen den ONLINE-Server nötig: requireAuth() lässt jede Anfrage
 * ohne Bearer-Token nur im Offline-Betrieb (IS_OFFLINE=true) durch (siehe
 * src/middleware/auth.js) — der bisherige einzige Aufrufer dieser Funktion
 * (turnier-vollablauf.spec.js) läuft ausschließlich gegen den Offline-Server und bleibt daher
 * unverändert funktionsfähig, wenn `token` weggelassen wird.
 */
export async function generierePoolsUndPruefeKampflos(page, baseUrl, request, turnierId, token = null) {
    await page.goto(`${baseUrl}/pools.html?id=${turnierId}`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('#generatePoolsBtn')).toBeVisible({ timeout: 15_000 });
    await page.locator('#generatePoolsBtn').click();

    // Altersklassen-Auswahl (Waage in Runden): alle angebotenen Klassen bleiben angehakt.
    await expect(page.locator('#altersklassenDialog')).toBeVisible();
    await page.locator('#altersklassenBestaetigen').click();

    // "Waage für die gewählten Altersklassen schließen und auslosen? ..." (kein vorheriger Warn-Dialog, da alle
    // 103 Teilnehmer bereits kampfbereit sind, siehe warneVorNichtKampfbereitenTeilnehmern).
    await expect(page.locator('#customConfirmModal')).toBeVisible();
    await page.locator('#modalConfirmBtn').click();

    await expect(page.locator('#snackbarText')).toHaveText('Pools erfolgreich generiert und ausgelost!');

    const detailsResp = await request.get(`${baseUrl}/api/pools/details?turnierId=${turnierId}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
    });
    expect(detailsResp.ok(), await detailsResp.text()).toBeTruthy();
    const pools = await detailsResp.json();

    expect(pools.length).toBeGreaterThan(0);
    const kampflosPools = pools.filter(p => p.anzahl_teilnehmer === 1);
    expect(kampflosPools, `Kampflos-Pools gefunden: ${kampflosPools.map(p => p.bezeichnung).join(', ')}`).toEqual([]);

    return pools;
}

/**
 * Ordnet die von tim/tom importierten (noch keinem Pool zugeordneten) Mannschaften automatisch
 * jans bestehenden U13-Team-Pools zu (mannschaften.html#autoVerteilenBtn -> POST
 * /api/mannschaften/auto-verteilen — findet passende Pools nach Altersklasse+Geschlecht wieder,
 * legt keine doppelten an, siehe Kommentar in Phase 1c).
 */
export async function verteileMannschaftenAutomatisch(page, baseUrl, turnierId) {
    await page.goto(`${baseUrl}/mannschaften.html?id=${turnierId}`);
    await page.locator('#autoVerteilenBtn').click();

    await expect(page.locator('#customConfirmModal')).toBeVisible();
    await page.locator('#modalConfirmBtn').click();

    await expect(page.locator('#snackbarText')).toContainText('Mannschaft(en) zugeordnet.');
}

/**
 * Verteilt alle generierten Pools (Einzel + Mannschaft) automatisch auf die Kampfflächen
 * (matten.html#aufteilenBtn -> POST /api/pools/aufteilen).
 */
export async function verteilePoolsAufMatten(page, baseUrl, turnierId) {
    await page.goto(`${baseUrl}/matten.html?id=${turnierId}`);
    await page.locator('#aufteilenBtn').click();

    await expect(page.locator('#customConfirmModal')).toBeVisible();
    await page.locator('#modalConfirmBtn').click();

    await expect(page.locator('#snackbarText')).toBeVisible();
}

// --- SCOREBOARD JE MATTE (Phase 8, echte UI, siehe steuerung.html) ---

/**
 * Spielt eine komplette Matte direkt am Hallen-Server durch (steuerung.html mit turnierId/matId,
 * jedes Ergebnis geht sofort an den Server, der die Kaskade rechnet). Entscheidet JEDEN Kampf über
 * die echten Scoreboard-Bedienelemente per Ippon für "W" (kaempfer1) — identisches Muster wie
 * tests/e2e/steuerung-dk8-komplett.spec.js.
 *
 * Der Fortschritt wird am Server abgelesen statt an den Namensfeldern: da "W" jeden Kampf gewinnt,
 * kann dieselbe Paarung über Pool-Grenzen hinweg nicht sicher als "neuer Kampf" erkannt werden.
 * Die Schleife endet, sobald auf der Matte kein Kampf mehr 'bereit' oder 'gestartet' ist
 * (Gruppen-Überkreuz-Final-Hüllen können per Kaskade zu "freilos" werden).
 */
export async function spieleMatteAmServerDurch(page, baseUrl, turnierId, kampfflaecheId) {
    const ladeKaempfe = async () => {
        const resp = await page.request.get(`${baseUrl}/api/kaempfe?kampfflaecheId=${kampfflaecheId}`);
        expect(resp.ok(), await resp.text()).toBeTruthy();
        return resp.json();
    };

    await page.goto(`${baseUrl}/steuerung.html?turnierId=${turnierId}&matId=${kampfflaecheId}`);
    await expect(page.locator('#matSelect')).toHaveValue(String(kampfflaecheId));

    const obergrenze = (await ladeKaempfe()).length;
    let gespielt = 0;
    for (; gespielt < obergrenze; gespielt++) {
        const offen = (await ladeKaempfe()).filter(k => k.status === 'bereit' || k.status === 'gestartet');
        if (offen.length === 0) break;

        // Zustand an Knöpfen und Server ablesen, nicht an #centerNotification (die Meldung erscheint
        // erst nach weiteren awaits in naechstenKampfHolen()/ergebnisSenden()).
        await page.locator('#btnNaechsterKampfLive').click();
        await expect(page.locator('#btnNaechsterKampfLive')).toBeHidden();
        // Der Kampf gilt erst mit dem START der Kampfzeit als "gestartet" (nicht schon beim Laden).
        await page.locator('#btnStartStopLive').click();
        let laufend;
        await expect.poll(async () => {
            laufend = (await ladeKaempfe()).find(k => k.status === 'gestartet');
            return Boolean(laufend);
        }, { message: 'nach START ist kein Kampf gestartet' }).toBe(true);

        await page.evaluate(() => window.changeScore('W', 'ippon', 1));
        await expect(page.locator('#btnErgebnisSendenLive')).toBeVisible();
        await page.locator('#btnErgebnisSendenLive').click();
        await expect(page.locator('#btnNaechsterKampfLive'), 'Ergebnis wurde nicht angenommen').toBeVisible();
        await expect.poll(async () => (await ladeKaempfe()).find(k => k.id === laufend.id)?.status).toBe('beendet');
    }
    return gespielt;
}

// --- ONLINE-RÜCKSYNC (Phase 10, echte UI, siehe turnier.html#importTurnierBtn "Ergebnisse hochladen") ---

/**
 * Lädt die per exportiereTurnierDaten() vom OFFLINE-Server heruntergeladene Gesamtdatei in das
 * BESTEHENDE Online-Turnier hoch (POST /api/turniere/:id/import-ergebnisse — ersetzt nur
 * Kampfflächen/Pools/Teilnehmer/Kämpfe/Mannschaften dieses einen Turniers, setzt es danach
 * automatisch auf Status "abgeschlossen").
 */
export async function importiereErgebnisseOnline(page, baseUrl, turnierId, dateiPfad) {
    await page.goto(`${baseUrl}/turnier.html?id=${turnierId}`);
    await page.locator('#importTurnierFileInput').setInputFiles(dateiPfad);

    await expect(page.locator('#customConfirmModal')).toBeVisible();
    await page.locator('#modalConfirmBtn').click();

    // Großer Datensatz (~100+ Teilnehmer/Kämpfe) über eine echte Netzwerkverbindung zur
    // Cloud-DB — braucht spürbar länger als das Playwright-Standard-Timeout.
    await expect(page).toHaveURL(new RegExp(`/teilnehmer\\.html\\?turnierId=${turnierId}$`), { timeout: 30_000 });
}

/**
 * Trägt für alle Mannschaftsmitglieder die tatsächliche (jetzt bekannte) Gewichtsklasse als
 * Positions-Zuordnung nach (PUT /api/mannschaften/:teamId/mitglieder/:mitgliedId
 * {gewichtsklasse}) — beim Import (blankes Gewicht) landete jedes Mitglied zunächst nur unter der
 * groben Alterklasse als Platzhalter-Position (siehe importTeilnehmer in teilnehmerController.js:
 * "Für Altersklassen ohne hinterlegte ... Gewichtsklassen ... dient dann das tatsächliche Gewicht
 * als Ad-hoc-Positionsbezeichnung"). jans U13-Team-Pools übernehmen als Positionsliste exakt die
 * Einzelwettkampf-Gewichtsklassen (siehe legeMannschaftsPoolAn in Phase 1c), decken sich also 1:1
 * mit der inzwischen echten Einzel-Gewichtsklasse jedes Mitglieds.
 */
export async function synchronisiereMannschaftsPositionen(baseUrl, request, turnierId, personen) {
    const teilnehmerResp = await request.get(`${baseUrl}/api/teilnehmer?turnierId=${turnierId}`);
    const teilnehmerListe = await teilnehmerResp.json();

    const mannschaftenResp = await request.get(`${baseUrl}/api/mannschaften?turnierId=${turnierId}`);
    const mannschaften = await mannschaftenResp.json();

    for (const person of personen.filter(p => p.imTeam)) {
        const teilnehmer = teilnehmerListe.find(t => t.vorname === person.vorname && t.nachname === person.nachname && t.verein === person.verein);
        if (!teilnehmer || !teilnehmer.gewichtsklasse) continue;

        for (const team of mannschaften) {
            const mitglied = (team.mitglieder || []).find(m => m.turnier_teilnehmer_id === teilnehmer.id);
            if (!mitglied) continue;

            const putResp = await request.put(`${baseUrl}/api/mannschaften/${team.id}/mitglieder/${mitglied.id}`, {
                data: { gewichtsklasse: teilnehmer.gewichtsklasse }
            });
            expect(putResp.ok(), await putResp.text()).toBeTruthy();
        }
    }
}
