// End-to-End: dasselbe wie pools-bracket-anzeige.spec.js (siehe dortige Kommentare für die
// ausführliche Begründung von Fixtur-Datei statt echtem Turnier-Import), nur für den vierten
// "Kampfsystem"-Modus dieser App: Jeder-gegen-Jeden (renderMatrix()/#matrixContainer statt
// renderBracket()/#bracketContainer in public/js/pools.js).
//
// Anders als bei den Doppel-KO-Modi gibt es hier strukturell KEINE Kaskaden-Platzhalter: jede
// Paarung steht von Anfang an fest (kein Kämpfer:innen-Slot hängt vom Ausgang eines Vorkampfes
// ab, siehe JederGegenJedenManager.js), die "Sieger H1"/"Freilos statt Platzhalter"-Regressionen
// aus den anderen drei Spec-Dateien sind hier also nicht anwendbar. Stattdessen prüft dieser Test
// die Pool-Kreuztabelle (Matrix): dass Sieg/Niederlage-Zellen, Siege/Punkte/Platz-Spalten korrekt
// aus den Kampfdaten abgeleitet werden, sobald Ergebnisse feststehen.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ladeUndErstelleTurnier, spieleBracketKomplettDurch } from './helpers/pool-fixture-turnier.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTUR = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'fixtures', 'pool-ko-jeder-gegen-jeden.json'), 'utf-8')
);

test('Matrix-Ansicht (pools.html) zeigt für ein Jeder-gegen-Jeden-Turnier nach allen Kämpfen die korrekten Ergebnis-Zellen sowie Siege/Punkte/Platz', async ({ page, request }) => {
    const { turnierId, poolId } = await ladeUndErstelleTurnier(request, FIXTUR);
    // Anders als bei den Doppel-KO-Modi entsteht bei Jeder-gegen-Jeden KEINE Kaskade (alle Kämpfe
    // starten bereits 'bereit', keine Folgekämpfe werden nachträglich befüllt) -- die Schleife in
    // spieleBracketKomplettDurch() läuft hier also einfach nur eine Runde.
    // Vor dem ersten Kampf ist der Bogen komplett leer (zum Ausfüllen per Hand beim Ausdruck).
    await page.goto(`/pools.html?turnierId=${turnierId}`);
    await page.locator(`.btn-view-fightplan[data-id="${poolId}"]`).click();
    await expect(page.locator('#matrixContainer')).toBeVisible();
    for (const klasse of ['.matrix-siege', '.matrix-punkte', '.matrix-platz']) {
        for (const zelle of await page.locator(`#matrixContainer ${klasse}`).all()) {
            await expect(zelle).toHaveText('');
        }
    }
    for (const zelle of await page.locator('#matrixContainer td[data-feld]').all()) {
        await expect(zelle).toHaveText('');
    }

    await spieleBracketKomplettDurch(request, poolId);

    // Live-Zustand aus derselben API laden, aus der auch pools.js seine Matrix befüllt (siehe
    // loadFightplan() -> GET /api/pools/:id in pools.js).
    const poolResp = await request.get(`/api/pools/${poolId}`);
    const pool = await poolResp.json();
    expect(pool.kaempfe).toHaveLength(6);
    expect(pool.kaempfe.every(k => k.status === 'beendet')).toBeTruthy();

    const idByVorname = new Map(pool.teilnehmer.map(t => [t.vorname, t.id]));

    await page.goto(`/pools.html?turnierId=${turnierId}`);
    await page.locator(`.btn-view-fightplan[data-id="${poolId}"]`).click();
    await expect(page.locator('#matrixContainer')).toBeVisible();

    // Deterministische Endstände (Kämpfer 1 gewinnt immer): bei diesem festen Paarungsraster
    // (siehe JederGegenJedenManager.js: [0,1],[2,3],[0,3],[1,2],[0,2],[1,3]) ist Anna in jedem
    // ihrer drei Kämpfe Kämpfer 1 und gewinnt daher alle -- Diana verliert alle drei.
    const erwarteteStandings = [
        { vorname: 'Anna', siege: 3, punkte: 30, platz: '1' },
        { vorname: 'Berta', siege: 2, punkte: 20, platz: '2' },
        { vorname: 'Clara', siege: 1, punkte: 10, platz: '3' },
        { vorname: 'Diana', siege: 0, punkte: 0, platz: '4' }
    ];

    for (const erwartet of erwarteteStandings) {
        const zeile = page.locator(`tr[data-teilnehmer-id="${idByVorname.get(erwartet.vorname)}"]`);
        await expect(zeile).toHaveCount(1);
        await expect(zeile.locator('.matrix-siege')).toHaveText(String(erwartet.siege));
        await expect(zeile.locator('.matrix-punkte')).toHaveText(String(erwartet.punkte));
        await expect(zeile.locator('.matrix-platz')).toHaveText(erwartet.platz);
    }

    // Kampfbogen: eine Spalte je Kampf (Kampfnummer = Reihenfolge), je Kampf Teilzellen Punkte | Ubw.
    // Stichprobe: Anna (Sieg, Ippon = 10) gegen Diana (Niederlage). Beide Zellen stehen im selben Kampf.
    const annaId = idByVorname.get('Anna');
    const dianaId = idByVorname.get('Diana');
    const annaGegenDiana = pool.kaempfe.find(k =>
        [k.kaempfer1_id, k.kaempfer2_id].includes(annaId) && [k.kaempfer1_id, k.kaempfer2_id].includes(dianaId));
    const annaZeile = page.locator(`tr[data-teilnehmer-id="${annaId}"]`);
    const dianaZeile = page.locator(`tr[data-teilnehmer-id="${dianaId}"]`);
    const zelle = (zeile, feld) => zeile.locator(`td[data-kampf-id="${annaGegenDiana.id}"][data-feld="${feld}"]`);
    await expect(zelle(annaZeile, 'punkte')).toHaveText('1');
    await expect(zelle(annaZeile, 'ubw')).toHaveText('10');
    await expect(zelle(dianaZeile, 'punkte')).toHaveText('0');
    await expect(zelle(dianaZeile, 'ubw')).toHaveText('0');

    // Kampfspalten: 6 Köpfe (1..6) in Reihenfolge, Kämpfe ohne Beteiligung sind geschwärzt und leer.
    await expect(page.locator('#matrixContainer thead th[colspan="2"]')).toHaveText(['1', '2', '3', '4', '5', '6']);
    const unbeteiligt = pool.kaempfe.find(k => ![k.kaempfer1_id, k.kaempfer2_id].includes(annaId));
    await expect(annaZeile.locator(`td[data-kampf-id="${unbeteiligt.id}"][data-beteiligt="nein"]`)).toHaveText('');
});
