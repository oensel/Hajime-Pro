// End-to-End: die Details-Spalte (Kampfplan/Turnierbaum ansehen, drucken, Pool abschließen) muss
// auf pools.html ohne horizontales Scrollen erreichbar sein. Die Pool-Tabelle ist breiter als der
// Platz neben der Seitenleiste (Summe der Mindestbreiten der Spalten), und die Details-Spalte steht
// ganz rechts -- ohne Fixierung verschwindet sie hinter dem Rand des Scroll-Bereichs, dessen
// Scrollleiste erst unter dem letzten Pool sitzt. Die übrigen pools-bracket-anzeige-Specs merken
// das nicht, weil Playwrights click() den Button selbst in den sichtbaren Bereich scrollt.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ladeUndErstelleTurnier } from './helpers/pool-fixture-turnier.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTUR = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'fixtures', 'pool-ko-jeder-gegen-jeden.json'), 'utf-8')
);

test('Details-Spalte (pools.html) bleibt auf einem Notebook-Bildschirm ohne horizontales Scrollen sichtbar', async ({ page, request }) => {
    const { turnierId, poolId } = await ladeUndErstelleTurnier(request, FIXTUR);

    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`/pools.html?turnierId=${turnierId}`);

    const button = page.locator(`.btn-view-fightplan[data-id="${poolId}"]`);
    await expect(button).toHaveCount(1);

    const lage = await button.evaluate(el => {
        const knopf = el.getBoundingClientRect();
        const scrollBereich = el.closest('.pools-table-wrapper').getBoundingClientRect();
        return { knopfLinks: knopf.left, knopfRechts: knopf.right, bereichLinks: scrollBereich.left, bereichRechts: scrollBereich.right };
    });
    expect(lage.knopfLinks).toBeGreaterThanOrEqual(lage.bereichLinks);
    expect(lage.knopfRechts).toBeLessThanOrEqual(lage.bereichRechts);

    // Auch der Spaltenkopf bleibt über dem Button stehen.
    const kopf = await page.locator('#poolsContainer .pools-table-header th').last().evaluate(el => {
        const th = el.getBoundingClientRect();
        return { rechts: th.right, bereichRechts: el.closest('.pools-table-wrapper').getBoundingClientRect().right };
    });
    expect(kopf.rechts).toBeLessThanOrEqual(kopf.bereichRechts + 1);
});
