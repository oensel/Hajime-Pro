// End-to-End: die drei Mannschafts-Wettkampfsysteme (Jeder-gegen-Jeden, Doppel-KO-8, Doppel-KO-16
// -- siehe MannschaftJederGegenJedenManager.js/MannschaftDoppelKo8Manager.js/
// MannschaftDoppelKo16Manager.js) sowie der automatische Stichkampf bei vollständigem Gleichstand
// (werteBegegnungAus() in mannschaftsBegegnungEngine.js, DJB-WKO Art. 3.12.13.1). Das direkte
// Pendant zu den steuerung-*-komplett.spec.js-Dateien für den Einzelwettkampf: dort ist
// die Bracket-/Paarungs-KASKADE (bracketTopologie.js/kampfProgression.js) bereits pro Modus
// abgedeckt, hier geht es um die zusätzliche BEGEGNUNGS-Ebene, die es nur bei Mannschaften gibt --
// mehrere Einzelkämpfe (einer pro gemeinsamer Gewichtsklasse) zu einer Begegnung zusammenfassen,
// deren Sieger aus Siegen/Wertungspunkten ermitteln und bei Gleichstand automatisch einen
// Stichkampf auslosen (mannschaftsBegegnungEngine.js). Diese Ebene war vor dieser Datei nur
// indirekt über teilnehmer-pools-verteilung.spec.js (Auto-Verteilung) mitgetestet, dort aber
// bewusst ausgeklammert (siehe dortiger Kommentar "die Begegnungen selbst sind nicht Gegenstand
// dieses Tests").
//
// Alle vier Tests bauen ihr Turnier direkt über dieselben additiven API-Aufrufe auf, die auch die
// App selbst beim manuellen Anlegen nutzt (POST /api/turniere, /api/pools, /api/mannschaften,
// /api/mannschaften/:id/mitglieder) -- ohne Anmeldung, da IS_OFFLINE=true jede Auth-Prüfung
// durchwinkt. Jeder Test bekommt sein eigenes, frisches Turnier (kein gemeinsamer State), damit
// die vier Modi unabhängig voneinander lesbar bleiben.
import { test, expect } from '@playwright/test';

const ALTERSKLASSE = 'U18';
const GESCHLECHT = 'männlich';

// Zwei Positionen reichen, um die Begegnungs-Engine (mehrere Einzelkämpfe pro Begegnung) zu
// prüfen, ohne die Doppel-KO-16-Fixtur (16 Teams) unnötig aufzublähen.
const GEWICHTSKLASSEN_2 = ['-73kg', '+73kg'];
const GEWICHTE_2 = [70, 85];

// Vier Positionen für den Stichkampf-Test: gerade Anzahl, damit ein exakter 2:2-Gleichstand bei
// Siegen UND (bei gleicher Wertungsstärke je Sieg) Wertungspunkten möglich ist.
const GEWICHTSKLASSEN_4 = ['-60kg', '-73kg', '-90kg', '+90kg'];
const GEWICHTE_4 = [58, 70, 85, 95];

// Baut `anzahl` Teams mit je einem Mitglied pro Gewichtsklassen-Position ("A1"/"B1"/... je
// Position, "A"/"B"/... als Team-/Vereinsname) -- jedes Team ist in JEDER Position besetzt, damit
// über alle Bracket-/Paarungsrunden hinweg stets ein austragbarer Einzelkampf entsteht.
function baueTeams(anzahl, gewichtsklassen, gewichte) {
    const teams = [];
    for (let i = 0; i < anzahl; i++) {
        const buchstabe = String.fromCharCode(65 + i);
        teams.push({
            bezeichnung: `Team ${buchstabe}`,
            verein: `JC ${buchstabe}`,
            mitglieder: gewichtsklassen.map((_, idx) => ({
                vorname: `${buchstabe}${idx + 1}`,
                nachname: 'Judoka',
                gewicht: gewichte[idx],
                geburtsjahr: 2007
            }))
        });
    }
    return teams;
}

// Legt Turnier + Mannschafts-Pool + alle Teams (samt Mitgliedern) an. Teams werden bereits MIT
// pool_id angelegt (statt separat zugeordnet) -- jeder createMannschaft-/fuegeMitgliedHinzu-Aufruf
// triggert serverseitig regeneriereMannschaftsPool(), der finale Bracket-/Paarungs-Zustand nach
// dem letzten Aufruf ist deshalb in jedem Fall korrekt, unabhängig von den Zwischenständen.
async function erstelleMannschaftsTurnier(request, { bezeichnung, modus, gewichtsklassen, teams }) {
    const turnierResp = await request.post('/api/turniere', {
        data: {
            bezeichnung, ort: 'Teststadt', datum: '2027-06-01',
            ausrichter: 'JC Mannschafts-Test', anzahl_kampfflaechen: 1
        }
    });
    expect(turnierResp.ok(), await turnierResp.text()).toBeTruthy();
    const { turnierId } = await turnierResp.json();

    const poolResp = await request.post('/api/pools', {
        data: {
            turnier_id: turnierId, bezeichnung: `${bezeichnung} Pool`, modus,
            altersklasse: ALTERSKLASSE, geschlecht: GESCHLECHT, typ: 'mannschaft',
            mannschafts_gewichtsklassen: gewichtsklassen, kampfzeit_sekunden: 180
        }
    });
    expect(poolResp.ok(), await poolResp.text()).toBeTruthy();
    const { poolId } = await poolResp.json();

    const teamIds = [];
    for (const team of teams) {
        const teamResp = await request.post('/api/mannschaften', {
            data: { turnier_id: turnierId, pool_id: poolId, verein: team.verein, bezeichnung: team.bezeichnung }
        });
        expect(teamResp.ok(), await teamResp.text()).toBeTruthy();
        const { mannschaftId } = await teamResp.json();
        teamIds.push(mannschaftId);

        for (const mitglied of team.mitglieder) {
            const tResp = await request.post('/api/teilnehmer', {
                data: {
                    turnier_id: turnierId, vorname: mitglied.vorname, nachname: mitglied.nachname,
                    verein: team.verein, geburtsjahr: mitglied.geburtsjahr, geschlecht: GESCHLECHT,
                    gewicht: mitglied.gewicht, altersklasse: ALTERSKLASSE
                }
            });
            expect(tResp.ok(), await tResp.text()).toBeTruthy();
            const { teilnehmerId } = await tResp.json();

            const mResp = await request.post(`/api/mannschaften/${mannschaftId}/mitglieder`, {
                data: { turnier_teilnehmer_id: teilnehmerId }
            });
            expect(mResp.ok(), await mResp.text()).toBeTruthy();
        }
    }

    return { turnierId, poolId, teamIds };
}

// Spielt alle gerade spielbaren ("bereit") Einzelkämpfe eines Mannschafts-Pools direkt über die
// API durch -- Kämpfer 1 (= immer der Starter der Mannschaft, die in der jeweiligen Begegnung als
// mannschaft1 geführt wird, siehe erzeugeEinzelkaempfeFuerBegegnung()) gewinnt dabei immer per
// Ippon. Läuft in Runden: nach jedem Ergebnis befüllt die Server-Kaskade (triggerPoolUpdate() ->
// aktualisiereMannschaftsPool()) automatisch die Einzelkämpfe neu 'bereit' gewordener Begegnungen,
// daher erneut nachladen, bis keine 'bereit'-Kämpfe mehr übrig sind.
async function spieleAlleBegegnungenDurch(request, poolId, maxRunden = 15) {
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
    throw new Error(`Begegnungen wurden nach ${maxRunden} Runden nicht fertig -- vermutlich ein hängender Kaskaden-Zustand.`);
}

test('Mannschaft Jeder-gegen-Jeden: Paarungstabelle einer 4er-Gruppe wird korrekt erzeugt und jede Begegnung anhand der Einzelkampf-Siege entschieden', async ({ request }) => {
    const gewichtsklassen = GEWICHTSKLASSEN_2;
    const teams = baueTeams(4, gewichtsklassen, GEWICHTE_2);
    const { poolId, teamIds } = await erstelleMannschaftsTurnier(request, {
        bezeichnung: `E2E-Mannschaft-JgJ-${Date.now()}`, modus: 'Jeder-gegen-Jeden', gewichtsklassen, teams
    });

    await spieleAlleBegegnungenDurch(request, poolId);

    const begegnungenResp = await request.get(`/api/mannschaftskaempfe?poolId=${poolId}`);
    const begegnungen = await begegnungenResp.json();

    // Paarungstabelle für n=4 (siehe MannschaftJederGegenJedenManager.js): [0,1],[2,3],[0,3],
    // [1,2],[0,2],[1,3] -- in jedem Paar ist mannschaft1 stets das Team mit dem niedrigeren Index.
    expect(begegnungen).toHaveLength(6);
    expect(begegnungen.every(b => b.status === 'beendet')).toBeTruthy();

    // Kämpfer 1 gewinnt immer -> mannschaft1 jeder Begegnung gewinnt mit vollem Punktestand (beide
    // Gewichtsklassen).
    for (const b of begegnungen) {
        expect(b.siegpunkte_mannschaft1).toBe(gewichtsklassen.length);
        expect(b.siegpunkte_mannschaft2).toBe(0);
        expect(b.sieger_mannschaft_id).toBe(b.mannschaft1_id);
    }

    // Team A (Index 0) ist in jeder seiner drei Begegnungen mannschaft1 (kleinster Index in jedem
    // Paar, das A enthält) und gewinnt daher alle drei; Team D (Index 3, größter Index) ist nie
    // mannschaft1 und verliert daher alle drei.
    const teamABegegnungen = begegnungen.filter(b => b.mannschaft1_id === teamIds[0] || b.mannschaft2_id === teamIds[0]);
    expect(teamABegegnungen).toHaveLength(3);
    expect(teamABegegnungen.every(b => b.sieger_mannschaft_id === teamIds[0])).toBeTruthy();

    const teamDBegegnungen = begegnungen.filter(b => b.mannschaft1_id === teamIds[3] || b.mannschaft2_id === teamIds[3]);
    expect(teamDBegegnungen).toHaveLength(3);
    expect(teamDBegegnungen.every(b => b.sieger_mannschaft_id !== teamIds[3])).toBeTruthy();
});

test('Mannschaft Doppel-KO-8: Begegnungs-Kaskade (H1-H4, H5/H6, Trostrunde, Finale) läuft für 8 Teams bis zum Turniersieger durch', async ({ request }) => {
    const gewichtsklassen = GEWICHTSKLASSEN_2;
    const teams = baueTeams(8, gewichtsklassen, GEWICHTE_2);
    const { poolId } = await erstelleMannschaftsTurnier(request, {
        bezeichnung: `E2E-Mannschaft-DK8-${Date.now()}`, modus: 'Doppel-KO-8', gewichtsklassen, teams
    });

    await spieleAlleBegegnungenDurch(request, poolId);

    const begegnungenResp = await request.get(`/api/mannschaftskaempfe?poolId=${poolId}`);
    const begegnungen = await begegnungenResp.json();
    // H1-H4, H5-H6, T1-T4, F -- identisches Raster zum Einzelwettkampf-Doppel-KO-8 (siehe
    // DoppelKo8Manager.js/DOPPEL_KO_8_TOPOLOGIE, hier über MannschaftDoppelKo8Manager.js). 8 von 8
    // Teams besetzt -> kein Freilos, jede Begegnung wird tatsächlich ausgetragen.
    expect(begegnungen).toHaveLength(11);
    expect(begegnungen.every(b => b.mannschaft1_id && b.mannschaft2_id)).toBeTruthy();
    expect(begegnungen.every(b => b.status === 'beendet')).toBeTruthy();
    for (const b of begegnungen) {
        expect(b.sieger_mannschaft_id).not.toBeNull();
        expect(b.siegpunkte_mannschaft1 + b.siegpunkte_mannschaft2).toBe(gewichtsklassen.length);
    }

    const finale = begegnungen.find(b => b.reihenfolge_nummer === 'F');
    expect(finale.sieger_mannschaft_id).not.toBeNull();

    // Jede Begegnung hat für jede der beiden gemeinsamen Gewichtsklassen genau einen Einzelkampf
    // bekommen (11 Begegnungen * 2 Gewichtsklassen).
    const kaempfeResp = await request.get(`/api/kaempfe?poolId=${poolId}`);
    const kaempfe = await kaempfeResp.json();
    expect(kaempfe).toHaveLength(22);
    expect(kaempfe.every(k => k.status === 'beendet')).toBeTruthy();

    const poolResp = await request.get(`/api/pools/${poolId}`);
    const pool = await poolResp.json();
    expect(pool.status).toBe('kaempfe_beendet');
});

test('Mannschaft Doppel-KO-16: Begegnungs-Kaskade läuft für 16 Teams bis zum Turniersieger durch', async ({ request }) => {
    test.setTimeout(60_000);

    const gewichtsklassen = GEWICHTSKLASSEN_2;
    const teams = baueTeams(16, gewichtsklassen, GEWICHTE_2);
    const { poolId } = await erstelleMannschaftsTurnier(request, {
        bezeichnung: `E2E-Mannschaft-DK16-${Date.now()}`, modus: 'Doppel-KO-16', gewichtsklassen, teams
    });

    await spieleAlleBegegnungenDurch(request, poolId, 20);

    const begegnungenResp = await request.get(`/api/mannschaftskaempfe?poolId=${poolId}`);
    const begegnungen = await begegnungenResp.json();
    // H1-H8, H9-H12, T1-T4, H13-H14, T5-T10, F1, T11-T12 -- identisches Raster zum
    // Einzelwettkampf-Doppel-KO-16 (siehe DoppelKo16Manager.js/DOPPEL_KO_16_TOPOLOGIE). 16 von 16
    // Teams besetzt -> kein Freilos.
    expect(begegnungen).toHaveLength(27);
    expect(begegnungen.every(b => b.mannschaft1_id && b.mannschaft2_id)).toBeTruthy();
    expect(begegnungen.every(b => b.status === 'beendet')).toBeTruthy();
    for (const b of begegnungen) {
        expect(b.sieger_mannschaft_id).not.toBeNull();
        expect(b.siegpunkte_mannschaft1 + b.siegpunkte_mannschaft2).toBe(gewichtsklassen.length);
    }

    const finale = begegnungen.find(b => b.reihenfolge_nummer === 'F1');
    expect(finale.sieger_mannschaft_id).not.toBeNull();

    const kaempfeResp = await request.get(`/api/kaempfe?poolId=${poolId}`);
    const kaempfe = await kaempfeResp.json();
    expect(kaempfe).toHaveLength(54);
    expect(kaempfe.every(k => k.status === 'beendet')).toBeTruthy();

    const poolResp = await request.get(`/api/pools/${poolId}`);
    const pool = await poolResp.json();
    expect(pool.status).toBe('kaempfe_beendet');
});

test('Bei vollständigem Gleichstand (Siege UND Wertungspunkte) wird automatisch ein Stichkampf in einer bereits bestrittenen Gewichtsklasse ausgelost und entscheidet die Begegnung', async ({ request }) => {
    const gewichtsklassen = GEWICHTSKLASSEN_4;
    const teams = baueTeams(2, gewichtsklassen, GEWICHTE_4);
    const { poolId, teamIds } = await erstelleMannschaftsTurnier(request, {
        bezeichnung: `E2E-Mannschaft-Stichkampf-${Date.now()}`, modus: 'Jeder-gegen-Jeden', gewichtsklassen, teams
    });

    // Bei genau 2 Teams entsteht sofort 1 Begegnung mit allen 4 Einzelkämpfen (kein Bracket, siehe
    // MannschaftJederGegenJedenManager.js: n===2 -> ein einziges Paar, direkt 'bereit').
    const kaempfeVorResp = await request.get(`/api/kaempfe?poolId=${poolId}`);
    const kaempfeVor = await kaempfeVorResp.json();
    expect(kaempfeVor).toHaveLength(4);
    expect(kaempfeVor.every(k => k.status === 'bereit')).toBeTruthy();

    // Exakter Gleichstand erzwingen: Team A (mannschaft1) gewinnt die ersten beiden
    // Gewichtsklassen, Team B (mannschaft2) die letzten beiden -- jeweils mit derselben
    // Wertungsstärke (10), damit auch die Wertungspunkte 20:20 gleichauf liegen.
    for (let i = 0; i < kaempfeVor.length; i++) {
        const k = kaempfeVor[i];
        const teamAGewinnt = i < 2;
        const updateResp = await request.put(`/api/kaempfe/${k.id}`, {
            data: {
                status: 'beendet',
                sieger_id: teamAGewinnt ? k.kaempfer1_id : k.kaempfer2_id,
                unterbewertung_kaempfer1: teamAGewinnt ? 10 : 0,
                unterbewertung_kaempfer2: teamAGewinnt ? 0 : 10,
                kampfzeit_in_sekunden: 90
            }
        });
        expect(updateResp.ok(), await updateResp.text()).toBeTruthy();
    }

    const [begegnungNachTie] = await (await request.get(`/api/mannschaftskaempfe?poolId=${poolId}`)).json();
    expect(begegnungNachTie.siegpunkte_mannschaft1).toBe(2);
    expect(begegnungNachTie.siegpunkte_mannschaft2).toBe(2);
    expect(begegnungNachTie.wertungspunkte_mannschaft1).toBe(20);
    expect(begegnungNachTie.wertungspunkte_mannschaft2).toBe(20);
    // Noch kein Sieger -- werteBegegnungAus() darf bei einem Doppel-Gleichstand nicht entscheiden.
    expect(begegnungNachTie.status).not.toBe('beendet');
    expect(begegnungNachTie.sieger_mannschaft_id).toBeNull();
    expect(gewichtsklassen).toContain(begegnungNachTie.stichkampf_gewichtsklasse);

    // Genau ein neuer, 'bereit' stehender Stichkampf-Einzelkampf in exakt der ausgelosten
    // Gewichtsklasse ist entstanden (fünfter Kampf dieser Begegnung).
    const kaempfeNachTie = await (await request.get(`/api/kaempfe?poolId=${poolId}`)).json();
    expect(kaempfeNachTie).toHaveLength(5);
    const stichkampf = kaempfeNachTie.find(k => k.status === 'bereit');
    expect(stichkampf).toBeTruthy();
    expect(stichkampf.mannschaftskampf_id).toBe(begegnungNachTie.id);
    expect(stichkampf.mannschaft_gewichtsklasse).toBe(begegnungNachTie.stichkampf_gewichtsklasse);

    // Stichkampf entscheiden: Team A gewinnt -> 3:2 Siege, die Begegnung ist damit entschieden.
    const stichkampfUpdateResp = await request.put(`/api/kaempfe/${stichkampf.id}`, {
        data: {
            status: 'beendet', sieger_id: stichkampf.kaempfer1_id,
            unterbewertung_kaempfer1: 10, unterbewertung_kaempfer2: 0,
            kampfzeit_in_sekunden: 90
        }
    });
    expect(stichkampfUpdateResp.ok(), await stichkampfUpdateResp.text()).toBeTruthy();

    const [begegnungFinal] = await (await request.get(`/api/mannschaftskaempfe?poolId=${poolId}`)).json();
    expect(begegnungFinal.status).toBe('beendet');
    expect(begegnungFinal.siegpunkte_mannschaft1).toBe(3);
    expect(begegnungFinal.siegpunkte_mannschaft2).toBe(2);
    expect(begegnungFinal.sieger_mannschaft_id).toBe(teamIds[0]);
});
