// Scoreboard (steuerung.html) im Sync-Modus: ein kompletter Doppel-KO-8-Pool läuft über die
// Dokument-DB und die Brücke — mit demselben Endergebnis wie online (vgl.
// tests/e2e/steuerung-dk8-komplett.spec.js, identische Bedienfolge).
import { test, expect } from '@playwright/test';
import { warteLeerlauf, richteDk8TurnierEin, syncStatus, alleDokumente } from './helpers.js';
import { schliesseOverlayAutomatisch } from '../e2e/helpers/pool-beginn-overlay.js';

// W (kaempfer1) gewinnt jeden Kampf per Ippon.
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

test('Scoreboard im Sync-Modus: kompletter DK8-Pool, Ergebnis wie online', async ({ page, request }) => {
    test.setTimeout(120_000);
    const { turnierId, matId } = await richteDk8TurnierEin(request, 'Sync Scoreboard');
    await warteLeerlauf(request);

    await page.goto(`/steuerung.html?turnierId=${turnierId}&matId=${matId}`);

    await schliesseOverlayAutomatisch(page);
    await expect(page.locator('#matSelect')).toHaveValue(String(matId));
    await spieleKomplettDurch(page, 11);
    await warteLeerlauf(request);

    const kaempfe = await (await request.get(`/api/kaempfe?kampfflaecheId=${matId}`)).json();
    expect(kaempfe).toHaveLength(11);
    expect(kaempfe.every(k => k.status === 'beendet')).toBe(true);
    const finale = kaempfe.find(k => k.reihenfolge_nummer === 'F');
    expect(finale.sieger_id).toBe(finale.kaempfer1_id);
    expect(finale.kaempfer1_nachname).toBe('Adler');

    // Nachweis des Dokument-Wegs: jedes Kampf-Dokument hat mehr als zwei Revisionen (Anlage durch
    // den Abgleich + mindestens eine Browser-Änderung + Server-Bestätigung).
    const { db_name } = await syncStatus(request);
    const docs = (await alleDokumente(request, db_name)).filter(d => d.dokumenttyp === 'kampf');
    expect(docs.every(d => parseInt(d._rev, 10) > 2)).toBe(true);
});
