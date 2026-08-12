// End-to-End: Prüft, dass die grafische Bracket-Ansicht eines Pool-KO (Doppel-KO-8) in
// pools.html (Kampfplan-Modal, #bracketContainer, buildMatchCardHtml()/getPlaceholderName() in
// public/js/pools.js) nach jedem ausgetragenen Kampf die tatsächlichen Kämpfer:innen-Namen zeigt
// statt eines Kaskaden-Platzhalters ("Sieger H1", "Verlierer H3" usw.) -- und dass ein permanent
// leerer Freilos-Slot "Freilos" statt eines solchen Platzhalters anzeigt. Regressionstest für
// genau diesen Bug.
//
// Turnier-Aufbau kommt aus einer externen JSON-Fixtur (fixtures/pool-ko-doppel-ko8.json) statt
// wie in den übrigen e2e-Tests direkt im Code. Bewusst NICHT über den echten Turnier-Import
// (POST /api/turniere/import, siehe importTurnier() in turnierController.js) eingespielt: dieser
// löscht vor dem Import ALLE Turniere/Pools/Teilnehmer der Test-DB -- die in der ganzen e2e-Suite
// gemeinsam genutzt wird (siehe playwright.config.js: "Eine gemeinsame SQLite-Datei für die ganze
// Suite ... Tests laufen daher bewusst NICHT parallel gegen sie, um sich nicht gegenseitig Daten
// wegzuschreiben") -- und würde damit je nach Ausführungsreihenfolge andere Testdateien
// beschädigen. Stattdessen baut ladeUndErstelleTurnier() das Turnier aus der Fixtur über
// dieselben additiven API-Aufrufe auf, die auch die übrigen e2e-Tests nutzen (siehe
// richteDk8TurnierEin() in siegerliste-dk8.spec.js) -- weiterhin ohne jede Anmeldung, da
// IS_OFFLINE=true jede Auth-Prüfung durchwinkt (requireAuth/requireTournamentEditAccess in
// src/middleware/auth.js).
//
// 7 statt 8 Teilnehmer:innen in der Fixtur sind Absicht: DoppelKo8Manager erzeugt dabei
// automatisch genau ein Freilos in der ersten Runde (siehe freilosIndices in
// DoppelKo8Manager.js), das sich in die Trostrunde fortpflanzt (T2 wird zum "doppelten Freilos",
// da auch der Verlierer von H4 nie existiert) -- ein einziges kleines Turnier deckt damit sowohl
// "echte, erst nach einem Vorkampf bekannte Namen" als auch "dauerhaft leerer Freilos-Slot" ab.
// Die genauen Paarungen/Ergebnisse unten sind deterministisch aus einer direkten Simulation von
// DoppelKo8Manager mit exakt dieser Fixtur übernommen (kein Math.random im Verteilungsalgorithmus).
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTUR = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'fixtures', 'pool-ko-doppel-ko8.json'), 'utf-8')
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

    // Reihenfolge identisch zur Fixtur -- Voraussetzung für ein deterministisches Freilos-Raster
    // (siehe DoppelKo8Manager.js: Teilnehmer werden ohne eigenes ORDER BY gelesen, SQLite liefert
    // ohne Sortierung Einfüge-/Rowid-Reihenfolge).
    for (const teilnehmerId of teilnehmerIds) {
        const moveResp = await request.post('/api/pools/verschieben', { data: { teilnehmerId, zielPoolId: poolId } });
        expect(moveResp.ok(), await moveResp.text()).toBeTruthy();
    }

    return { turnierId, poolId };
}

// Spielt alle gerade spielbaren ("bereit") Kämpfe eines Pools direkt über die API durch --
// Kämpfer 1 gewinnt dabei immer per Ippon. Läuft in Runden: nach jedem Ergebnis befüllt die
// Server-Kaskade (triggerPoolUpdate() -> kampfProgression.js) automatisch die Folgekämpfe, daher
// erneut nachladen, bis keine 'bereit'-Kämpfe mehr übrig sind.
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

test('Bracket-Ansicht (pools.html) zeigt nach einem komplett durchgespielten Pool-KO echte Namen statt Kaskaden-Platzhaltern', async ({ page, request }) => {
    const { turnierId, poolId } = await ladeUndErstelleTurnier(request, FIXTUR);
    await spieleBracketKomplettDurch(request, poolId);

    // Live-Zustand aus derselben API laden, aus der auch pools.js seine Bracket-Karten befüllt
    // (siehe loadFightplan() -> GET /api/pools/:id in pools.js).
    const poolResp = await request.get(`/api/pools/${poolId}`);
    const pool = await poolResp.json();
    expect(pool.kaempfe).toHaveLength(11);
    expect(pool.kaempfe.every(k => k.status === 'beendet' || k.status === 'freilos')).toBeTruthy();

    const nameById = new Map(pool.teilnehmer.map(t => [t.id, `${t.nachname}, ${t.vorname}`]));

    await page.goto(`/pools.html?turnierId=${turnierId}`);
    await page.locator(`.btn-view-fightplan[data-id="${poolId}"]`).click();
    await expect(page.locator('#bracketContainer')).toBeVisible();

    for (const kampf of pool.kaempfe) {
        const karte = page.locator(`.bracket-match-card[data-reihenfolge-nummer="${kampf.reihenfolge_nummer}"]`);
        await expect(karte).toHaveCount(1);

        for (const [slot, kaempferId] of [[1, kampf.kaempfer1_id], [2, kampf.kaempfer2_id]]) {
            const nameFeld = karte.locator(`[data-kaempfer-slot="${slot}"] .fighter-name`);
            const erwarteterText = kaempferId ? nameById.get(kaempferId) : 'Freilos';
            // toContainText statt toHaveText: Sieger von Finale/Bronze-Kämpfen tragen zusätzlich
            // ein Medaillen-Icon im selben <span>, das die Namensprüfung nicht stören soll.
            await expect(nameFeld).toContainText(erwarteterText);
            // Regressionsprüfung für den eigentlichen Bug: kein Kaskaden-Platzhalter ("Sieger
            // H1", "Verlierer H3" ...) darf für einen bereits entschiedenen Kampf -- dazu zählt
            // auch ein per Freilos entschiedener, dauerhaft leerer Slot -- noch sichtbar sein.
            await expect(nameFeld).not.toHaveText(/^(Sieger|Verlierer)\s/);
        }
    }

    // Deterministische Endstände (Kämpfer 1 gewinnt immer), siehe Kommentar am Dateianfang:
    // Anna gewinnt das Finale gegen Clara; Greta (H4) und Frida (T2) sind die Freilose.
    const finale = pool.kaempfe.find(k => k.reihenfolge_nummer === 'F');
    expect(nameById.get(finale.sieger_id)).toBe('Adler, Anna');
    expect(nameById.get(finale.kaempfer2_id)).toBe('Conrad, Clara');

    const h4 = pool.kaempfe.find(k => k.reihenfolge_nummer === 'H4');
    expect(h4.kaempfer2_id).toBeNull();
    expect(nameById.get(h4.kaempfer1_id)).toBe('Graf, Greta');

    const t2 = pool.kaempfe.find(k => k.reihenfolge_nummer === 'T2');
    expect(t2.kaempfer2_id).toBeNull();
    expect(nameById.get(t2.kaempfer1_id)).toBe('Fuchs, Frida');
});
