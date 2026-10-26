// Eingebettetes PostgreSQL für Tests (Unit-Tests und Playwright-Suiten): dieselben Binaries und derselbe Start wie
// im Betriebsmodus "server" (src/utils/eingebettetesPostgres.js), aber mit frischem Datenverzeichnis je Lauf.
// Nichts muss installiert sein; funktioniert unter Windows, macOS und Linux (nicht als root).
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import knexLib from 'knex';
import { plattformPaket, starteEingebettetesPostgres } from '../../src/utils/eingebettetesPostgres.js';

const projektWurzel = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const stillesLog = { log() {}, warn() {}, error() {} };

export async function freierPort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            server.close(() => resolve(port));
        });
    });
}

// Stoppt eine evtl. noch laufende Instanz (z.B. nach hartem Beenden unter Windows) und löscht das Verzeichnis.
export async function bereinigeTestPostgres(verzeichnis) {
    const dir = path.resolve(verzeichnis);
    if (fs.existsSync(path.join(dir, 'postmaster.pid'))) {
        try {
            const binaries = await import(plattformPaket());
            execFileSync(binaries.pg_ctl, ['-D', dir, '-m', 'immediate', '-w', '-t', '30', 'stop'], { stdio: 'ignore' });
        } catch { /* lief nicht mehr */ }
    }
    // Unter Windows halten die gerade beendeten Server-Prozesse (oder der Virenscanner) Dateien oft noch kurz fest.
    await fs.promises.rm(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
    await fs.promises.rm(`${dir}.log`, { force: true, maxRetries: 5, retryDelay: 250 });
}

// Startfehler, weil der Port inzwischen belegt ist (Windows: winsock-Fehler 10048, sonst "Address already in use").
export function istPortKonflikt(fehler) {
    return /winsock error 10048|address already in use|EADDRINUSE|could not bind IPv4 address/i.test(String(fehler?.message ?? fehler ?? ''));
}

const TEMP_PRAEFIX = 'hajime-pg-';

// Löscht liegen gebliebene temporäre Test-Datenbanken (älter als maxAlterMs und ohne postmaster.pid, also ohne
// laufenden Server), z.B. wenn ein Verzeichnis beim Aufräumen unter Windows noch gesperrt war. Fasst nur die eigenen
// hajime-pg-*-Verzeichnisse an, nie andere PostgreSQL-Instanzen.
export function raeumeAlteTempVerzeichnisseAuf({ basis = os.tmpdir(), maxAlterMs = 60 * 60 * 1000 } = {}) {
    const grenze = Date.now() - maxAlterMs;
    let eintraege;
    try { eintraege = fs.readdirSync(basis, { withFileTypes: true }); } catch { return; }
    for (const eintrag of eintraege) {
        if (!eintrag.isDirectory() || !eintrag.name.startsWith(TEMP_PRAEFIX)) continue;
        const dir = path.join(basis, eintrag.name);
        try {
            if (fs.existsSync(path.join(dir, 'postmaster.pid')) || fs.statSync(dir).mtimeMs > grenze) continue;
            fs.rmSync(dir, { recursive: true, force: true });
            fs.rmSync(`${dir}.log`, { force: true });
        } catch { /* noch gesperrt: beim nächsten Lauf */ }
    }
}

// Frische, migrierte Test-Datenbank. Ohne Angaben: temporäres Verzeichnis und freier Port (Unit-Tests).
// Rückgabe: { knex, verbindung, stoppe() } — stoppe() schließt knex, beendet PostgreSQL und löscht das Verzeichnis.
export async function starteTestPostgres({ verzeichnis, port, dbName = 'hajime_test', migriere = true, loescheBeimStopp = true } = {}) {
    if (!verzeichnis) raeumeAlteTempVerzeichnisseAuf();
    const dir = verzeichnis || fs.mkdtempSync(path.join(os.tmpdir(), TEMP_PRAEFIX));
    if (verzeichnis) await bereinigeTestPostgres(dir);
    // Zwischen freierPort() und dem Start kann ein anderer Prozess (parallele Testdateien) den Port belegen:
    // dann mit einem neuen freien Port erneut versuchen (höchstens 3 Versuche; ein vorgegebener Port wird nie gewechselt).
    let instanz;
    for (let versuch = 1; ; versuch += 1) {
        try {
            instanz = await starteEingebettetesPostgres({
                datenverzeichnis: dir,
                port: port || await freierPort(),
                dbName,
                log: stillesLog
            });
            break;
        } catch (e) {
            if (port || versuch >= 3 || !istPortKonflikt(e)) throw e;
        }
    }
    const verbindung = { host: instanz.host, port: instanz.port, user: instanz.user, password: instanz.password, database: instanz.database };
    const knex = knexLib({
        client: 'pg',
        connection: verbindung,
        pool: { min: 0, max: 5 },
        migrations: { directory: path.join(projektWurzel, 'migrations') }
    });
    if (migriere) {
        try {
            await knex.migrate.latest();
        } catch (e) {
            await knex.destroy();
            instanz.stoppe('fast');
            throw e;
        }
    }
    return {
        knex,
        verbindung,
        async stoppe() {
            await knex.destroy();
            try { instanz.stoppe('fast'); } catch { /* schon beendet */ }
            if (!loescheBeimStopp) return;
            try {
                await bereinigeTestPostgres(dir);
            } catch (e) {
                // Ein vorgegebenes Verzeichnis muss weg (der nächste Lauf nutzt es wieder); ein temporäres darf liegen
                // bleiben, das Testergebnis hängt nicht davon ab. raeumeAlteTempVerzeichnisseAuf() holt es später nach.
                if (verzeichnis) throw e;
                console.warn(`[testPostgres] ${dir} ließ sich nicht löschen (${e.code}), wird bei einem späteren Lauf aufgeräumt.`);
            }
        }
    };
}
