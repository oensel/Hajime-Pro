// Mattenwahl eines Client-Geräts: Vorauswahl aus der Gerätekonfiguration, Wechsel im Betrieb nur
// nach Nachfrage, Warnung wenn laut Heartbeat ein anderes Gerät die Ziel-Matte bedient.
import { test, expect } from '@playwright/test';
import { legeTurnierAn, syncLeerlauf, syncStatus, schreibeClientDokument, CLIENT_BASE_URL } from './helpers.js';

test('Scoreboard am Client: Matte aus der Gerätekonfiguration, Wechsel mit Nachfrage und Warnung', async ({ page, request }) => {
    const turnierId = await legeTurnierAn(request, 'Sync Client Mattenwahl', 2);
    await syncLeerlauf(request);
    const matten = await (await request.get(`/api/kampfflaechen?turnierId=${turnierId}`)).json();
    const [matte1, matte2] = matten.map(m => m.id);
    const { db_name } = await syncStatus(request);

    expect((await request.put(`${CLIENT_BASE_URL}/api/sync/client/matte`, { data: { matte_id: matte1 } })).ok()).toBeTruthy();
    // Ein anderes Gerät bedient laut Heartbeat gerade Matte 2.
    await schreibeClientDokument(request, db_name, {
        _id: 'client:anderes-geraet', dokumenttyp: 'client', client_id: 'anderes-geraet', geraet: 'Tablet 2',
        matte_id: matte2, letzter_kontakt: new Date().toISOString(), bearbeitet_von: 'client-heartbeat'
    });

    await page.goto(`${CLIENT_BASE_URL}/steuerung.html?turnierId=${turnierId}`);
    await expect(page.locator('#matSelect')).toHaveValue(String(matte1));

    // steuerung.html lädt bewusst kein menu.js -> Nachfrage über den nativen confirm()-Dialog.
    let meldung = '';
    page.once('dialog', dialog => { meldung = dialog.message(); dialog.dismiss(); });
    await page.locator('#matSelect').selectOption(String(matte2));
    await expect.poll(() => meldung).toContain('Tablet 2');
    await expect(page.locator('#matSelect')).toHaveValue(String(matte1));
    expect((await (await request.get(`${CLIENT_BASE_URL}/api/sync/client/matte`)).json()).matte_id).toBe(matte1);

    page.once('dialog', dialog => dialog.accept());
    await page.locator('#matSelect').selectOption(String(matte2));
    await expect.poll(async () => (await (await request.get(`${CLIENT_BASE_URL}/api/sync/client/matte`)).json()).matte_id).toBe(matte2);
});
