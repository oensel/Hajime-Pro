// Automatische Sicherung (nur Cloud): jeden Tag zur eingestellten Uhrzeit (Europe/Berlin) legt der Server eine Sicherung als
// auto-sicherung-<Zeit>.hajime-sicherung.gz im Sicherungsverzeichnis ab, kopiert sie auf Wunsch an einen anderen Ort und behält die
// letzten SICHERUNG_BEHALTEN (Standard 14). Der Stand des letzten Laufs steht in <Verzeichnis>/status.json (Anzeige auf sicherung.html).
//   SICHERUNG_AUTOMATISCH=false         schaltet den Zeitplan ab (Standard: an in der Cloud)
//   SICHERUNG_PASSWORT / SICHERUNG_PASSWORT_DATEI  verschlüsselt jede Sicherung (AES-256-GCM, mindestens 20 Zeichen, siehe sicherungsVerschluesselung.js)
//   SICHERUNG_UHRZEIT=03:00             Uhrzeit (Berlin) des täglichen Laufs
//   SICHERUNG_BEHALTEN=14               Anzahl der automatischen Sicherungen, die bleiben (auch im Kopie-Verzeichnis)
//   SICHERUNG_KOPIE_VERZEICHNIS=<Pfad>  zusätzliche Ablage, z. B. ein eingehängtes Netzlaufwerk oder eine Storage Box
//   SICHERUNG_NACH_BEFEHL=<Befehl>      läuft nach jeder Sicherung (Shell), mit HAJIME_SICHERUNG_DATEI/HAJIME_SICHERUNG_NAME in der
//                                       Umgebung, z. B. rclone, scp oder aws s3 cp; ein Fehlschlag steht als Fehler in der Konsole
// Fehler (Sicherung, Kopie, Befehl) gehen per console.error ins Fehlerprotokoll (Seite „Konsole“).
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { meldeInfo } from './fehlerProtokoll.js';
import { schreibeSicherungsdatei, listeSicherungsdateien, SicherungsFehler } from './datensicherung.js';

export const AUTO_PRAEFIX = 'auto-sicherung';
const BEFEHL_ZEITLIMIT_MS = 30 * 60_000;
const STATUS_DATEI = 'status.json';

export function leseSicherungsKonfig(env = process.env) {
    const uhrzeit = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(env.SICHERUNG_UHRZEIT || '').trim()) ? String(env.SICHERUNG_UHRZEIT).trim() : '03:00';
    return {
        automatisch: String(env.SICHERUNG_AUTOMATISCH ?? '').trim().toLowerCase() !== 'false',
        uhrzeit,
        behalte: Math.max(1, Math.floor(Number(env.SICHERUNG_BEHALTEN)) || 14),
        kopieVerzeichnis: String(env.SICHERUNG_KOPIE_VERZEICHNIS || '').trim(),
        nachBefehl: String(env.SICHERUNG_NACH_BEFEHL || '').trim()
    };
}

// --- Zeitplan (rein) ---
function berlinZeit(jetzt) {
    const teile = Object.fromEntries(new Intl.DateTimeFormat('de-DE', {
        timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(jetzt).map((t) => [t.type, t.value]));
    return { tag: `${teile.year}-${teile.month}-${teile.day}`, minuten: Number(teile.hour) * 60 + Number(teile.minute) };
}

/** Ist der tägliche Lauf fällig? (Uhrzeit erreicht und heute, nach Berliner Zeit, noch nicht gelaufen) */
export function istFaellig(jetzt, uhrzeit, letzterLauf) {
    const [h, m] = uhrzeit.split(':').map(Number);
    const jetztBerlin = berlinZeit(jetzt);
    if (jetztBerlin.minuten < h * 60 + m) return false;
    return !letzterLauf || berlinZeit(new Date(letzterLauf)).tag < jetztBerlin.tag;
}

// --- Status ---
export async function leseStatus(verzeichnis) {
    try {
        return JSON.parse(await fs.promises.readFile(path.join(verzeichnis, STATUS_DATEI), 'utf8'));
    } catch {
        return null;
    }
}

async function schreibeStatus(verzeichnis, status) {
    await fs.promises.mkdir(verzeichnis, { recursive: true, mode: 0o700 });
    await fs.promises.writeFile(path.join(verzeichnis, STATUS_DATEI), JSON.stringify(status, null, 2), { mode: 0o600 });
}

// --- Kopie und Befehl ---
async function bereinigeKopie(verzeichnis, behalte) {
    for (const datei of (await listeSicherungsdateien(verzeichnis)).filter((d) => d.name.startsWith(`${AUTO_PRAEFIX}-`)).slice(behalte)) {
        await fs.promises.rm(path.join(verzeichnis, datei.name), { force: true });
    }
}

async function kopiere(datei, zielVerzeichnis, behalte) {
    await fs.promises.mkdir(zielVerzeichnis, { recursive: true, mode: 0o700 });
    const ziel = path.join(zielVerzeichnis, datei.name);
    await fs.promises.copyFile(datei.pfad, `${ziel}.teil`);
    await fs.promises.rename(`${ziel}.teil`, ziel);
    await bereinigeKopie(zielVerzeichnis, behalte);
}

/** Führt den Befehl in der Shell aus; wirft bei Fehlschlag oder Zeitüberschreitung (mit dem Ende der Fehlerausgabe). */
export function fuehreBefehlAus(befehl, datei, { zeitlimitMs = BEFEHL_ZEITLIMIT_MS } = {}) {
    return new Promise((resolve, reject) => {
        const kind = spawn(befehl, {
            shell: true, env: { ...process.env, HAJIME_SICHERUNG_DATEI: datei.pfad, HAJIME_SICHERUNG_NAME: datei.name }
        });
        let ausgabe = '';
        const merke = (stueck) => { ausgabe = (ausgabe + stueck).slice(-1500); };
        kind.stdout.on('data', merke);
        kind.stderr.on('data', merke);
        const zeitgeber = setTimeout(() => { kind.kill(); reject(new Error(`Zeitüberschreitung nach ${Math.round(zeitlimitMs / 60000)} Minuten`)); }, zeitlimitMs);
        kind.on('error', (err) => { clearTimeout(zeitgeber); reject(err); });
        kind.on('close', (code) => {
            clearTimeout(zeitgeber);
            if (code === 0) resolve();
            else reject(new Error(`Exit-Code ${code}${ausgabe.trim() ? `: ${ausgabe.trim().split('\n').slice(-3).join(' | ')}` : ''}`));
        });
    });
}

/**
 * Sicherung + Kopie + Befehl; schreibt den Status. Wirft nur, wenn die Sicherung selbst scheitert (Kopie/Befehl: im Status und
 * als Fehler im Log). @returns {Promise<object>} der Status
 */
export async function fuehreAutomatischeSicherungAus(knex, verzeichnis, konfig, { befehlAusfuehren = fuehreBefehlAus } = {}) {
    const start = new Date();
    const status = { zeit: start.toISOString(), ok: false, name: null, groesse: null, verschluesselt: null, kopie: null, befehl: null, fehler: null };
    try {
        const datei = await schreibeSicherungsdatei(knex, verzeichnis, AUTO_PRAEFIX, { behalte: { [AUTO_PRAEFIX]: konfig.behalte } });
        status.name = datei.name;
        status.groesse = datei.groesse;
        status.verschluesselt = !!datei.verschluesselt;
        meldeInfo(`Automatische Sicherung abgeschlossen: ${datei.name} (${(datei.groesse / 1048576).toFixed(1).replace('.', ',')} MB, ${((Date.now() - start.getTime()) / 1000).toFixed(1).replace('.', ',')} s)`);
        if (konfig.kopieVerzeichnis) {
            try {
                await kopiere(datei, konfig.kopieVerzeichnis, konfig.behalte);
                status.kopie = { ok: true, ziel: konfig.kopieVerzeichnis };
                meldeInfo(`Kopie nach ${konfig.kopieVerzeichnis} erfolgreich`);
            } catch (err) {
                status.kopie = { ok: false, ziel: konfig.kopieVerzeichnis, fehler: err.message };
                console.error(`[Sicherung] Kopie nach ${konfig.kopieVerzeichnis} fehlgeschlagen:`, err.message);
            }
        }
        if (konfig.nachBefehl) {
            try {
                await befehlAusfuehren(konfig.nachBefehl, datei);
                status.befehl = { ok: true };
                meldeInfo('Befehl nach der Sicherung erfolgreich ausgeführt');
            } catch (err) {
                status.befehl = { ok: false, fehler: err.message };
                console.error('[Sicherung] Befehl nach der Sicherung fehlgeschlagen:', err.message);
            }
        }
        status.ok = (!status.kopie || status.kopie.ok) && (!status.befehl || status.befehl.ok);
    } catch (err) {
        status.fehler = err.message;
        if (!(err instanceof SicherungsFehler && err.status === 409)) console.error('[Sicherung] Automatische Sicherung fehlgeschlagen:', err.message);
        await schreibeStatus(verzeichnis, status).catch(() => {});
        throw err;
    }
    await schreibeStatus(verzeichnis, status).catch((err) => console.error('[Sicherung] Status nicht schreibbar:', err.message));
    return status;
}

/** Startet die minütliche Prüfung des Zeitplans. @returns {{ stop: () => void }} */
export function starteSicherungsPlaner(knex, verzeichnis, konfig, { jetzt = () => new Date() } = {}) {
    let laeuft = false;
    const pruefe = async () => {
        if (laeuft) return;
        try {
            const status = await leseStatus(verzeichnis);
            let letzter = status?.zeit || null;
            if (status && !status.name) {
                // die Sicherung selbst ist gescheitert: nach einer Stunde noch einmal versuchen, nicht erst morgen
                if (jetzt().getTime() - Date.parse(status.zeit) < 60 * 60_000) return;
                letzter = null;
            }
            if (!istFaellig(jetzt(), konfig.uhrzeit, letzter)) return;
            laeuft = true;
            await fuehreAutomatischeSicherungAus(knex, verzeichnis, konfig);
        } catch (err) {
            // der Fehler ist schon geloggt und im Status vermerkt; der nächste Versuch folgt erst am nächsten Tag
            if (!(err instanceof SicherungsFehler)) console.error('[Sicherung] Planer:', err.message);
        } finally {
            laeuft = false;
        }
    };
    const timer = setInterval(pruefe, 60_000);
    timer.unref();
    setTimeout(pruefe, 30_000).unref(); // nach einem Neustart nachholen, wenn der Lauf heute noch fehlt
    return { stop: () => clearInterval(timer) };
}
