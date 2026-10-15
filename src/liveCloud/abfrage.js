// Lesende Abfragen der öffentlichen App-API (Spec 6.1). Alle Antworten sind auf die Felder der Kachel beschränkt;
// Aufzählungen ohne Suchbegriff gibt es nur je Pool oder je Verein.
import { suchbegriffe, suchtextFuer } from './suchtext.js';

export const MAX_TREFFER = 20;
export const MAX_SCHLUESSEL = 200;
const MAX_UEBERSICHT_ZEILEN = 1000;
const OFFEN = new Set(['bereit', 'vorbereiten', 'gestartet']);
const BEENDET = new Set(['beendet', 'freilos']);
const NAME = (z) => `${z.vorname} ${z.nachname}`.trim();

function gewichtSortierwert(gewichtsklasse) {
    const zahl = parseFloat(String(gewichtsklasse).replace(/[^\d.]/g, '')) || 0;
    return String(gewichtsklasse).startsWith('+') ? zahl + 1000 : zahl;
}

const nachReihenfolge = (a, b) => {
    const ra = a.reihenfolge == null ? Infinity : Number(a.reihenfolge);
    const rb = b.reihenfolge == null ? Infinity : Number(b.reihenfolge);
    return ra !== rb ? ra - rb : a.kampf_id - b.kampf_id;
};

async function ladeNamen(knex, turnierKey) {
    const zeilen = await knex('live_teilnehmer').where({ turnier_key: turnierKey }).select('key', 'vorname', 'nachname', 'verein');
    return new Map(zeilen.map(z => [z.key, { key: z.key, name: NAME(z), verein: z.verein }]));
}

const kaempferDto = (namen, key) => (key ? (namen.get(key) || { key, name: 'unbekannt', verein: '' }) : null);

function mattenName(kopf, matteId) {
    const m = (Array.isArray(kopf.matten) ? kopf.matten : []).find(x => x.id === matteId);
    return m ? m.bezeichnung : '';
}

export function mannschaftDto(z) {
    return {
        key: z.key, bezeichnung: z.bezeichnung, verein: z.verein, vereinKey: z.verein_key,
        poolId: z.pool_id, poolBezeichnung: z.pool_bezeichnung, modus: z.modus, poolStatus: z.pool_status,
        altersklasse: z.altersklasse, geschlecht: z.geschlecht,
        matteId: z.matte_id, matteBezeichnung: z.matte_bezeichnung,
        zustand: z.zustand, abstand: z.abstand, gegner: z.gegner, siege: z.siege, niederlagen: z.niederlagen,
        anzahlMitglieder: Array.isArray(z.mitglieder) ? z.mitglieder.length : 0
    };
}

export function teilnehmerDto(z) {
    return {
        key: z.key, vorname: z.vorname, nachname: z.nachname, verein: z.verein, vereinKey: z.verein_key,
        altersklasse: z.altersklasse, gewichtsklasse: z.gewichtsklasse, geschlecht: z.geschlecht,
        poolId: z.pool_id, poolBezeichnung: z.pool_bezeichnung, matteId: z.matte_id, matteBezeichnung: z.matte_bezeichnung,
        zustand: z.zustand, abstand: z.abstand, platz: z.platz
    };
}

function berlinDatum(datum) {
    return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(datum);
}

function sortiert(abfrage) {
    return abfrage.orderBy([{ column: 'nachname' }, { column: 'vorname' }, { column: 'key' }]);
}

const schluesselliste = (wert) => (Array.isArray(wert)
    ? [...new Set(wert.filter(k => typeof k === 'string' && k.length > 0 && k.length <= 64))].slice(0, MAX_SCHLUESSEL)
    : []);

export async function listeTurniere(knex, { jetzt = () => new Date() } = {}) {
    const heute = berlinDatum(jetzt());
    const zeilen = await knex('live_turniere').where({ zurueckgezogen: false })
        .select('turnier_key', 'name', 'datum', 'stand', 'empfangen_am');
    return zeilen
        .map(z => ({ key: z.turnier_key, name: z.name, datum: z.datum, stand: z.stand, empfangenAm: z.empfangen_am }))
        .sort((a, b) => {
            const ah = a.datum === heute ? 0 : 1;
            const bh = b.datum === heute ? 0 : 1;
            if (ah !== bh) return ah - bh;
            return String(b.datum).localeCompare(String(a.datum)) || a.name.localeCompare(b.name);
        });
}

export async function ladeTurnier(knex, turnierKey) {
    const kopf = await knex('live_turniere').where({ turnier_key: turnierKey, zurueckgezogen: false }).first();
    if (!kopf) return null;
    const zaehler = await knex('live_teilnehmer').where({ turnier_key: turnierKey })
        .select('verein_key').count('* as anzahl').groupBy('verein_key');
    const anzahl = new Map(zaehler.map(z => [z.verein_key, Number(z.anzahl)]));
    const vereine = (Array.isArray(kopf.vereine) ? kopf.vereine : [])
        .map(v => ({ key: v.key, name: v.name, anzahl: anzahl.get(v.key) || 0 }))
        .filter(v => v.anzahl > 0)
        .sort((a, b) => a.name.localeCompare(b.name));
    const poolZeilen = await knex('live_pools').where({ turnier_key: turnierKey })
        .select('pool_id', 'bezeichnung', 'altersklasse', 'geschlecht', 'gewichtsklasse');
    const gruppen = new Map();
    for (const p of poolZeilen) {
        const schluessel = `${p.altersklasse}|${p.geschlecht}`;
        if (!gruppen.has(schluessel)) gruppen.set(schluessel, { altersklasse: p.altersklasse, geschlecht: p.geschlecht, pools: [] });
        gruppen.get(schluessel).pools.push({ poolId: p.pool_id, gewichtsklasse: p.gewichtsklasse, bezeichnung: p.bezeichnung });
    }
    const klassen = [...gruppen.values()]
        .map(g => ({ ...g, pools: g.pools.sort((a, b) => gewichtSortierwert(a.gewichtsklasse) - gewichtSortierwert(b.gewichtsklasse)) }))
        .sort((a, b) => a.altersklasse.localeCompare(b.altersklasse, 'de', { numeric: true }) || a.geschlecht.localeCompare(b.geschlecht));
    const [{ anzahl: anzahlTeams }] = await knex('live_mannschaften').where({ turnier_key: turnierKey }).count('* as anzahl');
    return {
        key: kopf.turnier_key, name: kopf.name, datum: kopf.datum, stand: kopf.stand, empfangenAm: kopf.empfangen_am,
        matten: Array.isArray(kopf.matten) ? kopf.matten : [], vereine, klassen,
        // Der Umschalter Einzel/Mannschaften erscheint nur, wenn es wirklich beides gibt.
        hatEinzel: poolZeilen.length > 0,
        hatMannschaften: Number(anzahlTeams) > 0
    };
}

export async function suche(knex, turnierKey, text) {
    const begriffe = suchbegriffe(text);
    if (!begriffe.length) return [];
    const abfrage = knex('live_teilnehmer').where({ turnier_key: turnierKey });
    for (const begriff of begriffe) abfrage.where('suche', 'like', `%${begriff}%`);
    const zeilen = await sortiert(abfrage).limit(MAX_TREFFER);
    return zeilen.map(teilnehmerDto);
}

// Teams, deren Name, Verein oder ein Mitglied zum Suchbegriff passt; passende Mitglieder werden einzeln aufgeführt.
export async function sucheMannschaften(knex, turnierKey, text) {
    const begriffe = suchbegriffe(text);
    if (!begriffe.length) return { mannschaften: [], mitglieder: [] };
    const abfrage = knex('live_mannschaften').where({ turnier_key: turnierKey });
    for (const begriff of begriffe) abfrage.where('suche', 'like', `%${begriff}%`);
    const zeilen = await abfrage.orderBy([{ column: 'bezeichnung' }, { column: 'key' }]).limit(MAX_TREFFER);
    const mitglieder = [];
    const teams = [];
    for (const z of zeilen) {
        const dto = mannschaftDto(z);
        const passend = (Array.isArray(z.mitglieder) ? z.mitglieder : []).filter(m => {
            const such = suchtextFuer(m.vorname, m.nachname);
            return begriffe.every(b => such.includes(b));
        });
        if (passend.length) {
            for (const m of passend) mitglieder.push({ vorname: m.vorname, nachname: m.nachname, gewichtsklasse: m.gewichtsklasse, mannschaft: dto });
        } else {
            teams.push(dto);
        }
    }
    return { mannschaften: teams, mitglieder };
}

export async function listeMannschaftsPools(knex, turnierKey) {
    const [teams, begegnungen, kopf] = await Promise.all([
        knex('live_mannschaften').where({ turnier_key: turnierKey }),
        knex('live_begegnungen').where({ turnier_key: turnierKey }),
        knex('live_turniere').where({ turnier_key: turnierKey }).first()
    ]);
    const pools = new Map();
    for (const t of teams) {
        if (t.pool_id == null) continue;
        if (!pools.has(t.pool_id)) {
            pools.set(t.pool_id, {
                poolId: t.pool_id, bezeichnung: t.pool_bezeichnung, modus: t.modus, status: t.pool_status,
                altersklasse: t.altersklasse, geschlecht: t.geschlecht, teams: 0, gesamt: 0, beendet: 0, laeuft: 0, matten: new Set(),
                mannschaften: []
            });
        }
        pools.get(t.pool_id).teams += 1;
        pools.get(t.pool_id).mannschaften.push(mannschaftDto(t));
    }
    for (const b of begegnungen) {
        const p = pools.get(b.pool_id);
        if (!p) continue;
        p.gesamt += 1;
        if (BEENDET.has(b.status)) p.beendet += 1;
        if (b.status === 'gestartet') p.laeuft += 1;
        if (b.matte_id != null) p.matten.add(b.matte_id);
    }
    return [...pools.values()]
        .map(p => ({
            poolId: p.poolId, bezeichnung: p.bezeichnung, modus: p.modus, status: p.status,
            altersklasse: p.altersklasse, geschlecht: p.geschlecht, teams: p.teams,
            gesamt: p.gesamt, beendet: p.beendet, laeuft: p.laeuft,
            mannschaften: p.mannschaften.sort((a, b) => a.bezeichnung.localeCompare(b.bezeichnung, 'de', { numeric: true })),
            matten: [...p.matten].sort((a, b) => a - b).map(id => ({ id, bezeichnung: kopf ? mattenName(kopf, id) : '' }))
        }))
        .sort((a, b) => a.altersklasse.localeCompare(b.altersklasse, 'de', { numeric: true })
            || a.geschlecht.localeCompare(b.geschlecht) || a.poolId - b.poolId);
}

export async function ladeMannschaft(knex, turnierKey, teamKey) {
    const team = await knex('live_mannschaften').where({ turnier_key: turnierKey, key: teamKey }).first();
    if (!team) return null;
    const [begegnungen, teams, kopf] = await Promise.all([
        knex('live_begegnungen').where({ turnier_key: turnierKey, pool_id: team.pool_id })
            .where(function () { this.where('team1_key', teamKey).orWhere('team2_key', teamKey); })
            .orderBy('begegnung_id'),
        knex('live_mannschaften').where({ turnier_key: turnierKey, pool_id: team.pool_id }).select('key', 'bezeichnung', 'verein'),
        knex('live_turniere').where({ turnier_key: turnierKey }).first()
    ]);
    const nameVon = new Map(teams.map(t => [t.key, t.bezeichnung]));
    return {
        mannschaft: { ...mannschaftDto(team), naechsteBegegnungId: team.naechste_begegnung_id },
        mitglieder: Array.isArray(team.mitglieder) ? team.mitglieder : [],
        begegnungen: begegnungen.map(b => {
            const gegnerKey = b.team1_key === teamKey ? b.team2_key : b.team1_key;
            const eigene = b.team1_key === teamKey ? b.s1 : b.s2;
            const fremde = b.team1_key === teamKey ? b.s2 : b.s1;
            return {
                id: b.begegnung_id, nr: b.nr, runde: b.runde, status: b.status, abstand: b.abstand,
                matteId: b.matte_id, matteBezeichnung: kopf && b.matte_id != null ? mattenName(kopf, b.matte_id) : '',
                gegner: gegnerKey ? (nameVon.get(gegnerKey) || '') : '', gegnerKey: gegnerKey || null,
                eigene, fremde, gewonnen: b.sieger_key == null ? null : b.sieger_key === teamKey
            };
        })
    };
}

export async function ladePool(knex, turnierKey, poolId) {
    const [teilnehmerZeilen, poolZeile, kopf] = await Promise.all([
        sortiert(knex('live_teilnehmer').where({ turnier_key: turnierKey, pool_id: poolId })),
        knex('live_pools').where({ turnier_key: turnierKey, pool_id: poolId }).first(),
        knex('live_turniere').where({ turnier_key: turnierKey }).first()
    ]);
    if (!teilnehmerZeilen.length && !poolZeile) return null;
    const matteId = poolZeile ? poolZeile.matte_id : (teilnehmerZeilen[0] ? teilnehmerZeilen[0].matte_id : null);
    const kaempfeZeilen = await knex('live_kaempfe').where({ turnier_key: turnierKey, pool_id: poolId }).orderBy('kampf_id');

    // Wartepositionen: offene Kämpfe der ganzen Matte in Matten-Reihenfolge (ein laufender Kampf zählt mit).
    let warteschlange = [];
    if (matteId != null) {
        const poolIdsDerMatte = (await knex('live_pools').where({ turnier_key: turnierKey, matte_id: matteId }).select('pool_id')).map(p => p.pool_id);
        const offene = poolIdsDerMatte.length
            ? await knex('live_kaempfe').where({ turnier_key: turnierKey }).whereIn('pool_id', poolIdsDerMatte).whereIn('status', [...OFFEN])
            : [];
        warteschlange = offene.sort(nachReihenfolge).map(k => k.kampf_id);
    }
    const namen = await ladeNamen(knex, turnierKey);
    const bezeichnung = poolZeile ? poolZeile.bezeichnung : (teilnehmerZeilen[0] ? teilnehmerZeilen[0].pool_bezeichnung : '');
    return {
        pool: {
            id: poolId, bezeichnung,
            matteBezeichnung: poolZeile && kopf ? mattenName(kopf, poolZeile.matte_id) : (teilnehmerZeilen[0] ? teilnehmerZeilen[0].matte_bezeichnung : ''),
            modus: poolZeile ? poolZeile.modus : '', status: poolZeile ? poolZeile.status : '', farbe2: poolZeile ? poolZeile.farbe2 : 'blau'
        },
        teilnehmer: await mitPoolStart(knex, turnierKey, teilnehmerZeilen.map(teilnehmerDto)),
        kaempfe: kaempfeZeilen.map(k => {
            const index = warteschlange.indexOf(k.kampf_id);
            return {
                id: k.kampf_id, nr: k.nr, status: k.status, k1: kaempferDto(namen, k.k1_key), k2: kaempferDto(namen, k.k2_key),
                sieger: k.sieger_key, p1: k.p1, p2: k.p2, abstand: index >= 0 ? index : null
            };
        })
    };
}

// Pool-Beginn je Pool: begonnen = es lief oder endete schon ein Kampf; startetIn = Abstand des ersten offenen Kampfes
// des Pools in der Matten-Warteschlange (nur, solange der Pool noch nicht begonnen hat, sonst null).
export async function poolStarts(knex, turnierKey) {
    const [pools, kaempfe] = await Promise.all([
        knex('live_pools').where({ turnier_key: turnierKey }).select('pool_id', 'matte_id'),
        knex('live_kaempfe').where({ turnier_key: turnierKey }).select('pool_id', 'status', 'reihenfolge', 'kampf_id')
    ]);
    const ergebnis = new Map();
    const mattenDerPools = new Map(pools.map(p => [p.pool_id, p.matte_id]));
    for (const p of pools) ergebnis.set(p.pool_id, { begonnen: false, startetIn: null });
    for (const k of kaempfe) {
        if ((k.status === 'gestartet' || k.status === 'beendet') && ergebnis.has(k.pool_id)) ergebnis.get(k.pool_id).begonnen = true;
    }
    const nachMatte = new Map();
    for (const k of kaempfe) {
        const matte = mattenDerPools.get(k.pool_id);
        if (matte == null || !OFFEN.has(k.status)) continue;
        if (!nachMatte.has(matte)) nachMatte.set(matte, []);
        nachMatte.get(matte).push(k);
    }
    for (const liste of nachMatte.values()) {
        liste.sort(nachReihenfolge).forEach((k, index) => {
            const info = ergebnis.get(k.pool_id);
            if (info && !info.begonnen && info.startetIn == null) info.startetIn = index;
        });
    }
    return ergebnis;
}

async function mitPoolStart(knex, turnierKey, dtos) {
    if (!dtos.length) return dtos;
    const starts = await poolStarts(knex, turnierKey);
    return dtos.map(d => {
        const info = d.poolId != null ? starts.get(d.poolId) : null;
        return { ...d, poolBegonnen: info ? info.begonnen : false, poolStartetIn: info ? info.startetIn : null };
    });
}

export async function ladeVerein(knex, turnierKey, vereinKey) {
    const zeilen = await sortiert(knex('live_teilnehmer').where({ turnier_key: turnierKey, verein_key: vereinKey }));
    return mitPoolStart(knex, turnierKey, zeilen.map(teilnehmerDto));
}

// Verfolgte Teams der Übersicht (Stern am Team). Vereine zählen hier nicht mit.
export async function uebersichtMannschaften(knex, turnierKey, { mannschaften, teilnehmer } = {}) {
    // Stern und Glocke am Team liegen in der App wie bei Teilnehmern in der Liste "teilnehmer".
    const keys = schluesselliste([...(Array.isArray(mannschaften) ? mannschaften : []), ...(Array.isArray(teilnehmer) ? teilnehmer : [])]);
    if (!keys.length) return [];
    const zeilen = await knex('live_mannschaften').where({ turnier_key: turnierKey }).whereIn('key', keys)
        .orderBy([{ column: 'bezeichnung' }, { column: 'key' }]);
    return zeilen.map(mannschaftDto);
}

export async function uebersicht(knex, turnierKey, { teilnehmer, vereine } = {}) {
    const keys = schluesselliste(teilnehmer);
    const vereinKeys = schluesselliste(vereine);
    if (!keys.length && !vereinKeys.length) return [];
    const abfrage = knex('live_teilnehmer').where({ turnier_key: turnierKey }).where(function () {
        if (keys.length) this.whereIn('key', keys);
        if (vereinKeys.length) this.orWhereIn('verein_key', vereinKeys);
    });
    const zeilen = await sortiert(abfrage).limit(MAX_UEBERSICHT_ZEILEN);
    return mitPoolStart(knex, turnierKey, zeilen.map(teilnehmerDto));
}

export async function listePools(knex, turnierKey) {
    const [pools, kopf, teilnehmerZaehler, kampfZeilen] = await Promise.all([
        knex('live_pools').where({ turnier_key: turnierKey }),
        knex('live_turniere').where({ turnier_key: turnierKey }).first(),
        knex('live_teilnehmer').where({ turnier_key: turnierKey }).select('pool_id').count('* as anzahl').groupBy('pool_id'),
        knex('live_kaempfe').where({ turnier_key: turnierKey }).select('pool_id', 'status')
    ]);
    const anzahl = new Map(teilnehmerZaehler.map(z => [z.pool_id, Number(z.anzahl)]));
    const summen = new Map();
    for (const k of kampfZeilen) {
        const summe = summen.get(k.pool_id) || { gesamt: 0, beendet: 0, laeuft: 0 };
        summe.gesamt += 1;
        if (BEENDET.has(k.status)) summe.beendet += 1;
        if (k.status === 'gestartet') summe.laeuft += 1;
        summen.set(k.pool_id, summe);
    }
    return pools
        .map(p => ({
            poolId: p.pool_id, bezeichnung: p.bezeichnung, modus: p.modus, status: p.status, matteId: p.matte_id,
            matteBezeichnung: kopf && p.matte_id != null ? mattenName(kopf, p.matte_id) : '',
            altersklasse: p.altersklasse, geschlecht: p.geschlecht, gewichtsklasse: p.gewichtsklasse,
            teilnehmer: anzahl.get(p.pool_id) || 0, ...(summen.get(p.pool_id) || { gesamt: 0, beendet: 0, laeuft: 0 })
        }))
        .sort((a, b) => (a.matteId ?? Infinity) - (b.matteId ?? Infinity) || a.poolId - b.poolId);
}

export async function ladeDashboard(knex, turnierKey) {
    const kopf = await knex('live_turniere').where({ turnier_key: turnierKey, zurueckgezogen: false }).first();
    if (!kopf) return null;
    const [pools, kaempfe, namen] = await Promise.all([
        knex('live_pools').where({ turnier_key: turnierKey }).orderBy('pool_id'),
        knex('live_kaempfe').where({ turnier_key: turnierKey }),
        ladeNamen(knex, turnierKey)
    ]);
    const poolNachId = new Map(pools.map(p => [p.pool_id, p]));
    const fuerAnzeige = (k) => {
        const p = poolNachId.get(k.pool_id);
        const dto = (key) => { const n = kaempferDto(namen, key); return n ? { name: n.name, verein: n.verein } : null; };
        return { id: k.kampf_id, poolId: k.pool_id, poolBezeichnung: p ? p.bezeichnung : '', farbe2: p ? p.farbe2 : 'blau', k1: dto(k.k1_key), k2: dto(k.k2_key) };
    };
    const summe = (poolId) => {
        const eigene = kaempfe.filter(k => k.pool_id === poolId);
        return { gesamt: eigene.length, beendet: eigene.filter(k => BEENDET.has(k.status)).length };
    };
    const matten = (Array.isArray(kopf.matten) ? kopf.matten : []).map(m => {
        const poolsDerMatte = pools.filter(p => p.matte_id === m.id);
        const ids = new Set(poolsDerMatte.map(p => p.pool_id));
        const dieser = kaempfe.filter(k => ids.has(k.pool_id)).sort(nachReihenfolge);
        const laufend = dieser.find(k => k.status === 'gestartet') || null;
        const naechste = dieser.filter(k => k.status === 'bereit' || k.status === 'vorbereiten').slice(0, 3);
        return {
            id: m.id, bezeichnung: m.bezeichnung,
            farbe2: (laufend && poolNachId.get(laufend.pool_id)) ? poolNachId.get(laufend.pool_id).farbe2 : (poolsDerMatte[0] ? poolsDerMatte[0].farbe2 : 'blau'),
            laufend: laufend ? fuerAnzeige(laufend) : null,
            naechste: naechste.map(fuerAnzeige),
            pools: poolsDerMatte.map(p => ({ poolId: p.pool_id, bezeichnung: p.bezeichnung, status: p.status, ...summe(p.pool_id) }))
        };
    });
    const warteschlange = pools.filter(p => p.matte_id == null).map(p => ({ poolId: p.pool_id, bezeichnung: p.bezeichnung }));
    return { matten, warteschlange, stand: kopf.stand, empfangenAm: kopf.empfangen_am };
}
