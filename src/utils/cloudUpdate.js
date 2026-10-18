// Update des Cloud-Servers aus der Oberfläche (Super-Admin, admin-nutzer.html) und per Befehl (scripts/cloud-update.mjs).
// Derselbe Weg wie das Selbst-Update des Linux-Dienstes (src/utils/dienstUpdate.js): neuestes Release aus dem öffentlichen
// Release-Repository holen, Signatur und Prüfsumme prüfen, Paket aufbauen (npm ci, Datenbank-Migration), Code austauschen,
// Prozess mit NEUSTART_EXITCODE beenden. Wieder hoch bringt ihn der Überwacher: systemd (Restart=always) bzw.
// scripts/cloud-lokal.mjs (setzt HAJIME_UEBERWACHT=1). Ohne Überwacher und im Docker-Container (dort gibt es ein neues
// Image) bietet die Seite das Update nicht an.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import path from 'path';
import { vergleicheVersionen } from '../cluster/updateLogik.js';
import { installiereDienstPaket, DIENST_PLATTFORM } from './dienstUpdate.js';
import { erzeugeUpdateDienst } from '../cluster/updateDienst.js';

export const NEUSTART_EXITCODE = 75;
// Erst dynamisch geladene Teile aus desktop/ fehlen im Cloud-Docker-Image, dieses Modul wird aber von src/app.js importiert.
const istNeuer = (kandidat, aktuell) => vergleicheVersionen(kandidat, aktuell) === 1;
const MAX_MELDUNGEN = 40;

export function cloudUpdateMoeglich(env = process.env, { dockerErkannt = existsSync('/.dockerenv') } = {}) {
    if (env.BETRIEBSMODUS !== 'cloud') return { moeglich: false, grund: 'Nur im Cloud-Betrieb.' };
    if (env.HAJIME_CLOUD_UPDATE === 'false') return { moeglich: false, grund: 'Per HAJIME_CLOUD_UPDATE=false abgeschaltet.' };
    if (dockerErkannt) return { moeglich: false, grund: 'Im Docker-Container wird das Image ausgetauscht, nicht der Code darin.' };
    if (!env.INVOCATION_ID && !env.HAJIME_UEBERWACHT) {
        return { moeglich: false, grund: 'Kein Überwacher, der den Server nach dem Update wieder startet (systemd-Dienst oder scripts/cloud-lokal.mjs).' };
    }
    return { moeglich: true, grund: null };
}

export function erzeugeCloudUpdate({
    installDir, aktuelleVersion, env = process.env, repo = 'oensel/Hajime-Pro-Releases', token = '',
    ladeSchluessel = async () => (await import('../sync/clientDateien.js')).liesOeffentlichenSchluessel(),
    ladeFn = null, installiere = installiereDienstPaket, neuesteVersionFn = null,
    beenden = (code) => process.exit(code), warte = (ms) => new Promise((r) => setTimeout(r, ms)),
    moeglichkeit = cloudUpdateMoeglich(env), jetzt = () => Date.now(), log = console
}) {
    const datenDir = path.join(installDir, 'data');
    const statusDatei = path.join(datenDir, 'cloud-update.json');
    const versuchsDatei = path.join(datenDir, 'selbstupdate.json');
    const releases = erzeugeUpdateDienst({ repo, token, statusDatei: path.join(datenDir, 'unbenutzt.json'), updateBefehl: '', fuehreBefehlAus: async () => {}, env });
    const holeNeueste = neuesteVersionFn || (() => releases.neuesteVersion());

    let zustand = 'bereit';   // bereit | laeuft | neustart | fehler
    let meldungen = [];
    let fehler = null;
    let ziel = null;

    // Nach dem Neustart: ein vorgemerktes Ziel, das jetzt läuft, gilt als erledigt.
    try {
        const alt = JSON.parse(readFileSync(statusDatei, 'utf8'));
        if (alt.zustand === 'neustart' && alt.ziel === aktuelleVersion) {
            meldungen = [`Update auf Version ${aktuelleVersion} abgeschlossen.`];
        } else if (alt.zustand === 'fehler') {
            fehler = alt.fehler || null;
            meldungen = alt.meldungen || [];
            zustand = 'fehler';
            ziel = alt.ziel || null;
        }
    } catch { /* kein früherer Lauf */ }

    function merke(text) {
        meldungen.push(text);
        if (meldungen.length > MAX_MELDUNGEN) meldungen = meldungen.slice(-MAX_MELDUNGEN);
        log.log(`[Cloud-Update] ${text}`);
    }

    function schreibeStatus() {
        try {
            mkdirSync(datenDir, { recursive: true });
            writeFileSync(`${statusDatei}.tmp`, JSON.stringify({ zustand, ziel, fehler, meldungen, zeit: new Date(jetzt()).toISOString() }));
            renameSync(`${statusDatei}.tmp`, statusDatei);
        } catch { /* Statusdatei ist nur Komfort */ }
    }

    async function status() {
        const neueste = await holeNeueste();
        return {
            moeglich: moeglichkeit.moeglich,
            grund: moeglichkeit.grund,
            aktuelleVersion,
            neuesteVersion: neueste,
            updateVerfuegbar: !!neueste && istNeuer(neueste, aktuelleVersion),
            zustand,
            ziel,
            fehler,
            meldungen
        };
    }

    async function lauf(zielVersion) {
        try {
            const { pruefeUndLade } = await import('../../desktop/server/selbstUpdate.js');
            const lade = ladeFn || pruefeUndLade;
            const ergebnis = await lade({
                repo, token, aktuelleVersion, schluessel: await ladeSchluessel(),
                zielVerzeichnis: path.join(installDir, '.update', 'download'), versuchsDatei,
                plattformName: DIENST_PLATTFORM, unterstuetzt: [DIENST_PLATTFORM],
                log: { log() {}, warn() {} },
                beiFortschritt: ({ geladen, gesamt }) => { if (gesamt && geladen === gesamt) merke(`Paket geladen (${zielVersion}).`); }
            });
            if (ergebnis.status !== 'bereit') {
                throw new Error(ergebnis.status === 'aktuell' ? 'Kein neueres Release.' : `Release nicht ladbar (${ergebnis.status}${ergebnis.grund ? `: ${ergebnis.grund}` : ''}).`);
            }
            await installiere({
                paket: ergebnis.datei, installDir, aktuelleVersion, neueVersion: ergebnis.version, env, log,
                migrationsUmgebung: env.DB_URL_MIGRATION ? 'online-migration' : 'online',
                // Windows: eine laufende PostgreSQL aus node_modules sperrt den Austausch, der Überwacher macht ihn beim Neustart.
                austausch: process.platform === 'win32' ? 'spaeter' : 'sofort',
                anzeige: { meldung: merke }
            });
            zustand = 'neustart';
            ziel = ergebnis.version;
            schreibeStatus();
            merke(`Version ${ergebnis.version} installiert – der Server startet neu.`);
            await warte(3000);
            beenden(NEUSTART_EXITCODE);
        } catch (err) {
            zustand = 'fehler';
            fehler = err.message;
            schreibeStatus();
            merke(`Update fehlgeschlagen: ${err.message}`);
        }
    }

    async function starte() {
        if (!moeglichkeit.moeglich) throw Object.assign(new Error(moeglichkeit.grund), { status: 409 });
        if (zustand === 'laeuft' || zustand === 'neustart') throw Object.assign(new Error('Ein Update läuft bereits.'), { status: 409 });
        const neueste = await holeNeueste();
        if (!neueste || !istNeuer(neueste, aktuelleVersion)) throw Object.assign(new Error('Es gibt kein neueres Release.'), { status: 409 });
        zustand = 'laeuft';
        fehler = null;
        ziel = neueste;
        meldungen = [];
        schreibeStatus();
        merke(`Update auf Version ${neueste} gestartet.`);
        lauf(neueste);   // läuft im Hintergrund weiter, der Status zeigt den Stand
        return { success: true, ziel: neueste };
    }

    return { status, starte };
}
