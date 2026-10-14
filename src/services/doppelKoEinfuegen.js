// Nachzügler in einen laufenden Doppel-KO-Pool (docs/specs/2026-10-14-nachzuegler-laufender-pool.md):
// der Teilnehmer nimmt den nächsten freien Freilos-Platz des Rasters ein. Das Freilos-Spiel wird zum echten Kampf
// (der bisher kampflos weitergekommene Partner kämpft jetzt gegen ihn), die davon abhängigen Folge- und
// Trostrundenkämpfe werden zurückgesetzt und aus den Ergebnissen neu abgeleitet. Die Prüfung, dass davon nichts
// begonnen hat, liegt in pruefeBaumEinfuegen (src/shared/nachzueglerEinfuegen.js); hier wird sie wiederholt,
// weil der Aufrufer sie unter Zeilensperre braucht.
import { pruefeBaumEinfuegen } from '../shared/nachzueglerEinfuegen.js';

/**
 * @param {Object} knex - Knex-Instanz oder Transaktion
 * @param {Object} manager - Manager des Pool-Systems (hat aktualisiereTurnier für die Kaskade)
 * @param {number} poolId
 * @param {number} teilnehmerId - bereits dem Pool zugeordnet
 * @param {string} modus - 'Doppel-KO-8' | 'Doppel-KO-16' | 'Doppel-KO-32'
 * @returns {Promise<number>} Anzahl neuer Kämpfe (immer 1)
 */
export async function fuegeInFreilosPlatzEin(knex, manager, poolId, teilnehmerId, modus) {
    const kaempfe = await knex('kaempfe').where({ pool_id: poolId });
    const mitglieder = await knex('turnier_teilnehmer').where({ pool_id: poolId }).whereNot({ id: teilnehmerId });

    const pruefung = pruefeBaumEinfuegen({ modus, teilnehmerAnzahl: mitglieder.length, kaempfe });
    if (!pruefung.moeglich) throw new Error(pruefung.grund);

    const ziel = kaempfe.find(k => k.id === pruefung.kampfId);
    const andereSeite = pruefung.seite === 'kaempfer1_id' ? 'kaempfer2_id' : 'kaempfer1_id';
    const hatPartner = ziel[andereSeite] != null;

    // 1. Das Freilos wird zum echten Kampf (oder bleibt Freilos des neuen Teilnehmers, wenn auch der Partner fehlt).
    await knex('kaempfe').where({ id: ziel.id }).update({
        [pruefung.seite]: teilnehmerId,
        status: hatPartner ? 'bereit' : 'freilos',
        sieger_id: hatPartner ? null : teilnehmerId,
        matten_reihenfolge: null,
        reihenfolge_manuell: false
    });

    // 2. Alles, was von diesem Kampf abhängt, zurücksetzen: die Kämpfer-Slots dieser Kämpfe stammen ausnahmslos aus
    //    Quellkämpfen und werden von der Kaskade gleich wieder aus den vorhandenen Ergebnissen abgeleitet.
    if (pruefung.abhaengigeIds.length > 0) {
        await knex('kaempfe').whereIn('id', pruefung.abhaengigeIds).update({
            status: 'angelegt',
            kaempfer1_id: null,
            kaempfer2_id: null,
            sieger_id: null,
            kampfzeit_in_sekunden: 0,
            unterbewertung_kaempfer1: 0,
            unterbewertung_kaempfer2: 0,
            matten_reihenfolge: null,
            reihenfolge_manuell: false
        });
    }

    // 3. Kaskade neu rechnen (befüllt Folgekämpfe aus bereits beendeten Quellen, setzt Freilose neu).
    await manager.aktualisiereTurnier(knex, poolId);
    return 1;
}
