// Eingebettetes PostgreSQL für den Modus "server" (BETRIEBSMODUS=server ohne DB_HOST): der Server bringt
// seine Datenbank selbst mit und startet sie, ohne dass auf dem Notebook etwas installiert werden muss.
// Nutzt die Binaries aus dem npm-Paket embedded-postgres (Windows, macOS, Linux); Nachweis der Tragfähigkeit auf
// allen drei Systemen: scripts/spike-eingebettetes-pg.mjs.
//
// Eigenschaften:
//  - Instanz im Datenverzeichnis (Standard ./data/pg), nur auf 127.0.0.1 erreichbar, trust-Authentifizierung
//    (die Datenbank ist von außen nicht erreichbar, es gibt kein Passwort zu verwalten).
//  - Läuft bereits eine Instanz in diesem Verzeichnis (z.B. nach einem Absturz der App), wird sie weiterverwendet.
//  - Das Log liegt NEBEN dem Datenverzeichnis: liegt es darin, meldet Windows beim Wiederanlauf "sharing violation"
//    auf der offenen Logdatei, und der Start dauert ~30 s länger (im Spike gemessen).
//  - Nach einem Absturz läuft die Wiederherstellung beim nächsten Start; deshalb großzügige Wartezeit (60 s).
//  - PostgreSQL verweigert den Betrieb als root (Linux/macOS) bzw. mit Administratorrechten ohne Rechteabgabe.
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import pg from 'pg';

const PLATTFORMEN = {
    'win32-x64': 'windows-x64',
    'linux-x64': 'linux-x64',
    'linux-arm64': 'linux-arm64',
    'darwin-x64': 'darwin-x64',
    'darwin-arm64': 'darwin-arm64'
};

export function plattformPaket(platform = process.platform, arch = process.arch) {
    const name = PLATTFORMEN[`${platform}-${arch}`];
    return name ? `@embedded-postgres/${name}` : null;
}

// Liefert eine verständliche Fehlermeldung, wenn PostgreSQL hier nicht starten darf, sonst null.
export function startHindernis({ platform = process.platform, uid = typeof process.getuid === 'function' ? process.getuid() : null } = {}) {
    if (platform !== 'win32' && uid === 0) {
        return 'PostgreSQL startet nicht als root. Den Server als normaler Benutzer ausführen (z.B. Dienstbenutzer "hajime"), ' +
            'oder eine vorhandene PostgreSQL-Datenbank über DB_HOST/DB_USER/DB_PASSWORD/DB_NAME nutzen.';
    }
    return null;
}

async function ladeBinaries() {
    const paket = plattformPaket();
    if (!paket) {
        throw new Error(`Für ${process.platform}/${process.arch} gibt es kein eingebettetes PostgreSQL. Bitte eine vorhandene Datenbank über DB_HOST nutzen.`);
    }
    try {
        return await import(paket);
    } catch (e) {
        throw new Error(`Das eingebettete PostgreSQL (${paket}) ist nicht installiert (${e.code || e.message}). "npm ci" ausführen, ohne optionale Pakete auszulassen.`);
    }
}

// Alle von diesem Prozess gestarteten/übernommenen Instanzen — der Electron-Hauptprozess des Server-Pakets
// stoppt sie beim Beenden der App (before-quit), ohne auf Signal-Handler angewiesen zu sein.
const instanzen = new Set();

export function stoppeAlleEingebetteten(modus = 'fast', log = console) {
    for (const instanz of [...instanzen]) {
        try {
            instanz.stoppe(modus);
            log.log('[Datenbank] PostgreSQL gestoppt.');
        } catch (e) {
            log.warn(`[Datenbank] PostgreSQL ließ sich nicht sauber stoppen: ${e.message.split('\n')[0]}`);
        }
        instanzen.delete(instanz);
    }
}

function ctl(binaries, verzeichnis, args) {
    execFileSync(binaries.pg_ctl, ['-D', verzeichnis, ...args], { stdio: 'ignore' });
}

function laeuft(binaries, verzeichnis) {
    try {
        ctl(binaries, verzeichnis, ['status']);
        return true;
    } catch {
        return false;
    }
}

// Port der laufenden Instanz: 4. Zeile der postmaster.pid.
function laufenderPort(verzeichnis) {
    try {
        const zeilen = fs.readFileSync(path.join(verzeichnis, 'postmaster.pid'), 'utf8').split(/\r?\n/);
        const port = Number(zeilen[3]);
        return Number.isInteger(port) && port > 0 ? port : null;
    } catch {
        return null;
    }
}

function logEnde(logDatei, zeilen = 15) {
    try {
        return fs.readFileSync(logDatei, 'utf8').trim().split(/\r?\n/).slice(-zeilen).join('\n');
    } catch {
        return '(kein Log vorhanden)';
    }
}

/**
 * Startet (oder übernimmt) das eingebettete PostgreSQL und stellt sicher, dass die Datenbank existiert.
 * @returns {{host:string, port:number, user:string, password:string, database:string, neuAngelegt:boolean,
 *            bereitsGelaufen:boolean, stoppe:(modus?:string)=>void}}
 */
export async function starteEingebettetesPostgres({ datenverzeichnis, port, dbName, timeoutSekunden = 60, log = console }) {
    const hindernis = startHindernis();
    if (hindernis) throw new Error(hindernis);

    const binaries = await ladeBinaries();
    const verzeichnis = path.resolve(datenverzeichnis);
    const logDatei = `${verzeichnis}.log`;

    let neuAngelegt = false;
    if (!fs.existsSync(path.join(verzeichnis, 'PG_VERSION'))) {
        log.log(`[Datenbank] Lege PostgreSQL-Instanz in ${verzeichnis} an …`);
        fs.mkdirSync(path.dirname(verzeichnis), { recursive: true });
        try {
            execFileSync(binaries.initdb, ['-D', verzeichnis, '-U', 'postgres', '-A', 'trust', '-E', 'UTF8', '--locale=C'], { stdio: 'ignore' });
        } catch (e) {
            throw new Error(`PostgreSQL-Instanz konnte nicht angelegt werden (initdb): ${e.message.split('\n')[0]}`);
        }
        fs.appendFileSync(path.join(verzeichnis, 'postgresql.conf'), "\nlisten_addresses = '127.0.0.1'\n");
        neuAngelegt = true;
    }

    let aktuellerPort = port;
    const bereitsGelaufen = laeuft(binaries, verzeichnis);
    if (bereitsGelaufen) {
        aktuellerPort = laufenderPort(verzeichnis) || port;
        log.log(`[Datenbank] PostgreSQL läuft bereits (Port ${aktuellerPort}) – wird weiterverwendet.`);
    } else {
        log.log(`[Datenbank] Starte PostgreSQL (127.0.0.1:${port}, bis zu ${timeoutSekunden} s) …`);
        try {
            ctl(binaries, verzeichnis, ['-o', `-p ${port}`, '-l', logDatei, '-w', '-t', String(timeoutSekunden), 'start']);
        } catch {
            throw new Error(`PostgreSQL konnte nicht gestartet werden (Port ${port} belegt? Siehe ${logDatei}):\n${logEnde(logDatei)}`);
        }
    }

    const verbindung = { host: '127.0.0.1', port: aktuellerPort, user: 'postgres' };
    const admin = new pg.Client({ ...verbindung, database: 'postgres' });
    await admin.connect();
    try {
        const { rowCount } = await admin.query('select 1 from pg_database where datname = $1', [dbName]);
        if (rowCount === 0) await admin.query(`create database "${String(dbName).replace(/"/g, '')}"`);
    } finally {
        await admin.end();
    }

    const instanz = {
        ...verbindung,
        password: '',
        database: dbName,
        neuAngelegt,
        bereitsGelaufen,
        stoppe(modus = 'fast') {
            if (!laeuft(binaries, verzeichnis)) return;
            ctl(binaries, verzeichnis, ['-m', modus, '-w', '-t', '60', 'stop']);
        }
    };
    instanzen.add(instanz);
    return instanz;
}

// Beendet die Datenbank mit der App: bei SIGINT/SIGTERM und beim normalen Programmende. Ein Absturz der App
// lässt die Datenbank laufen — der nächste Start übernimmt sie (siehe "bereitsGelaufen").
export function stoppeMitProzess(instanz, log = console) {
    let beendet = false;
    const stoppe = () => {
        if (beendet) return;
        beendet = true;
        try {
            instanz.stoppe('fast');
            instanzen.delete(instanz);
            log.log('[Datenbank] PostgreSQL gestoppt.');
        } catch (e) {
            log.warn(`[Datenbank] PostgreSQL ließ sich nicht sauber stoppen: ${e.message.split('\n')[0]}`);
        }
    };
    process.once('exit', stoppe);
    for (const signal of ['SIGINT', 'SIGTERM']) {
        process.once(signal, () => {
            stoppe();
            process.exit(0);
        });
    }
    return stoppe;
}
