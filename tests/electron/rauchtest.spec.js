import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtempSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
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
    const fenster = await app.waitForEvent('window', { predicate: (w) => w.url().includes('client.html'), timeout: 60_000 });
    await expect(fenster.locator('body')).toBeVisible();
    expect(fenster.url()).toMatch(/^http:\/\/localhost:\d+\/client\.html$/);
    await app.close();
});
