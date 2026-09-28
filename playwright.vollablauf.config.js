// Eigene, komplett von playwright.config.js getrennte Konfiguration für den "kompletten
// Turnierablauf"-Test (siehe tests/e2e-vollablauf/): startet ZWEI echte Serverprozesse parallel
// (Online gegen die echte Cloud-Postgres-DB, Offline gegen eine eigene frische SQLite) und
// simuliert damit den realen Datenaustausch zwischen Turnierserver und einer Offline-Matte per
// echtem Datei-Download/-Upload. Bewusst NICHT Teil von playwright.config.js/testDir './tests/e2e'
// — dieser Lauf schreibt in die echte Cloud-DB und ist deutlich langsamer als die normale Suite,
// muss also explizit über `npm run test:e2e:vollablauf` gestartet werden.
import { defineConfig, devices } from '@playwright/test';
import { ONLINE_BASE_URL, OFFLINE_BASE_URL, onlineServerEnv, offlineServerEnv } from './tests/e2e-vollablauf/test-env.js';

export default defineConfig({
    testDir: './tests/e2e-vollablauf',
    testMatch: '**/*.spec.js',
    fullyParallel: false,
    workers: 1,
    retries: 0,
    // Der Ablauf umfasst realistisch ~110-130 Einzelkämpfe mit voller IJF-Wertungserfassung sowie
    // zwei komplette Turnier-Datenaustausch-Runden — einzelne test()-Schritte (z.B. "alle Kämpfe
    // einer Matte abhandeln") brauchen entsprechend lange (siehe Plan, Abschnitt "Offene
    // Annahmen: Laufzeit").
    timeout: 20 * 60 * 1000,
    reporter: [['html', { open: 'never' }], ['list']],
    globalSetup: './tests/e2e-vollablauf/global-setup.js',
    globalTeardown: './tests/e2e-vollablauf/global-teardown.js',

    use: {
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure'
    },

    projects: [
        { name: 'chromium', use: { ...devices['Desktop Chrome'] } }
    ],

    webServer: [
        {
            command: 'node src/app.js',
            url: ONLINE_BASE_URL,
            env: onlineServerEnv,
            reuseExistingServer: false,
            timeout: 30_000,
            stdout: 'pipe',
            stderr: 'pipe'
        },
        {
            command: 'node src/app.js',
            url: OFFLINE_BASE_URL,
            env: offlineServerEnv,
            reuseExistingServer: false,
            timeout: 30_000,
            stdout: 'pipe',
            stderr: 'pipe'
        }
    ]
});
