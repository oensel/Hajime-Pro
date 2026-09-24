import { DOPPEL_KO_8_TOPOLOGIE } from '../../shared/bracketTopologie.js';
import { verknuepfeQuellenFuerMannschaftsPool } from './bracketVerknuepfung.js';
import { aktualisiereMannschaftsPool } from './mannschaftsBegegnungKaskade.js';

// CouchDB-Pendant zur Begegnungs-ERZEUGUNG aus MannschaftDoppelKo8Manager.initialisierePool
// (src/services/MannschaftDoppelKo8Manager.js) -- dort direkt knex-gebunden, hier über die
// jeweiligen Repositories. Ruft nach der Bracket-Verknüpfung wie das Original
// aktualisiereMannschaftsPool (mannschaftsBegegnungKaskade.js) auf.
const RASTER_GROESSE = 8;
const FREILOS_INDICES = [7, 0, 4, 3];

export async function initialisierePool(kaempfeRepository, mannschaftskaempfeRepository, mannschaftenRepository, mannschaftMitgliederRepository, poolsRepository, poolId) {
    const mannschaften = await mannschaftenRepository.findByPool(poolId);
    const N = mannschaften.length;
    const F = Math.max(0, RASTER_GROESSE - N);
    const freilosSlots = new Set(FREILOS_INDICES.slice(0, F));

    const rasterListe = new Array(RASTER_GROESSE).fill(null);
    let cursor = 0;
    for (let slot = 0; slot < RASTER_GROESSE; slot++) {
        if (freilosSlots.has(slot)) continue;
        rasterListe[slot] = mannschaften[cursor++] || null;
    }

    for (let i = 0; i < rasterListe.length; i += 2) {
        const m1 = rasterListe[i];
        const m2 = rasterListe[i + 1];
        const begegnung = {
            pool_id: poolId,
            status: 'bereit',
            reihenfolge_nummer: `H${(i / 2) + 1}`,
            mannschaft1_id: m1 ? m1._id : null,
            mannschaft2_id: m2 ? m2._id : null,
            sieger_mannschaft_id: null
        };
        if (m1 === null && m2 === null) {
            begegnung.status = 'freilos';
        } else if (m1 === null || m2 === null) {
            const sieger = m1 || m2;
            begegnung.status = 'freilos';
            begegnung.sieger_mannschaft_id = sieger._id;
        }
        await mannschaftskaempfeRepository.create(begegnung);
    }

    for (const reihenfolgeNummer of ['H5', 'H6', 'T1', 'T2', 'T3', 'T4', 'F']) {
        await mannschaftskaempfeRepository.create({
            pool_id: poolId, status: 'angelegt', reihenfolge_nummer: reihenfolgeNummer,
            mannschaft1_id: null, mannschaft2_id: null, sieger_mannschaft_id: null
        });
    }

    await verknuepfeQuellenFuerMannschaftsPool(mannschaftskaempfeRepository, poolId, DOPPEL_KO_8_TOPOLOGIE);
    await aktualisiereMannschaftsPool(kaempfeRepository, mannschaftskaempfeRepository, mannschaftMitgliederRepository, poolsRepository, poolId);
}
