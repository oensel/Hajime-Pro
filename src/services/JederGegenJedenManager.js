export class JederGegenJedenManager {
    constructor() {
        this.bezeichnung = "Jeder gegen Jeden";
    }

    /**
     * Initialisiert den kompletten Pool-Kampfplan direkt in der Datenbank.
     * Generiert kombinatorisch alle Paarungen (Jeder gegen Jeden).
     * @param {Object} knex - Die Knex-Instanz
     * @param {number} poolId - Die ID des Pools aus der Datenbank
     */
    async initialisierePool(knex, poolId) {
        // 1. Pool-Daten und alle registrierten Teilnehmer laden
        const pool = await knex('pools').where({ id: poolId }).first();
        const teilnehmer = await knex('turnier_teilnehmer').where({ pool_id: poolId });

        // Sortieren nach Gewicht aufsteigend
        teilnehmer.sort((a, b) => Number(a.gewicht) - Number(b.gewicht));

        // KORREKTUR: Wenn weniger als 1 Teilnehmer da sind, macht es keinen Sinn
        if (teilnehmer.length < 1) {
            console.log(`[DB] Kein Teilnehmer für Pool-ID ${poolId} vorhanden.`);
            return;
        }

        // SONDERFALL: Genau 1 Teilnehmer -> Pool direkt erfolgreich abschließen (Kampflos).
        // Kein Kampf zu prüfen -> direkt 'abgeschlossen', ohne den Zwischenschritt
        // 'kaempfe_beendet' (der eine manuelle Tischbestätigung von Ergebnissen voraussetzt).
        if (teilnehmer.length === 1) {
            console.log(`[DB] 1 Teilnehmer in Pool-ID ${poolId}. Pool wird direkt als abgeschlossen markiert (Kampflos).`);
            await knex('pools').where({ id: poolId }).update({ status: 'abgeschlossen' });
            return;
        }

        const neueKaempfe = [];

        // 2. Paarungen ermitteln
        let pairings = [];
        const n = teilnehmer.length;
        if (n === 2) {
            pairings = [[0, 1]];
        } else if (n === 3) {
            pairings = [
                [0, 1], // 1-2
                [0, 2], // 1-3
                [1, 2]  // 2-3
            ];
        } else if (n === 4) {
            pairings = [
                [0, 1], // 1-2
                [2, 3], // 3-4
                [0, 3], // 1-4
                [1, 2], // 2-3
                [0, 2], // 1-3
                [1, 3]  // 2-4
            ];
        } else if (n === 5) {
            pairings = [
                [0, 1], // 1-2
                [2, 3], // 3-4
                [1, 2], // 2-3
                [3, 4], // 4-5
                [0, 2], // 1-3
                [1, 4], // 2-5
                [0, 3], // 1-4
                [2, 4], // 3-5
                [0, 4], // 1-5
                [1, 3]  // 2-4
            ];
        } else {
            // Fallback für andere Pool-Größen
            for (let i = 0; i < n; i++) {
                for (let j = i + 1; j < n; j++) {
                    pairings.push([i, j]);
                }
            }
        }

        pairings.forEach((pair, idx) => {
            const k1 = teilnehmer[pair[0]];
            const k2 = teilnehmer[pair[1]];

            neueKaempfe.push({
                pool_id: poolId,
                status: 'bereit',
                reihenfolge_nummer: idx + 1,
                kaempfer1_id: k1.id,
                kaempfer2_id: k2.id,
                sieger_id: null,
                kampfzeit_in_sekunden: 0,
                unterbewertung_kaempfer1: 0,
                unterbewertung_kaempfer2: 0
            });
        });

        // 3. Alle generierten Kämpfe gesammelt in die DB schreiben
        if (neueKaempfe.length > 0) {
            await knex('kaempfe').insert(neueKaempfe);
            console.log(`[DB] ${neueKaempfe.length} Kämpfe für Pool-ID ${poolId} (Jeder-gegen-Jeden) generiert.`);
        }

        // 4. Initialen Abschlussstatus prüfen
        await this.aktualisiereTurnier(knex, poolId);
    }


    /**
     * Wird nach jedem Kampf am Tisch aufgerufen.
     * Da keine Kämpfe nachrücken, wird nur geprüft, ob das Turnier vollendet ist.
     * @param {Object} knex - Die Knex-Instanz
     * @param {number} poolId - Die ID des Pools aus der Datenbank
     */
    async aktualisiereTurnier(knex, poolId) {
        // Alle Kämpfe des aktuellen Pools laden
        const kaempfe = await knex('kaempfe').where({ pool_id: poolId });

        if (kaempfe.length === 0) {
            return;
        }

        // Prüfen, ob wirklich alle vorhandenen Kämpfe den Status 'beendet' haben
        const alleBeendet = kaempfe.every(kampf => kampf.status === 'beendet');

        if (alleBeendet) {
            // Wenn alle Kämpfe durch sind, wartet der Pool auf die manuelle Tischbestätigung
            // der Ergebnisse (-> 'abgeschlossen' per eigenem Endpoint, siehe schliessePoolAb).
            await knex('pools').where({ id: poolId }).update({ status: 'kaempfe_beendet' });
            console.log(`[DB] Pool-Turnier ID ${poolId}: alle Kämpfe ausgetragen, wartet auf Bestätigung.`);
        }
    }
}
