// Selbst-Update des Linux-Dienstes (Hallen-Server ohne Desktop, systemd, deploy/linux/install.sh) beim Start:
// fragt das neueste GitHub-Release ab, lädt das Dienst-Paket (Quellpaket "Hajime-Pro-Dienst-<version>.tar.gz"), prüft die
// Ed25519-Signatur aus server-version.json (derselbe Schlüssel wie bei den Client-Dateien), baut es neben der laufenden
// Installation auf (npm ci, Datenbank-Migration), tauscht den Code aus und beendet den Prozess — systemd
// (Restart=always) startet danach die neue Version. Jeder Fehler (kein Internet, kein neueres Release, Prüfung,
// Installation) lässt die vorhandene Version unverändert weiterstarten.
//
// Nicht im Cluster (CLUSTER_KNOTEN): zwei Server dürfen nicht gleichzeitig neu starten; dort bleibt das Update Handarbeit
// (deploy/linux/README.md). Abschalten: HAJIME_SELBSTUPDATE=false.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs';
import { execFile } from 'child_process';
import path from 'path';
import { MELDUNG, erzeugeKonsolenAnzeige, schrittZeile } from '../shared/updateAnzeige.js';

export const DIENST_PLATTFORM = 'linux-dienst';
// Was beim Austausch ersetzt wird; .env, data/ und alles andere im Installationsordner bleiben unberührt.
export const PAKET_TEILE = ['src', 'public', 'migrations', 'node_modules', 'knexfile.cjs', 'package.json', 'package-lock.json', 'desktop', 'deploy', 'scripts'];

export function dienstUpdateAktiv(env = process.env) {
    return env.BETRIEBSMODUS === 'server'
        && !!env.INVOCATION_ID                 // läuft unter systemd (nicht Entwicklung, nicht das Electron-Server-Paket)
        && !env.CLUSTER_KNOTEN
        && env.HAJIME_SELBSTUPDATE !== 'false'
        && env.NODE_ENV !== 'test';
}

// npm unter Windows: über das Node mitgelieferte npm-cli.js (kein .cmd, keine Shell); fehlt es, bleibt die Shell als Ausweg.
function npmAufruf(befehl, args) {
    if (befehl !== 'npm' || process.platform !== 'win32') return { befehl, args, shell: false };
    const cli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
    return existsSync(cli) ? { befehl: process.execPath, args: [cli, ...args], shell: false } : { befehl, args, shell: true };
}

function fuehreAusStandard(befehl, args, optionen = {}) {
    const aufruf = npmAufruf(befehl, args);
    return new Promise((resolve, reject) => {
        execFile(aufruf.befehl, aufruf.args, { timeout: 15 * 60 * 1000, maxBuffer: 16 * 1024 * 1024, ...(aufruf.shell ? { shell: true } : {}), ...optionen }, (fehler, stdout, stderr) => {
            if (fehler) reject(new Error(`${befehl} ${args.join(' ')}: ${(stderr || fehler.message).toString().trim().split('\n').slice(-5).join(' | ')}`));
            else resolve(stdout);
        });
    });
}

// Windows: Virenscanner/Indexdienst halten frisch geschriebene Ordner kurz fest (EPERM/EBUSY), daher mit Wiederholung.
function benenne(von, nach) {
    for (let versuch = 0; ; versuch++) {
        try {
            return renameSync(von, nach);
        } catch (err) {
            if (!['EPERM', 'EBUSY', 'EACCES'].includes(err.code) || versuch >= 20) throw err;
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
        }
    }
}

// Teile, die das Paket nicht enthalten muss (ältere Releases): fehlen sie im Paket, bleibt der vorhandene Teil stehen.
const OPTIONALE_TEILE = ['scripts'];
const AUSTAUSCH_DATEI = 'austausch.json';

// Tauscht die Programmteile gegen die vorbereitete neue Version: erst das Alte beiseite, dann das Neue hinein; scheitert
// etwas, wird alles zurückgelegt.
function tauscheAus({ installDir, neu, alt }) {
    rmSync(alt, { recursive: true, force: true });
    mkdirSync(alt, { recursive: true });
    const verschoben = [];
    try {
        for (const teil of PAKET_TEILE) {
            const imPaket = existsSync(path.join(neu, teil));
            if (!imPaket && OPTIONALE_TEILE.includes(teil)) continue;
            if (existsSync(path.join(installDir, teil))) {
                benenne(path.join(installDir, teil), path.join(alt, teil));
                verschoben.push({ teil, hattAlt: true });
            } else {
                verschoben.push({ teil, hattAlt: false });
            }
            if (imPaket) benenne(path.join(neu, teil), path.join(installDir, teil));
        }
    } catch (err) {
        for (const { teil, hattAlt } of verschoben.reverse()) {
            try {
                rmSync(path.join(installDir, teil), { recursive: true, force: true });
                if (hattAlt) benenne(path.join(alt, teil), path.join(installDir, teil));
            } catch { /* so weit wie möglich zurückholen */ }
        }
        throw err;
    }
    rmSync(neu, { recursive: true, force: true });
}

/**
 * Entpackt das Paket, baut es auf und tauscht es gegen die laufende Installation aus. Bei jedem Fehler vor oder während des
 * Austauschs bleibt (bzw. wird wiederhergestellt) die bisherige Installation.
 *
 * `austausch: 'spaeter'` (Windows: eine laufende PostgreSQL sperrt node_modules) bereitet nur vor und merkt den Austausch
 * in .update/austausch.json vor; `fuehreVorgemerktenAustauschAus` führt ihn aus, sobald nichts mehr auf den Dateien läuft.
 * @returns {Promise<{alt: string, vorgemerkt?: boolean}>} Ordner mit der vorherigen Version (zum manuellen Zurückrollen)
 */
export async function installiereDienstPaket({
    paket, installDir, aktuelleVersion, neueVersion, fuehreAus = fuehreAusStandard, env = process.env, log = console,
    anzeige = { meldung: (text) => log.log(`[Selbst-Update] ${text}`) },
    migrationsUmgebung = 'online', austausch = 'sofort'
}) {
    const arbeit = path.join(installDir, '.update');
    const neu = path.join(arbeit, `neu-${neueVersion}`);
    const alt = path.join(arbeit, `alt-${aktuelleVersion}`);
    rmSync(neu, { recursive: true, force: true });
    mkdirSync(neu, { recursive: true });

    anzeige.meldung(schrittZeile(1, 4, `Entpacke Version ${neueVersion} …`));
    // Relative Pfade im Ordner des Pakets: GNU tar (Git Bash unter Windows) hielte "D:\..." sonst für einen Rechnernamen.
    const paketDir = path.dirname(path.resolve(paket));
    await fuehreAus('tar', ['-xzf', path.basename(paket), '-C', path.relative(paketDir, neu).split(path.sep).join('/'), '--strip-components=1'], { cwd: paketDir });
    for (const pflicht of ['src/app.js', 'package.json', 'package-lock.json', 'knexfile.cjs']) {
        if (!existsSync(path.join(neu, pflicht))) throw new Error(`Paket unvollständig: ${pflicht} fehlt`);
    }

    anzeige.meldung(schrittZeile(2, 4, 'Installiere Abhängigkeiten (npm ci) – das dauert einige Minuten …'));
    await fuehreAus('npm', ['ci', '--omit=dev', '--no-audit', '--no-fund'], { cwd: neu, env });
    anzeige.meldung(schrittZeile(3, 4, 'Migriere die Datenbank …'));
    await fuehreAus(process.execPath, [path.join(neu, 'node_modules/knex/bin/cli.js'), 'migrate:latest', '--knexfile', 'knexfile.cjs', '--env', migrationsUmgebung], { cwd: neu, env });

    if (austausch === 'spaeter') {
        writeFileSync(path.join(arbeit, AUSTAUSCH_DATEI), JSON.stringify({ neu, alt, neueVersion, aktuelleVersion }));
        anzeige.meldung(schrittZeile(4, 4, 'Austausch der Programmdateien beim nächsten Start vorgemerkt.'));
        return { alt, vorgemerkt: true };
    }
    anzeige.meldung(schrittZeile(4, 4, 'Tausche die Programmdateien aus …'));
    tauscheAus({ installDir, neu, alt });
    return { alt };
}

/**
 * Führt einen mit `austausch: 'spaeter'` vorgemerkten Austausch aus (aufzurufen, solange weder der Server noch eine
 * PostgreSQL aus node_modules läuft). Gibt die neue Version zurück oder null, wenn nichts vorgemerkt war. Bei einem Fehler
 * bleibt die alte Version erhalten, die Vormerkung wird in jedem Fall entfernt.
 */
export function fuehreVorgemerktenAustauschAus(installDir, log = console) {
    const datei = path.join(installDir, '.update', AUSTAUSCH_DATEI);
    if (!existsSync(datei)) return null;
    let eintrag;
    try {
        eintrag = JSON.parse(readFileSync(datei, 'utf8'));
    } catch (err) {
        rmSync(datei, { force: true });
        log.warn(`[Selbst-Update] Vormerkung unlesbar, verworfen: ${err.message}`);
        return null;
    }
    rmSync(datei, { force: true });
    try {
        tauscheAus({ installDir, neu: eintrag.neu, alt: eintrag.alt });
        log.log(`[Selbst-Update] Version ${eintrag.neueVersion} eingesetzt (vorherige Version: ${eintrag.alt}).`);
        return eintrag.neueVersion;
    } catch (err) {
        log.warn(`[Selbst-Update] Austausch auf ${eintrag.neueVersion} fehlgeschlagen, ${eintrag.aktuelleVersion} bleibt: ${err.message}`);
        return null;
    }
}

/**
 * Prüft beim Start auf ein neueres Release und installiert es. Gibt 'neustart' zurück, wenn der Code ausgetauscht wurde
 * (der Aufrufer beendet den Prozess), sonst 'weiter'. Wirft nie.
 */
export async function pruefeUndAktualisiereDienst({
    installDir, aktuelleVersion, schluessel, repo = 'oensel/Hajime-Pro-Releases', token = '', apiBasis = undefined, fehlerAusgabe = null,
    pruefeUndLadeFn = null, installiere = installiereDienstPaket, log = console,
    anzeige = erzeugeKonsolenAnzeige(), neustartSekunden = 3, warte = (ms) => new Promise((r) => setTimeout(r, ms))
}) {
    try {
        // Erst hier geladen: desktop/ fehlt im Cloud-Docker-Image (.dockerignore), dieses Modul wird aber von src/app.js importiert.
        const { merkeVersuch, pruefeUndLade } = await import('../../desktop/server/selbstUpdate.js');
        const lade = pruefeUndLadeFn || pruefeUndLade;
        const zielVerzeichnis = path.join(installDir, '.update', 'download');
        const versuchsDatei = path.join(installDir, 'data', 'selbstupdate.json');
        anzeige.meldung(MELDUNG.suche);
        let geholt = false;
        const ergebnis = await lade({
            repo, token, aktuelleVersion, schluessel, zielVerzeichnis, versuchsDatei, ...(apiBasis ? { apiBasis } : {}),
            plattformName: DIENST_PLATTFORM, unterstuetzt: [DIENST_PLATTFORM],
            log: { log() {}, warn() {} },   // die Anzeige übernimmt die Meldungen
            beiFortschritt: ({ version, geladen, gesamt }) => {
                if (!geholt) { geholt = true; anzeige.meldung(MELDUNG.holeGit(version)); }
                anzeige.fortschritt({ text: 'Lade', geladen, gesamt });
            }
        });
        anzeige.ende();
        switch (ergebnis.status) {
            case 'aktuell': anzeige.meldung(MELDUNG.aktuell(aktuelleVersion)); break;
            case 'kein-release': anzeige.meldung(`Kein Release auf GitHub gefunden – starte Version ${aktuelleVersion}.`); break;
            case 'keine-verbindung': anzeige.meldung(MELDUNG.keineVerbindung('GitHub', aktuelleVersion)); break;
            case 'aufgegeben': anzeige.meldung(`Update auf ${ergebnis.version} ist mehrfach fehlgeschlagen – starte Version ${aktuelleVersion}.`); break;
            case 'fehler': anzeige.meldung(`Update fehlgeschlagen: ${ergebnis.grund} – starte Version ${aktuelleVersion}.`); break;
            case 'bereit': if (!geholt) anzeige.meldung(`Update ${ergebnis.version} liegt bereits geladen vor.`); break;
            default: break;
        }
        if (ergebnis.status !== 'bereit') return 'weiter';

        merkeVersuch(versuchsDatei, ergebnis.version);
        try {
            const { alt } = await installiere({ paket: ergebnis.datei, installDir, aktuelleVersion, neueVersion: ergebnis.version, log, anzeige });
            rmSync(zielVerzeichnis, { recursive: true, force: true });
            anzeige.meldung(`Version ${ergebnis.version} installiert (vorherige Version: ${alt}).`);
            anzeige.meldung(MELDUNG.neustart(neustartSekunden));
            await warte(neustartSekunden * 1000);
            return 'neustart';
        } catch (err) {
            anzeige.meldung(`Installation von ${ergebnis.version} fehlgeschlagen (${err.message}) – starte Version ${aktuelleVersion}.`);
            if (fehlerAusgabe) fehlerAusgabe(err);
            return 'weiter';
        }
    } catch (err) {
        anzeige.meldung(`Prüfung fehlgeschlagen: ${err.message} – starte Version ${aktuelleVersion}.`);
        return 'weiter';
    }
}

export function liesPaketVersion(installDir) {
    return JSON.parse(readFileSync(path.join(installDir, 'package.json'), 'utf8')).version;
}
