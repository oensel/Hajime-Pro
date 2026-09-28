import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtempSync, writeFileSync, mkdirSync } from 'fs';
import http from 'http';
import { networkInterfaces, tmpdir } from 'os';
import path from 'path';

// Linux-CI (GitHub-Runner) hat keinen nutzbaren chrome-sandbox-SUID-Helfer.
const SANDBOX_ARGS = process.platform === 'linux' ? ['--no-sandbox'] : [];

function starteApp(userData) {
    const pfad = process.env.HAJIME_APP_PFAD;
    return electron.launch(pfad
        ? { executablePath: pfad, args: [...SANDBOX_ARGS, `--user-data-dir=${userData}`] }
        : { args: ['.', ...SANDBOX_ARGS, `--user-data-dir=${userData}`] });
}

// Ohne Server: Suche läuft ins Leere; mit vorab gespeicherter Kopplung muss die App trotzdem
// offline client.html zeigen (Spec Desktop-Client Abschnitt 4, Punkt 6).
test('startet ohne Server offline mit client.html', async () => {
    const userData = mkdtempSync(path.join(tmpdir(), 'hajime-e2e-'));
    mkdirSync(userData, { recursive: true });
    writeFileSync(path.join(userData, 'einstellungen.json'), JSON.stringify({ serverUrl: 'http://127.0.0.1:9', secret: 'x', clientId: '00000000-0000-0000-0000-000000000000', updateVersuche: {} }));
    const app = await starteApp(userData);
    try {
        const fenster = await app.waitForEvent('window', { predicate: (w) => w.url().includes('client.html'), timeout: 60_000 });
        await expect(fenster.locator('body')).toBeVisible();
        expect(fenster.url()).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/client\.html$/);
        const port = new URL(fenster.url()).port;

        // Der Client-Knoten lauscht nur auf Loopback: über eine LAN-Adresse dieses Rechners nicht erreichbar.
        const lanAdresse = Object.values(networkInterfaces()).flat().find(a => a && a.family === 'IPv4' && !a.internal);
        if (lanAdresse) {
            await expect(fetch(`http://${lanAdresse.address}:${port}/client.html`, { signal: AbortSignal.timeout(3000) })).rejects.toThrow();
        }

        // Navigation weg von der lokalen Oberfläche wird verhindert, externe http(s)-Links gehen an den
        // System-Browser (hier abgefangen, damit der Test keinen Browser öffnet).
        await app.evaluate(({ shell }) => { shell.openExternal = async (url) => { globalThis.externGeoeffnet = url; }; });
        await fenster.evaluate(() => { location.href = 'http://127.0.0.1:9/fremd.html'; });
        await expect.poll(() => app.evaluate(() => globalThis.externGeoeffnet)).toBe('http://127.0.0.1:9/fremd.html');
        expect(fenster.url()).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/client\.html$/);
    } finally {
        await app.close();
    }
});

// Kein mDNS-Treffer (blockiert/anderes Netz): nach ~15 s bietet das Start-Fenster die manuelle
// Server-Adresse an; danach normale Kopplung gegen diese Adresse (Standardport ergänzt, hier explizit).
test('manuelle Server-Adresse im Start-Fenster, danach Kopplung', async () => {
    const anfragen = [];
    const server = http.createServer((req, res) => {
        anfragen.push(`${req.method} ${req.url}`);
        res.setHeader('Content-Type', 'application/json');
        if (req.url === '/api/sync/status') return res.end(JSON.stringify({ rolle: 'server', modus: 'master', instanz_id: null }));
        if (req.url === '/api/client/koppeln' && req.method === 'POST') return res.end(JSON.stringify({ secret: 'geheim' }));
        res.statusCode = 404;
        res.end('{}');
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const userData = mkdtempSync(path.join(tmpdir(), 'hajime-e2e-'));
    const app = await starteApp(userData);
    try {
        const start = await app.firstWindow();
        await expect(start.locator('#manuell')).toBeVisible({ timeout: 30_000 });
        await start.locator('#adresse').fill('gibt-es-nicht.invalid');
        await start.locator('#manuell button').click();
        await expect(start.locator('#adresseFehler')).toContainText('nicht erreichbar', { timeout: 10_000 });
        await start.locator('#adresse').fill(`127.0.0.1:${port}`);
        await start.locator('#manuell button').click();
        await expect(start.locator('#kopplung')).toBeVisible({ timeout: 15_000 });
        await expect(start.locator('#manuell')).toBeHidden();
        await start.locator('#code').fill('123456');
        await start.locator('#kopplung button').click();
        const fenster = await app.waitForEvent('window', { predicate: (w) => w.url().includes('client.html'), timeout: 60_000 });
        await expect(fenster.locator('body')).toBeVisible();
        expect(anfragen).toContain('POST /api/client/koppeln');
    } finally {
        await app.close();
        server.close();
    }
});
