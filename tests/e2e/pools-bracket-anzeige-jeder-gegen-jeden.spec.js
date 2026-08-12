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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTUR = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'fixtures', 'pool-ko-jeder-gegen-jeden.json'), 'utf-8')
);

async function ladeUndErstelleTurnier(request, fixtur) {
    const turnierResp = await request.post('/api/turniere', { data: fixtur.turnier });
    expect(turnierResp.ok(), await turnierResp.text()).toBeTruthy();
    const { turnierId } = await turnierResp.json();

    const poolResp = await request.post('/api/pools', {
        data: { turnier_id: turnierId, ...fixtur.pool }
    });
    expect(poolResp.ok(), await poolResp.text()).toBeTruthy();
    const { poolId } = await poolResp.json();

    const teilnehmerIds = [];
    for (const t of fixtur.teilnehmer) {
        const tResp = await request.post('/api/teilnehmer', {
            data: {
                turnier_id: turnierId, vorname: t.vorname, nachname: t.nachname, verein: t.verein,
                geburtsjahr: t.geburtsjahr, geschlecht: fixtur.pool.geschlecht, gewicht: t.gewicht,
                altersklasse: fixtur.pool.altersklasse, gewichtsklasse: fixtur.pool.gewichtsklasse
            }
        });
        expect(tResp.ok(), await tResp.text()).toBeTruthy();
        const { teilnehmerId } = await tResp.json();
        teilnehmerIds.push(teilnehmerId);
    }

    // Reihenfolge identisch zur Fixtur -- Voraussetzung für ein deterministisches Paarungsraster
    // (siehe JederGegenJedenManager.js: Teilnehmer werden ohne eigenes ORDER BY gelesen, SQLite
    // liefert ohne Sortierung Einfüge-/Rowid-Reihenfolge).
    for (const teilnehmerId of teilnehmerIds) {
        const moveResp = await request.post('/api/pools/verschieben', { data: { teilnehmerId, zielPoolId: poolId } });
        expect(moveResp.ok(), await moveResp.text()).toBeTruthy();
    }

    return { turnierId, poolId };
}

// Spielt alle Kämpfe eines Jeder-gegen-Jeden-Pools direkt über die API durch -- Kämpfer 1 gewinnt
// dabei immer per Ippon. Anders als bei den Doppel-KO-Modi entsteht dabei KEINE Kaskade (alle
// Kämpfe starten bereits 'bereit', keine Folgekämpfe werden nachträglich befüllt), ein einziger
// Durchlauf reicht daher aus.
async function spieleAlleKaempfeDurch(request, poolId) {
    const resp = await request.get(`/api/kaempfe?poolId=${poolId}`);
    const kaempfe = await resp.json();
    for (const k of kaempfe) {
        const updateResp = await request.put(`/api/kaempfe/${k.id}`, {
            data: {
                status: 'beendet', sieger_id: k.kaempfer1_id,
                unterbewertung_kaempfer1: 10, unterbewertung_kaempfer2: 0,
                kampfzeit_in_sekunden: 90
            }
        });
        expect(updateResp.ok(), await updateResp.text()).toBeTruthy();
    }
}

test('Matrix-Ansicht (pools.html) zeigt für ein Jeder-gegen-Jeden-Turnier nach allen Kämpfen die korrekten Ergebnis-Zellen sowie Siege/Punkte/Platz', async ({ page, request }) => {
    const { turnierId, poolId } = await ladeUndErstelleTurnier(request, FIXTUR);
    await spieleAlleKaempfeDurch(request, poolId);

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

    // Eine konkrete Kreuz-Zelle stichprobenartig prüfen: Anna (Sieg, Ippon = 10 Punkte) gegen
    // Diana (Niederlage, per Konvention immer '0' -- siehe renderMatrix() in pools.js).
    const annaZeile = page.locator(`tr[data-teilnehmer-id="${idByVorname.get('Anna')}"]`);
    await expect(annaZeile.locator(`td[data-gegner-id="${idByVorname.get('Diana')}"]`)).toHaveText('10');
    const dianaZeile = page.locator(`tr[data-teilnehmer-id="${idByVorname.get('Diana')}"]`);
    await expect(dianaZeile.locator(`td[data-gegner-id="${idByVorname.get('Anna')}"]`)).toHaveText('0');

    // Diagonale (gegen sich selbst) bleibt leer/geschwärzt.
    await expect(annaZeile.locator(`td[data-gegner-id="${idByVorname.get('Anna')}"]`)).toHaveText('');
});
