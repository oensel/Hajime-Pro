// Cloud-Server auf das neueste Release aus dem öffentlichen Release-Repository bringen (Windows und Linux gleich):
//
//   node scripts/cloud-update.mjs [--ziel <Ordner>] [--env-datei <Datei>] [--nur-pruefen] [--ohne-neustart]
//
// Holt Hajime-Pro-Dienst-<version>.tar.gz, prüft Signatur und Prüfsumme (wie das Selbst-Update des Linux-Dienstes),
// baut es im Zielordner auf (npm ci), migriert die Datenbank, tauscht den Code aus und fordert den Neustart an.
// Ein leerer oder neuer Zielordner wird erstmalig eingerichtet; scripts/ (Cloud-Start, lokale PostgreSQL) stammt dann
// aus diesem Ordner, falls das Paket sie noch nicht enthält. Die Konfiguration (.env.cloud-lokal bzw. .env) und alle
// Daten bleiben unberührt.
//
// Neustart: Läuft der Server über `node scripts/cloud-lokal.mjs start`, genügt die Anforderungsdatei data/neustart.anfordern
// (der Überwacher tauscht dann auch die Dateien aus, falls vorgemerkt). Sonst führt CLOUD_NEUSTART_BEFEHL den Neustart aus
// (z. B. "systemctl restart hajime-cloud"). Das Update aus der Oberfläche (admin-nutzer.html) braucht kein Skript.
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { execSync } from 'child_process';

const EIGENES = path.resolve(import.meta.dirname, '..');

function argument(name) {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : null;
}

function leseEnv(datei) {
    const werte = {};
    if (!datei || !fs.existsSync(datei)) return werte;
    for (const zeile of fs.readFileSync(datei, 'utf8').split(/\r?\n/)) {
        const m = zeile.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/);
        if (!m) continue;
        let v = m[2].trim();
        if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) v = v.slice(1, -1);
        werte[m[1]] = v;
    }
    return werte;
}

export async function aktualisiere({ ziel, envDatei, nurPruefen = false, ohneNeustart = false, log = console }) {
    const paketDatei = path.join(ziel, 'package.json');
    const frisch = !fs.existsSync(paketDatei);
    const aktuelleVersion = frisch ? '0.0.0' : JSON.parse(fs.readFileSync(paketDatei, 'utf8')).version;
    const env = {
        ...process.env,
        ...leseEnv(envDatei || [path.join(ziel, '.env.cloud-lokal'), path.join(ziel, '.env')].find((d) => fs.existsSync(d)))
    };
    const modul = (datei) => import(pathToFileURL(path.join(EIGENES, datei)).href);
    const { pruefeUndLade } = await modul('desktop/server/selbstUpdate.js');
    const { installiereDienstPaket, DIENST_PLATTFORM } = await modul('src/utils/dienstUpdate.js');
    const { liesOeffentlichenSchluessel } = await modul('src/sync/clientDateien.js');

    fs.mkdirSync(ziel, { recursive: true });
    log.log(`Zielordner: ${ziel} (${frisch ? 'neu' : `Version ${aktuelleVersion}`})`);
    const ergebnis = await pruefeUndLade({
        repo: env.CLIENT_RELEASE_REPO || 'oensel/Hajime-Pro-Releases',
        token: env.CLIENT_RELEASE_TOKEN || env.GITHUB_TOKEN || '',
        aktuelleVersion, schluessel: liesOeffentlichenSchluessel(),
        zielVerzeichnis: path.join(ziel, '.update', 'download'),
        versuchsDatei: path.join(ziel, 'data', 'selbstupdate.json'),
        plattformName: DIENST_PLATTFORM, unterstuetzt: [DIENST_PLATTFORM],
        beiFortschritt: () => {}, log
    });
    if (ergebnis.status === 'aktuell') { log.log(`Version ${aktuelleVersion} ist aktuell.`); return { status: 'aktuell' }; }
    if (ergebnis.status !== 'bereit') throw new Error(`Release nicht ladbar: ${ergebnis.status}${ergebnis.grund ? ` (${ergebnis.grund})` : ''}`);
    log.log(`Neues Release: ${ergebnis.version} (laufend: ${aktuelleVersion}).`);
    if (nurPruefen) return { status: 'verfuegbar', version: ergebnis.version };

    const ergebnisInstall = await installiereDienstPaket({
        paket: ergebnis.datei, installDir: ziel, aktuelleVersion, neueVersion: ergebnis.version, env,
        migrationsUmgebung: env.DB_URL_MIGRATION ? 'online-migration' : 'online',
        // Windows: eine laufende PostgreSQL aus node_modules sperrt den Austausch, der Überwacher macht ihn beim Neustart.
        austausch: process.platform === 'win32' && !frisch ? 'spaeter' : 'sofort'
    });
    // Ältere Pakete enthalten die Start-Skripte nicht: bei einem neuen Zielordner aus diesem Ordner übernehmen.
    if (ziel !== EIGENES) {
        fs.mkdirSync(path.join(ziel, 'scripts'), { recursive: true });
        for (const datei of ['cloud-lokal.mjs', 'cloud-update.mjs', 'lokale-pg.mjs']) {
            const nach = path.join(ziel, 'scripts', datei);
            if (!fs.existsSync(nach) && fs.existsSync(path.join(EIGENES, 'scripts', datei))) fs.copyFileSync(path.join(EIGENES, 'scripts', datei), nach);
        }
    }
    fs.rmSync(path.join(ziel, '.update', 'download'), { recursive: true, force: true });
    log.log(`Version ${ergebnis.version} ${ergebnisInstall.vorgemerkt ? 'vorbereitet (Austausch beim Neustart)' : 'installiert'}.`);

    if (ohneNeustart) { log.log('Neustart nicht angefordert (--ohne-neustart): Server selbst neu starten.'); return { status: 'installiert', version: ergebnis.version }; }
    if (env.CLOUD_NEUSTART_BEFEHL) {
        log.log(`Neustart: ${env.CLOUD_NEUSTART_BEFEHL}`);
        execSync(env.CLOUD_NEUSTART_BEFEHL, { stdio: 'inherit' });
    } else {
        fs.mkdirSync(path.join(ziel, 'data'), { recursive: true });
        fs.writeFileSync(path.join(ziel, 'data', 'neustart.anfordern'), new Date().toISOString());
        log.log('Neustart angefordert (läuft der Server über "node scripts/cloud-lokal.mjs start", startet er sich neu; sonst CLOUD_NEUSTART_BEFEHL setzen oder den Dienst von Hand neu starten).');
    }
    return { status: 'installiert', version: ergebnis.version };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
    try {
        await aktualisiere({
            ziel: path.resolve(argument('--ziel') || EIGENES),
            envDatei: argument('--env-datei'),
            nurPruefen: process.argv.includes('--nur-pruefen'),
            ohneNeustart: process.argv.includes('--ohne-neustart')
        });
    } catch (err) {
        console.error(`Update fehlgeschlagen: ${err.message}`);
        process.exit(1);
    }
}
