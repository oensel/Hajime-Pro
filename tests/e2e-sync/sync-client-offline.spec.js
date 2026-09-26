// Offline-Betrieb eines Client-Geräts: die Matte spielt einen kompletten Doppel-KO-8-Pool ohne
// Verbindung zum Hallen-Server (Offline-Kaskade am Gerät), danach wird alles übertragen und der
// Server kommt zum selben Ergebnis.
import { test, expect } from '@playwright/test';
import { richteDk8TurnierEin, syncLeerlauf, clientTrennen, clientVerbinden, clientStatus, CLIENT_BASE_URL } from './helpers.js';

async function spieleKomplettDurch(page, anzahl) {
    let vorher = 'Kämpfer 1|Kämpfer 2';
    for (let i = 0; i < anzahl; i++) {
        await page.locator('#btnNaechsterKampfLive').click();
        await page.waitForFunction(
            (v) => `${document.getElementById('nameW').value}|${document.getElementById('nameB').value}` !== v, vorher
        );
        vorher = await page.evaluate(() => `${document.getElementById('nameW').value}|${document.getElementById('nameB').value}`);
        await page.evaluate(() => window.changeScore('W', 'ippon', 1));
        await expect(page.locator('#btnErgebnisSendenLive')).toBeVisible();
        await page.locator('#btnErgebnisSendenLive').click();
        await expect(page.locator('#btnNaechsterKampfLive')).toBeVisible();
    }
}

test('Scoreboard am Client: DK8 komplett offline, danach identisch am Server', async ({ page, request }) => {
    test.setTimeout(180_000);
    const { turnierId, matId } = await richteDk8TurnierEin(request, 'Sync Client Offline DK8');
    await syncLeerlauf(request);
    const matteGesetzt = await request.put(`${CLIENT_BASE_URL}/api/sync/client/matte`, { data: { matte_id: matId } });
    expect(matteGesetzt.ok()).toBeTruthy();

    await clientTrennen(request);
    await page.goto(`${CLIENT_BASE_URL}/steuerung.html?turnierId=${turnierId}&matId=${matId}`);
    await expect(page.locator('#matSelect')).toHaveValue(String(matId));
    await spieleKomplettDurch(page, 11);

    // Lokal (Client-API) ist der Pool komplett durch — ohne jeden Server-Kontakt.
    const lokal = await (await request.get(`${CLIENT_BASE_URL}/api/kaempfe?kampfflaecheId=${matId}`)).json();
    expect(lokal.every(k => k.status === 'beendet')).toBe(true);
    expect(lokal.find(k => k.reihenfolge_nummer === 'F').kaempfer1_nachname).toBe('Adler');
    expect((await clientStatus(request)).ausstehend).toBeGreaterThan(0);
    // Statusleiste (syncStatus.js): gelb mit Anzahl der ausstehenden Änderungen.
    await expect(page.locator('#syncStatusLeiste')).toHaveAttribute('data-zustand', 'offline');
    await expect(page.locator('#syncStatusLeiste')).toContainText('ausstehend');
    const serverVorher = await (await request.get(`/api/kaempfe?kampfflaecheId=${matId}`)).json();
    expect(serverVorher.some(k => k.status !== 'beendet')).toBe(true);

    await clientVerbinden(request);
    await syncLeerlauf(request);
    await expect(page.locator('#syncStatusLeiste')).toHaveAttribute('data-zustand', 'verbunden');
    await expect(page.locator('#syncStatusLeiste')).toHaveText('verbunden');

    const server = await (await request.get(`/api/kaempfe?kampfflaecheId=${matId}`)).json();
    expect(server).toHaveLength(11);
    expect(server.every(k => k.status === 'beendet')).toBe(true);
    const finale = server.find(k => k.reihenfolge_nummer === 'F');
    expect(finale.sieger_id).toBe(finale.kaempfer1_id);
    expect(finale.kaempfer1_nachname).toBe('Adler');
    // Lokale Kaskade und Server-Kaskade kommen zu denselben Paarungen.
    const paarung = (l) => Object.fromEntries(l.map(k => [k.reihenfolge_nummer, [k.kaempfer1_nachname, k.kaempfer2_nachname, k.sieger_id === k.kaempfer1_id]]));
    expect(paarung(server)).toEqual(paarung(lokal));
    expect((await clientStatus(request)).ausstehend).toBe(0);
});
