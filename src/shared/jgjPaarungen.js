/**
 * Reihenfolge der Paarungen im Jeder-gegen-Jeden (Indizes in der nach Gewicht sortierten Teilnehmerliste).
 * Für 4 und 5 so gewählt, dass niemand zweimal direkt hintereinander kämpft; genutzt für Jeder-gegen-Jeden-Pools
 * und die Vorrundengruppen im Gruppen-Überkreuz.
 * @param {number} n - Anzahl Teilnehmer
 * @returns {Array<[number, number]>}
 */
export function jgjPaarungen(n) {
    if (n === 2) return [[0, 1]];
    if (n === 3) return [[0, 1], [0, 2], [1, 2]];
    if (n === 4) return [[0, 1], [2, 3], [0, 3], [1, 2], [0, 2], [1, 3]];
    if (n === 5) {
        return [[0, 1], [2, 3], [1, 2], [3, 4], [0, 2], [1, 4], [0, 3], [2, 4], [0, 4], [1, 3]];
    }
    const paarungen = [];
    for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) paarungen.push([i, j]);
    }
    return paarungen;
}
