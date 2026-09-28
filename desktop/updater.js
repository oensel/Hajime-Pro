// Selbst-Update des Desktop-Clients vor dem eigentlichen Start (Spec Desktop-Client Abschnitt 6):
// Version beim Server erfragen, bei Abweichung die Datei der eigenen Plattform laden, sha256 und
// Ed25519-Signatur prüfen, dann plattformspezifisch austauschen und neu starten. Jeder Fehler führt
// zum normalen Start der vorhandenen Version. `electron` wird nur dynamisch importiert, damit
// holeServerVersion und die Plattform-Bausteine per node:test prüfbar sind.
import { accessSync, chmodSync, constants, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs';
import { spawn, execFileSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { plattformSchluessel, entscheideUpdate, pruefeDatei } from './updateLogik.js';

const hier = path.dirname(fileURLToPath(import.meta.url));

export async function holeServerVersion(serverUrl, { timeoutMs = 3000 } = {}) {
    try {
        const r = await fetch(`${serverUrl}/api/client/version`, { signal: AbortSignal.timeout(timeoutMs) });
        if (!r.ok) return null;
        const vj = await r.json();
        return vj && typeof vj.version === 'string' ? vj : null;
    } catch {
        return null;
    }
}

async function ladeDatei(url, status) {
    const r = await fetch(url, { signal: AbortSignal.timeout(10 * 60 * 1000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const gesamt = Number(r.headers.get('content-length')) || 0;
    const teile = [];
    let geladen = 0;
    for await (const teil of r.body) {
        teile.push(teil);
        geladen += teil.length;
        if (gesamt) status(`Lade Update … ${Math.round(geladen / gesamt * 100)} %`);
    }
    return Buffer.concat(teile);
}

// Startet ein Programm losgelöst und wartet, bis es wirklich läuft — schlägt der Start fehl (fehlt,
// nicht ausführbar), wirft das, bevor die alte Version sich beendet.
export function starteLoesgeloest(befehl, args, optionen = {}) {
    return new Promise((resolve, reject) => {
        const kind = spawn(befehl, args, { detached: true, stdio: 'ignore', ...optionen });
        kind.once('error', reject);
        kind.once('spawn', () => { kind.unref(); resolve(); });
    });
}

// macOS: .app-Bundle-Pfad aus dem Programmpfad (…/Hajime Pro.app/Contents/MacOS/Hajime Pro).
function macAppPfad() {
    return path.resolve(process.execPath, '../../..');
}

function macAustauschbar(appPfad) {
    if (appPfad.startsWith('/Volumes/') || appPfad.includes('/AppTranslocation/')) return false;
    try { accessSync(path.dirname(appPfad), constants.W_OK); return true; } catch { return false; }
}

// Shell-Befehl für den Bundle-Tausch nach Ende des laufenden Prozesses. Pfade gehen als
// Positionsparameter hinein (keine Quoting-Probleme). Das alte Bundle wird erst beiseitegelegt und
// nur bei erfolgreichem Einsetzen des neuen gelöscht, sonst zurückgeholt — danach wird in jedem Fall
// das Bundle am alten Pfad geöffnet.
export function macAustauschBefehl({ pid, appPfad, neu, oeffnen = 'open' }) {
    const skript = 'while kill -0 "$1" 2>/dev/null; do sleep 0.2; done; ' +
        'alt="$2.alt-$$"; ' +
        'if mv "$2" "$alt"; then if mv "$3" "$2"; then rm -rf "$alt"; else mv "$alt" "$2"; fi; fi; ' +
        `${oeffnen} "$2"`;
    return ['/bin/sh', ['-c', skript, 'sh', String(pid), appPfad, neu]];
}

export function linuxUmgebung(env) {
    const ergebnis = { ...env };
    for (const v of ['APPIMAGE', 'APPDIR', 'OWD', 'ARGV0']) delete ergebnis[v];
    return ergebnis;
}

// Linux: neue AppImage neben die alte kopieren (der Download liegt im Profil, evtl. auf einem anderen
// Dateisystem) und atomar umbenennen — die laufende Datei bleibt bis zum Prozessende gültig.
export function tauscheAppImage({ quelle, ziel }) {
    const neu = `${ziel}.neu`;
    copyFileSync(quelle, neu);
    chmodSync(neu, 0o755);
    renameSync(neu, ziel);
    rmSync(quelle, { force: true });
}

async function tauscheAus({ app, plattform, datei }) {
    if (plattform === 'win32-x64') {
        // NSIS still installieren (pro Benutzer, ohne Admin); --force-run startet danach die neue Version.
        await starteLoesgeloest(datei, ['/S', '--force-run']);
        app.quit();
        return;
    }
    if (plattform === 'darwin-universal') {
        const appPfad = macAppPfad();
        const entpackt = `${datei}-entpackt`;
        rmSync(entpackt, { recursive: true, force: true });
        execFileSync('ditto', ['-x', '-k', datei, entpackt]);
        const bundles = readdirSync(entpackt).filter(n => n.endsWith('.app'));
        const name = bundles.includes(path.basename(appPfad)) ? path.basename(appPfad) : bundles[0];
        if (!name) throw new Error('Kein .app-Bundle im Update-Archiv');
        const [befehl, args] = macAustauschBefehl({ pid: process.pid, appPfad, neu: path.join(entpackt, name) });
        await starteLoesgeloest(befehl, args);
        app.quit();
        return;
    }
    const ziel = process.env.APPIMAGE;
    tauscheAppImage({ quelle: datei, ziel });
    await starteLoesgeloest(ziel, [], { env: linuxUmgebung(process.env) });
    app.quit();
}

function linuxAustauschbar(appImage) {
    if (!appImage) return false;
    try { accessSync(path.dirname(appImage), constants.W_OK); return true; } catch { return false; }
}

async function pruefeUndAktualisiereIntern({ serverUrl, einstellungen, status, app, schluesselPfad, tausche }) {
    const eigeneVersion = app.getVersion();
    const werte = einstellungen.lade();
    // Erster Start nach erfolgreichem Update: Versuchszähler der jetzt laufenden Version löschen.
    if (werte.updateVersuche[eigeneVersion]) {
        const { [eigeneVersion]: _erledigt, ...rest } = werte.updateVersuche;
        einstellungen.speichere({ updateVersuche: rest });
    }
    // Heruntergeladene Update-Dateien früherer Starts (Installer ~130 MB) sind jetzt überflüssig.
    try { rmSync(path.join(app.getPath('userData'), 'updates'), { recursive: true, force: true }); } catch { /* belegt – nächster Start */ }
    if (!app.isPackaged) return 'weiter'; // Entwicklungsstart: nie selbst ersetzen

    status('Prüfe auf Updates …');
    const vj = await holeServerVersion(serverUrl);
    const entscheidung = entscheideUpdate({ eigeneVersion, serverVersion: vj && vj.version, versuche: einstellungen.lade().updateVersuche });
    if (entscheidung === 'kein') return 'weiter';
    if (entscheidung === 'aufgegeben') {
        console.warn(`[Update] Update auf ${vj.version} mehrfach fehlgeschlagen – starte ${eigeneVersion}.`);
        status(`Update auf ${vj.version} mehrfach fehlgeschlagen – starte Version ${eigeneVersion}.`);
        process.env.HAJIME_UPDATE_HINWEIS = `Update auf ${vj.version} fehlgeschlagen – bitte Client neu installieren (turnier.local/download).`;
        return 'weiter';
    }
    const plattform = plattformSchluessel(process.platform, process.arch);
    const eintrag = plattform && vj.dateien && vj.dateien[plattform] && vj.dateien[plattform].aktualisieren;
    if (!eintrag) {
        console.warn(`[Update] Server bietet ${vj.version}, aber keine Datei für ${plattform || process.platform}.`);
        return 'weiter';
    }
    // Umgebungsprüfungen nur für den echten Austausch (Tests ersetzen tauscheAus).
    if (tausche === tauscheAus) {
        if (plattform === 'darwin-universal' && !macAustauschbar(macAppPfad())) {
            status('Update nicht möglich: Bitte „Hajime Pro“ in den Ordner Programme verschieben.');
            await new Promise(r => setTimeout(r, 4000));
            return 'weiter';
        }
        if (plattform === 'linux-x64' && !linuxAustauschbar(process.env.APPIMAGE)) return 'weiter';
    }
    if (!existsSync(schluesselPfad)) {
        console.error(`[Update] Öffentlicher Schlüssel fehlt (${schluesselPfad}) – Update auf ${vj.version} nicht prüfbar.`);
        return 'weiter';
    }

    const versuche = einstellungen.lade().updateVersuche;
    einstellungen.speichere({ updateVersuche: { ...versuche, [vj.version]: (versuche[vj.version] || 0) + 1 } });
    try {
        const puffer = await ladeDatei(`${serverUrl}/downloads/${encodeURIComponent(vj.version)}/${encodeURIComponent(eintrag.datei)}`, status);
        const schluessel = readFileSync(schluesselPfad, 'utf8');
        const pruefung = pruefeDatei({ puffer, eintrag, version: vj.version, oeffentlicherSchluessel: schluessel });
        if (!pruefung.ok) {
            console.error(`[Update] ${eintrag.datei} verworfen (${pruefung.grund}).`);
            status(`Update verworfen (${pruefung.grund === 'sha256' ? 'unvollständig' : 'Signatur ungültig'}) – starte Version ${eigeneVersion}.`);
            return 'weiter';
        }
        const ordner = path.join(app.getPath('userData'), 'updates');
        mkdirSync(ordner, { recursive: true });
        const datei = path.join(ordner, path.basename(eintrag.datei));
        writeFileSync(datei, puffer);
        status(`Installiere Version ${vj.version} …`);
        await tausche({ app, plattform, datei });
        return 'neustart';
    } catch (err) {
        console.error('[Update] fehlgeschlagen:', err);
        status(`Update fehlgeschlagen (${err.message}) – starte Version ${eigeneVersion}.`);
        return 'weiter';
    }
}

// app/schluesselPfad/tauscheAus nur für Tests überschreibbar; main.js übergibt serverUrl,
// einstellungen und status. Wirft nie — im Zweifel startet die vorhandene Version.
export async function pruefeUndAktualisiere({ serverUrl, einstellungen, status, app, schluesselPfad, tauscheAus: tausche } = {}) {
    try {
        const electronApp = app || (await import('electron')).app;
        return await pruefeUndAktualisiereIntern({
            serverUrl, einstellungen, status, app: electronApp,
            schluesselPfad: schluesselPfad || path.join(hier, 'update-schluessel.pub'),
            tausche: tausche || tauscheAus
        });
    } catch (err) {
        console.error('[Update] Prüfung fehlgeschlagen:', err);
        return 'weiter';
    }
}
