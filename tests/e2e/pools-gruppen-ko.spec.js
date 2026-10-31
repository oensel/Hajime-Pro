// End-to-End: Gruppen-Vorrunde mit KO-Endrunde (GruppenUeberKreuzManager mit GRUPPEN_KO). Ein 12er-Pool startet als
// Doppel-KO-16, wird in pools.html über die Auswahlliste auf Gruppen-KO umgestellt (vier Dreiergruppen) und komplett
// durchgespielt (Kämpfer 1 gewinnt immer).
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ladeUndErstelleTurnier, spieleBracketKomplettDurch } from './helpers/pool-fixture-turnier.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTUR16 = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'pool-ko-doppel-ko16.json'), 'utf-8'));

test('12er-Pool auf Gruppen-KO umstellen, Gruppen und KO-Endrunde anzeigen, durchspielen', async ({ page, request }) => {
    const { turnierId, poolId } = await ladeUndErstelleTurnier(request, { ...FIXTUR16, teilnehmer: FIXTUR16.teilnehmer.slice(0, 12) });

    await page.goto(`/pools.html?turnierId=${turnierId}`);
    const auswahl = page.locator(`tr.pool-section[data-pool-id="${poolId}"] .pool-system-select`);
    await expect(auswahl).toHaveValue('Doppel-KO-16');
    await expect(auswahl.locator('option')).toHaveText(['DKO-16 – Doppel-KO', 'KOR-16 – KO mit Hoffnungsrunde', 'Gruppen+KO – Gruppen mit KO-Endrunde']);
    await auswahl.selectOption('Gruppen-KO');
    await page.locator('#modalConfirmBtn').click();
    await expect(page.locator(`tr.pool-section[data-pool-id="${poolId}"] .pool-system-select`)).toHaveValue('Gruppen-KO');

    let pool = await (await request.get(`/api/pools/${poolId}`)).json();
    expect(pool.kaempfe).toHaveLength(4 * 3 + 7); // vier Dreiergruppen + VF1-4, HF1-2, F1

    await page.locator(`.btn-view-fightplan[data-id="${poolId}"]`).click();
    const container = page.locator('#ueberKreuzContainer');
    await expect(container).toBeVisible();
    for (const g of ['A', 'B', 'C', 'D']) await expect(container).toContainText(`Gruppe ${g} – Kampfbogen`);
    await expect(container).toContainText('KO-Endrunde');
    const slot = (nr, s) => page.locator(`.bracket-match-card[data-reihenfolge-nummer="${nr}"] [data-kaempfer-slot="${s}"] .fighter-name`);
    await expect(slot('VF1', 1)).toHaveText('1. Gruppe A');
    await expect(slot('VF1', 2)).toHaveText('2. Gruppe B');
    await expect(slot('VF4', 1)).toHaveText('1. Gruppe D');
    await expect(slot('HF1', 1)).toHaveText('Sieger VF1');
    await expect(slot('HF1', 2)).toHaveText('Sieger VF2');
    await expect(slot('F1', 2)).toHaveText('Sieger HF2');

    await spieleBracketKomplettDurch(request, poolId, 12);
    pool = await (await request.get(`/api/pools/${poolId}`)).json();
    expect(pool.status).toBe('kaempfe_beendet');
    expect(pool.kaempfe.every(k => k.status === 'beendet')).toBeTruthy();

    const { berechnePlatzierungen } = await import('../../src/shared/platzierungen.js');
    const plaetze = berechnePlatzierungen(pool, pool.kaempfe, pool.teilnehmer).eintraege.map(e => e.platz);
    expect(plaetze.sort((a, b) => a - b)).toEqual([1, 2, 3, 3, 5, 5, 5, 5, 9, 9, 9, 9]);

    await page.reload();
    await page.locator(`.btn-view-fightplan[data-id="${poolId}"]`).click();
    for (const nr of ['VF1', 'VF2', 'VF3', 'VF4', 'HF1', 'HF2', 'F1']) {
        for (const s of [1, 2]) await expect(slot(nr, s)).not.toHaveText(/^(Sieger|Verlierer|\d\. Gruppe)\s/);
    }
});
