// End-to-End: Live-Durchsage in steuerung.html. Chromium liefert per Fake-Mikrofon einen Testton; der Server leitet das PCM
// an den Fake-Player weiter (DURCHSAGE_PLAYER_BEFEHL in test-env.js), der es in eine Datei schreibt.
import { test, expect } from '@playwright/test';
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import { DURCHSAGE_TESTDATEI } from './test-env.js';

test.use({
    permissions: ['microphone'],
    launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] }
});

test('Durchsage: Strg halten sendet Mikrofon-PCM an den Player des Servers', async ({ page, request }) => {
    rmSync(DURCHSAGE_TESTDATEI, { force: true });

    const status = await (await request.get('/api/durchsage/status')).json();
    expect(status.verfuegbar, status.grund).toBe(true);

    // Turnier und Matte anlegen, sonst überdecken Fehlermeldung bzw. Turnier-Auswahl den Knopf.
    const turnierResp = await request.post('/api/turniere', {
        data: { bezeichnung: 'Durchsage', ort: 'Teststadt', datum: '2027-04-10', ausrichter: 'JC Test', anzahl_kampfflaechen: 1 }
    });
    expect(turnierResp.ok(), await turnierResp.text()).toBeTruthy();

    const { turnierId } = await turnierResp.json();
    const [{ id: matId }] = await (await request.get(`/api/kampfflaechen?turnierId=${turnierId}`)).json();

    await page.goto(`/steuerung.html?turnierId=${turnierId}&matId=${matId}`);
    const statusZeile = page.locator('#durchsageStatus');
    await expect(statusZeile).toHaveAttribute('data-phase', 'bereit', { timeout: 10_000 });

    // Strg halten sendet, loslassen beendet
    await page.keyboard.down('Control');
    await expect(statusZeile).toContainText('Sendet', { timeout: 10_000 });
    await expect(statusZeile).toHaveClass(/durchsage-aktiv/);
    await page.waitForTimeout(1200);
    await page.keyboard.up('Control');

    await expect(statusZeile).toHaveText('');
    await expect(statusZeile).not.toHaveClass(/durchsage-aktiv/);
    await expect.poll(() => existsSync(DURCHSAGE_TESTDATEI) ? statSync(DURCHSAGE_TESTDATEI).size : 0, { timeout: 10_000 }).toBeGreaterThan(16000);

    // Fake-Mikrofon liefert einen Piepton: die Aufnahme darf nicht komplett still sein.
    const daten = readFileSync(DURCHSAGE_TESTDATEI);
    const werte = new Int16Array(daten.buffer, daten.byteOffset, Math.floor(daten.length / 2));
    expect(werte.some(v => Math.abs(v) > 500)).toBe(true);

    await expect.poll(async () => (await (await request.get('/api/durchsage/status')).json()).besetzt).toBe(false);
});
