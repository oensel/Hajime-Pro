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
