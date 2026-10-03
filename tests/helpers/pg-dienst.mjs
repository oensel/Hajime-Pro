// Startet ein frisches, migriertes PostgreSQL für eine Playwright-Suite und bleibt als Prozess am Leben.
// Als erster Eintrag in `webServer` der Playwright-Konfiguration (Einträge starten nacheinander), damit der
// Anwendungsserver beim Start schon eine fertige Datenbank vorfindet. Bereit-Meldung über HTTP (erst NACH den
// Migrationen), Beenden über SIGTERM/SIGINT. Unter Windows wird der Prozess hart beendet — deshalb räumt
// zusätzlich globalTeardown über bereinigeTestPostgres() auf.
//
// Konfiguration über Umgebungsvariablen: PG_DIENST_VERZEICHNIS, PG_DIENST_PORT, PG_DIENST_DB, PG_DIENST_BEREIT_PORT.
import http from 'http';
import { starteTestPostgres } from './testPostgres.js';

const verzeichnis = process.env.PG_DIENST_VERZEICHNIS;
const port = Number(process.env.PG_DIENST_PORT);
const dbName = process.env.PG_DIENST_DB;
const bereitPort = Number(process.env.PG_DIENST_BEREIT_PORT);
if (!verzeichnis || !port || !dbName || !bereitPort) {
    console.error('pg-dienst: PG_DIENST_VERZEICHNIS, PG_DIENST_PORT, PG_DIENST_DB und PG_DIENST_BEREIT_PORT sind Pflicht.');
    process.exit(1);
}

const db = await starteTestPostgres({ verzeichnis, port, dbName, loescheBeimStopp: false });
// Der Anwendungsserver öffnet eigene Verbindungen; diese hier wird nicht gebraucht.
await db.knex.destroy();

let beendet = false;
async function beende() {
    if (beendet) return;
    beendet = true;
    try { (await import('./testPostgres.js')).bereinigeTestPostgres(verzeichnis).catch(() => {}); } catch { /* egal */ }
    setTimeout(() => process.exit(0), 3000).unref();
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, beende);

http.createServer((req, res) => res.end('bereit')).listen(bereitPort, '127.0.0.1', () => {
    console.log(`PostgreSQL bereit (127.0.0.1:${port}, Datenbank ${dbName}).`);
});
