// Teilnehmerliste am Client-Gerät: lädt auch dann nach, wenn der Sync-Status beim Öffnen der Seite
// nicht abrufbar ist (z.B. Laufzeit der App direkt nach dem Start noch nicht bereit) und die Liste
// zuerst leer war, weil die Replikation noch nicht durch war. Früher blieb die Liste dann leer, bis
// die Seite von Hand neu geöffnet wurde.
import { test, expect } from '@playwright/test';
import { richteDk8TurnierEin, syncLeerlauf, DK8_TEILNEHMER, CLIENT_BASE_URL } from './helpers.js';

test('Liste lädt nach, obwohl der Sync-Status beim Start fehlt und die erste Antwort leer war', async ({ page, request }) => {
    test.setTimeout(120_000);
    const { turnierId, teilnehmerIds } = await richteDk8TurnierEin(request, 'Sync Liste Nachladen');
    await syncLeerlauf(request);

    // Sync-Status zunächst nicht abrufbar, die Teilnehmerliste zunächst leer
    const statusFehlerBis = Date.now() + 6000;
    await page.route('**/api/sync/status', route => (Date.now() < statusFehlerBis
        ? route.fulfill({ status: 500, contentType: 'application/json', body: '{}' })
        : route.continue()));
    let listeLeer = true;
    await page.route('**/api/teilnehmer?turnierId=*', route => (listeLeer
        ? route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
        : route.continue()));

    await page.goto(`${CLIENT_BASE_URL}/teilnehmer.html?turnierId=${turnierId}`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('#teilnehmerTableBody')).not.toContainText(DK8_TEILNEHMER[0].nachname);

    // Die Daten sind jetzt da (Replikation fertig); die Seite wird NICHT neu geladen
    listeLeer = false;
    await expect(page.locator('#teilnehmerTableBody tr')).toHaveCount(teilnehmerIds.length, { timeout: 25_000 });
    await expect(page.locator('#teilnehmerTableBody')).toContainText(DK8_TEILNEHMER[0].nachname);
});
