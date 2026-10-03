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
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    fs.rmSync(`${dir}.log`, { force: true });
}

// Frische, migrierte Test-Datenbank. Ohne Angaben: temporäres Verzeichnis und freier Port (Unit-Tests).
// Rückgabe: { knex, verbindung, stoppe() } — stoppe() schließt knex, beendet PostgreSQL und löscht das Verzeichnis.
export async function starteTestPostgres({ verzeichnis, port, dbName = 'hajime_test', migriere = true, loescheBeimStopp = true } = {}) {
    const dir = verzeichnis || fs.mkdtempSync(path.join(os.tmpdir(), 'hajime-pg-'));
    if (verzeichnis) await bereinigeTestPostgres(dir);
    const instanz = await starteEingebettetesPostgres({
        datenverzeichnis: dir,
        port: port || await freierPort(),
        dbName,
        log: stillesLog
    });
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
            if (loescheBeimStopp) await bereinigeTestPostgres(dir);
        }
    };
}
