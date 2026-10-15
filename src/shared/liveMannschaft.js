// Zustand der Mannschaften und ihrer Begegnungen für die Teilnehmer-App. Rein und DB-frei (Live-Prozess, Tests).
// Eine Begegnung (Team A gegen Team B) läuft immer ganz auf einer Matte; ihre Einzelkämpfe stehen in der
// Matten-Warteschlange. "Abstand" zählt die Begegnungen, die vor ihr auf derselben Matte dran sind.
const OFFEN = new Set(['bereit', 'vorbereiten', 'gestartet']);
const FERTIG = new Set(['beendet', 'freilos']);

function gewichtWert(gk) {
    const zahl = parseFloat(String(gk ?? '').replace(',', '.').replace(/[^\d.]/g, '')) || 0;
    return String(gk ?? '').trim().startsWith('+') ? 100000 + zahl : zahl;
}

// pools/mannschaften/mitglieder/begegnungen/kaempfe/teilnehmer: Zeilen aus den Views (live.*).
// schluesselVon(mannschaft): stabiler Schlüssel. matteName(id): Anzeigename der Matte.
export function berechneMannschaften({ pools, mannschaften, mitglieder, begegnungen, kaempfe, teilnehmer }, { schluesselVon, matteName }) {
    const poolById = new Map(pools.map(p => [p.id, p]));
    const istTeamPool = (id) => {
        const p = poolById.get(id);
        return !!p && p.typ === 'mannschaft' && !p.verspaetet;
    };
    const teams = mannschaften.filter(m => m.pool_id != null && istTeamPool(m.pool_id));
    const teilnehmerById = new Map(teilnehmer.map(t => [t.id, t]));
    const keyVon = new Map(teams.map(m => [m.id, schluesselVon(m)]));
    const teamById = new Map(teams.map(m => [m.id, m]));

    const echteBegegnungen = begegnungen.filter(b => istTeamPool(b.pool_id) && b.status !== 'freilos');
    const begegnungById = new Map(echteBegegnungen.map(b => [b.id, b]));
    const matteVon = (b) => (b.kampfflaeche_id != null ? b.kampfflaeche_id : (poolById.get(b.pool_id)?.kampfflaeche_id ?? null));

    // Einzelkämpfe je Begegnung und Warteschlange der Begegnungen je Matte
    const kaempfeJeBegegnung = new Map();
    for (const k of kaempfe) {
        if (k.mannschaftskampf_id == null || !begegnungById.has(k.mannschaftskampf_id)) continue;
        if (!kaempfeJeBegegnung.has(k.mannschaftskampf_id)) kaempfeJeBegegnung.set(k.mannschaftskampf_id, []);
        kaempfeJeBegegnung.get(k.mannschaftskampf_id).push(k);
    }
    const offene = [...kaempfeJeBegegnung.values()].flat()
        .filter(k => OFFEN.has(k.status) && k.matten_reihenfolge != null)
        .sort((a, b) => Number(a.matten_reihenfolge) - Number(b.matten_reihenfolge) || a.id - b.id);
    const abstandJeBegegnung = new Map();
    const zaehlerJeMatte = new Map();
    for (const k of offene) {
        if (abstandJeBegegnung.has(k.mannschaftskampf_id)) continue;
        const matte = matteVon(begegnungById.get(k.mannschaftskampf_id));
        const n = zaehlerJeMatte.get(matte) || 0;
        abstandJeBegegnung.set(k.mannschaftskampf_id, n);
        zaehlerJeMatte.set(matte, n + 1);
    }
    const laeuft = (b) => b.status === 'gestartet' || (kaempfeJeBegegnung.get(b.id) || []).some(k => k.status === 'gestartet');

    const begegnungenAusgabe = echteBegegnungen.map(b => ({
        id: b.id, poolId: b.pool_id, nr: b.reihenfolge_nummer == null ? '' : String(b.reihenfolge_nummer),
        runde: b.runde == null ? null : Number(b.runde), status: laeuft(b) ? 'gestartet' : b.status,
        matteId: matteVon(b),
        team1: keyVon.get(b.mannschaft1_id) ?? null, team2: keyVon.get(b.mannschaft2_id) ?? null,
        s1: Number(b.siegpunkte_mannschaft1) || 0, s2: Number(b.siegpunkte_mannschaft2) || 0,
        sieger: keyVon.get(b.sieger_mannschaft_id) ?? null,
        abstand: abstandJeBegegnung.has(b.id) ? abstandJeBegegnung.get(b.id) : null
    })).sort((a, b) => a.id - b.id);

    const mitgliederJeTeam = new Map();
    for (const m of mitglieder) {
        const t = teilnehmerById.get(m.turnier_teilnehmer_id);
        if (!t || t.status === 'zurueckgezogen') continue;
        if (!mitgliederJeTeam.has(m.mannschaft_id)) mitgliederJeTeam.set(m.mannschaft_id, []);
        mitgliederJeTeam.get(m.mannschaft_id).push({ vorname: t.vorname, nachname: t.nachname, gewichtsklasse: m.gewichtsklasse || '' });
    }

    const teamAusgabe = teams.map(team => {
        const pool = poolById.get(team.pool_id);
        const eigene = echteBegegnungen.filter(b => b.mannschaft1_id === team.id || b.mannschaft2_id === team.id);
        const offen = eigene.filter(b => !FERTIG.has(b.status));
        const siege = eigene.filter(b => b.sieger_mannschaft_id === team.id).length;
        const niederlagen = eigene.filter(b => b.status === 'beendet' && b.sieger_mannschaft_id != null && b.sieger_mannschaft_id !== team.id).length;

        let zustand = 'wartet';
        let abstand = null;
        let naechste = null;
        const laufende = offen.find(laeuft);
        if (laufende) {
            zustand = 'laeuft';
            abstand = 0;
            naechste = laufende;
        } else {
            const geplant = offen.filter(b => abstandJeBegegnung.has(b.id))
                .sort((a, b) => abstandJeBegegnung.get(a.id) - abstandJeBegegnung.get(b.id));
            if (geplant.length) {
                naechste = geplant[0];
                abstand = abstandJeBegegnung.get(naechste.id);
                zustand = abstand === 0 ? 'als_naechstes' : 'in_n';
            } else if (!offen.length && eigene.length) {
                zustand = 'abgeschlossen';
            } else if (offen.length) {
                naechste = [...offen].sort((a, b) => a.id - b.id)[0];
            }
        }
        const gegnerId = naechste ? (naechste.mannschaft1_id === team.id ? naechste.mannschaft2_id : naechste.mannschaft1_id) : null;
        const matteId = naechste ? matteVon(naechste) : (pool.kampfflaeche_id ?? null);
        return {
            key: keyVon.get(team.id), bezeichnung: team.bezeichnung, verein: team.verein,
            poolId: pool.id, poolBezeichnung: pool.bezeichnung, modus: pool.modus, poolStatus: pool.status,
            altersklasse: pool.altersklasse, geschlecht: pool.geschlecht,
            matteId, matteBezeichnung: matteId != null ? (matteName(matteId) || '') : '',
            zustand, abstand, naechsteBegegnungId: naechste ? naechste.id : null,
            gegner: gegnerId != null && teamById.get(gegnerId) ? teamById.get(gegnerId).bezeichnung : '',
            siege, niederlagen,
            mitglieder: (mitgliederJeTeam.get(team.id) || [])
                .sort((a, b) => gewichtWert(a.gewichtsklasse) - gewichtWert(b.gewichtsklasse)
                    || `${a.nachname} ${a.vorname}`.localeCompare(`${b.nachname} ${b.vorname}`, 'de'))
        };
    }).sort((a, b) => a.key.localeCompare(b.key));

    return { teams: teamAusgabe, begegnungen: begegnungenAusgabe };
}
