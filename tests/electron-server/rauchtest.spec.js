import { test, expect, _electron as electron } from '@playwright/test';
import { existsSync, mkdtempSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

// Rauchtest des Server-Pakets "Hajime Pro Server": die App startet den Server im Modus server mit eigenem,
// eingebettetem PostgreSQL, zeigt das Frontend des laufenden Servers und stoppt beim Beenden die Datenbank.
// Linux-CI (GitHub-Runner) hat keinen nutzbaren chrome-sandbox-SUID-Helfer.
const SANDBOX_ARGS = process.platform === 'linux' ? ['--no-sandbox'] : [];
const APP_PORT = 3650;
const DB_PORT = 5650;

function starteApp(userData) {
    const pfad = process.env.HAJIME_APP_PFAD;
    const env = { ...process.env, HAJIME_PORT: String(APP_PORT), HAJIME_DB_PORT: String(DB_PORT), MDNS_AKTIV: 'false', PORT80_WEITERLEITUNG: 'false' };
    return electron.launch(pfad
        ? { executablePath: pfad, args: [...SANDBOX_ARGS, `--user-data-dir=${userData}`], env }
        : { args: ['desktop/server/main.js', ...SANDBOX_ARGS, `--user-data-dir=${userData}`], env });
}

test('startet den Server mit eigener Datenbank, zeigt das Frontend und stoppt die Datenbank beim Beenden', async () => {
    const userData = mkdtempSync(path.join(tmpdir(), 'hajime-server-e2e-'));
    mkdirSync(userData, { recursive: true });
    const postmaster = path.join(userData, 'pg', 'postmaster.pid');

    const app = await starteApp(userData);
    let beendet = false;
    app.on('close', () => { beendet = true; });
    try {
        // Frontend des laufenden Servers (localhost, auch ohne Netzwerk nutzbar)
        const fenster = await app.waitForEvent('window', { predicate: (w) => w.url().startsWith(`http://localhost:${APP_PORT}/`), timeout: 200_000 });
        await expect(fenster.locator('body')).toBeVisible();

        // Der Server läuft im Modus server mit PostgreSQL, die API liefert Daten aus der eingebetteten Datenbank.
        const konfig = await (await fetch(`http://localhost:${APP_PORT}/api/config`)).json();
        expect(konfig.betriebsmodus).toBe('server');
        expect(konfig.isOffline).toBe(true);
        const turniere = await fetch(`http://localhost:${APP_PORT}/api/turniere`);
        expect(turniere.ok).toBe(true);
        expect(existsSync(postmaster)).toBe(true);

        // Navigation weg von der lokalen Oberfläche wird verhindert, externe Links gehen an den System-Browser.
        await app.evaluate(({ shell }) => { shell.openExternal = async (url) => { globalThis.externGeoeffnet = url; }; });
        await fenster.evaluate(() => { location.href = 'http://127.0.0.1:9/fremd.html'; });
        await expect.poll(() => app.evaluate(() => globalThis.externGeoeffnet)).toBe('http://127.0.0.1:9/fremd.html');
        expect(fenster.url()).toMatch(new RegExp(`^http://localhost:${APP_PORT}/`));

        // Fenster schließen: der Server läuft weiter (Tray), Clients im LAN brauchen ihn.
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.close()));
        await new Promise(r => setTimeout(r, 1500));
        expect(beendet).toBe(false);
        expect((await fetch(`http://localhost:${APP_PORT}/api/config`)).ok).toBe(true);
    } finally {
        // Beenden der App stoppt die Datenbank (before-quit)
        if (!beendet) await app.evaluate(({ app: a }) => a.quit()).catch(() => {});
        await expect.poll(() => beendet, { timeout: 60_000 }).toBe(true);
    }
    await expect.poll(() => existsSync(postmaster), { timeout: 30_000 }).toBe(false);
});
