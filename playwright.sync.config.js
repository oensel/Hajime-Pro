import { defineConfig, devices } from '@playwright/test';
import {
    SYNC_BASE_URL, syncServerEnv, CLIENT_BASE_URL, clientEnv, SYNC_TEST_SECRET,
    SYNC_TEST_PG_VERZEICHNIS, SYNC_TEST_DOKUMENTE, CLIENT_TEST_DOKUMENTE, SYNC_TEST_DOWNLOADS
} from './tests/e2e-sync/test-env.js';
import { rmSync, readdirSync } from 'fs';
import { SYNC_SHARD } from './tests/e2e-sync/test-env.js';
import { SYNC_SHARDS, specsVonShard, pruefeZuordnung } from './tests/e2e-sync/shards.js';
import { bereinigeTestPostgres } from './tests/helpers/testPostgres.js';

// Testdaten werden hier — VOR dem Start der Webserver — gelöscht, nicht erst im globalSetup
// (das läuft nach dem Serverstart): der Client fragt sofort beim Start den Server-Status ab, und
// eine dadurch geöffnete LevelDB-/PostgreSQL-Datei ließe sich unter Windows nicht mehr löschen.
// Das frische Schema legt der Server beim Start selbst an (eingebettetes PostgreSQL, migriert beim Start).
// Playwright wertet die Konfiguration mehrfach aus (Hauptprozess, Worker) — der Umgebungs-Marker
// sorgt dafür, dass nur die ERSTE Auswertung aufräumt (Worker erben ihn), nicht eine spätere,
// während die Server ihre Dateien schon geöffnet haben.
if (!process.env.HAJIME_SYNC_TESTDATEN_BEREINIGT) {
    process.env.HAJIME_SYNC_TESTDATEN_BEREINIGT = '1';
    await bereinigeTestPostgres(SYNC_TEST_PG_VERZEICHNIS);
    for (const pfad of [SYNC_TEST_DOKUMENTE, CLIENT_TEST_DOKUMENTE, SYNC_TEST_DOWNLOADS]) {
        rmSync(pfad, { recursive: true, force: true });
    }
}

// Shard-Zuordnung: jede Spec-Datei muss in shards.js stehen, sonst liefe sie in keinem Shard.
{
    const z = pruefeZuordnung(readdirSync('./tests/e2e-sync').filter((d) => d.endsWith('.spec.js')));
    if (z.fehlen.length || z.doppelt.length || z.unbekannt.length) {
        throw new Error(`tests/e2e-sync/shards.js passt nicht zu den Spec-Dateien: nicht zugeordnet [${z.fehlen}], `
            + `doppelt [${z.doppelt}], nicht vorhanden [${z.unbekannt}]`);
    }
    if (SYNC_SHARD !== null && SYNC_SHARD >= SYNC_SHARDS.length) throw new Error(`HAJIME_SYNC_SHARD ${SYNC_SHARD} existiert nicht`);
}

// Sync-Suite: Hallen-Server mit eingebetteter Dokument-DB (SYNC_ROLLE=server, Port 3200) und ein
// Client-Knoten (SYNC_ROLLE=client, Port 3201, Browser-Seiten der Matte/Waage). Seriell gegen eine
// gemeinsame DB wie die Haupt-Suite (je Shard ein eigenes Knotenpaar, siehe tests/e2e-sync/shards.js) — zusätzlich trägt der Hallen-Server immer nur EIN Turnier,
// jedes neu angelegte Turnier löscht das vorherige.
export default defineConfig({
    testDir: './tests/e2e-sync',
    // Mit HAJIME_SYNC_SHARD nur die Specs dieses Shards (npm run test:e2e:sync startet alle Shards parallel).
    testMatch: SYNC_SHARD === null ? '**/*.spec.js' : specsVonShard(SYNC_SHARD),
    fullyParallel: false,
    workers: 1,
    retries: 0,
    reporter: [['list']],
    // Eigenes Ergebnisverzeichnis je Shard: Playwright leert es beim Start, parallele Shards würden sich sonst
    // gegenseitig Traces/Screenshots löschen.
    outputDir: SYNC_SHARD === null ? 'test-results' : `test-results/sync-${SYNC_SHARD}`,
    globalTeardown: './tests/e2e-sync/global-teardown.js',
    use: {
        baseURL: SYNC_BASE_URL,
        // Direkte /db-Zugriffe der Tests sind keine Browser-Anfragen -> SYNC_SECRET mitsenden.
        extraHTTPHeaders: { 'x-hajime-sync-secret': SYNC_TEST_SECRET },
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure'
    },
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
    webServer: [
        {
            command: 'node src/app.js',
            url: SYNC_BASE_URL,
            env: syncServerEnv,
            reuseExistingServer: false,
            timeout: 120_000, // initdb + Migrationen des eingebetteten PostgreSQL
            stdout: 'pipe',
            stderr: 'pipe'
        },
        {
            command: 'node src/app.js',
            url: CLIENT_BASE_URL,
            env: clientEnv,
            reuseExistingServer: false,
            timeout: 30_000,
            stdout: 'pipe',
            stderr: 'pipe'
        }
    ]
});
