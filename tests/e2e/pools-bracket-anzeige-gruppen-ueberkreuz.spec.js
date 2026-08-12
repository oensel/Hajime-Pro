// End-to-End: dasselbe wie pools-bracket-anzeige.spec.js (siehe dortige Kommentare für die
// ausführliche Begründung von Fixtur-Datei statt echtem Turnier-Import), nur für den zweiten
// "Pool-KO"-Modus dieser App: Gruppen-Überkreuz (Gruppenphase + Überkreuz-Halbfinale/-Finale,
// renderUeberKreuz()/#ueberKreuzContainer statt renderBracket()/#bracketContainer in
// public/js/pools.js). Prüft zusätzlich, DASS und WELCHEN mode-spezifischen Platzhalter HF1/HF2
// vor der Gruppenphase zeigen ("1./2. Gruppe A/B") -- genau der Zweig von getPlaceholderName(),
// der vor der Mode-Trennung wegen der If-Ketten-Kollision mit Doppel-KO-16/-32 fehleranfällig war.
//
// Kein Freilos möglich (Gruppen-Überkreuz läuft immer mit exakt 6 Teilnehmer:innen, siehe
// waehleWettkampfsystem() in poolController.js) -- die "Freilos statt Kaskaden-Platzhalter"-
// Regression bleibt daher allein in pools-bracket-anzeige.spec.js (Doppel-KO-8 mit 7
// Teilnehmer:innen) abgedeckt.
//
// Beim Bau dieses Tests kam zutage, dass GruppenUeberKreuzManager.aktualisiereTurnier() HF1/HF2
// nach der Gruppenphase zwar mit den richtigen Kämpfer:innen befüllte, ihren Status aber nie von
// 'angelegt' auf 'bereit' hob -- planeKaempfeFuerKampfflaeche()/kampf.js filtern die Matten-
// Warteschlange strikt auf status 'bereit', wodurch HF1/HF2 nie startbar waren und ein
// Gruppen-Überkreuz-Turnier nach der Gruppenphase never live weiterlief. Behoben in
// GruppenUeberKreuzManager.js (siehe Kommentar dort); dieser Test spielt deshalb bewusst über die
// normale 'bereit'-Warteschlange statt jeden Kampf blind per ID zu beenden -- sonst hätte er genau
// diesen Bug nicht gefangen.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTUR = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'fixtures', 'pool-ko-gruppen-ueberkreuz.json'), 'utf-8')
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

    // Reihenfolge identisch zur Fixtur -- Voraussetzung für eine deterministische Gruppenzuteilung
    // (siehe GruppenUeberKreuzManager.js: Teilnehmer werden ohne eigenes ORDER BY gelesen, SQLite
    // liefert ohne Sortierung Einfüge-/Rowid-Reihenfolge; nach Gewicht sortiert kommen abwechselnd
    // Gruppe A/B dran).
    for (const teilnehmerId of teilnehmerIds) {
        const moveResp = await request.post('/api/pools/verschieben', { data: { teilnehmerId, zielPoolId: poolId } });
        expect(moveResp.ok(), await moveResp.text()).toBeTruthy();
    }

    return { turnierId, poolId };
}

// Spielt alle gerade spielbaren ("bereit") Kämpfe eines Pools direkt über die API durch --
// Kämpfer 1 gewinnt dabei immer per Ippon. Läuft in Runden: nach jedem Ergebnis befüllt die
// Server-Kaskade (triggerPoolUpdate() -> GruppenUeberKreuzManager.aktualisiereTurnier())
// automatisch die Folgekämpfe, daher erneut nachladen, bis keine 'bereit'-Kämpfe mehr übrig sind.
// Bewusst NICHT "alle noch offenen Kämpfe egal welchen Status beenden" -- ein Kampf, der (wie
// HF1/HF2 vor dem Fix) nie 'bereit' wird, muss den Test zum Scheitern bringen statt stillschweigend
// übersprungen zu werden.
async function spieleBracketKomplettDurch(request, poolId) {
    for (let runde = 0; runde < 10; runde++) {
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
    throw new Error('Bracket wurde nach 10 Runden nicht fertig -- vermutlich ein hängender Kaskaden-Zustand.');
}

test('Bracket-Ansicht (pools.html) zeigt für ein Gruppen-Überkreuz-Turnier vor der Gruppenphase Platz-Platzhalter und danach echte Namen statt Kaskaden-Platzhaltern', async ({ page, request }) => {
    const { turnierId, poolId } = await ladeUndErstelleTurnier(request, FIXTUR);

    await page.goto(`/pools.html?turnierId=${turnierId}`);
    await page.locator(`.btn-view-fightplan[data-id="${poolId}"]`).click();
    await expect(page.locator('#ueberKreuzContainer')).toBeVisible();

    // Vor der Gruppenphase sind HF1/HF2 noch reine Platzhalter-Hüllen (kaempfer1_id/2_id null) --
    // getPlaceholderName() muss dafür modusabhängig "1./2. Gruppe A/B" liefern, nicht die
    // gleichnamigen, aber semantisch anderen Platzhalter aus Doppel-KO-16/-32.
    const hf1VorGruppenphase = page.locator('.bracket-match-card[data-reihenfolge-nummer="HF1"]');
    await expect(hf1VorGruppenphase.locator('[data-kaempfer-slot="1"] .fighter-name')).toHaveText('1. Gruppe A');
    await expect(hf1VorGruppenphase.locator('[data-kaempfer-slot="2"] .fighter-name')).toHaveText('2. Gruppe B');
    const hf2VorGruppenphase = page.locator('.bracket-match-card[data-reihenfolge-nummer="HF2"]');
    await expect(hf2VorGruppenphase.locator('[data-kaempfer-slot="1"] .fighter-name')).toHaveText('1. Gruppe B');
    await expect(hf2VorGruppenphase.locator('[data-kaempfer-slot="2"] .fighter-name')).toHaveText('2. Gruppe A');

    await spieleBracketKomplettDurch(request, poolId);

    // Live-Zustand aus derselben API laden, aus der auch pools.js seine Bracket-Karten befüllt
    // (siehe loadFightplan() -> GET /api/pools/:id in pools.js).
    const poolResp = await request.get(`/api/pools/${poolId}`);
    const pool = await poolResp.json();
    expect(pool.kaempfe).toHaveLength(10);
    expect(pool.kaempfe.every(k => k.status === 'beendet' || k.status === 'freilos')).toBeTruthy();

    const nameById = new Map(pool.teilnehmer.map(t => [t.id, `${t.nachname}, ${t.vorname}`]));

    await page.reload();
    await page.locator(`.btn-view-fightplan[data-id="${poolId}"]`).click();
    await expect(page.locator('#ueberKreuzContainer')).toBeVisible();

    // Nur die 4 Halbfinal-/Final-Karten laufen über buildMatchCardHtml()/getPlaceholderName() --
    // die Vorrunden-Kämpfe (V_A_1 etc.) werden als eigene Mini-Matrix gerendert, nicht als
    // Bracket-Karte (siehe buildMiniMatrixHtml() in pools.js).
    for (const reihenfolgeNummer of ['HF1', 'HF2', 'F1', 'F2']) {
        const kampf = pool.kaempfe.find(k => k.reihenfolge_nummer === reihenfolgeNummer);
        const karte = page.locator(`.bracket-match-card[data-reihenfolge-nummer="${reihenfolgeNummer}"]`);
        await expect(karte).toHaveCount(1);

        for (const [slot, kaempferId] of [[1, kampf.kaempfer1_id], [2, kampf.kaempfer2_id]]) {
            const nameFeld = karte.locator(`[data-kaempfer-slot="${slot}"] .fighter-name`);
            // toContainText statt toHaveText: Sieger von Finale/Bronze-Kampf tragen zusätzlich ein
            // Medaillen-Icon im selben <span>, das die Namensprüfung nicht stören soll.
            await expect(nameFeld).toContainText(nameById.get(kaempferId));
            // Regressionsprüfung für den eigentlichen Anzeige-Bug: kein Kaskaden-Platzhalter
            // ("Sieger HF1", "Verlierer HF2" ...) darf für einen bereits entschiedenen Kampf mehr
            // sichtbar sein.
            await expect(nameFeld).not.toHaveText(/^(Sieger|Verlierer)\s/);
        }
    }

    // Deterministische Endstände (Kämpfer 1 gewinnt immer), siehe Kommentar am Dateianfang: Anna
    // gewinnt Gruppe A und das Finale gegen Berta (Gruppensiegerin B); Diana (2. Gruppe B) gewinnt
    // das kleine Finale gegen Clara (2. Gruppe A).
    const f1 = pool.kaempfe.find(k => k.reihenfolge_nummer === 'F1');
    expect(nameById.get(f1.sieger_id)).toBe('Adler, Anna');
    expect(nameById.get(f1.kaempfer2_id)).toBe('Busch, Berta');

    const f2 = pool.kaempfe.find(k => k.reihenfolge_nummer === 'F2');
    expect(nameById.get(f2.sieger_id)).toBe('Diehl, Diana');
    expect(nameById.get(f2.kaempfer2_id)).toBe('Conrad, Clara');
});
