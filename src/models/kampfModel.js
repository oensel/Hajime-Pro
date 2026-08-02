/**
 * @typedef {Object} KampfTeilnehmer
 * @property {number} id
 * @property {string|null} vorname
 * @property {string|null} nachname
 * @property {string|null} verein
 */

/**
 * @typedef {Object} KampfDTO
 * @property {number} id
 * @property {number} poolId
 * @property {'wartet'|'laufend'|'beendet'} status
 * @property {KampfTeilnehmer|null} kaempfer1
 * @property {KampfTeilnehmer|null} kaempfer2
 * @property {number|null} siegerId
 * @property {number} kampfzeitInSekunden
 * @property {{kaempfer1: number, kaempfer2: number}} unterbewertung
 * @property {string|null} reihenfolgeNummer
 * @property {number|null} mattenReihenfolge
 * @property {{bezeichnung: string|null, kampfzeitSekunden: number|null}} pool
 */

/**
 * Wandelt eine (ggf. gejointe) Zeile aus `kaempfe` in ein konsistentes DTO um — unabhängig
 * davon, welche der drei getKaempfe()-Varianten (poolId / turnierId / kampfflaecheId) sie
 * geliefert hat. Felder, die eine Variante nicht mitjoint, werden hier einheitlich zu null
 * statt in manchen Antworten zu fehlen und in anderen vorhanden zu sein.
 * @param {Object} row
 * @returns {KampfDTO}
 */
export function mapKampf(row) {
    return {
        id: row.id,
        poolId: row.pool_id,
        status: row.status,
        kaempfer1: row.kaempfer1_id ? {
            id: row.kaempfer1_id,
            vorname: row.kaempfer1_vorname ?? null,
            nachname: row.kaempfer1_nachname ?? null,
            verein: row.kaempfer1_verein ?? null
        } : null,
        kaempfer2: row.kaempfer2_id ? {
            id: row.kaempfer2_id,
            vorname: row.kaempfer2_vorname ?? null,
            nachname: row.kaempfer2_nachname ?? null,
            verein: row.kaempfer2_verein ?? null
        } : null,
        siegerId: row.sieger_id,
        kampfzeitInSekunden: row.kampfzeit_in_sekunden,
        unterbewertung: {
            kaempfer1: row.unterbewertung_kaempfer1,
            kaempfer2: row.unterbewertung_kaempfer2
        },
        reihenfolgeNummer: row.reihenfolge_nummer,
        mattenReihenfolge: row.matten_reihenfolge,
        pool: {
            bezeichnung: row.pool_bezeichnung ?? null,
            kampfzeitSekunden: row.pool_kampfzeit ?? null
        }
    };
}

/** @param {Object[]} rows @returns {KampfDTO[]} */
export function mapKaempfe(rows) {
    return rows.map(mapKampf);
}
