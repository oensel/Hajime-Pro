import { defineConfig, devices } from '@playwright/test';
import { SYNC_BASE_URL, syncServerEnv } from './tests/e2e-sync/test-env.js';

// Sync-Suite: Hallen-Server mit eingebetteter Dokument-DB (SYNC_ROLLE=server). Seriell gegen eine
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
    use: { baseURL: SYNC_BASE_URL, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
    webServer: {
        command: 'node src/app.js',
        url: SYNC_BASE_URL,
        env: syncServerEnv,
        reuseExistingServer: false,
        timeout: 30_000,
        stdout: 'pipe',
        stderr: 'pipe'
    }
});
