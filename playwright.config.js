import { defineConfig, devices } from '@playwright/test';
import { BASE_URL, testServerEnv, pgDienstEnv, TEST_PG_BEREIT_PORT } from './tests/e2e/test-env.js';

export default defineConfig({
    testDir: './tests/e2e',
    testMatch: '**/*.spec.js',
    // Eine gemeinsame PostgreSQL-Datenbank für die ganze Suite (siehe tests/helpers/pg-dienst.mjs) — Tests laufen
    // daher bewusst NICHT parallel gegen sie, um sich nicht gegenseitig Daten wegzuschreiben.
    // Kann aufgeteilt werden (z.B. eigene DB pro Worker), sobald die Suite das nötig macht.
    fullyParallel: false,
    workers: 1,
    retries: process.env.CI ? 1 : 0,
    reporter: [['html', { open: 'never' }], ['list']],
    globalTeardown: './tests/e2e/global-teardown.js',

    use: {
        baseURL: BASE_URL,
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure'
    },

    projects: [
        { name: 'chromium', use: { ...devices['Desktop Chrome'] } }
    ],

    // Startet zuerst ein frisches, migriertes PostgreSQL und dann den Hallen-Server (eigener Port + eigene DB,
    // siehe test-env.js); beides fährt danach wieder herunter — reuseExistingServer:false, damit ein Testlauf
    // nie versehentlich gegen einen bereits laufenden, potenziell inkonsistenten Server greift.
    webServer: [
        {
            command: 'node tests/helpers/pg-dienst.mjs',
            url: `http://127.0.0.1:${TEST_PG_BEREIT_PORT}`,
            env: pgDienstEnv,
            reuseExistingServer: false,
            timeout: 120_000,
            stdout: 'pipe',
            stderr: 'pipe'
        },
        {
            command: 'node src/app.js',
            url: BASE_URL,
            env: testServerEnv,
            reuseExistingServer: false,
            timeout: 30_000,
            stdout: 'pipe',
            stderr: 'pipe'
        }
    ]
});
