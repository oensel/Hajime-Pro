import { defineConfig, devices } from '@playwright/test';
import { BASE_URL, testServerEnv } from './tests/e2e/test-env.js';

export default defineConfig({
    testDir: './tests/e2e',
    testMatch: '**/*.spec.js',
    // Eine gemeinsame SQLite-Datei für die ganze Suite (siehe global-setup.js) — Tests laufen
    // daher bewusst NICHT parallel gegen sie, um sich nicht gegenseitig Daten wegzuschreiben.
    // Kann aufgeteilt werden (z.B. eigene DB pro Worker), sobald die Suite das nötig macht.
    fullyParallel: false,
    workers: 1,
    retries: process.env.CI ? 1 : 0,
    reporter: [['html', { open: 'never' }], ['list']],
    globalSetup: './tests/e2e/global-setup.js',

    use: {
        baseURL: BASE_URL,
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure'
    },

    projects: [
        { name: 'chromium', use: { ...devices['Desktop Chrome'] } }
    ],

    // Startet den Offline-Server automatisch für die Suite (eigener Port + eigene DB, siehe
    // test-env.js) und fährt ihn danach wieder herunter — reuseExistingServer:false, damit ein
    // Testlauf nie versehentlich gegen einen bereits laufenden, potenziell inkonsistenten Server
    // (z.B. mit anderem IS_OFFLINE-Stand) greift.
    webServer: {
        command: 'node src/app.js',
        url: BASE_URL,
        env: testServerEnv,
        reuseExistingServer: false,
        timeout: 30_000,
        stdout: 'pipe',
        stderr: 'pipe'
    }
});
