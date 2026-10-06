// Selbst-Update des Linux-Dienstes (Hallen-Server ohne Desktop, systemd, deploy/linux/install.sh) beim Start:
// fragt das neueste GitHub-Release ab, lädt das Dienst-Paket (Quellpaket "Hajime-Pro-Dienst-<version>.tar.gz"), prüft die
// Ed25519-Signatur aus server-version.json (derselbe Schlüssel wie bei den Client-Dateien), baut es neben der laufenden
// Installation auf (npm ci, Datenbank-Migration), tauscht den Code aus und beendet den Prozess — systemd
// (Restart=always) startet danach die neue Version. Jeder Fehler (kein Internet, kein neueres Release, Prüfung,
// Installation) lässt die vorhandene Version unverändert weiterstarten.
//
// Nicht im Cluster (CLUSTER_KNOTEN): zwei Server dürfen nicht gleichzeitig neu starten; dort bleibt das Update Handarbeit
// (deploy/linux/README.md). Abschalten: HAJIME_SELBSTUPDATE=false.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'fs';
import { execFile } from 'child_process';
import path from 'path';
import { merkeVersuch, pruefeUndLade } from '../../desktop/server/selbstUpdate.js';

export const DIENST_PLATTFORM = 'linux-dienst';
// Was beim Austausch ersetzt wird; .env, data/ und alles andere im Installationsordner bleiben unberührt.
export const PAKET_TEILE = ['src', 'public', 'migrations', 'node_modules', 'knexfile.cjs', 'package.json', 'package-lock.json', 'desktop', 'deploy'];

export function dienstUpdateAktiv(env = process.env) {
    return env.BETRIEBSMODUS === 'server'
        && !!env.INVOCATION_ID                 // läuft unter systemd (nicht Entwicklung, nicht das Electron-Server-Paket)
        && !env.CLUSTER_KNOTEN
        && env.HAJIME_SELBSTUPDATE !== 'false'
        && env.NODE_ENV !== 'test';
}

function fuehreAusStandard(befehl, args, optionen = {}) {
    return new Promise((resolve, reject) => {
        execFile(befehl, args, { timeout: 15 * 60 * 1000, maxBuffer: 16 * 1024 * 1024, ...optionen }, (fehler, stdout, stderr) => {
            if (fehler) reject(new Error(`${befehl} ${args.join(' ')}: ${(stderr || fehler.message).toString().trim().split('\n').slice(-5).join(' | ')}`));
            else resolve(stdout);
        });
    });
}

/**
 * Entpackt das Paket, baut es auf und tauscht es gegen die laufende Installation aus. Bei jedem Fehler vor oder während des
 * Austauschs bleibt (bzw. wird wiederhergestellt) die bisherige Installation.
 * @returns {Promise<{alt: string}>} Ordner mit der vorherigen Version (zum manuellen Zurückrollen)
 */
export async function installiereDienstPaket({ paket, installDir, aktuelleVersion, neueVersion, fuehreAus = fuehreAusStandard, env = process.env, log = console }) {
    const arbeit = path.join(installDir, '.update');
    const neu = path.join(arbeit, `neu-${neueVersion}`);
    const alt = path.join(arbeit, `alt-${aktuelleVersion}`);
    rmSync(neu, { recursive: true, force: true });
    mkdirSync(neu, { recursive: true });

    log.log(`[Selbst-Update] Entpacke Version ${neueVersion} …`);
    await fuehreAus('tar', ['-xzf', paket, '-C', neu, '--strip-components=1']);
    for (const pflicht of ['src/app.js', 'package.json', 'package-lock.json', 'knexfile.cjs']) {
        if (!existsSync(path.join(neu, pflicht))) throw new Error(`Paket unvollständig: ${pflicht} fehlt`);
    }

    log.log('[Selbst-Update] Installiere Abhängigkeiten (npm ci) …');
    await fuehreAus('npm', ['ci', '--omit=dev', '--no-audit', '--no-fund'], { cwd: neu, env });
    log.log('[Selbst-Update] Migriere die Datenbank …');
    await fuehreAus(process.execPath, [path.join(neu, 'node_modules/knex/bin/cli.js'), 'migrate:latest', '--knexfile', 'knexfile.cjs', '--env', 'online'], { cwd: neu, env });

    // Austausch: erst das Alte beiseite, dann das Neue hinein; scheitert etwas, wird alles zurückgelegt.
    rmSync(alt, { recursive: true, force: true });
    mkdirSync(alt, { recursive: true });
    const verschoben = [];
    try {
        for (const teil of PAKET_TEILE) {
            if (existsSync(path.join(installDir, teil))) {
                renameSync(path.join(installDir, teil), path.join(alt, teil));
                verschoben.push({ teil, hattAlt: true });
            } else {
                verschoben.push({ teil, hattAlt: false });
            }
            if (existsSync(path.join(neu, teil))) renameSync(path.join(neu, teil), path.join(installDir, teil));
        }
    } catch (err) {
        for (const { teil, hattAlt } of verschoben.reverse()) {
            try {
                rmSync(path.join(installDir, teil), { recursive: true, force: true });
                if (hattAlt) renameSync(path.join(alt, teil), path.join(installDir, teil));
            } catch { /* so weit wie möglich zurückholen */ }
        }
        throw err;
    }
    rmSync(neu, { recursive: true, force: true });
    return { alt };
}

/**
 * Prüft beim Start auf ein neueres Release und installiert es. Gibt 'neustart' zurück, wenn der Code ausgetauscht wurde
 * (der Aufrufer beendet den Prozess), sonst 'weiter'. Wirft nie.
 */
export async function pruefeUndAktualisiereDienst({
    installDir, aktuelleVersion, schluessel, repo = 'oensel/Hajime-Pro', token = '', fehlerAusgabe = null,
    pruefeUndLadeFn = pruefeUndLade, installiere = installiereDienstPaket, log = console
}) {
    try {
        const zielVerzeichnis = path.join(installDir, '.update', 'download');
        const versuchsDatei = path.join(installDir, 'data', 'selbstupdate.json');
        const ergebnis = await pruefeUndLadeFn({
            repo, token, aktuelleVersion, schluessel, zielVerzeichnis, versuchsDatei,
            plattformName: DIENST_PLATTFORM, unterstuetzt: [DIENST_PLATTFORM], log
        });
        if (ergebnis.status === 'aufgegeben') log.warn(`[Selbst-Update] Update auf ${ergebnis.version} ist mehrfach fehlgeschlagen – starte ${aktuelleVersion}.`);
        else if (ergebnis.status === 'fehler') log.warn(`[Selbst-Update] ${ergebnis.grund}`);
        else if (ergebnis.status === 'keine-verbindung') log.log('[Selbst-Update] Keine Verbindung zu GitHub – starte die vorhandene Version.');
        if (ergebnis.status !== 'bereit') return 'weiter';

        merkeVersuch(versuchsDatei, ergebnis.version);
        try {
            const { alt } = await installiere({ paket: ergebnis.datei, installDir, aktuelleVersion, neueVersion: ergebnis.version, log });
            rmSync(zielVerzeichnis, { recursive: true, force: true });
            log.log(`[Selbst-Update] Version ${ergebnis.version} installiert (vorherige Version: ${alt}). Starte neu …`);
            return 'neustart';
        } catch (err) {
            log.error(`[Selbst-Update] Installation von ${ergebnis.version} fehlgeschlagen (${err.message}) – starte ${aktuelleVersion}.`);
            if (fehlerAusgabe) fehlerAusgabe(err);
            return 'weiter';
        }
    } catch (err) {
        log.error(`[Selbst-Update] Prüfung fehlgeschlagen: ${err.message}`);
        return 'weiter';
    }
}

export function liesPaketVersion(installDir) {
    return JSON.parse(readFileSync(path.join(installDir, 'package.json'), 'utf8')).version;
}
