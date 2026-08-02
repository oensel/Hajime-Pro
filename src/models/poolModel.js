/**
 * @typedef {Object} PoolDTO
 * @property {number} id
 * @property {number} turnierId
 * @property {number|null} kampfflaecheId
 * @property {string} bezeichnung
 * @property {string} modus
 * @property {string} altersklasse
 * @property {string} geschlecht
 * @property {string} gewichtsklasse
 * @property {number} kampfzeitSekunden
 * @property {number|null} matteReihenfolge
 */

/** @param {Object} row @returns {PoolDTO} */
export function mapPool(row) {
    return {
        id: row.id,
        turnierId: row.turnier_id,
        kampfflaecheId: row.kampfflaeche_id,
        bezeichnung: row.bezeichnung,
        modus: row.modus,
        altersklasse: row.altersklasse,
        geschlecht: row.geschlecht,
        gewichtsklasse: row.gewichtsklasse,
        kampfzeitSekunden: row.kampfzeit_sekunden,
        matteReihenfolge: row.matte_reihenfolge
    };
}

/** @param {Object[]} rows @returns {PoolDTO[]} */
export function mapPools(rows) {
    return rows.map(mapPool);
}
