import { berechneKaempferPatches } from '../../shared/kampfProgression.js';

// Verbindet die reine, seiteneffektfreie Kaskaden-Engine (kampfProgression.js) mit dem
// kaempfeRepository: lädt alle Kämpfe des Pools, wendet berechnete Patches an und wiederholt
// das, bis keine mehr entstehen -- exakt das in kampfProgression.js selbst dokumentierte
// Aufrufmuster (siehe dortiger Docstring von berechneKaempferPatches).
//
// kampfProgression.js stammt aus der knex-Welt und arbeitet auf einem Feld `id` (dort die
// SQL-Primärschlüsselspalte) -- sowohl als Map-Schlüssel zum Auflösen von
// kaempfer{1,2}_quelle_kampf_id als auch als Identifikator in den zurückgegebenen Patches.
// CouchDB-Dokumente aus kaempfeRepository tragen ihre ID dagegen ausschließlich als `_id`.
// mitId() spiegelt `_id` deshalb lediglich für den Aufruf von berechneKaempferPatches nach
// `id` -- rein lesend, nur für diese eine Berechnung, ohne die von findByPool gelieferten
// Dokumente oder den Rückgabewert dieser Funktion zu verändern.
function mitId(kaempfe) {
    return kaempfe.map(kampf => ({ ...kampf, id: kampf._id }));
}

export async function wendeKaempfeKaskadeAn(kaempfeRepository, poolId) {
    let kaempfe = await kaempfeRepository.findByPool(poolId);
    let patches = berechneKaempferPatches(mitId(kaempfe));

    while (patches.length > 0) {
        for (const patch of patches) {
            const { id, ...aenderungen } = patch;
            await kaempfeRepository.update(id, aenderungen);
        }
        kaempfe = await kaempfeRepository.findByPool(poolId);
        patches = berechneKaempferPatches(mitId(kaempfe));
    }

    return kaempfe;
}
