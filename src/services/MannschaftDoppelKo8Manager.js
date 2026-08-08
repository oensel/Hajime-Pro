import { DOPPEL_KO_8_TOPOLOGIE, verknuepfeQuellenFuerMannschaftsPool } from '../shared/bracketTopologie.js';
import { aktualisiereMannschaftsPool } from './mannschaftsBegegnungEngine.js';

// Team-Pendant zu DoppelKo8Manager.js: gleiches 8er-Raster samt DJB-Freilos-Positionen, aber
// ohne die dortige Vereinstrennung/Gewichtssortierung — bei Mannschaften ist der "Verein" die
// Mannschaft selbst, eine Trennung ergibt daher keinen Sinn. Mannschaften werden schlicht in
// Anmeldereihenfolge ins Raster gesetzt; die Turnierleitung kann die Reihenfolge über die
// Mannschaften-Seite steuern.
export class MannschaftDoppelKo8Manager {
    constructor() {
        this.rasterGroesse = 8;
    }

    async initialisierePool(knex, poolId) {
        const mannschaften = await knex('mannschaften').where({ pool_id: poolId }).orderBy('id', 'asc');
        const N = mannschaften.length;
        if (N < 2 || N > this.rasterGroesse) {
            console.warn(`[DB] Mannschaft-Doppel-KO-8 erwartet 2-8 Mannschaften, Pool-ID ${poolId} hat ${N}.`);
        }
        const F = Math.max(0, this.rasterGroesse - N);

        // Freilose nach DJB-Regelwerk an exakten Positionen (1-indexed: 8, 1, 5, 4) — identisch
        // zum Einzelwettkampf-Raster (rein bracket-strukturell, unabhängig von Judoka/Mannschaft).
        const freilosIndices = [7, 0, 4, 3];
        const freilosSlots = new Set(freilosIndices.slice(0, F));

        const rasterListe = new Array(this.rasterGroesse).fill(null);
        let cursor = 0;
        for (let slot = 0; slot < this.rasterGroesse; slot++) {
            if (freilosSlots.has(slot)) continue;
            rasterListe[slot] = mannschaften[cursor++] || null;
        }

        const neueBegegnungen = [];

        // H1-H4 (erste Hauptrunde)
        for (let i = 0; i < rasterListe.length; i += 2) {
            const m1 = rasterListe[i];
            const m2 = rasterListe[i + 1];
            const begegnung = {
                pool_id: poolId,
                status: 'bereit',
                reihenfolge_nummer: `H${(i / 2) + 1}`,
                mannschaft1_id: m1 ? m1.id : null,
                mannschaft2_id: m2 ? m2.id : null,
                sieger_mannschaft_id: null
            };
            if (m1 === null && m2 === null) {
                begegnung.status = 'freilos';
            } else if (m1 === null || m2 === null) {
                const sieger = m1 || m2;
                begegnung.status = 'freilos';
                begegnung.sieger_mannschaft_id = sieger.id;
            }
            neueBegegnungen.push(begegnung);
        }

        for (const nr of ['H5', 'H6', 'T1', 'T2', 'T3', 'T4', 'F']) {
            neueBegegnungen.push({
                pool_id: poolId, status: 'angelegt', reihenfolge_nummer: nr,
                mannschaft1_id: null, mannschaft2_id: null, sieger_mannschaft_id: null
            });
        }

        await knex('mannschaftskaempfe').insert(neueBegegnungen);
        await verknuepfeQuellenFuerMannschaftsPool(knex, poolId, DOPPEL_KO_8_TOPOLOGIE);
        await this.aktualisiereTurnier(knex, poolId);
    }

    async aktualisiereTurnier(knex, poolId) {
        await aktualisiereMannschaftsPool(knex, poolId);
    }
}
