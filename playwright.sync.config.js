import { defineConfig, devices } from '@playwright/test';
import {
    SYNC_BASE_URL, syncServerEnv, CLIENT_BASE_URL, clientEnv, SYNC_TEST_SECRET,
    SYNC_TEST_SQLITE_PATH, SYNC_TEST_DOKUMENTE, CLIENT_TEST_DOKUMENTE
} from './tests/e2e-sync/test-env.js';
import { rmSync } from 'fs';

// Testdaten werden hier — VOR dem Start der Webserver — gelöscht, nicht erst im globalSetup
// (das läuft nach dem Serverstart): der Client fragt sofort beim Start den Server-Status ab, und
// eine dadurch geöffnete SQLite-/LevelDB-Datei ließe sich unter Windows nicht mehr löschen.
// globalSetup migriert danach nur noch die frische SQLite-Datei.
// Playwright wertet die Konfiguration mehrfach aus (Hauptprozess, Worker) — der Umgebungs-Marker
// sorgt dafür, dass nur die ERSTE Auswertung aufräumt (Worker erben ihn), nicht eine spätere,
// während die Server ihre Dateien schon geöffnet haben.
if (!process.env.HAJIME_SYNC_TESTDATEN_BEREINIGT) {
    process.env.HAJIME_SYNC_TESTDATEN_BEREINIGT = '1';
    for (const pfad of [SYNC_TEST_SQLITE_PATH, SYNC_TEST_DOKUMENTE, CLIENT_TEST_DOKUMENTE]) {
        rmSync(pfad, { recursive: true, force: true });
    }
}

// Sync-Suite: Hallen-Server mit eingebetteter Dokument-DB (SYNC_ROLLE=server, Port 3200) und ein
// Client-Knoten (SYNC_ROLLE=client, Port 3201, Browser-Seiten der Matte/Waage). Seriell gegen eine
// gemeinsame DB wie die Haupt-Suite — zusätzlich trägt der Hallen-Server immer nur EIN Turnier,
// jedes neu angelegte Turnier löscht das vorherige.
export default defineConfig({
    testDir: './tests/e2e-sync',
    testMatch: '**/*.spec.js',
    fullyParallel: false,
    workers: 1,
    retries: 0,
    reporter: [['list']],
    globalSetup: './tests/e2e-sync/global-setup.js',
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
            timeout: 30_000,
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
