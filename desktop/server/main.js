// Electron-Hauptprozess des Server-Pakets "Hajime Pro Server": ein Notebook (Windows, macOS oder Linux) als
// Hallen-Server und Frontend in einem. Startet src/app.js im Modus server — mit eigenem, eingebettetem
// PostgreSQL (nichts zu installieren) — und zeigt das Frontend des laufenden Servers in einem Fenster.
//
//  - Alle Daten liegen im Profilordner der App (pg/, dokumente/, client-downloads/).
//  - Der Server ist im Netzwerk erreichbar (mDNS turnier.local, andere Clients holen sich über /download
//    den Client-Installer) UND läuft ohne jedes Netzwerk (der Browser dieser App spricht über localhost).
//  - Wird das Fenster geschlossen, läuft der Server im Tray weiter (Clients im LAN brauchen ihn);
//    "Beenden" stoppt Server und Datenbank sauber.
import { app, BrowserWindow, Menu, Tray, dialog, nativeImage, session, shell } from 'electron';
import { spawn } from 'child_process';
import { accessSync, constants, readFileSync } from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { merkeVersuch, pruefeUndLade } from './selbstUpdate.js';
import { baueInstallFensterBefehl } from './installFenster.js';
import { starteLoesgeloest, startBefehl, tauscheAppImage } from '../updater.js';
import { MELDUNG, ladeText } from '../../src/shared/updateAnzeige.js';

const hier = path.dirname(fileURLToPath(import.meta.url));
const WURZEL = path.resolve(hier, '../..');
const STANDARD_PORT = 3000;
const STANDARD_DB_PORT = 5433;

// --user-data-dir=<pfad> (Rauchtest, mehrere Profile) MUSS vor der ersten Nutzung von app.getPath('userData') wirken.
const eigenesProfil = process.argv.find(a => a.startsWith('--user-data-dir='));
if (eigenesProfil) app.setPath('userData', eigenesProfil.slice('--user-data-dir='.length));

const einzigeInstanz = app.requestSingleInstanceLock();
if (!einzigeInstanz) app.quit();

let startFenster = null;
let hauptFenster = null;
let tray = null;
let beenden = false;
let origin = null; // http://localhost:<port>, sobald der Server läuft
let port = null;
let stoppeDatenbanken = () => {};

// ---------------------------------------------------------------------------------------------
// Hilfen
// ---------------------------------------------------------------------------------------------
function istFrei(p, host) {
    return new Promise((resolve) => {
        const s = net.createServer();
        s.once('error', () => resolve(false));
        s.listen(p, host, () => s.close(() => resolve(true)));
    });
}

async function ersterFreierPort(ab, host, maxVersuche = 60) {
    for (let p = ab; p < ab + maxVersuche; p++) {
        if (await istFrei(p, host)) return p;
    }
    throw new Error(`Kein freier Port ab ${ab} gefunden.`);
}

async function warteAufServer(url, maxMs = 120000) {
    const ende = Date.now() + maxMs;
    while (Date.now() < ende) {
        try { if ((await fetch(url)).ok) return; } catch { /* startet noch */ }
        await new Promise(r => setTimeout(r, 250));
    }
    throw new Error('Der Server startet nicht.');
}

// anteil (0..1): Fortschrittsbalken im Start-Fenster (Download des Updates); null blendet ihn aus.
function status(text, anteil = null) {
    if (startFenster && !startFenster.isDestroyed()) {
        const skript = `document.getElementById('status').textContent = ${JSON.stringify(String(text).slice(0, 300))};` +
            `var b = document.getElementById('fortschritt'); if (b) { b.hidden = ${typeof anteil === 'number' ? 'false' : 'true'}; b.value = ${typeof anteil === 'number' ? anteil : 0}; }`;
        startFenster.webContents.executeJavaScript(skript).catch(() => {});
    }
}

function lokaleAdressen() {
    const adressen = [];
    for (const eintraege of Object.values(os.networkInterfaces())) {
        for (const e of eintraege || []) {
            if ((e.family === 'IPv4' || e.family === 4) && !e.internal) adressen.push(e.address);
        }
    }
    return adressen;
}

function datenverzeichnis() {
    return app.getPath('userData');
}

// ---------------------------------------------------------------------------------------------
// Sicherheit: Fenster bleiben auf der lokalen Oberfläche (wie im Desktop-Client)
// ---------------------------------------------------------------------------------------------
function istLokal(url) {
    try { return !!origin && new URL(url).origin === origin; } catch { return false; }
}

function oeffneExtern(url) {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url).catch(() => {});
}

function sichereFenster() {
    app.on('web-contents-created', (_e, wc) => {
        wc.on('will-navigate', (e, url) => {
            if (istLokal(url)) return;
            e.preventDefault();
            oeffneExtern(url);
        });
        wc.setWindowOpenHandler(({ url }) => {
            if (istLokal(url)) return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true } };
            oeffneExtern(url);
            return { action: 'deny' };
        });
    });
    // Kamera (Waage, Judopass-QR) nur für die lokale Oberfläche.
    session.defaultSession.setPermissionRequestHandler((wc, recht, cb, details) => {
        cb(recht === 'media' && istLokal((details && details.requestingUrl) || wc.getURL()));
    });
    session.defaultSession.setPermissionCheckHandler((_wc, recht, herkunft) => {
        if (recht === 'media') return istLokal(herkunft);
        return true;
    });
}

// ---------------------------------------------------------------------------------------------
// Server starten
// ---------------------------------------------------------------------------------------------
class StartAbbruch extends Error {
    constructor(code) { super(`Start abgebrochen (Exit-Code ${code})`); this.code = code; }
}

// app.js beendet sich bei Konfigurations- oder Datenbankfehlern mit process.exit(1) und schreibt die Ursache nach
// console.error. Im Electron-Hauptprozess würde das die App kommentarlos schließen: stattdessen den Abbruch als
// Fehler werfen und die Meldungen für den Dialog sammeln. Nach dem Start wird alles wiederhergestellt.
async function importiereServer() {
    const original = { log: console.log, warn: console.warn, error: console.error, exit: process.exit };
    const fehlerZeilen = [];
    console.log = (...a) => { original.log(...a); status(a.join(' ').replace(/^\[[^\]]+\]\s*/, '')); };
    console.warn = (...a) => { original.warn(...a); };
    console.error = (...a) => { original.error(...a); fehlerZeilen.push(a.join(' ')); };
    process.exit = (code) => { throw new StartAbbruch(code); };
    try {
        const { app: expressApp } = await import(pathToFileURL(path.join(WURZEL, 'src/app.js')).href);
        return expressApp;
    } catch (e) {
        if (e instanceof StartAbbruch) {
            throw new Error(fehlerZeilen.join('\n') || 'Der Server konnte nicht gestartet werden.');
        }
        throw e;
    } finally {
        Object.assign(console, { log: original.log, warn: original.warn, error: original.error });
        process.exit = original.exit;
    }
}

async function starteServer() {
    const wunschPort = Number(process.env.HAJIME_PORT) || STANDARD_PORT;
    port = await ersterFreierPort(wunschPort, '0.0.0.0');
    const dbPort = await ersterFreierPort(Number(process.env.HAJIME_DB_PORT) || STANDARD_DB_PORT, '127.0.0.1');
    const basis = datenverzeichnis();
    // Alte/fremde Einstellungen aus der Umgebung dürfen den Betriebsmodus nicht verbiegen.
    Object.assign(process.env, {
        BETRIEBSMODUS: 'server',
        IS_OFFLINE: '', SYNC_ROLLE: '', DB_CLIENT: '', DB_HOST: '', LISTEN_HOST: '', CLUSTER_KNOTEN: '',
        PORT: String(port),
        DB_PORT: String(dbPort),
        DB_NAME: 'hajime',
        PG_DATENVERZEICHNIS: path.join(basis, 'pg'),
        SYNC_DATENVERZEICHNIS: path.join(basis, 'dokumente'),
        CLIENT_DOWNLOADS_VERZEICHNIS: path.join(basis, 'client-downloads'),
        // Im Installer mitgelieferte, signierte Client-Dateien (extraResources, siehe electron-builder.server.yml).
        CLIENT_DATEIEN_MITGELIEFERT: app.isPackaged ? path.join(process.resourcesPath, 'client-dateien') : ''
    });
    status('Starte Datenbank und Server …');
    const expressApp = await importiereServer();
    const { stoppeAlleEingebetteten } = await import(pathToFileURL(path.join(WURZEL, 'src/utils/eingebettetesPostgres.js')).href);
    stoppeDatenbanken = () => stoppeAlleEingebetteten('fast');
    await warteAufServer(`http://127.0.0.1:${port}/api/config`);
    origin = `http://localhost:${port}`;
    return expressApp;
}

// ---------------------------------------------------------------------------------------------
// Selbst-Update (nur Windows, nur installierte App)
// ---------------------------------------------------------------------------------------------
// Beim START (vor Datenbank und Server, im Start-Fenster): "Suche nach Updates …", bei einer NEUEREN Version im neuesten
// GitHub-Release "Hole Update … aus git" mit Fortschrittsbalken (der signierte Installer ist über 600 MB groß; ein
// abgebrochener Download wird später fortgesetzt), dann ein Hinweis im Fenster (kein Dialog) und die Installation, die den
// Server beendet und neu startet. Danach, im Hintergrund bei laufendem Server: erneute Suche stündlich; ein dann
// geladenes Update wird NICHT mitten im Betrieb installiert, sondern beim nächsten Start (oder per Menü "Server").
// Ohne Internet/ohne Neueres/bei Fehlern startet der Server einfach; ein neuer Versuch folgt später.
// Abschalten: HAJIME_SELBSTUPDATE=false. Privates Repository: CLIENT_RELEASE_TOKEN oder "token" in <Profilordner>/update.json.
const UPDATE_WIEDERHOLUNG_MS = 10 * 60 * 1000; // nach unterbrochenem Download
const UPDATE_PRUEFUNG_MS = 60 * 60 * 1000;     // erneute Suche, z.B. wenn beim Start noch kein Internet da war
let updateStatus = { text: '', version: null, datei: null };
let updateLaeuft = false;
let updateTimer = null;

// Windows: NSIS-Installer; Linux: die laufende AppImage wird ersetzt (nur wenn ihr Ordner beschreibbar ist).
function plattformUnterstuetzt() {
    if (process.platform === 'win32') return true;
    if (process.platform === 'linux' && process.env.APPIMAGE) {
        try { accessSync(path.dirname(process.env.APPIMAGE), constants.W_OK); return true; } catch { return false; }
    }
    return false;
}

function selbstUpdateAktiv() {
    return app.isPackaged && plattformUnterstuetzt() && !eigenesProfil && process.env.HAJIME_SELBSTUPDATE !== 'false';
}

function liesUpdateKonfig() {
    try { return JSON.parse(readFileSync(path.join(datenverzeichnis(), 'update.json'), 'utf8')) || {}; } catch { return {}; }
}

function aktualisiereMenues() {
    if (tray) tray.setContextMenu(baueMenue().trayMenue);
    if (hauptFenster && !hauptFenster.isDestroyed()) hauptFenster.setMenu(baueMenue().dateiMenue);
}

function setzeUpdateStatus(text, zusatz = {}) {
    updateStatus = { text, version: null, datei: null, ...zusatz };
    if (text) console.log(`[Selbst-Update] ${text}`);
    if (tray) tray.setToolTip(text ? `Hajime Pro Server – ${text}` : 'Hajime Pro Server');
    aktualisiereMenues();
}

function planeUpdatePruefung(ms) {
    clearTimeout(updateTimer);
    if (beenden) return;
    updateTimer = setTimeout(() => { pruefeSelbstUpdate().catch(() => {}); }, ms);
    if (updateTimer.unref) updateTimer.unref();
}

const mb = (bytes) => Math.round(bytes / 1048576);

// beiStart: Aufruf vor dem Serverstart — Meldungen und Fortschritt erscheinen im Start-Fenster, Rückgabe 'bereit', wenn
// ein geprüftes Update installiert werden soll. Sonst (Hintergrund) nur Tray/Menü, nie eine automatische Installation.
async function pruefeSelbstUpdate({ manuell = false, beiStart = false } = {}) {
    if (!selbstUpdateAktiv() || updateLaeuft || beenden) return null;
    updateLaeuft = true;
    clearTimeout(updateTimer);
    aktualisiereMenues();
    const konfig = liesUpdateKonfig();
    const versuchsDatei = path.join(datenverzeichnis(), 'selbstupdate.json');
    const zeige = (text, anteil = null) => { if (beiStart) status(text, anteil); };
    zeige(MELDUNG.suche);
    let letzteAnzeige = 0;
    let holeMeldung = false;
    let ergebnis;
    try {
        const { liesOeffentlichenSchluessel } = await import(pathToFileURL(path.join(WURZEL, 'src/sync/clientDateien.js')).href);
        ergebnis = await pruefeUndLade({
            repo: process.env.CLIENT_RELEASE_REPO || konfig.repo || 'oensel/Hajime-Pro',
            token: process.env.CLIENT_RELEASE_TOKEN || konfig.token || '',
            aktuelleVersion: app.getVersion(),
            schluessel: liesOeffentlichenSchluessel(),
            ...(process.env.HAJIME_RELEASE_API ? { apiBasis: process.env.HAJIME_RELEASE_API } : {}), // nur für Tests gegen ein Release-Double
            zielVerzeichnis: path.join(datenverzeichnis(), 'updates'),
            versuchsDatei,
            beiFortschritt: ({ version, geladen, gesamt }) => {
                if (!holeMeldung) { holeMeldung = true; console.log(`[Selbst-Update] ${MELDUNG.holeGit(version)}`); zeige(MELDUNG.holeGit(version), 0); }
                if (Date.now() - letzteAnzeige < 500) return;
                letzteAnzeige = Date.now();
                const text = gesamt
                    ? `Hole Update ${version} aus git … ${Math.floor(geladen / gesamt * 100)} % (${ladeText({ geladen, gesamt })})`
                    : `Hole Update ${version} aus git … ${ladeText({ geladen, gesamt })}`;
                if (beiStart) status(text, gesamt ? geladen / gesamt : null);
                else setzeUpdateStatus(text, { version });
            }
        });
    } catch (err) {
        ergebnis = { status: 'fehler', grund: err.message };
    } finally {
        updateLaeuft = false;
    }
    const meldung = (titel, detail) => { if (manuell) dialog.showMessageBox({ type: 'info', title: 'Hajime Pro Server', message: titel, detail, buttons: ['OK'] }); };
    switch (ergebnis.status) {
        case 'bereit':
            setzeUpdateStatus(beiStart
                ? `Version ${ergebnis.version} ist geladen`
                : `Version ${ergebnis.version} ist geladen – wird beim nächsten Start installiert (oder im Menü „Server“)`, { version: ergebnis.version, datei: ergebnis.datei });
            return 'bereit';
        case 'aktuell':
            zeige(MELDUNG.aktuell(app.getVersion()));
            setzeUpdateStatus('');
            meldung('Der Server ist auf dem neuesten Stand.', `Installierte Version: ${app.getVersion()}`);
            break;
        case 'keine-verbindung':
            if (ergebnis.version) {
                zeige(`Update ${ergebnis.version}: Download unterbrochen (${ergebnis.grund}) – starte Version ${app.getVersion()}, neuer Versuch später`);
                setzeUpdateStatus(`Update ${ergebnis.version}: Download unterbrochen (${ergebnis.grund}) – neuer Versuch in 10 Minuten`, { version: ergebnis.version });
                planeUpdatePruefung(UPDATE_WIEDERHOLUNG_MS);
                meldung('Das Update konnte nicht fertig geladen werden.', `${ergebnis.grund}\nDer Download wird später fortgesetzt.`);
                return ergebnis.status;
            }
            zeige(MELDUNG.keineVerbindung('GitHub', app.getVersion()));
            setzeUpdateStatus('');
            meldung('Keine Verbindung zu GitHub.', 'Es konnte nicht nach Updates gesucht werden.');
            break;
        case 'fehler':
            zeige(`Update fehlgeschlagen: ${ergebnis.grund} – starte Version ${app.getVersion()}`);
            setzeUpdateStatus(`Update ${ergebnis.version || ''} fehlgeschlagen: ${ergebnis.grund}`.replace('  ', ' '), { version: ergebnis.version || null });
            meldung('Das Update ist fehlgeschlagen.', ergebnis.grund);
            return ergebnis.status;
        case 'aufgegeben':
            zeige(`Update ${ergebnis.version} ist mehrfach fehlgeschlagen – starte Version ${app.getVersion()}`);
            setzeUpdateStatus(`Update ${ergebnis.version} wurde nach mehreren Versuchen nicht installiert – bitte den Installer von Hand ausführen`, { version: ergebnis.version });
            meldung('Das Update wurde nach mehreren Versuchen nicht installiert.', `Lade ${process.platform === 'win32' ? 'Hajime-Pro-Server-<Version>-win-x64.exe' : 'die neue AppImage'} aus dem GitHub-Release und installiere sie von Hand.`);
            return ergebnis.status;
        default:
            setzeUpdateStatus('');
    }
    planeUpdatePruefung(UPDATE_PRUEFUNG_MS);
    return ergebnis.status;
}

// Installation (Menü "Server" oder direkt nach dem Laden beim Start): erst ein kurzer Hinweis (Fenster bzw. Tray, kein
// Dialog), dann beendet sich der Server und wird vom Installer bzw. der neuen AppImage wieder gestartet.
async function installiereUpdate() {
    const { version, datei } = updateStatus;
    if (!datei) return;
    merkeVersuch(path.join(datenverzeichnis(), 'selbstupdate.json'), version);
    const hinweis = `Version ${version} wird installiert – ${MELDUNG.neustart(3)}`;
    setzeUpdateStatus(hinweis, { version });
    status(hinweis, null);
    await new Promise((r) => setTimeout(r, 3000));
    beenden = true;
    clearTimeout(updateTimer);
    await Promise.resolve(stoppeDatenbanken()).catch(() => {});
    if (process.platform === 'linux') {
        // Neue AppImage an die Stelle der laufenden kopieren (atomar umbenennen) und nach dem Ende dieses Prozesses starten.
        try {
            const ziel = process.env.APPIMAGE;
            tauscheAppImage({ quelle: datei, ziel });
            const [prog, args, optionen] = startBefehl({ plattform: 'linux-x64', appImage: ziel, env: process.env, pid: process.pid });
            await starteLoesgeloest(prog, args, optionen);
        } catch (err) {
            console.error('[Selbst-Update] Austausch der AppImage fehlgeschlagen:', err);
            // Der Server (und seine Datenbank) sind schon beendet: mit der vorhandenen Version neu starten, damit er nicht ausbleibt.
            app.relaunch({ execPath: process.env.APPIMAGE });
        }
        app.exit(0);
        return;
    }
    // Der Installer ersetzt die laufende App: sie muss dafür beendet sein. cmd wartet auf den (still laufenden, per UAC
    // erhöhten) Installer und startet die App danach in jedem Fall wieder — auch wenn die Installation scheitert oder
    // abgelehnt wird, soll der Server nicht ausbleiben. Läuft die neue Version schon, verwirft die Einzelinstanz-Sperre den Zweitstart.
    const befehl = `""${datei}" /S & start "" "${process.execPath}""`;
    const installation = spawn('cmd.exe', ['/d', '/s', '/c', befehl], { detached: true, stdio: 'ignore', windowsVerbatimArguments: true });
    installation.unref();
    // Die Installation dauert einige Minuten und läuft still: ein kleines Hajime-Fenster zeigt solange, dass installiert
    // wird, und schließt sich, sobald die cmd (Installer + Neustart der App) fertig ist. Fehlt es, läuft die Installation trotzdem.
    try {
        const { programm, args } = baueInstallFensterBefehl({ version, exePfad: process.execPath, wartePid: installation.pid });
        spawn(programm, args, { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    } catch (err) {
        console.error('[Selbst-Update] Installationsfenster nicht gestartet:', err);
    }
    app.exit(0);
}

// ---------------------------------------------------------------------------------------------
// Oberfläche
// ---------------------------------------------------------------------------------------------
function zeigeStartFenster() {
    startFenster = new BrowserWindow({ width: 460, height: 220, resizable: false, title: 'Hajime Pro Server', autoHideMenuBar: true });
    startFenster.setMenuBarVisibility(false);
    return startFenster.loadFile(path.join(hier, 'fenster/start.html'));
}

function verbindungsdaten() {
    const mdns = process.env.MDNS_NAME || 'turnier';
    const zeilen = [
        'Dieser Server ist erreichbar unter:',
        '',
        `  http://${mdns}.local   (Name im Hallennetz)`,
        ...lokaleAdressen().map(a => `  http://${a}:${port}`),
        `  http://localhost:${port}   (nur auf diesem Rechner)`,
        '',
        `Client-Installation für Matte und Waage: http://${mdns}.local/download`,
        '',
        `Datenordner: ${datenverzeichnis()}`
    ];
    return zeilen.join('\n');
}

function zeigeVerbindungsdaten() {
    dialog.showMessageBox(hauptFenster && !hauptFenster.isDestroyed() ? hauptFenster : undefined, {
        type: 'info', title: 'Verbindungsdaten', message: 'Hajime Pro Server', detail: verbindungsdaten(), buttons: ['OK']
    });
}

function oeffneFenster() {
    if (!hauptFenster || hauptFenster.isDestroyed()) {
        erzeugeHauptfenster().then(() => hauptFenster.show());
        return;
    }
    if (hauptFenster.isMinimized()) hauptFenster.restore();
    hauptFenster.show();
    hauptFenster.focus();
}

function beendeAlles() {
    beenden = true;
    app.quit();
}

function baueMenue() {
    const updateEintraege = [];
    if (updateStatus.text) updateEintraege.push({ label: updateStatus.text, enabled: false });
    if (updateStatus.datei && !beenden) updateEintraege.push({ label: `Version ${updateStatus.version} jetzt installieren …`, click: () => { installiereUpdate().catch(() => {}); } });
    else if (selbstUpdateAktiv()) updateEintraege.push({ label: 'Nach Updates suchen', enabled: !updateLaeuft, click: () => { pruefeSelbstUpdate({ manuell: true }).catch(() => {}); } });
    if (updateEintraege.length) updateEintraege.push({ type: 'separator' });
    const eintraege = [
        ...updateEintraege,
        { label: 'Verbindungsdaten …', click: zeigeVerbindungsdaten },
        { label: 'Datenordner öffnen', click: () => shell.openPath(datenverzeichnis()) },
        { type: 'separator' },
        { label: 'Server beenden', click: beendeAlles }
    ];
    return { dateiMenue: Menu.buildFromTemplate([{ label: 'Server', submenu: eintraege }]), trayMenue: Menu.buildFromTemplate([{ label: 'Fenster öffnen', click: oeffneFenster }, ...eintraege]) };
}

async function erzeugeHauptfenster() {
    hauptFenster = new BrowserWindow({ width: 1280, height: 860, title: 'Hajime Pro Server', show: false });
    hauptFenster.setMenu(baueMenue().dateiMenue);
    // Schließen = im Tray weiterlaufen (der Server wird von Clients im LAN gebraucht), außer beim Beenden.
    hauptFenster.on('close', (e) => {
        if (beenden || !tray) return;
        e.preventDefault();
        hauptFenster.hide();
    });
    await hauptFenster.loadURL(`${origin}/`);
}

function erzeugeTray() {
    try {
        const bild = nativeImage.createFromPath(path.join(WURZEL, 'desktop/build/icon.png')).resize({ width: 18, height: 18 });
        tray = new Tray(bild);
        tray.setToolTip('Hajime Pro Server');
        tray.setContextMenu(baueMenue().trayMenue);
        tray.on('click', oeffneFenster);
    } catch (e) {
        // Ohne Tray (z.B. Linux ohne Statusleiste) beendet das Schließen des Fensters den Server.
        console.warn(`[Server-App] Kein Tray verfügbar (${e.message}) – Fenster schließen beendet den Server.`);
        tray = null;
    }
}

async function start() {
    sichereFenster();
    await zeigeStartFenster();
    // Zuerst nach einem Update suchen (Meldungen und Fortschritt im Start-Fenster); ein geladenes Update wird gleich installiert.
    if (selbstUpdateAktiv()) {
        const erg = await pruefeSelbstUpdate({ beiStart: true }).catch((err) => { console.warn(`[Selbst-Update] Übersprungen: ${err.message}`); return null; });
        if (erg === 'bereit') { await installiereUpdate(); return; }
    }
    try {
        await starteServer();
    } catch (err) {
        console.error(err);
        if (startFenster && !startFenster.isDestroyed()) startFenster.close();
        dialog.showErrorBox('Hajime Pro Server konnte nicht starten', String(err.message || err).slice(0, 1500));
        beenden = true;
        app.exit(1);
        return;
    }
    erzeugeTray();
    await erzeugeHauptfenster();
    hauptFenster.maximize();
    hauptFenster.show();
    if (startFenster && !startFenster.isDestroyed()) startFenster.close();
    // Erst jetzt, im Hintergrund: der Server steht, das Update lädt nebenher (Fortschritt im Tray/Menü).
    pruefeSelbstUpdate().catch((err) => console.warn(`[Selbst-Update] Übersprungen: ${err.message}`));
}

if (einzigeInstanz) {
    app.on('second-instance', oeffneFenster);
    app.on('activate', () => { if (origin) oeffneFenster(); });
    // Fenster zu: Server läuft im Tray weiter. Ohne Tray (oder beim Beenden) endet die App.
    app.on('window-all-closed', () => { if (beenden || !tray) app.quit(); });
    app.on('before-quit', () => {
        beenden = true;
        stoppeDatenbanken();
    });
    app.whenReady().then(start).catch((err) => {
        console.error(err);
        dialog.showErrorBox('Hajime Pro Server', String(err.message || err));
        app.exit(1);
    });
}
