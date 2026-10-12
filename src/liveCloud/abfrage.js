// Lesende Abfragen der öffentlichen App-API (Spec 6.1). Alle Antworten sind auf die Felder der Kachel beschränkt;
// Aufzählungen ohne Suchbegriff gibt es nur je Pool oder je Verein.
import { suchbegriffe } from './suchtext.js';

export const MAX_TREFFER = 20;
export const MAX_SCHLUESSEL = 200;
const MAX_UEBERSICHT_ZEILEN = 1000;

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
    return {
        key: kopf.turnier_key, name: kopf.name, datum: kopf.datum, stand: kopf.stand, empfangenAm: kopf.empfangen_am,
        matten: Array.isArray(kopf.matten) ? kopf.matten : [], vereine
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
    const zeilen = await sortiert(knex('live_teilnehmer').where({ turnier_key: turnierKey, pool_id: poolId }));
    if (!zeilen.length) return null;
    return {
        pool: { id: poolId, bezeichnung: zeilen[0].pool_bezeichnung, matteBezeichnung: zeilen[0].matte_bezeichnung },
        teilnehmer: zeilen.map(teilnehmerDto)
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
