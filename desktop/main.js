// Electron-Hauptprozess des Desktop-Clients (Spec Desktop-Client Abschnitte 3, 4): Server per mDNS
// suchen, ggf. selbst aktualisieren, einmalig koppeln, dann den bestehenden Client-Knoten
// (src/app.js mit SYNC_ROLLE=client) auf einem freien localhost-Port starten und client.html zeigen.
import { app, BrowserWindow, ipcMain, session, systemPreferences } from 'electron';
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

// --user-data-dir=<pfad> (Rauchtest, mehrere Profile auf einem Gerät) MUSS vor der ersten Nutzung
// von app.getPath('userData') wirken — auch vor der Einzelinstanz-Sperre, die an diesem Profil hängt.
const eigenesProfil = process.argv.find(a => a.startsWith('--user-data-dir='));
if (eigenesProfil) app.setPath('userData', eigenesProfil.slice('--user-data-dir='.length));

const einzigeInstanz = app.requestSingleInstanceLock();
if (!einzigeInstanz) app.quit();

let startFenster = null;
let hauptFenster = null;
const einstellungen = erzeugeEinstellungen(path.join(app.getPath('userData'), 'einstellungen.json'));

function status(text) {
    if (startFenster && !startFenster.isDestroyed()) startFenster.webContents.send('status', text);
}

function freierPort() {
    return new Promise((resolve, reject) => {
        const s = net.createServer();
        s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
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

// Kopplung: zeigt das Formular im Start-Fenster und löst auf, sobald der Server einen Code akzeptiert.
function koppeln(serverUrl, grund) {
    return new Promise((resolve) => {
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
                if (!r.ok) return { ok: false, fehler: 'Code falsch.' };
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
        PORT: String(port)
    });
    const { app: expressApp } = await import(pathToFileURL(path.join(hier, '../src/app.js')).href);
    const basis = `http://localhost:${port}`;
    await warteAufServer(`${basis}/client.html`);
    return { basis, clientDienst: () => expressApp.get('sync') };
}

// Im Betrieb: fehlt der Server > 10 s, neu suchen (Master-Wechsel); lehnt er das Geheimnis ab,
// einmalig neu koppeln.
function ueberwache(clientDienst) {
    let wegSeit = null;
    let kopplungLaeuft = false;
    setInterval(async () => {
        const dienst = clientDienst();
        if (!dienst) return;
        if (dienst.replikation.status().abgelehnt && !kopplungLaeuft) {
            kopplungLaeuft = true;
            const url = einstellungen.lade().serverUrl;
            await zeigeStartFenster();
            const secret = await koppeln(url, 'Der Server hat die Kopplung nicht angenommen (neuer Server oder Code erneuert). Bitte neuen Code eingeben:');
            await dienst.setzeVerbindung({ secret });
            startFenster.close();
            kopplungLaeuft = false;
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
    }, UEBERWACHUNG_MS).unref();
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
    session.defaultSession.setPermissionRequestHandler((_wc, recht, cb) => cb(recht === 'media'));
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
        await koppeln(gefunden.url);
        werte = einstellungen.lade();
    }

    status('Starte …');
    const { basis, clientDienst } = await starteClientKnoten({ serverUrl: werte.serverUrl, secret: werte.secret });
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
