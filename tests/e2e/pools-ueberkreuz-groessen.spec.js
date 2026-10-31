// End-to-End: Gruppen-Überkreuz mit 7 bis 10 Teilnehmern (GruppenUeberKreuzManager.js). Ein 8er-Pool startet als
// Doppel-KO-8, wird in pools.html über die Auswahlliste auf Gruppen-Überkreuz umgestellt (zwei Vierergruppen) und
// komplett durchgespielt (Kämpfer 1 gewinnt immer).
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ladeUndErstelleTurnier, spieleBracketKomplettDurch } from './helpers/pool-fixture-turnier.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTUR16 = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'pool-ko-doppel-ko16.json'), 'utf-8'));
const fixtur = anzahl => ({ ...FIXTUR16, teilnehmer: FIXTUR16.teilnehmer.slice(0, anzahl) });

test('8er-Pool auf Gruppen-Überkreuz umstellen und durchspielen', async ({ page, request }) => {
    const { turnierId, poolId } = await ladeUndErstelleTurnier(request, fixtur(8));

    await page.goto(`/pools.html?turnierId=${turnierId}`);
    const auswahl = page.locator(`tr.pool-section[data-pool-id="${poolId}"] .pool-system-select`);
    await expect(auswahl).toHaveValue('Doppel-KO-8');
    await expect(auswahl.locator('option')).toHaveText(['DKO-8 – Doppel-KO', 'Pool+Ko – Gruppen über Kreuz']);
    await auswahl.selectOption('Gruppen-Überkreuz');
    await page.locator('#modalConfirmBtn').click();
    await expect(page.locator(`tr.pool-section[data-pool-id="${poolId}"] .pool-system-select`)).toHaveValue('Gruppen-Überkreuz');

    let pool = await (await request.get(`/api/pools/${poolId}`)).json();
    expect(pool.modus).toBe('Gruppen-Überkreuz');
    expect(pool.kaempfe).toHaveLength(15); // 2 × 6 Vorrunde + HF1, HF2, F1

    await page.locator(`.btn-view-fightplan[data-id="${poolId}"]`).click();
    const container = page.locator('#ueberKreuzContainer');
    await expect(container).toBeVisible();
    await expect(container).toContainText('Gruppe A – Kampfbogen');
    await expect(container).toContainText('Gruppe B – Kampfbogen');
    const hf1 = page.locator('.bracket-match-card[data-reihenfolge-nummer="HF1"]');
    await expect(hf1.locator('[data-kaempfer-slot="1"] .fighter-name')).toHaveText('1. Gruppe A');
    await expect(hf1.locator('[data-kaempfer-slot="2"] .fighter-name')).toHaveText('2. Gruppe B');

    await spieleBracketKomplettDurch(request, poolId, 12);
    pool = await (await request.get(`/api/pools/${poolId}`)).json();
    expect(pool.status).toBe('kaempfe_beendet');
    expect(pool.kaempfe.every(k => k.status === 'beendet')).toBeTruthy();

    const { berechnePlatzierungen } = await import('../../src/shared/platzierungen.js');
    const plaetze = berechnePlatzierungen(pool, pool.kaempfe, pool.teilnehmer).eintraege.map(e => e.platz);
    expect(plaetze.sort((a, b) => a - b)).toEqual([1, 2, 3, 3, 5, 5, 7, 7]);
});

test('Ein Überkreuz-Pool bleibt beim System, wenn sich vor Beginn die Teilnehmerzahl ändert', async ({ request }) => {
    const { poolId } = await ladeUndErstelleTurnier(request, fixtur(9));
    const umstellen = await request.put(`/api/pools/${poolId}/system`, { data: { modus: 'Gruppen-Überkreuz' } });
    expect(umstellen.ok(), await umstellen.text()).toBeTruthy();
    let pool = await (await request.get(`/api/pools/${poolId}`)).json();
    expect(pool.kaempfe).toHaveLength(10 + 6 + 3); // Gruppe A 5er, Gruppe B 4er

    // einen herausnehmen (9 → 8): bleibt Überkreuz mit zwei Vierergruppen
    const teilnehmerId = pool.teilnehmer[0].id;
    const raus = await request.post('/api/pools/verschieben', { data: { teilnehmerId, zielPoolId: null } });
    expect(raus.ok(), await raus.text()).toBeTruthy();
    pool = await (await request.get(`/api/pools/${poolId}`)).json();
    expect(pool.modus).toBe('Gruppen-Überkreuz');
    expect(pool.kaempfe).toHaveLength(6 + 6 + 3);

    // und wieder hinein (8 → 9)
    const rein = await request.post('/api/pools/verschieben', { data: { teilnehmerId, zielPoolId: poolId } });
    expect(rein.ok(), await rein.text()).toBeTruthy();
    pool = await (await request.get(`/api/pools/${poolId}`)).json();
    expect(pool.modus).toBe('Gruppen-Überkreuz');
    expect(pool.kaempfe).toHaveLength(10 + 6 + 3);
});
