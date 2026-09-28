// Electron-Hauptprozess des Desktop-Clients (Spec Desktop-Client Abschnitte 3, 4): Server per mDNS
// suchen, ggf. selbst aktualisieren, einmalig koppeln, dann den bestehenden Client-Knoten
// (src/app.js mit SYNC_ROLLE=client) auf einem freien localhost-Port starten und client.html zeigen.
import { app, BrowserWindow, ipcMain, session, shell, systemPreferences } from 'electron';
import net from 'net';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { erzeugeEinstellungen } from './einstellungen.js';
import { sucheServer } from './serverSuche.js';
import { pruefeUndAktualisiere } from './updater.js';
import { richteLinuxIntegrationEin } from './linuxIntegration.js';

const hier = path.dirname(fileURLToPath(import.meta.url));
const VERBINDUNG_WEG_MS = 10000;
const UEBERWACHUNG_MS = 5000;
// Nach einer vom Nutzer abgebrochenen Neukopplung (Start-Fenster geschlossen) erst nach dieser Zeit
// erneut fragen, statt das Fenster alle 5 s wieder aufzureißen.
const KOPPLUNG_PAUSE_MS = 60000;
// Der Client-Knoten lauscht nur auf der Loopback-Adresse (nicht im Hallen-WLAN erreichbar).
const LOKALER_HOST = '127.0.0.1';

// --user-data-dir=<pfad> (Rauchtest, mehrere Profile auf einem Gerät) MUSS vor der ersten Nutzung
// von app.getPath('userData') wirken — auch vor der Einzelinstanz-Sperre, die an diesem Profil hängt.
const eigenesProfil = process.argv.find(a => a.startsWith('--user-data-dir='));
if (eigenesProfil) app.setPath('userData', eigenesProfil.slice('--user-data-dir='.length));

const einzigeInstanz = app.requestSingleInstanceLock();
if (!einzigeInstanz) app.quit();

let startFenster = null;
let hauptFenster = null;
let lokaleOrigin = null; // http://127.0.0.1:<port>, sobald der Client-Knoten läuft
const einstellungen = erzeugeEinstellungen(path.join(app.getPath('userData'), 'einstellungen.json'));

function status(text) {
    if (startFenster && !startFenster.isDestroyed()) startFenster.webContents.send('status', text);
}

function freierPort() {
    return new Promise((resolve, reject) => {
        const s = net.createServer();
        s.listen(0, LOKALER_HOST, () => { const { port } = s.address(); s.close(() => resolve(port)); });
        s.on('error', reject);
    });
}

async function warteAufServer(url, maxMs = 30000) {
    const ende = Date.now() + maxMs;
    while (Date.now() < ende) {
        try { if ((await fetch(url)).ok) return; } catch { /* startet noch */ }
        await new Promise(r => setTimeout(r, 200));
    }
    throw new Error('Lokaler Client-Dienst startet nicht.');
}

// Kopplung: zeigt das Formular im Start-Fenster und löst mit dem Geheimnis auf, sobald der Server
// einen Code akzeptiert — oder mit null, wenn der Nutzer das Start-Fenster vorher schließt.
function koppeln(serverUrl, grund) {
    return new Promise((resolve) => {
        startFenster.once('closed', () => { ipcMain.removeHandler('koppeln'); resolve(null); });
        ipcMain.removeHandler('koppeln');
        ipcMain.handle('koppeln', async (_e, code) => {
            try {
                const r = await fetch(`${serverUrl}/api/client/koppeln`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ code, clientId: einstellungen.lade().clientId }),
                    signal: AbortSignal.timeout(5000)
                });
                const daten = await r.json().catch(() => ({}));
                if (r.status === 429) return { ok: false, fehler: `Zu viele Fehlversuche – bitte ${daten.restSekunden} s warten.` };
                if (r.status === 401) return { ok: false, fehler: 'Code falsch.' };
                if (!r.ok || !daten.secret) return { ok: false, fehler: `Server antwortet nicht wie erwartet (HTTP ${r.status}).` };
                einstellungen.speichere({ secret: daten.secret, serverUrl });
                resolve(daten.secret);
                return { ok: true };
            } catch {
                return { ok: false, fehler: 'Server nicht erreichbar.' };
            }
        });
        startFenster.webContents.send('kopplung-noetig', grund || '');
    });
}

async function starteClientKnoten({ serverUrl, secret }) {
    const port = await freierPort();
    Object.assign(process.env, {
        SYNC_ROLLE: 'client',
        SYNC_SERVER_URL: serverUrl || 'http://127.0.0.1:9', // ohne bekannte Adresse: offline, bis die Suche einen Server findet
        SYNC_SECRET: secret || '',
        SYNC_DATENVERZEICHNIS: path.join(app.getPath('userData'), 'dokumente'),
        PORT: String(port),
        LISTEN_HOST: LOKALER_HOST
    });
    const { app: expressApp } = await import(pathToFileURL(path.join(hier, '../src/app.js')).href);
    const basis = `http://${LOKALER_HOST}:${port}`;
    await warteAufServer(`${basis}/client.html`);
    return { basis, clientDienst: () => expressApp.get('sync') };
}

// Im Betrieb: fehlt der Server > 10 s, neu suchen (Master-Wechsel); lehnt er das Geheimnis ab,
// einmalig neu koppeln.
function ueberwache(clientDienst) {
    let wegSeit = null;
    let laeuft = false; // vorheriger Durchlauf (Suche/Kopplung) noch nicht fertig -> Tick auslassen
    let kopplungPauseBis = 0;

    async function neuKoppeln(dienst) {
        const url = einstellungen.lade().serverUrl;
        await zeigeStartFenster();
        const secret = await koppeln(url, 'Der Server hat die Kopplung nicht angenommen (neuer Server oder Code erneuert). Bitte neuen Code eingeben:');
        if (!secret) { // Nutzer hat das Start-Fenster geschlossen
            kopplungPauseBis = Date.now() + KOPPLUNG_PAUSE_MS;
            return;
        }
        if (startFenster && !startFenster.isDestroyed()) startFenster.close();
        await dienst.setzeVerbindung({ secret });
    }

    async function durchlauf() {
        const dienst = clientDienst();
        if (!dienst) return;
        if (dienst.replikation.status().abgelehnt) {
            if (Date.now() >= kopplungPauseBis) await neuKoppeln(dienst);
            return;
        }
        if (dienst.zustand.serverErreichbar) { wegSeit = null; return; }
        wegSeit = wegSeit || Date.now();
        if (Date.now() - wegSeit < VERBINDUNG_WEG_MS) return;
        const gefunden = await sucheServer({ timeoutMs: 3000 });
        if (gefunden && gefunden.url !== einstellungen.lade().serverUrl) {
            einstellungen.speichere({ serverUrl: gefunden.url });
            await dienst.setzeVerbindung({ serverUrl: gefunden.url });
            wegSeit = null;
        }
    }

    setInterval(async () => {
        if (laeuft) return;
        laeuft = true;
        try {
            await durchlauf();
        } catch (err) {
            console.error('[Desktop] Überwachung fehlgeschlagen:', err);
        } finally {
            laeuft = false;
        }
    }, UEBERWACHUNG_MS).unref();
}

// Alle Fenster bleiben auf der lokalen Oberfläche: Navigation nur innerhalb von lokaleOrigin, neue
// Fenster nur für lokale Seiten (kampf.js öffnet steuerung.html per window.open), externe
// http(s)-Links im System-Browser, alles andere wird verweigert.
function istLokal(url) {
    try { return !!lokaleOrigin && new URL(url).origin === lokaleOrigin; } catch { return false; }
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
    session.defaultSession.setPermissionCheckHandler((_wc, recht, origin) => {
        if (recht === 'media') return istLokal(origin);
        return true; // übrige Prüfungen wie Electron-Standard
    });
}

function zeigeStartFenster() {
    startFenster = new BrowserWindow({
        width: 480, height: 420, resizable: false, title: 'Hajime Pro',
        webPreferences: { preload: path.join(hier, 'fenster/preload.cjs') }
    });
    startFenster.setMenuBarVisibility(false);
    return startFenster.loadFile(path.join(hier, 'fenster/start.html'));
}

async function start() {
    sichereFenster();
    if (process.platform === 'darwin') systemPreferences.askForMediaAccess('camera').catch(() => {});
    if (process.platform === 'linux' && process.env.APPIMAGE) {
        richteLinuxIntegrationEin({ appImage: process.env.APPIMAGE, iconQuelle: path.join(hier, 'build/icon.png') });
    }
    await zeigeStartFenster();

    status('Suche Turnier-Server …');
    let gefunden = await sucheServer({ timeoutMs: 5000 });
    let werte = einstellungen.lade();
    if (gefunden) werte = einstellungen.speichere({ serverUrl: gefunden.url });

    if (gefunden) {
        const ergebnis = await pruefeUndAktualisiere({ serverUrl: gefunden.url, einstellungen, status });
        if (ergebnis === 'neustart') return; // der Updater beendet die App
    }

    while (!werte.secret) {
        if (!gefunden) {
            status('Kein Turnier-Server gefunden – WLAN prüfen. Suche weiter …');
            gefunden = await sucheServer({ timeoutMs: 5000 });
            if (gefunden) werte = einstellungen.speichere({ serverUrl: gefunden.url });
            continue;
        }
        status(`Server gefunden: ${gefunden.url}`);
        if (!await koppeln(gefunden.url)) return; // Start-Fenster geschlossen -> App endet
        werte = einstellungen.lade();
    }

    status('Starte …');
    const { basis, clientDienst } = await starteClientKnoten({ serverUrl: werte.serverUrl, secret: werte.secret });
    lokaleOrigin = basis;
    hauptFenster = new BrowserWindow({ width: 1280, height: 860, title: 'Hajime Pro', show: false });
    hauptFenster.setMenuBarVisibility(false);
    await hauptFenster.loadURL(`${basis}/client.html`);
    hauptFenster.maximize();
    hauptFenster.show();
    startFenster.close();
    ueberwache(clientDienst);
}

// Zweite Instanz desselben Profils: beendet sich oben per app.quit() und startet hier nichts.
if (einzigeInstanz) {
    app.on('second-instance', () => { if (hauptFenster) { hauptFenster.restore(); hauptFenster.focus(); } });
    app.on('window-all-closed', () => app.quit());
    app.whenReady().then(start).catch((err) => {
        console.error(err);
        status(`Fehler beim Start: ${err.message}`);
    });
}
