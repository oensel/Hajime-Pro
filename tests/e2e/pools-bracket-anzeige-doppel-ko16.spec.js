// End-to-End: dasselbe wie pools-bracket-anzeige.spec.js (siehe dortige Kommentare für die
// ausführliche Begründung von Fixtur-Datei statt echtem Turnier-Import), nur für Doppel-KO-16.
//
// 16 statt z.B. 13 Teilnehmer:innen sind Absicht: bei 16 entsteht KEIN Freilos (die "Freilos
// statt Kaskaden-Platzhalter"-Regression ist bereits über pools-bracket-anzeige.spec.js, Doppel-
// KO-8, abgedeckt). Dieser Test zielt stattdessen auf eine ZWEITE, unabhängige Stelle desselben
// Bugs: getPlaceholderName() in pools.js bestand vor der Mode-Trennung aus einer einzigen langen
// If-Kette, in der dieselben Kampfnummern ('F1', 'T3', 'T4', 'H5', 'H6', 'T1'-'T4') für Gruppen-
// Überkreuz, Doppel-KO-8 UND Doppel-KO-16 mit jeweils anderer Bedeutung wiederverwendet wurden --
// der erste Treffer in der Kette gewann immer, jüngere, korrekte Doppel-KO-16-Zweige waren toter
// Code. Am auffälligsten beim Finale (F1): vor der Fertigstellung zeigte es fälschlich "Sieger
// HF1"/"Sieger HF2" (ein Begriff aus Gruppen-Überkreuz, den es in Doppel-KO-16 gar nicht gibt)
// statt "Sieger H13"/"Sieger H14".
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTUR = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'fixtures', 'pool-ko-doppel-ko16.json'), 'utf-8')
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

    // Reihenfolge identisch zur Fixtur -- Voraussetzung für ein deterministisches Raster (siehe
    // DoppelKo16Manager.js: Teilnehmer werden ohne eigenes ORDER BY gelesen, SQLite liefert ohne
    // Sortierung Einfüge-/Rowid-Reihenfolge).
    for (const teilnehmerId of teilnehmerIds) {
        const moveResp = await request.post('/api/pools/verschieben', { data: { teilnehmerId, zielPoolId: poolId } });
        expect(moveResp.ok(), await moveResp.text()).toBeTruthy();
    }

    return { turnierId, poolId };
}

// Spielt alle gerade spielbaren ("bereit") Kämpfe eines Pools direkt über die API durch --
// Kämpfer 1 gewinnt dabei immer per Ippon. Läuft in Runden: nach jedem Ergebnis befüllt die
// Server-Kaskade (triggerPoolUpdate() -> DoppelKo16Manager.aktualisiereTurnier()) automatisch die
// Folgekämpfe, daher erneut nachladen, bis keine 'bereit'-Kämpfe mehr übrig sind. Doppel-KO-16
// braucht (Achtelfinale -> Trostrunde R1 -> Viertelfinale -> Trostrunde R2 -> Halbfinale ->
// Trostrunde R3 -> Finale/Bronze) mehr Runden als Doppel-KO-8, daher ein höheres Limit.
async function spieleBracketKomplettDurch(request, poolId) {
    for (let runde = 0; runde < 15; runde++) {
        const resp = await request.get(`/api/kaempfe?poolId=${poolId}`);
        const kaempfe = await resp.json();
        const bereit = kaempfe.filter(k => k.status === 'bereit');
        if (bereit.length === 0) return;

        for (const k of bereit) {
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
    throw new Error('Bracket wurde nach 15 Runden nicht fertig -- vermutlich ein hängender Kaskaden-Zustand.');
}

test('Bracket-Ansicht (pools.html) zeigt für ein Doppel-KO-16-Turnier vor Auflösung die korrekten modusabhängigen Platzhalter und danach echte Namen statt Kaskaden-Platzhaltern', async ({ page, request }) => {
    const { turnierId, poolId } = await ladeUndErstelleTurnier(request, FIXTUR);

    await page.goto(`/pools.html?turnierId=${turnierId}`);
    await page.locator(`.btn-view-fightplan[data-id="${poolId}"]`).click();
    await expect(page.locator('#bracketContainer')).toBeVisible();

    // Direkt nach der Auslosung, bevor irgendein Kampf gespielt wurde: F1/T3/T4 sind leere
    // Hüllen. Genau diese drei Kampfnummern kollidierten vor der Mode-Trennung mit Gruppen-
    // Überkreuz bzw. Doppel-KO-8 -- siehe Kommentar am Dateianfang.
    const f1VorAuflösung = page.locator('.bracket-match-card[data-reihenfolge-nummer="F1"]');
    await expect(f1VorAuflösung.locator('[data-kaempfer-slot="1"] .fighter-name')).toHaveText('Sieger H13');
    await expect(f1VorAuflösung.locator('[data-kaempfer-slot="2"] .fighter-name')).toHaveText('Sieger H14');
    const t3VorAufloesung = page.locator('.bracket-match-card[data-reihenfolge-nummer="T3"]');
    await expect(t3VorAufloesung.locator('[data-kaempfer-slot="1"] .fighter-name')).toHaveText('Verlierer H5');
    await expect(t3VorAufloesung.locator('[data-kaempfer-slot="2"] .fighter-name')).toHaveText('Verlierer H6');
    const t4VorAufloesung = page.locator('.bracket-match-card[data-reihenfolge-nummer="T4"]');
    await expect(t4VorAufloesung.locator('[data-kaempfer-slot="1"] .fighter-name')).toHaveText('Verlierer H7');
    await expect(t4VorAufloesung.locator('[data-kaempfer-slot="2"] .fighter-name')).toHaveText('Verlierer H8');

    await spieleBracketKomplettDurch(request, poolId);

    // Live-Zustand aus derselben API laden, aus der auch pools.js seine Bracket-Karten befüllt
    // (siehe loadFightplan() -> GET /api/pools/:id in pools.js).
    const poolResp = await request.get(`/api/pools/${poolId}`);
    const pool = await poolResp.json();
    expect(pool.kaempfe).toHaveLength(27);
    expect(pool.kaempfe.every(k => k.status === 'beendet' || k.status === 'freilos')).toBeTruthy();

    const nameById = new Map(pool.teilnehmer.map(t => [t.id, `${t.nachname}, ${t.vorname}`]));

    await page.reload();
    await page.locator(`.btn-view-fightplan[data-id="${poolId}"]`).click();
    await expect(page.locator('#bracketContainer')).toBeVisible();

    for (const kampf of pool.kaempfe) {
        const karte = page.locator(`.bracket-match-card[data-reihenfolge-nummer="${kampf.reihenfolge_nummer}"]`);
        await expect(karte).toHaveCount(1);

        for (const [slot, kaempferId] of [[1, kampf.kaempfer1_id], [2, kampf.kaempfer2_id]]) {
            const nameFeld = karte.locator(`[data-kaempfer-slot="${slot}"] .fighter-name`);
            // toContainText statt toHaveText: Sieger von Finale/Bronze-Kämpfen tragen zusätzlich
            // ein Medaillen-Icon im selben <span>, das die Namensprüfung nicht stören soll.
            await expect(nameFeld).toContainText(nameById.get(kaempferId));
            // Regressionsprüfung für den eigentlichen Bug: kein Kaskaden-Platzhalter ("Sieger
            // H1", "Verlierer H3", "Sieger HF1" ...) darf für einen bereits entschiedenen Kampf
            // mehr sichtbar sein.
            await expect(nameFeld).not.toHaveText(/^(Sieger|Verlierer)\s/);
        }
    }

    // Deterministische Endstände (Kämpfer 1 gewinnt immer), siehe Kommentar am Dateianfang: Anna
    // gewinnt das Finale gegen Clara; Elena und Greta holen (getrennt) Bronze gegen Diana bzw.
    // Berta.
    const f1 = pool.kaempfe.find(k => k.reihenfolge_nummer === 'F1');
    expect(nameById.get(f1.sieger_id)).toBe('Adler, Anna');
    expect(nameById.get(f1.kaempfer2_id)).toBe('Conrad, Clara');

    const t11 = pool.kaempfe.find(k => k.reihenfolge_nummer === 'T11');
    expect(nameById.get(t11.sieger_id)).toBe('Ebert, Elena');
    expect(nameById.get(t11.kaempfer2_id)).toBe('Diehl, Diana');

    const t12 = pool.kaempfe.find(k => k.reihenfolge_nummer === 'T12');
    expect(nameById.get(t12.sieger_id)).toBe('Graf, Greta');
    expect(nameById.get(t12.kaempfer2_id)).toBe('Busch, Berta');
});
