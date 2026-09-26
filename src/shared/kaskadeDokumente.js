/**
 * Offline-Kaskade auf einer Liste von Kämpfen EINES Pools (Dokumente oder DB-Zeilen): wendet
 * Gruppen-Überkreuz-Halbfinale und die allgemeine Quellkampf-Kaskade so lange an, bis sich nichts
 * mehr ändert (gleiches Vorgehen wie der bisherige Browser-Offline-Modus in scoreboard.js,
 * aktualisiereTurnierOffline). Rein und knex-/DOM-frei — genutzt von src/sync/kaskadeLokal.js auf
 * Client-Geräten; der Server rechnet unabhängig davon mit seinen Managern nach und ist maßgeblich.
 *
 * @param {Array<Object>} kaempfe - alle Kämpfe eines Pools
 * @returns {Map<number, Object>} Kampf-ID -> zusammengefasste Feldänderungen gegenüber der Eingabe
 */
import { berechneKaempferPatches } from './kampfProgression.js';
import { berechneGruppenUeberkreuzHalbfinalPatches } from './gruppenUeberkreuzProgression.js';

const PATCH_FELDER = ['kaempfer1_id', 'kaempfer2_id', 'status', 'sieger_id', 'unterbewertung_kaempfer1', 'unterbewertung_kaempfer2'];
const MAX_RUNDEN = 50;

export function berechneKaskadenPatches(kaempfe) {
    const arbeit = kaempfe.map(k => ({ ...k }));
    const byId = new Map(arbeit.map(k => [k.id, k]));
    const ergebnis = new Map();

    for (let runde = 0; runde < MAX_RUNDEN; runde++) {
        const patches = [...berechneGruppenUeberkreuzHalbfinalPatches(arbeit), ...berechneKaempferPatches(arbeit)];
        let geaendert = false;
        for (const patch of patches) {
            const kampf = byId.get(patch.id);
            if (!kampf) continue;
            for (const feld of PATCH_FELDER) {
                if (patch[feld] === undefined || kampf[feld] === patch[feld]) continue;
                kampf[feld] = patch[feld];
                ergebnis.set(patch.id, { ...(ergebnis.get(patch.id) || {}), [feld]: patch[feld] });
                geaendert = true;
            }
        }
        if (!geaendert) break;
    }
    return ergebnis;
}
