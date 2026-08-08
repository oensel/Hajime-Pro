/**
 * @typedef {Object} TeilnehmerDTO
 * @property {number} id
 * @property {number} turnierId
 * @property {number|null} poolId
 * @property {string|null} judopassId
 * @property {string} vorname
 * @property {string} nachname
 * @property {number} geburtsjahr
 * @property {string} lizenzAblauf
 * @property {'männlich'|'weiblich'|'mixed'} geschlecht
 * @property {string|null} verein
 * @property {number} gewicht
 * @property {string} altersklasse
 * @property {string} gewichtsklasse
 * @property {boolean} startgeldBezahlt
 * @property {string|null} graduierung
 */

/** @param {Object} row @returns {TeilnehmerDTO} */
export function mapTeilnehmer(row) {
    return {
        id: row.id,
        turnierId: row.turnier_id,
        poolId: row.pool_id,
        judopassId: row.judopass_id,
        vorname: row.vorname,
        nachname: row.nachname,
        geburtsjahr: row.geburtsjahr,
        lizenzAblauf: row.lizenz_ablauf,
        geschlecht: row.geschlecht,
        verein: row.verein,
        gewicht: row.gewicht !== null ? parseFloat(row.gewicht) : 0,
        altersklasse: row.altersklasse,
        gewichtsklasse: row.gewichtsklasse,
        startgeldBezahlt: !!row.startgeld_bezahlt,
        graduierung: row.graduierung
    };
}

/** @param {Object[]} rows @returns {TeilnehmerDTO[]} */
export function mapTeilnehmerListe(rows) {
    return rows.map(mapTeilnehmer);
}
