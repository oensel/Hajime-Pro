import { defineConfig, devices } from '@playwright/test';
import { rmSync } from 'fs';
import { bereinigeTestPostgres } from './tests/helpers/testPostgres.js';
import {
    SERVER_URL, APP_URL, serverEnv, TEST_PG_VERZEICHNIS, TEST_DOKUMENTE, TEST_DOWNLOADS, APP_WWW
} from './tests/e2e-mobil/test-env.js';

// Wie bei der Sync-Suite: Testdaten VOR dem Start der Server löschen, nur bei der ersten Auswertung.
if (!process.env.HAJIME_MOBIL_TESTDATEN_BEREINIGT) {
    process.env.HAJIME_MOBIL_TESTDATEN_BEREINIGT = '1';
    await bereinigeTestPostgres(TEST_PG_VERZEICHNIS);
    for (const pfad of [TEST_DOKUMENTE, TEST_DOWNLOADS, APP_WWW]) rmSync(pfad, { recursive: true, force: true });
}

// Mobil-Suite: Verhalten der Android-App (Browser-Laufzeit aus mobil/web) gegen einen Hallen-Server.
// HAJIME_PW_CHANNEL=msedge|chrome nutzt einen vorhandenen Browser statt des gebündelten Chromium.
export default defineConfig({
    testDir: './tests/e2e-mobil',
    testMatch: '**/*.spec.js',
    fullyParallel: false,
    workers: 1,
    retries: 0,
    reporter: [['list']],
    globalTeardown: './tests/e2e-mobil/global-teardown.js',
    use: {
        // API-Aufrufe der Tests gehen an den Hallen-Server; die App öffnen die Tests über APP_URL.
        baseURL: SERVER_URL,
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure'
    },
    projects: [{
        name: 'android-webview',
        // Hochformat-Handy wie das Zielgerät an der Waage.
        use: { ...devices['Pixel 7'], channel: process.env.HAJIME_PW_CHANNEL || undefined, defaultBrowserType: 'chromium' }
    }],
    webServer: [
        {
            command: 'node src/app.js',
            url: SERVER_URL,
            env: serverEnv,
            reuseExistingServer: false,
            timeout: 120_000,
            stdout: 'pipe',
            stderr: 'pipe'
        },
        {
            command: 'node tests/e2e-mobil/app-server.mjs',
            url: APP_URL,
            reuseExistingServer: false,
            timeout: 30_000
        }
    ]
});
