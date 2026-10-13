// Lesende Abfragen der öffentlichen App-API (Spec 6.1). Alle Antworten sind auf die Felder der Kachel beschränkt;
// Aufzählungen ohne Suchbegriff gibt es nur je Pool oder je Verein.
import { suchbegriffe } from './suchtext.js';

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
    return {
        key: kopf.turnier_key, name: kopf.name, datum: kopf.datum, stand: kopf.stand, empfangenAm: kopf.empfangen_am,
        matten: Array.isArray(kopf.matten) ? kopf.matten : [], vereine, klassen
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
        teilnehmer: teilnehmerZeilen.map(teilnehmerDto),
        kaempfe: kaempfeZeilen.map(k => {
            const index = warteschlange.indexOf(k.kampf_id);
            return {
                id: k.kampf_id, nr: k.nr, status: k.status, k1: kaempferDto(namen, k.k1_key), k2: kaempferDto(namen, k.k2_key),
                sieger: k.sieger_key, p1: k.p1, p2: k.p2, abstand: index >= 0 ? index : null
            };
        })
    };
}

export async function ladeVerein(knex, turnierKey, vereinKey) {
    const zeilen = await sortiert(knex('live_teilnehmer').where({ turnier_key: turnierKey, verein_key: vereinKey }));
    return zeilen.map(teilnehmerDto);
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
    return zeilen.map(teilnehmerDto);
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
