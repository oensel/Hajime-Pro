import { berechneMannschaftsPatches } from '../../shared/mannschaftsProgression.js';

// Pendant zu kaempfeKaskade.js auf Ebene der Mannschafts-Begegnungen statt der Einzelkämpfe --
// verbindet die reine mannschaftsProgression.js-Engine mit dem mannschaftskaempfeRepository.
//
// mannschaftsProgression.js stammt wie kampfProgression.js aus der knex-Welt und arbeitet auf
// einem Feld `id` (dort die SQL-Primärschlüsselspalte) -- sowohl als Map-Schlüssel zum Auflösen
// von mannschaftN_quelle_kampf_id als auch als Identifikator in den zurückgegebenen Patches.
// CouchDB-Dokumente aus mannschaftskaempfeRepository tragen ihre ID dagegen ausschließlich als
// `_id`. mitId() spiegelt `_id` deshalb lediglich für den Aufruf von berechneMannschaftsPatches
// nach `id` -- rein lesend, nur für diese eine Berechnung, ohne die von findByPool gelieferten
// Dokumente oder den Rückgabewert dieser Funktion zu verändern (identisches Muster zu
// kaempfeKaskade.js).
function mitId(begegnungen) {
    return begegnungen.map(begegnung => ({ ...begegnung, id: begegnung._id }));
}

export async function wendeMannschaftsKaskadeAn(mannschaftskaempfeRepository, poolId) {
    let begegnungen = await mannschaftskaempfeRepository.findByPool(poolId);
    let patches = berechneMannschaftsPatches(mitId(begegnungen));

    while (patches.length > 0) {
        for (const patch of patches) {
            const { id, ...aenderungen } = patch;
            await mannschaftskaempfeRepository.update(id, aenderungen);
        }
        begegnungen = await mannschaftskaempfeRepository.findByPool(poolId);
        patches = berechneMannschaftsPatches(mitId(begegnungen));
    }

    return begegnungen;
}
