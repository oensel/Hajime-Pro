// End-to-End: KO-System mit Hoffnungsrunde (src/shared/koRepechage.js). Ein 16er-Pool startet als Doppel-KO-16,
// wird in pools.html auf KO-Repechage-16 umgestellt und komplett durchgespielt (Kämpfer 1 gewinnt immer).
// Geprüft: Umschalten, Platzhalter der Hoffnungsrunde und der Bronzekämpfe (über Kreuz), 19 statt 27 Kämpfe,
// Platzierungen 1,2,3,3,5,5,7,7 und dass eine spätere Teilnehmerverschiebung das System nicht zurücksetzt.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ladeUndErstelleTurnier, spieleBracketKomplettDurch } from './helpers/pool-fixture-turnier.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTUR = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'pool-ko-doppel-ko16.json'), 'utf-8'));

test('16er-Pool auf KO-Repechage umstellen, Hoffnungsrunde anzeigen und durchspielen', async ({ page, request }) => {
    const { turnierId, poolId } = await ladeUndErstelleTurnier(request, FIXTUR);

    await page.goto(`/pools.html?turnierId=${turnierId}`);
    const zeile = page.locator(`tr.pool-section[data-pool-id="${poolId}"]`);
    const auswahl = zeile.locator('.pool-system-select');
    await expect(auswahl).toHaveValue('Doppel-KO-16');
    // 16 Teilnehmer: Doppel-KO oder KO-Repechage (Gruppen-Überkreuz nur bis 10)
    await expect(auswahl.locator('option')).toHaveText(['DKO-16 – Doppel-KO', 'KOR-16 – KO mit Hoffnungsrunde']);

    await auswahl.selectOption('KO-Repechage-16');
    await expect(page.locator('#modalMessage')).toContainText('KO-Repechage-16');
    await page.locator('#modalConfirmBtn').click();
    await expect(zeile.locator('.pool-system-select')).toHaveValue('KO-Repechage-16');

    let pool = await (await request.get(`/api/pools/${poolId}`)).json();
    expect(pool.modus).toBe('KO-Repechage-16');
    expect(pool.kaempfe).toHaveLength(19);

    await zeile.locator('.btn-view-fightplan').click();
    await expect(page.locator('#bracketContainer')).toBeVisible();
    await expect(page.locator('#bracketContainer')).toContainText('Hoffnungsrunde (Repechage)');
    const karte = nr => page.locator(`.bracket-match-card[data-reihenfolge-nummer="${nr}"]`);
    const slot = (nr, s) => karte(nr).locator(`[data-kaempfer-slot="${s}"] .fighter-name`);
    await expect(slot('T1', 1)).toHaveText('Verlierer VF1');
    await expect(slot('T1', 2)).toHaveText('Verlierer VF2');
    await expect(slot('T3', 1)).toHaveText('Sieger Hoffnungsrunde 1');
    await expect(slot('T3', 2)).toHaveText('Verlierer HF2');
    await expect(slot('T4', 2)).toHaveText('Verlierer HF1');
    await expect(slot('F1', 1)).toHaveText('Sieger HF1');
    await expect(karte('T3').locator('.bracket-match-badge')).toHaveText('kleines Finale 1');

    await spieleBracketKomplettDurch(request, poolId, 8);
    pool = await (await request.get(`/api/pools/${poolId}`)).json();
    expect(pool.kaempfe.every(k => k.status === 'beendet' || k.status === 'freilos')).toBeTruthy();
    expect(pool.status).toBe('kaempfe_beendet');

    // Hoffnungsrunde = die vier Viertelfinal-Verlierer, Bronze über Kreuz gegen den anderen Halbfinal-Verlierer
    const k = n => pool.kaempfe.find(x => x.reihenfolge_nummer === n);
    const verlierer = x => (x.sieger_id === x.kaempfer1_id ? x.kaempfer2_id : x.kaempfer1_id);
    expect([k('T1').kaempfer1_id, k('T1').kaempfer2_id]).toEqual([verlierer(k('H9')), verlierer(k('H10'))]);
    expect([k('T2').kaempfer1_id, k('T2').kaempfer2_id]).toEqual([verlierer(k('H11')), verlierer(k('H12'))]);
    expect(k('T3').kaempfer2_id).toBe(verlierer(k('H14')));
    expect(k('T4').kaempfer2_id).toBe(verlierer(k('H13')));

    const { berechnePlatzierungen } = await import('../../src/shared/platzierungen.js');
    const plaetze = berechnePlatzierungen(pool, pool.kaempfe, pool.teilnehmer).eintraege.map(e => e.platz).filter(p => p != null);
    expect(plaetze.sort((a, b) => a - b)).toEqual([1, 2, 3, 3, 5, 5, 7, 7]);

    await page.reload();
    await page.locator(`.btn-view-fightplan[data-id="${poolId}"]`).click();
    for (const kampf of pool.kaempfe) {
        for (const s of [1, 2]) await expect(slot(kampf.reihenfolge_nummer, s)).not.toHaveText(/^(Sieger|Verlierer)\s/);
    }
});

test('Ein KO-Repechage-Pool bleibt beim System, wenn sich vor Beginn die Teilnehmerzahl ändert', async ({ request }) => {
    const { poolId } = await ladeUndErstelleTurnier(request, FIXTUR);
    const umstellen = await request.put(`/api/pools/${poolId}/system`, { data: { modus: 'KO-Repechage-16' } });
    expect(umstellen.ok(), await umstellen.text()).toBeTruthy();

    // einen Teilnehmer herausnehmen: der Kampfplan wird neu aufgebaut (15 Teilnehmer, ein Freilos)
    const pool = await (await request.get(`/api/pools/${poolId}`)).json();
    const raus = await request.post('/api/pools/verschieben', { data: { teilnehmerId: pool.teilnehmer[0].id, zielPoolId: null } });
    expect(raus.ok(), await raus.text()).toBeTruthy();

    const nachher = await (await request.get(`/api/pools/${poolId}`)).json();
    expect(nachher.modus).toBe('KO-Repechage-16');
    expect(nachher.kaempfe).toHaveLength(19);
    expect(nachher.kaempfe.filter(x => x.status === 'freilos').length).toBe(1);

    // ungültiges Ziel wird abgelehnt
    const falsch = await request.put(`/api/pools/${poolId}/system`, { data: { modus: 'KO-Repechage-64' } });
    expect(falsch.status()).toBe(400);
});
