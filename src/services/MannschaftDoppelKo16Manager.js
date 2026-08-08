import { DOPPEL_KO_16_TOPOLOGIE, verknuepfeQuellenFuerMannschaftsPool } from '../shared/bracketTopologie.js';
import { aktualisiereMannschaftsPool } from './mannschaftsBegegnungEngine.js';

// Team-Pendant zu DoppelKo16Manager.js — siehe MannschaftDoppelKo8Manager.js für die
// Begründung, warum hier (anders als beim Einzelwettkampf) auf Vereinstrennung/
// Gewichtssortierung verzichtet wird.
export class MannschaftDoppelKo16Manager {
    constructor() {
        this.rasterGroesse = 16;
    }

    async initialisierePool(knex, poolId) {
        const mannschaften = await knex('mannschaften').where({ pool_id: poolId }).orderBy('id', 'asc');
        const N = mannschaften.length;
        if (N < 9 || N > this.rasterGroesse) {
            console.warn(`[DB] Mannschaft-Doppel-KO-16 erwartet 9-16 Mannschaften, Pool-ID ${poolId} hat ${N}.`);
        }
        const F = Math.max(0, this.rasterGroesse - N);

        // Freilose nach DJB-Regelwerk (1-indexed: 16, 1, 9, 8, 5, 12, 13, 4) — identisch zum
        // Einzelwettkampf-Raster.
        const freilosIndices = [15, 0, 8, 7, 4, 11, 12, 3];
        const freilosSlots = new Set(freilosIndices.slice(0, F));

        const rasterListe = new Array(this.rasterGroesse).fill(null);
        let cursor = 0;
        for (let slot = 0; slot < this.rasterGroesse; slot++) {
            if (freilosSlots.has(slot)) continue;
            rasterListe[slot] = mannschaften[cursor++] || null;
        }

        const neueBegegnungen = [];

        // H1-H8 (Achtelfinale)
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

        const weitereRunden = [
            'H9', 'H10', 'H11', 'H12', 'T1', 'T2', 'T3', 'T4',
            'H13', 'H14', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10',
            'F1', 'T11', 'T12'
        ];
        for (const nr of weitereRunden) {
            neueBegegnungen.push({
                pool_id: poolId, status: 'angelegt', reihenfolge_nummer: nr,
                mannschaft1_id: null, mannschaft2_id: null, sieger_mannschaft_id: null
            });
        }

        await knex('mannschaftskaempfe').insert(neueBegegnungen);
        await verknuepfeQuellenFuerMannschaftsPool(knex, poolId, DOPPEL_KO_16_TOPOLOGIE);
        await this.aktualisiereTurnier(knex, poolId);
    }

    async aktualisiereTurnier(knex, poolId) {
        await aktualisiereMannschaftsPool(knex, poolId);
    }
}
