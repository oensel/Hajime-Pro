// Waage an einem Client-Gerät ohne Verbindung zum Hallen-Server: Wiegen (Formular + Datenzugriff)
// und eine Nachmeldung werden lokal gespeichert und nach dem Verbinden vollständig übertragen —
// die Nachmeldung genau einmal.
import { test, expect } from '@playwright/test';
import { richteDk8TurnierEin, syncLeerlauf, clientTrennen, clientVerbinden, clientStatus, CLIENT_BASE_URL } from './helpers.js';

test('Waage offline: 5 Wiegungen und 1 Nachmeldung, danach vollständig am Server', async ({ page, request }) => {
    test.setTimeout(120_000);
    const { turnierId, teilnehmerIds } = await richteDk8TurnierEin(request, 'Sync Client Waage');
    // Als ausrichtender Verein verlangt das Formular Judopass und gültige Lizenz.
    for (const [i, id] of teilnehmerIds.entries()) {
        const r = await request.put(`/api/teilnehmer/${id}`, { data: { judopass_id: `CW-${i}`, lizenz_ablauf: '2030-12-31' } });
        expect(r.ok(), await r.text()).toBeTruthy();
    }
    await syncLeerlauf(request);
    await clientTrennen(request);

    await page.goto(`${CLIENT_BASE_URL}/teilnehmer.html?turnierId=${turnierId}`);
    await page.waitForFunction(() => typeof window.oeffneWaageModal === 'function' && !!window.Datenzugriff);

    // 1 Wiegung über das Formular.
    await page.evaluate((id) => window.oeffneWaageModal(id), teilnehmerIds[0]);
    await expect(page.locator('#vorname')).toHaveValue('Anna');
    await page.locator('#gewicht').fill('59,10');
    await expect(page.locator('#submitBtn')).toBeEnabled();
    await page.locator('#submitBtn').click();
    await page.getByRole('button', { name: 'Ja', exact: true }).click({ timeout: 3000 }).catch(() => {});
    await expect(page.locator('#snackbarText')).toContainText('Lokal gespeichert');

    // 4 weitere Wiegungen und 1 Nachmeldung über den Datenzugriff der Seite.
    const ergebnisse = await page.evaluate(async ({ ids, turnierId }) => {
        const r = [];
        for (let i = 1; i <= 4; i++) {
            r.push(await window.Datenzugriff.speichereTeilnehmer(ids[i], { gewicht: 70 + i, gewogen: true }));
        }
        r.push(await window.Datenzugriff.speichereTeilnehmer(null, {
            turnier_id: turnierId, vorname: 'Nora', nachname: 'Nachzügler', verein: 'JC Spät', judopass_id: 'NZ-1',
            geburtsjahr: 2009, geschlecht: 'männlich', gewicht: 72.3, altersklasse: 'U18', gewichtsklasse: '-73kg', gewogen: true
        }));
        return r;
    }, { ids: teilnehmerIds, turnierId });
    expect(ergebnisse.every(e => e.ok && e.ausstehend)).toBe(true);
    expect((await clientStatus(request)).ausstehend).toBe(6);
    await expect(page.locator('#syncStatusLeiste')).toContainText('6 Änderungen ausstehend');

    await clientVerbinden(request);
    await syncLeerlauf(request);

    const liste = await (await request.get(`/api/teilnehmer?turnierId=${turnierId}`)).json();
    const gewichtVon = (id) => parseFloat(liste.find(t => t.id === id).gewicht);
    expect(gewichtVon(teilnehmerIds[0])).toBe(59.1);
    for (let i = 1; i <= 4; i++) expect(gewichtVon(teilnehmerIds[i])).toBe(70 + i);
    const nachmeldungen = liste.filter(t => t.judopass_id === 'NZ-1');
    expect(nachmeldungen).toHaveLength(1);
    expect(parseFloat(nachmeldungen[0].gewicht)).toBe(72.3);
    expect((await clientStatus(request)).ausstehend).toBe(0);
});
