// Baut aus den Views des Schemas "live" den Snapshot, den der Uplink an die Cloud sendet
// (Spec Abschnitt 5.2). baueSnapshot ist rein und deterministisch (gleicher Eingang → gleiche Ausgabe), damit der
// Uplink Änderungen über einen Hash erkennen kann; ladeSnapshots liest nur über die schreibgeschützte Rolle live_ro.
import { berechneKacheln } from '../shared/liveKachel.js';
import { berechnePlatzierungen } from '../shared/platzierungen.js';
import { berechneMannschaften } from '../shared/liveMannschaft.js';
import { mannschaftsSchluessel, teilnehmerSchluessel, vereinSchluessel, waehleAnzeigename } from './schluessel.js';

const OFFEN = new Set(['bereit', 'vorbereiten', 'gestartet']);

// node-pg liefert DATE ohne Type-Parser als Date (lokale Mitternacht); die App setzt den Parser in src/app.js, der
// Live-Prozess nicht. Beides wird zu YYYY-MM-DD.
function datumText(wert) {
    if (wert instanceof Date) {
        const monat = String(wert.getMonth() + 1).padStart(2, '0');
        const tag = String(wert.getDate()).padStart(2, '0');
        return `${wert.getFullYear()}-${monat}-${tag}`;
    }
    return String(wert).slice(0, 10);
}

function platzierungenJePool(pools, teilnehmer, kaempfe) {
    const ergebnis = {};
    for (const pool of pools) {
        if (pool.typ === 'mannschaft' || pool.status !== 'abgeschlossen') continue;
        const mitglieder = teilnehmer.filter(t => t.pool_id === pool.id).map(t => ({ id: t.id, gewicht: Number(t.gewicht_rang) || 0 }));
        const poolKaempfe = kaempfe.filter(k => k.pool_id === pool.id);
        const r = berechnePlatzierungen(pool, poolKaempfe, mitglieder);
        ergebnis[pool.id] = Object.fromEntries(r.eintraege.map(e => [e.teilnehmer.id, e.platz]));
    }
    return ergebnis;
}

export function baueSnapshot({ turnier, kampfflaechen, pools, teilnehmer, kaempfe, mannschaften = [], mitglieder = [], begegnungen = [] }, { geheimnis }) {
    const sichtbar = teilnehmer.filter(t => t.status !== 'zurueckgezogen' && !t.nur_mannschaft);
    const kacheln = berechneKacheln({
        pools, teilnehmer: sichtbar, kaempfe, platzierungen: platzierungenJePool(pools, sichtbar, kaempfe)
    });
    const poolById = new Map(pools.map(p => [p.id, p]));
    const matteById = new Map(kampfflaechen.map(m => [m.id, m]));
    const keyVonId = new Map(sichtbar.map(t => [t.id, teilnehmerSchluessel(geheimnis, t.passnummer_hash)]));

    const eintraege = [];
    const vereinNamen = new Map();
    for (const t of sichtbar) {
        const kachel = kacheln.get(t.id);
        if (!kachel) continue; // Mannschaftsteilnehmer
        const pool = t.pool_id != null ? poolById.get(t.pool_id) : null;
        const matte = pool && pool.kampfflaeche_id != null ? matteById.get(pool.kampfflaeche_id) : null;
        const vereinKey = vereinSchluessel(t.verein);
        if (!vereinNamen.has(vereinKey)) vereinNamen.set(vereinKey, []);
        vereinNamen.get(vereinKey).push(t.verein);
        eintraege.push({
            key: keyVonId.get(t.id),
            vorname: t.vorname, nachname: t.nachname,
            vereinKey, verein: t.verein,
            altersklasse: t.altersklasse, gewichtsklasse: t.gewichtsklasse, geschlecht: t.geschlecht,
            poolId: pool ? pool.id : null, poolBezeichnung: pool ? pool.bezeichnung : null,
            matteId: matte ? matte.id : null, matteBezeichnung: matte ? matte.bezeichnung : null,
            zustand: kachel.zustand, abstand: kachel.abstand, naechsterKampfId: kachel.naechsterKampfId, platz: kachel.platz
        });
    }
    eintraege.sort((a, b) => a.key.localeCompare(b.key));

    const vereine = [...vereinNamen.entries()]
        .map(([key, namen]) => ({ key, name: waehleAnzeigename(namen) }))
        .sort((a, b) => a.key.localeCompare(b.key));

    const warteschlangen = kampfflaechen
        .map(m => {
            const poolById = new Map(pools.map(p => [p.id, p]));
            const wirksameMatte = (k) => (k.kampfflaeche_id != null ? k.kampfflaeche_id : (poolById.get(k.pool_id) || {}).kampfflaeche_id);
            const offen = kaempfe
                .filter(k => wirksameMatte(k) === m.id && OFFEN.has(k.status))
                .sort((a, b) => {
                    const ra = a.matten_reihenfolge == null ? Infinity : Number(a.matten_reihenfolge);
                    const rb = b.matten_reihenfolge == null ? Infinity : Number(b.matten_reihenfolge);
                    return ra !== rb ? ra - rb : a.id - b.id;
                });
            return {
                matteId: m.id,
                kaempfe: offen.map((k, i) => ({
                    id: k.id, status: k.status, position: i,
                    teilnehmerKeys: [keyVonId.get(k.kaempfer1_id) ?? null, keyVonId.get(k.kaempfer2_id) ?? null]
                }))
            };
        })
        .sort((a, b) => a.matteId - b.matteId);

    const einzelPools = pools.filter(p => p.typ !== 'mannschaft' && !p.verspaetet).sort((a, b) => a.id - b.id);
    const poolIdsAusgabe = new Set(einzelPools.map(p => p.id));
    const poolsAusgabe = einzelPools.map(p => ({
        id: p.id, bezeichnung: p.bezeichnung, modus: p.modus, status: p.status,
        matteId: p.kampfflaeche_id != null ? p.kampfflaeche_id : null,
        reihenfolge: p.matte_reihenfolge == null ? null : Number(p.matte_reihenfolge),
        altersklasse: p.altersklasse, geschlecht: p.geschlecht, gewichtsklasse: p.gewichtsklasse,
        farbe2: p.farbe_kaempfer2 || turnier.farbe_kaempfer2 || 'blau'
    }));
    const kaempfeAusgabe = kaempfe
        .filter(k => !k.mannschaftskampf_id && poolIdsAusgabe.has(k.pool_id))
        .sort((a, b) => a.id - b.id)
        .map(k => ({
            id: k.id, poolId: k.pool_id, nr: k.reihenfolge_nummer == null ? '' : String(k.reihenfolge_nummer), status: k.status,
            reihenfolge: k.matten_reihenfolge == null ? null : Number(k.matten_reihenfolge),
            k1: keyVonId.get(k.kaempfer1_id) ?? null, k2: keyVonId.get(k.kaempfer2_id) ?? null,
            sieger: keyVonId.get(k.sieger_id) ?? null,
            p1: Number(k.unterbewertung_kaempfer1) || 0, p2: Number(k.unterbewertung_kaempfer2) || 0
        }));

    // Mannschaften (Teams) mit Kader und Begegnungen; Mitglieder ohne Einzelstart stehen nur hier.
    const turnierKey = String(turnier.urspruengliche_id);
    const matteName = (id) => (matteById.get(id) || {}).bezeichnung || '';
    const team = berechneMannschaften(
        { pools, mannschaften, mitglieder, begegnungen, kaempfe, teilnehmer },
        { schluesselVon: (m) => mannschaftsSchluessel(geheimnis, turnierKey, m.verein, m.bezeichnung), matteName }
    );
    const teamsAusgabe = team.teams.map(t => ({ ...t, vereinKey: vereinSchluessel(t.verein) }));
    for (const t of teamsAusgabe) {
        if (!vereinNamen.has(t.vereinKey)) vereinNamen.set(t.vereinKey, []);
        vereinNamen.get(t.vereinKey).push(t.verein);
    }
    const vereineAlle = [...vereinNamen.entries()]
        .map(([key, namen]) => ({ key, name: waehleAnzeigename(namen) }))
        .sort((a, b) => a.key.localeCompare(b.key));

    return {
        version: 1,
        turnierKey,
        name: turnier.bezeichnung,
        datum: datumText(turnier.datum),
        vereine: vereineAlle,
        mannschaften: teamsAusgabe,
        begegnungen: team.begegnungen,
        matten: kampfflaechen.map(m => ({ id: m.id, bezeichnung: m.bezeichnung })).sort((a, b) => a.id - b.id),
        teilnehmer: eintraege,
        warteschlangen,
        pools: poolsAusgabe,
        kaempfe: kaempfeAusgabe
    };
}

export async function ladeSnapshots(knexLive, { geheimnis }) {
    const turniere = await knexLive('live.turniere')
        .where({ live_freigabe: true })
        .whereNotNull('urspruengliche_id')
        .orderBy('id');
    const snapshots = [];
    for (const turnier of turniere) {
        const [kampfflaechen, pools, teilnehmer, mannschaften] = await Promise.all([
            knexLive('live.kampfflaechen').where({ turnier_id: turnier.id }),
            knexLive('live.pools').where({ turnier_id: turnier.id }),
            knexLive('live.teilnehmer').where({ turnier_id: turnier.id }),
            knexLive('live.mannschaften').where({ turnier_id: turnier.id })
        ]);
        const poolIds = pools.map(p => p.id);
        const mannschaftsIds = mannschaften.map(m => m.id);
        const [kaempfe, begegnungen, mitglieder] = await Promise.all([
            poolIds.length ? knexLive('live.kaempfe').whereIn('pool_id', poolIds) : [],
            poolIds.length ? knexLive('live.mannschaftskaempfe').whereIn('pool_id', poolIds) : [],
            mannschaftsIds.length ? knexLive('live.mannschaft_mitglieder').whereIn('mannschaft_id', mannschaftsIds) : []
        ]);
        snapshots.push(baueSnapshot({ turnier, kampfflaechen, pools, teilnehmer, kaempfe, mannschaften, mitglieder, begegnungen }, { geheimnis }));
    }
    return snapshots;
}
