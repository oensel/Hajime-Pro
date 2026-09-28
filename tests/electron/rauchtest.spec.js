import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtempSync, writeFileSync, mkdirSync } from 'fs';
import { networkInterfaces, tmpdir } from 'os';
import path from 'path';

// Ohne Server: Suche läuft ins Leere; mit vorab gespeicherter Kopplung muss die App trotzdem
// offline client.html zeigen (Spec Desktop-Client Abschnitt 4, Punkt 6).
test('startet ohne Server offline mit client.html', async () => {
    const userData = mkdtempSync(path.join(tmpdir(), 'hajime-e2e-'));
    mkdirSync(userData, { recursive: true });
    writeFileSync(path.join(userData, 'einstellungen.json'), JSON.stringify({ serverUrl: 'http://127.0.0.1:9', secret: 'x', clientId: '00000000-0000-0000-0000-000000000000', updateVersuche: {} }));
    const pfad = process.env.HAJIME_APP_PFAD;
    const app = await electron.launch(pfad
        ? { executablePath: pfad, args: [`--user-data-dir=${userData}`] }
        : { args: ['.', `--user-data-dir=${userData}`] });
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
