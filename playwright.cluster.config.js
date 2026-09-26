import { defineConfig, devices } from '@playwright/test';
import { VIP_URL, LEITSTAND_URL, SECRET } from './tests/e2e-cluster/test-env.js';

// Cluster-Suite (Spec CouchDB-Umbau, Abschnitt 12): der Leitstand (tests/e2e-cluster/leitstand.js)
// baut zwei PostgreSQL-Instanzen, zwei Hallen-Server und ein Client-Gerät auf und simuliert
// keepalived, VIP und Zeugen. Die Tests sprechen den Master über die VIP an (baseURL) und lösen
// Ausfälle über die Steuer-API des Leitstands aus. Seriell — die Tests bauen aufeinander auf.
export default defineConfig({
    testDir: './tests/e2e-cluster',
    testMatch: '**/*.spec.js',
    fullyParallel: false,
    workers: 1,
    retries: 0,
    reporter: [['list']],
    timeout: 120_000,
    globalTeardown: './tests/e2e-cluster/global-teardown.js',
    use: {
        baseURL: VIP_URL,
        extraHTTPHeaders: { 'x-hajime-sync-secret': SECRET },
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure'
    },
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
    webServer: [
        {
            command: 'node tests/e2e-cluster/leitstand.js',
            url: `${LEITSTAND_URL}/bereit`,
            reuseExistingServer: false,
            timeout: 120_000,
            stdout: 'pipe',
            stderr: 'pipe'
        }
    ]
});
