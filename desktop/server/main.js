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
import net from 'net';
import os from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

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

function status(text) {
    if (startFenster && !startFenster.isDestroyed()) {
        startFenster.webContents.executeJavaScript(`document.getElementById('status').textContent = ${JSON.stringify(String(text).slice(0, 300))}`).catch(() => {});
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
    const eintraege = [
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
