// Audioausgabe der Live-Durchsage am Server: ein Player-Prozess bekommt rohes PCM (16 kHz, 16 Bit, Mono) auf stdin und
// spielt es über das Standard-Audiogerät des Betriebssystems (z. B. den 3,5-mm-Ausgang). Ein nativer Prozess, weil die
// Ausgabe auch auf dem Linux-Server ohne Desktop (keine Electron-App, kein Browser) laufen muss.
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PCM_RATE = 16000;
// Mehr als diese Menge ungespielter Daten (~1 s) wird verworfen, damit die Verzögerung nicht anwächst.
const MAX_RUECKSTAU_BYTES = PCM_RATE * 2;

const WINDOWS_SKRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'windowsWiedergabe.ps1');

const FFPLAY_ARGS = ['-nodisp', '-autoexit', '-loglevel', 'quiet', '-fflags', 'nobuffer', '-f', 's16le', '-ar', String(PCM_RATE), '-ac', '1', '-i', '-'];

// Mögliche Player je Betriebssystem, in Reihenfolge der Bevorzugung. `befehl` muss im PATH liegen.
export function playerKandidaten(plattform) {
    const aplay = { name: 'aplay', befehl: 'aplay', args: ['-q', '-t', 'raw', '-f', 'S16_LE', '-r', String(PCM_RATE), '-c', '1', '-'] };
    const paplay = { name: 'paplay', befehl: 'paplay', args: ['--raw', '--format=s16le', `--rate=${PCM_RATE}`, '--channels=1'] };
    const ffplay = { name: 'ffplay', befehl: 'ffplay', args: FFPLAY_ARGS };
    const sox = { name: 'sox', befehl: 'play', args: ['-q', '-t', 'raw', '-r', String(PCM_RATE), '-e', 'signed', '-b', '16', '-c', '1', '-'] };
    const powershell = {
        name: 'windows-waveout', befehl: 'powershell',
        args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', WINDOWS_SKRIPT]
    };
    if (plattform === 'win32') return [powershell, ffplay];
    if (plattform === 'darwin') return [ffplay, sox];
    return [aplay, paplay, ffplay];
}

function befehlVorhanden(befehl, plattform) {
    const r = spawnSync(plattform === 'win32' ? 'where' : 'which', [befehl], { stdio: 'ignore' });
    return r.status === 0;
}

// Wählt den Player. `DURCHSAGE_PLAYER_BEFEHL` (komplette Befehlszeile, liest PCM von stdin) überschreibt die Suche.
export function waehlePlayer({ plattform = process.platform, env = process.env, vorhanden = befehlVorhanden } = {}) {
    if (env.DURCHSAGE_PLAYER_BEFEHL) return { name: 'eigener Befehl', befehl: env.DURCHSAGE_PLAYER_BEFEHL, args: [], shell: true };
    return playerKandidaten(plattform).find(k => vorhanden(k.befehl, plattform)) || null;
}

function fehlendHinweis(plattform) {
    if (plattform === 'win32') return 'Kein Audio-Player gefunden (PowerShell fehlt).';
    if (plattform === 'darwin') return 'Kein Audio-Player gefunden (ffplay oder sox installieren).';
    return 'Kein Audio-Player gefunden (Paket alsa-utils installieren).';
}

export function erzeugeAusgabe({ plattform = process.platform, env = process.env, vorhanden = befehlVorhanden, spawnFn = spawn } = {}) {
    let zwischenspeicher = null; // { zeit, player }
    function player() {
        if (!zwischenspeicher || Date.now() - zwischenspeicher.zeit > 10000) {
            zwischenspeicher = { zeit: Date.now(), player: waehlePlayer({ plattform, env, vorhanden }) };
        }
        return zwischenspeicher.player;
    }

    return {
        status() {
            const p = player();
            return p ? { verfuegbar: true, grund: '', player: p.name } : { verfuegbar: false, grund: fehlendHinweis(plattform), player: null };
        },

        // Startet den Player. onEnde(grund) wird gerufen, wenn er von selbst endet (Fehler, Gerät fehlt) —
        // nicht, wenn schliesse() ihn beendet hat.
        oeffne({ onEnde = () => {} } = {}) {
            const p = player();
            if (!p) throw new Error(fehlendHinweis(plattform));
            const prozess = spawnFn(p.befehl, p.args, { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true, shell: !!p.shell });
            let geschlossen = false;
            let stderr = '';
            prozess.stderr?.on('data', d => { if (stderr.length < 500) stderr += d; });
            prozess.stdin.on('error', () => {}); // EPIPE, wenn der Player vorzeitig endet
            const meldeEnde = (grund) => { if (!geschlossen) { geschlossen = true; onEnde(grund); } };
            prozess.on('error', (e) => meldeEnde(`Audio-Player nicht startbar (${e.code || e.message})`));
            prozess.on('exit', (code) => {
                if (geschlossen) return;
                meldeEnde(`Audio-Player beendet (Code ${code})${stderr.trim() ? `: ${stderr.trim().split('\n')[0]}` : ''}`);
            });
            return {
                schreibe(buf) {
                    if (geschlossen || !prozess.stdin.writable) return;
                    if (prozess.stdin.writableLength > MAX_RUECKSTAU_BYTES) return; // zu viel Rückstau: Block verwerfen
                    prozess.stdin.write(buf);
                },
                schliesse() {
                    if (geschlossen) return;
                    geschlossen = true;
                    // stdin schließen: der Player spielt den Rest und endet; zur Sicherheit nach 3 s beenden.
                    try { prozess.stdin.end(); } catch { /* bereits zu */ }
                    const t = setTimeout(() => { try { prozess.kill(); } catch { /* beendet */ } }, 3000);
                    t.unref();
                    prozess.on('exit', () => clearTimeout(t));
                }
            };
        }
    };
}
