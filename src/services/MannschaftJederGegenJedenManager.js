import { aktualisiereMannschaftsPool } from './mannschaftsBegegnungEngine.js';

// Team-Pendant zu JederGegenJedenManager.js: erzeugt Begegnungen (mannschaftskaempfe) statt
// Einzelkämpfe. Gleiche Paarungstabellen wie beim Original — nur dass "Teilnehmer" hier
// Mannschaften sind, geordnet nach Anmeldereihenfolge (kein Gewicht zum Sortieren vorhanden).
export class MannschaftJederGegenJedenManager {
    constructor() {
        this.bezeichnung = "Mannschaft Jeder gegen Jeden";
    }

    async initialisierePool(knex, poolId) {
        const mannschaften = await knex('mannschaften').where({ pool_id: poolId }).orderBy('id', 'asc');

        if (mannschaften.length < 1) {
            console.log(`[DB] Keine Mannschaft für Pool-ID ${poolId} vorhanden.`);
            return;
        }

        if (mannschaften.length === 1) {
            console.log(`[DB] 1 Mannschaft in Pool-ID ${poolId}. Pool wird direkt als abgeschlossen markiert (Kampflos).`);
            await knex('pools').where({ id: poolId }).update({ status: 'abgeschlossen' });
            return;
        }

        let pairings = [];
        const n = mannschaften.length;
        if (n === 2) {
            pairings = [[0, 1]];
        } else if (n === 3) {
            pairings = [[0, 1], [0, 2], [1, 2]];
        } else if (n === 4) {
            pairings = [[0, 1], [2, 3], [0, 3], [1, 2], [0, 2], [1, 3]];
        } else if (n === 5) {
            pairings = [
                [0, 1], [2, 3], [1, 2], [3, 4],
                [0, 2], [1, 4], [0, 3], [2, 4],
                [0, 4], [1, 3]
            ];
        } else {
            for (let i = 0; i < n; i++) {
                for (let j = i + 1; j < n; j++) {
                    pairings.push([i, j]);
                }
            }
        }

        const neueBegegnungen = pairings.map((pair, idx) => ({
            pool_id: poolId,
            status: 'bereit',
            reihenfolge_nummer: String(idx + 1),
            mannschaft1_id: mannschaften[pair[0]].id,
            mannschaft2_id: mannschaften[pair[1]].id,
            sieger_mannschaft_id: null
        }));

        if (neueBegegnungen.length > 0) {
            await knex('mannschaftskaempfe').insert(neueBegegnungen);
            console.log(`[DB] ${neueBegegnungen.length} Begegnungen für Pool-ID ${poolId} (Mannschaft Jeder-gegen-Jeden) generiert.`);
        }

        await this.aktualisiereTurnier(knex, poolId);
    }

    async aktualisiereTurnier(knex, poolId) {
        await aktualisiereMannschaftsPool(knex, poolId);
    }
}
