// Rauchtest für den Selbststart des eingebetteten PostgreSQL im Modus "server" (BETRIEBSMODUS=server, kein DB_HOST):
// startet die App wie ein Nutzer (node src/app.js) und prüft den Lebenszyklus der Datenbank:
//   1. Erster Start: Instanz anlegen, starten, Schema migrieren, API antwortet
//   2. Sauberes Beenden (SIGTERM) stoppt die Datenbank mit (Windows: kein SIGTERM, dort Prozess-Ende)
//   3. Zweiter Start übernimmt die vorhandenen Daten
//   4. Absturz der App (SIGKILL) lässt die Datenbank laufen, der nächste Start übernimmt sie
// Läuft in der CI auf Ubuntu, Windows und macOS (.github/workflows/ci.yml, Job "server-selbststart") und lokal
// über `node scripts/smoke-server-eingebettet.mjs` (nicht als root: PostgreSQL verweigert das).
// Exit-Code != 0 bei Fehler.
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { createRequire } from 'module';

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const pg = require('pg');
const { plattformPaket } = await import(pathToFileURL(path.join(WURZEL, 'src/utils/eingebettetesPostgres.js')).href);

const ARBEIT = process.env.SMOKE_ARBEITSVERZEICHNIS
    ? path.resolve(process.env.SMOKE_ARBEITSVERZEICHNIS)
    : fs.mkdtempSync(path.join(os.tmpdir(), 'hajime-smoke-'));
fs.mkdirSync(ARBEIT, { recursive: true });
const APP_PORT = Number(process.env.SMOKE_APP_PORT || 3601);
const PG_PORT = Number(process.env.SMOKE_PG_PORT || 5545);
const DB_NAME = 'hajime_smoke';
const PG_DIR = path.join(ARBEIT, 'pg');
const WINDOWS = process.platform === 'win32';

const env = {
    ...process.env,
    BETRIEBSMODUS: 'server',
    IS_OFFLINE: '', SYNC_ROLLE: '', DB_CLIENT: '', DB_HOST: '', CLUSTER_KNOTEN: '',
    PORT: String(APP_PORT),
    DB_PORT: String(PG_PORT),
    DB_NAME,
    PG_DATENVERZEICHNIS: PG_DIR,
    SYNC_DATENVERZEICHNIS: path.join(ARBEIT, 'dokumente'),
    SYNC_SECRET: 'smoke',
    CLIENT_DOWNLOADS_VERZEICHNIS: path.join(ARBEIT, 'downloads'),
    MDNS_AKTIV: 'false',
    PORT80_WEITERLEITUNG: 'false',
    STEUERUNG_PASSWORD: '',
    SMTP_HOST: '',
    NODE_ENV: 'test'
};

const binaries = await import(plattformPaket());
let fehler = 0;
let aktiv = null; // laufender App-Prozess

async function schritt(name, fn) {
    const t0 = Date.now();
    try {
        const info = await fn();
        console.log(`OK      ${name} (${Date.now() - t0} ms)${info ? ' – ' + info : ''}`);
    } catch (e) {
        fehler++;
        console.log(`FEHLER  ${name} (${Date.now() - t0} ms): ${String(e.message).split('\n').slice(0, 6).join('\n          ')}`);
    }
}

const warte = (ms) => new Promise((r) => setTimeout(r, ms));

function starteApp() {
    const kind = spawn(process.execPath, ['src/app.js'], { cwd: WURZEL, env, stdio: ['ignore', 'pipe', 'pipe'] });
    kind.ausgabe = '';
    for (const strom of [kind.stdout, kind.stderr]) strom.on('data', (d) => { kind.ausgabe += d.toString(); });
    kind.beendet = new Promise((r) => kind.once('exit', (code, signal) => { kind.exitInfo = { code, signal }; r(); }));
    aktiv = kind;
    return kind;
}

async function warteBereit(kind, timeoutMs = 240000) {
    const ende = Date.now() + timeoutMs;
    while (Date.now() < ende) {
        if (kind.exitInfo) throw new Error(`App wurde beendet (${JSON.stringify(kind.exitInfo)}):\n${kind.ausgabe.slice(-1500)}`);
        try {
            const r = await fetch(`http://127.0.0.1:${APP_PORT}/api/config`);
            if (r.ok) return;
        } catch { /* noch nicht erreichbar */ }
        await warte(500);
    }
    throw new Error(`App nicht bereit nach ${timeoutMs / 1000} s:\n${kind.ausgabe.slice(-1500)}`);
}

async function beende(kind, signal) {
    kind.kill(signal);
    await Promise.race([kind.beendet, warte(30000)]);
    if (!kind.exitInfo) throw new Error('App ließ sich nicht beenden');
}

const dbLaeuft = () => {
    try {
        require('child_process').execFileSync(binaries.pg_ctl, ['-D', PG_DIR, 'status'], { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
};

async function sql(text, werte) {
    const c = new pg.Client({ host: '127.0.0.1', port: PG_PORT, user: 'postgres', database: DB_NAME });
    await c.connect();
    try { return await c.query(text, werte); } finally { await c.end(); }
}

console.log(`Plattform ${process.platform}/${process.arch}, Node ${process.version}, Arbeitsverzeichnis ${ARBEIT}`);

await schritt('1. Erster Start: Instanz anlegen, starten, migrieren', async () => {
    const kind = starteApp();
    await warteBereit(kind);
    if (!/Schema aktuell/.test(kind.ausgabe)) throw new Error(`Migrationsmeldung fehlt:\n${kind.ausgabe.slice(-800)}`);
    if (!dbLaeuft()) throw new Error('PostgreSQL läuft nicht');
});

await schritt('2. API liefert Daten aus der eingebetteten Datenbank', async () => {
    const r = await fetch(`http://127.0.0.1:${APP_PORT}/api/turniere`);
    if (!r.ok) throw new Error(`GET /api/turniere: ${r.status}`);
    await sql('insert into vereine (name) values ($1)', ['Smoke-Verein']);
});

await schritt(WINDOWS ? '3. Beenden der App' : '3. Sauberes Beenden (SIGTERM) stoppt die Datenbank mit', async () => {
    await beende(aktiv, 'SIGTERM');
    if (!WINDOWS) {
        for (let i = 0; i < 20 && dbLaeuft(); i++) await warte(500);
        if (dbLaeuft()) throw new Error('PostgreSQL läuft nach dem Beenden der App weiter');
    }
});

await schritt('4. Zweiter Start übernimmt die vorhandenen Daten', async () => {
    const kind = starteApp();
    await warteBereit(kind);
    const { rowCount } = await sql('select 1 from vereine where name = $1', ['Smoke-Verein']);
    if (rowCount !== 1) throw new Error('Datensatz fehlt nach dem Neustart');
});

await schritt('5. Absturz der App (SIGKILL): Datenbank läuft weiter, nächster Start übernimmt sie', async () => {
    await beende(aktiv, 'SIGKILL');
    if (!dbLaeuft()) throw new Error('PostgreSQL wurde mit dem Absturz der App beendet (unerwartet)');
    const kind = starteApp();
    await warteBereit(kind);
    if (!/läuft bereits/.test(kind.ausgabe)) throw new Error(`Weiterverwendung nicht gemeldet:\n${kind.ausgabe.slice(-800)}`);
    const { rowCount } = await sql('select 1 from vereine where name = $1', ['Smoke-Verein']);
    if (rowCount !== 1) throw new Error('Datensatz fehlt nach dem Absturz');
});

// Aufräumen: App beenden, Datenbank stoppen, Verzeichnis löschen
try {
    if (aktiv && !aktiv.exitInfo) await beende(aktiv, 'SIGKILL');
    if (dbLaeuft()) require('child_process').execFileSync(binaries.pg_ctl, ['-D', PG_DIR, '-m', 'immediate', '-w', '-t', '60', 'stop'], { stdio: 'ignore' });
    // SMOKE_BEHALTEN=1: Arbeitsverzeichnis stehen lassen (zum Nachsehen bei Fehlern).
    if (!process.env.SMOKE_BEHALTEN) {
        fs.rmSync(ARBEIT, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
        fs.rmSync(`${PG_DIR}.log`, { force: true });
    }
} catch (e) {
    console.log(`Hinweis: Aufräumen unvollständig (${String(e.message).split('\n')[0]})`);
}
console.log(fehler === 0 ? '\nERGEBNIS: alles OK' : `\nERGEBNIS: ${fehler} Schritt(e) fehlgeschlagen`);
process.exit(fehler === 0 ? 0 : 1);
