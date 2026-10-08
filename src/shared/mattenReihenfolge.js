/**
 * Reihenfolge der noch nicht gestarteten Kämpfe einer Matte (matten_reihenfolge). Rein und
 * knex-/DOM-frei, damit Server und Client-Geräte dieselbe Verteilung berechnen.
 *
 * Die neue Reihenfolge verwendet genau die Positionswerte, die die beteiligten Kämpfe bisher
 * belegt haben (aufsteigend neu zugeteilt). Dadurch kollidiert nie ein Wert mit den Kämpfen, die
 * nicht angefasst werden (gestartete/beendete), auch wenn deren Werte Lücken haben.
 */

/** @returns {Array<{id: number, matten_reihenfolge: number}>} */
export function verteilePositionen(idFolge, kaempfeById) {
    const positionen = idFolge
        .map(id => kaempfeById.get(id)?.matten_reihenfolge)
        .filter(p => p != null)
        .map(Number)
        .sort((a, b) => a - b);
    // Kämpfe ohne bisherige Position (z. B. frisch zurückgesetzt): hinter den höchsten Wert
    let naechste = positionen.length ? positionen[positionen.length - 1] + 1 : 0;
    while (positionen.length < idFolge.length) positionen.push(naechste++);
    return idFolge.map((id, i) => ({ id, matten_reihenfolge: positionen[i] }));
}

/** Setzt kampfId an Index (0-basiert) in die bestehende Folge der übrigen Kämpfe. */
export function fuegeEin(uebrigeIdFolge, kampfId, index) {
    const folge = uebrigeIdFolge.filter(id => id !== kampfId);
    folge.splice(Math.min(index, folge.length), 0, kampfId);
    return folge;
}
