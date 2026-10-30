import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { SYNC_TEST_DOWNLOADS, SYNC_TEST_DOKUMENTE } from './test-env.js';

const { version } = createRequire(import.meta.url)('../../package.json');
const ordner = path.join(SYNC_TEST_DOWNLOADS, version);

test.describe.serial('Client-Verteilung', () => {
    test('ohne Client-Dateien liefert /api/client/version 404', async ({ request }) => {
        rmSync(SYNC_TEST_DOWNLOADS, { recursive: true, force: true });
        const resp = await request.get('/api/client/version');
        expect(resp.status()).toBe(404);
    });

    test('mit version.json wird sie ausgeliefert, Dateien liegen unter /downloads', async ({ request }) => {
        mkdirSync(ordner, { recursive: true });
        const vj = { version, dateien: { 'win32-x64': {
            installieren: { datei: 'a.exe', sha256: 'x', signatur: 'y' },
            aktualisieren: { datei: 'a.exe', sha256: 'x', signatur: 'y' } } } };
        writeFileSync(path.join(ordner, 'version.json'), JSON.stringify(vj));
        writeFileSync(path.join(ordner, 'a.exe'), 'INHALT');
        const resp = await request.get('/api/client/version');
        expect(resp.ok()).toBeTruthy();
        expect(await resp.json()).toEqual(vj);
        const datei = await request.get(`/downloads/${version}/a.exe`);
        expect(await datei.text()).toBe('INHALT');
        // Nur der Ordner der eigenen Serverversion ist abrufbar, ältere Stände nicht.
        const alt = path.join(SYNC_TEST_DOWNLOADS, '0.0.1-alt');
        mkdirSync(alt, { recursive: true });
        writeFileSync(path.join(alt, 'a.exe'), 'ALT');
        expect((await request.get('/downloads/0.0.1-alt/a.exe')).status()).toBe(404);
    });

    test('Download-Seite empfiehlt die Datei passend zum Betriebssystem', async ({ browser }) => {
        const d = (datei) => ({ datei, sha256: 'x', signatur: 'y' });
        writeFileSync(path.join(ordner, 'version.json'), JSON.stringify({ version, dateien: {
            'win32-x64': { installieren: d('w.exe'), aktualisieren: d('w.exe') },
            'darwin-universal': { installieren: d('m.dmg'), aktualisieren: d('m.zip') },
            'linux-x64': { installieren: d('l.AppImage'), aktualisieren: d('l.AppImage') } } }));
        const faelle = [
            ['Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'w.exe'],
            ['Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)', 'm.dmg'],
            ['Mozilla/5.0 (X11; Linux x86_64)', 'l.AppImage']
        ];
        for (const [ua, datei] of faelle) {
            const ctx = await browser.newContext({ userAgent: ua });
            const page = await ctx.newPage();
            await page.goto('/download');
            await expect(page.locator('#downloadHauptlink')).toHaveAttribute('href', `/downloads/${version}/${datei}`);
            await expect(page.locator('#downloadWeitere a')).toHaveCount(2);
            await ctx.close();
        }
    });

    test('Download-Seite: Apple-Geräte bekommen einen Hinweis, Android ohne APK ebenfalls', async ({ browser }) => {
        const faelle = [
            ['Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 Chrome/126.0 Safari/537.36', 0, 'Für Android liegt auf diesem Server noch keine App vor'],
            ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148', 0, 'iPhone und iPad'],
            // iPadOS meldet sich als Mac — nur die Touch-Punkte verraten das Tablet.
            ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15', 5, 'iPhone und iPad']
        ];
        for (const [ua, touchPunkte, text] of faelle) {
            const ctx = await browser.newContext({ userAgent: ua });
            if (touchPunkte) await ctx.addInitScript((n) => Object.defineProperty(Navigator.prototype, 'maxTouchPoints', { get: () => n }), touchPunkte);
            const page = await ctx.newPage();
            await page.goto('/download');
            await expect(page.locator('#downloadHinweis')).toContainText(text);
            await expect(page.locator('#downloadHauptlink')).toHaveCount(0);
            await expect(page.locator('#downloadWeitere a')).toHaveCount(0);
            await ctx.close();
        }
    });

    test('/api/client/version meldet ohne Dateien den Stand der automatischen Bereitstellung', async ({ request }) => {
        rmSync(path.join(ordner, 'version.json'), { force: true });
        const resp = await request.get('/api/client/version');
        expect(resp.status()).toBe(404);
        // In der Suite ist der Abruf aus (NODE_ENV=test) und nichts mitgeliefert -> "inaktiv".
        expect((await resp.json()).status).toMatchObject({ phase: 'inaktiv' });
        writeFileSync(path.join(ordner, 'version.json'), JSON.stringify({ version, dateien: {} }));
    });

    test('Download-Seite zeigt den Fortschritt, solange der Server die Dateien bereitstellt, und meldet Fehler', async ({ page }) => {
        const antworte = (status) => page.route('**/api/client/version', route => route.fulfill({
            status: 404, contentType: 'application/json', body: JSON.stringify({ success: false, error: 'keine Dateien', status })
        }));
        await antworte({ phase: 'kopiere', datei: 'b.dmg', fertig: 1, gesamt: 5, fehler: null });
        await page.goto('/download');
        await expect(page.locator('#downloadHinweis')).toContainText('stellt die Client-Dateien bereit (2 von 5)');
        await page.unroute('**/api/client/version');
        await antworte({ phase: 'fehler', fehler: 'Kein Release v1 gefunden', fertig: 0, gesamt: 0 });
        await page.goto('/download');
        await expect(page.locator('#downloadHinweis')).toContainText('Kein Release v1 gefunden');
        await expect(page.locator('#downloadHinweis')).toContainText('regelmäßig erneut');
    });

    test('Download-Seite ohne Client-Dateien zeigt einen Hinweis', async ({ page }) => {
        rmSync(path.join(ordner, 'version.json'));
        await page.goto('/download');
        await expect(page.locator('#downloadHinweis')).toContainText('keine Client-Dateien');
        await expect(page.locator('#downloadHauptlink')).toHaveCount(0);
        // Fixture für die folgenden Tests wiederherstellen
        writeFileSync(path.join(ordner, 'version.json'), JSON.stringify({ version, dateien: {} }));
    });

    test('client-konfig.html zeigt die Kopplungskarte, Erneuern aktualisiert den Code', async ({ page, request }) => {
        await page.goto('/client-konfig.html');
        await expect(page.locator('#nav-client-konfig')).toBeVisible();
        const code = (await (await request.get('/api/client/kopplungscode')).json()).code;
        await expect(page.locator('#kopplungKarte')).toBeVisible();
        await expect(page.locator('#kopplungCode')).toHaveText(`${code.slice(0, 3)} ${code.slice(3)}`);
        await page.locator('#kopplungErneuernBtn').click();
        await expect(page.locator('#kopplungCode')).not.toHaveText(`${code.slice(0, 3)} ${code.slice(3)}`);
    });

    test('Kopplung: richtiger Code (mit Leerzeichen) liefert das Geheimnis', async ({ request }) => {
        const { code } = await (await request.get('/api/client/kopplungscode')).json();
        expect(code).toMatch(/^\d{6}$/);
        const resp = await request.post('/api/client/koppeln', { data: { code: `${code.slice(0, 3)} ${code.slice(3)}`, clientId: 'test-client' } });
        expect(resp.status()).toBe(200);
        expect((await resp.json()).secret).toBe('test-geheimnis');
    });

    test('Kopplung: 5 falsche Codes sperren, auch der richtige Code gilt dann nicht', async ({ request }) => {
        const { code } = await (await request.get('/api/client/kopplungscode')).json();
        const falsch = code === '000000' ? '111111' : '000000';
        for (let i = 0; i < 5; i++) {
            const r = await request.post('/api/client/koppeln', { data: { code: falsch, clientId: 'x' } });
            expect(r.status()).toBe(401);
        }
        const gesperrt = await request.post('/api/client/koppeln', { data: { code, clientId: 'x' } });
        expect(gesperrt.status()).toBe(429);
        expect((await gesperrt.json()).restSekunden).toBeGreaterThan(0);
    });

    test('Erneuern ändert den Code', async ({ request }) => {
        const vorher = (await (await request.get('/api/client/kopplungscode')).json()).code;
        let neu = vorher;
        for (let i = 0; i < 5 && neu === vorher; i++) {
            neu = (await (await request.post('/api/client/kopplungscode/erneuern')).json()).code;
        }
        expect(neu).not.toBe(vorher);
        expect((await (await request.get('/api/client/kopplungscode')).json()).code).toBe(neu);
    });
});
