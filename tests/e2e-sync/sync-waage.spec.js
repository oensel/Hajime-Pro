// Waage (teilnehmer.html, waage-modal.js) im Sync-Modus: das Speichern läuft über die
// Dokument-DB und die Brücke in die relationale DB.
import { test, expect } from '@playwright/test';
import { warteLeerlauf, richteDk8TurnierEin, syncStatus, ladeDokument } from './helpers.js';

test('Waage im Sync-Modus: Gewicht ändern läuft über die Dokument-DB in die relationale DB', async ({ page, request }) => {
    const { turnierId, teilnehmerIds } = await richteDk8TurnierEin(request, 'Sync Waage');
    // Als ausrichtender Verein verlangt die Waage Judopass und gültige Lizenz (siehe
    // aktualisiereSpeicherButtonStatus in waage-modal.js) — die DK8-Fixtur hat beides nicht.
    const vorbereitet = await request.put(`/api/teilnehmer/${teilnehmerIds[0]}`, {
        data: { judopass_id: 'WA-1', lizenz_ablauf: '2030-12-31' }
    });
    expect(vorbereitet.ok(), await vorbereitet.text()).toBeTruthy();
    await warteLeerlauf(request);
    const { db_name } = await syncStatus(request);
    const docId = `teilnehmer:${teilnehmerIds[0]}`;
    const revVorher = (await ladeDokument(request, db_name, docId))._rev;

    await page.goto(`/teilnehmer.html?turnierId=${turnierId}`);
    // Erst nach der asynchronen Initialisierung (Gastgeber-Status, Konfiguration) öffnen — sonst
    // bewertet die Lizenzprüfung das Formular gelegentlich vor dem Gastgeber-Status.
    await page.waitForLoadState('networkidle');
    await page.waitForFunction(() => typeof window.oeffneWaageModal === 'function');
    await page.evaluate((id) => window.oeffneWaageModal(id), teilnehmerIds[0]);
    await expect(page.locator('#vorname')).toHaveValue('Anna');
    await page.locator('#gewicht').fill('59,40');
    await expect(page.locator('#submitBtn')).toBeEnabled();
    await page.locator('#submitBtn').click();
    // "Als gewogen markieren?" — erscheint nur bei geändertem Gewicht (ausrichtender Verein).
    const ja = page.getByRole('button', { name: 'Ja', exact: true });
    await ja.click({ timeout: 3000 }).catch(() => {});

    await expect.poll(async () => {
        const t = await (await request.get(`/api/teilnehmer/${teilnehmerIds[0]}`)).json();
        return parseFloat(t.gewicht);
    }).toBe(59.4);
    await warteLeerlauf(request);
    const doc = await ladeDokument(request, db_name, docId);
    expect(doc.bearbeitet_von).toBe('server');
    // Nachweis des Dokument-Wegs: Browser-Änderung + Server-Bestätigung = mindestens zwei neue
    // Revisionen (über REST entstünde nur eine durch den Abgleich).
    expect(parseInt(doc._rev, 10)).toBeGreaterThan(parseInt(revVorher, 10) + 1);
});
