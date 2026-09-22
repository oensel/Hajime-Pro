// Gemeinsame Aufbau-/Durchspiel-Helper für die vier pools-bracket-anzeige-*.spec.js-Dateien
// (Doppel-KO-8, Doppel-KO-16, Gruppen-Überkreuz, Jeder-gegen-Jeden). Jede dieser Dateien deckt
// einen eigenen, in ihrem Dateikopf dokumentierten Regressionsbug in getPlaceholderName()/
// buildMatchCardHtml() (public/js/pools.js) für genau EINEN Modus ab -- die eigentlichen
// Test-Assertions bleiben deshalb bewusst in den einzelnen Dateien. Nur das identische
// Turnier-Aufbau- und Durchspiel-Gerüst lebt hier, damit eine Anpassung (z.B. an
// POST /api/teilnehmer) nicht viermal nachgezogen werden muss.
import { expect } from '@playwright/test';

// Baut ein Turnier + einen Pool + dessen Teilnehmer:innen aus einer Fixtur (siehe fixtures/pool-
// ko-*.json) über dieselben additiven API-Aufrufe auf, die auch die App selbst beim manuellen
// Anlegen nutzt (POST /api/turniere, /api/teilnehmer, /api/pools/verschieben) -- ohne Anmeldung,
// da IS_OFFLINE=true jede Auth-Prüfung durchwinkt (requireAuth/requireTournamentEditAccess in
// src/middleware/auth.js). Bewusst NICHT über den echten Turnier-Import (POST /api/turniere/
// import): dieser löscht vor dem Import ALLE Turniere/Pools/Teilnehmer der (in der ganzen Suite
// gemeinsam genutzten) Test-DB und würde damit je nach Ausführungsreihenfolge andere Testdateien
// beschädigen (siehe playwright.config.js).
export async function ladeUndErstelleTurnier(request, fixtur) {
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

    // Reihenfolge identisch zur Fixtur -- Voraussetzung für ein deterministisches Raster/Freilos
    // (die jeweiligen Manager lesen Teilnehmer ohne eigenes ORDER BY, SQLite liefert ohne
    // Sortierung Einfüge-/Rowid-Reihenfolge).
    for (const teilnehmerId of teilnehmerIds) {
        const moveResp = await request.post('/api/pools/verschieben', { data: { teilnehmerId, zielPoolId: poolId } });
        expect(moveResp.ok(), await moveResp.text()).toBeTruthy();
    }

    return { turnierId, poolId };
}

// Spielt alle gerade spielbaren ("bereit") Kämpfe eines Pools direkt über die API durch -- Kämpfer
// 1 gewinnt dabei immer per Ippon. Läuft in Runden: nach jedem Ergebnis befüllt die Server-Kaskade
// (triggerPoolUpdate() -> kampfProgression.js bzw. der jeweilige Modus-Manager) automatisch die
// Folgekämpfe, daher erneut nachladen, bis keine 'bereit'-Kämpfe mehr übrig sind. Funktioniert
// unverändert auch für Jeder-gegen-Jeden (dort startet alles bereits 'bereit', keine Folgekämpfe
// werden nachträglich befüllt -- die Schleife läuft dann einfach nur eine Runde).
//
// maxRunden ist absichtlich modusabhängig wählbar: Doppel-KO-16 braucht (Achtelfinale ->
// Trostrunde R1 -> Viertelfinale -> Trostrunde R2 -> Halbfinale -> Trostrunde R3 -> Finale/Bronze)
// mehr Runden als Doppel-KO-8.
export async function spieleBracketKomplettDurch(request, poolId, maxRunden = 10) {
    for (let runde = 0; runde < maxRunden; runde++) {
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
    throw new Error(`Bracket wurde nach ${maxRunden} Runden nicht fertig -- vermutlich ein hängender Kaskaden-Zustand.`);
}
