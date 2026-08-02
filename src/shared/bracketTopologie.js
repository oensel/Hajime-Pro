/**
 * Bracket-Topologie pro Turniermodus: welcher Kampf (per reihenfolge_nummer) bezieht seine
 * beiden Kämpfer-Slots aus welchem vorherigen Kampf (Sieger oder Verlierer). Rein deklarative
 * Daten — genutzt sowohl beim Neu-Anlegen eines Pools (DoppelKo8Manager.js, DoppelKo16Manager.js,
 * GruppenUeberKreuzManager.js) als auch beim einmaligen Backfill bestehender Pools (siehe
 * Migration 20260713065807).
 *
 * Format: { [reihenfolge_nummer]: { k1: [quelleReihenfolgeNummer, 'sieger'|'verlierer'], k2: [...] } }
 */
export const DOPPEL_KO_8_TOPOLOGIE = {
    H5: { k1: ['H1', 'sieger'], k2: ['H2', 'sieger'] },
    H6: { k1: ['H3', 'sieger'], k2: ['H4', 'sieger'] },
    T1: { k1: ['H1', 'verlierer'], k2: ['H2', 'verlierer'] },
    T2: { k1: ['H3', 'verlierer'], k2: ['H4', 'verlierer'] },
    T3: { k1: ['T1', 'sieger'], k2: ['H6', 'verlierer'] },
    T4: { k1: ['T2', 'sieger'], k2: ['H5', 'verlierer'] },
    F: { k1: ['H5', 'sieger'], k2: ['H6', 'sieger'] }
};

export const DOPPEL_KO_16_TOPOLOGIE = {
    H9: { k1: ['H1', 'sieger'], k2: ['H2', 'sieger'] },
    H10: { k1: ['H3', 'sieger'], k2: ['H4', 'sieger'] },
    H11: { k1: ['H5', 'sieger'], k2: ['H6', 'sieger'] },
    H12: { k1: ['H7', 'sieger'], k2: ['H8', 'sieger'] },
    T1: { k1: ['H1', 'verlierer'], k2: ['H2', 'verlierer'] },
    T2: { k1: ['H3', 'verlierer'], k2: ['H4', 'verlierer'] },
    T3: { k1: ['H5', 'verlierer'], k2: ['H6', 'verlierer'] },
    T4: { k1: ['H7', 'verlierer'], k2: ['H8', 'verlierer'] },
    H13: { k1: ['H9', 'sieger'], k2: ['H10', 'sieger'] },
    H14: { k1: ['H11', 'sieger'], k2: ['H12', 'sieger'] },
    T5: { k1: ['T1', 'sieger'], k2: ['H10', 'verlierer'] },
    T6: { k1: ['T2', 'sieger'], k2: ['H9', 'verlierer'] },
    T7: { k1: ['T3', 'sieger'], k2: ['H12', 'verlierer'] },
    T8: { k1: ['T4', 'sieger'], k2: ['H11', 'verlierer'] },
    T9: { k1: ['T5', 'sieger'], k2: ['T6', 'sieger'] },
    T10: { k1: ['T7', 'sieger'], k2: ['T8', 'sieger'] },
    F1: { k1: ['H13', 'sieger'], k2: ['H14', 'sieger'] },
    T11: { k1: ['T9', 'sieger'], k2: ['H14', 'verlierer'] },
    T12: { k1: ['T10', 'sieger'], k2: ['H13', 'verlierer'] }
};

// Repechage-Struktur rekursiv aus DOPPEL_KO_8/16_TOPOLOGIE hochgerechnet: die Trostrunde
// kreuzt an jeder Ebene die Sieger der aktuellen Trost-Runde mit den Verlierern der jeweils
// EINE Ebene höher liegenden Hauptrunde, gespiegelt am selben Halbierungs-Baum wie die
// Hauptrunde selbst (siehe DOPPEL_KO_16_TOPOLOGIE: T5←T1+H10, T11←T9+H14 folgen exakt diesem
// Muster) — für 32 TeilnehmerInnen einmal tiefer verschachtelt.
export const DOPPEL_KO_32_TOPOLOGIE = {
    H17: { k1: ['H1', 'sieger'], k2: ['H2', 'sieger'] },
    H18: { k1: ['H3', 'sieger'], k2: ['H4', 'sieger'] },
    H19: { k1: ['H5', 'sieger'], k2: ['H6', 'sieger'] },
    H20: { k1: ['H7', 'sieger'], k2: ['H8', 'sieger'] },
    H21: { k1: ['H9', 'sieger'], k2: ['H10', 'sieger'] },
    H22: { k1: ['H11', 'sieger'], k2: ['H12', 'sieger'] },
    H23: { k1: ['H13', 'sieger'], k2: ['H14', 'sieger'] },
    H24: { k1: ['H15', 'sieger'], k2: ['H16', 'sieger'] },
    T1: { k1: ['H1', 'verlierer'], k2: ['H2', 'verlierer'] },
    T2: { k1: ['H3', 'verlierer'], k2: ['H4', 'verlierer'] },
    T3: { k1: ['H5', 'verlierer'], k2: ['H6', 'verlierer'] },
    T4: { k1: ['H7', 'verlierer'], k2: ['H8', 'verlierer'] },
    T5: { k1: ['H9', 'verlierer'], k2: ['H10', 'verlierer'] },
    T6: { k1: ['H11', 'verlierer'], k2: ['H12', 'verlierer'] },
    T7: { k1: ['H13', 'verlierer'], k2: ['H14', 'verlierer'] },
    T8: { k1: ['H15', 'verlierer'], k2: ['H16', 'verlierer'] },
    H25: { k1: ['H17', 'sieger'], k2: ['H18', 'sieger'] },
    H26: { k1: ['H19', 'sieger'], k2: ['H20', 'sieger'] },
    H27: { k1: ['H21', 'sieger'], k2: ['H22', 'sieger'] },
    H28: { k1: ['H23', 'sieger'], k2: ['H24', 'sieger'] },
    T9: { k1: ['T1', 'sieger'], k2: ['H18', 'verlierer'] },
    T10: { k1: ['T2', 'sieger'], k2: ['H17', 'verlierer'] },
    T11: { k1: ['T3', 'sieger'], k2: ['H20', 'verlierer'] },
    T12: { k1: ['T4', 'sieger'], k2: ['H19', 'verlierer'] },
    T13: { k1: ['T5', 'sieger'], k2: ['H22', 'verlierer'] },
    T14: { k1: ['T6', 'sieger'], k2: ['H21', 'verlierer'] },
    T15: { k1: ['T7', 'sieger'], k2: ['H24', 'verlierer'] },
    T16: { k1: ['T8', 'sieger'], k2: ['H23', 'verlierer'] },
    H29: { k1: ['H25', 'sieger'], k2: ['H26', 'sieger'] },
    H30: { k1: ['H27', 'sieger'], k2: ['H28', 'sieger'] },
    T17: { k1: ['T9', 'sieger'], k2: ['T10', 'sieger'] },
    T18: { k1: ['T11', 'sieger'], k2: ['T12', 'sieger'] },
    T19: { k1: ['T13', 'sieger'], k2: ['T14', 'sieger'] },
    T20: { k1: ['T15', 'sieger'], k2: ['T16', 'sieger'] },
    T21: { k1: ['T17', 'sieger'], k2: ['H26', 'verlierer'] },
    T22: { k1: ['T18', 'sieger'], k2: ['H25', 'verlierer'] },
    T23: { k1: ['T19', 'sieger'], k2: ['H28', 'verlierer'] },
    T24: { k1: ['T20', 'sieger'], k2: ['H27', 'verlierer'] },
    F1: { k1: ['H29', 'sieger'], k2: ['H30', 'sieger'] },
    T25: { k1: ['T21', 'sieger'], k2: ['T22', 'sieger'] },
    T26: { k1: ['T23', 'sieger'], k2: ['T24', 'sieger'] },
    T27: { k1: ['T25', 'sieger'], k2: ['H30', 'verlierer'] },
    T28: { k1: ['T26', 'sieger'], k2: ['H29', 'verlierer'] }
};

// HF1/HF2 sind bewusst NICHT enthalten: ihre Kämpfer kommen aus einer Ranglisten-Berechnung
// über je 3 Vorrundenkämpfe (siehe GruppenUeberKreuzManager._berechneTeilRangliste), nicht aus
// dem Ergebnis eines einzelnen Kampfes — lässt sich nicht auf einen 1:1-Link reduzieren.
export const GRUPPEN_UEBERKREUZ_TOPOLOGIE = {
    F1: { k1: ['HF1', 'sieger'], k2: ['HF2', 'sieger'] },
    F2: { k1: ['HF1', 'verlierer'], k2: ['HF2', 'verlierer'] }
};

/**
 * Setzt kaempfer1/2_quelle_kampf_id + _typ für alle Kämpfe eines Pools, deren reihenfolge_nummer
 * in der übergebenen Topologie-Tabelle vorkommt. Rein additiv — ändert kaempfer1_id/kaempfer2_id/
 * status/sieger_id nicht, nur die neuen Quelle-Spalten. Nutzbar sowohl direkt nach dem Anlegen
 * eines neuen Pools als auch als einmaliger Backfill für bestehende Pools.
 * @param {Object} knex
 * @param {number} poolId
 * @param {Object} topologie - eine der obigen *_TOPOLOGIE-Konstanten
 */
export async function verknuepfeQuellenFuerPool(knex, poolId, topologie) {
    const kaempfe = await knex('kaempfe').where({ pool_id: poolId });
    const idByReihenfolge = new Map(kaempfe.map(k => [k.reihenfolge_nummer, k.id]));

    for (const kampf of kaempfe) {
        const eintrag = topologie[kampf.reihenfolge_nummer];
        if (!eintrag) continue;

        const [k1QuelleNr, k1Typ] = eintrag.k1;
        const [k2QuelleNr, k2Typ] = eintrag.k2;
        const k1QuelleId = idByReihenfolge.get(k1QuelleNr);
        const k2QuelleId = idByReihenfolge.get(k2QuelleNr);

        // Quelle im selben Pool nicht gefunden (z.B. unvollständige/kaputte Altdaten) ->
        // überspringen statt eine falsche Referenz zu setzen.
        if (!k1QuelleId || !k2QuelleId) continue;

        await knex('kaempfe').where({ id: kampf.id }).update({
            kaempfer1_quelle_kampf_id: k1QuelleId,
            kaempfer1_quelle_typ: k1Typ,
            kaempfer2_quelle_kampf_id: k2QuelleId,
            kaempfer2_quelle_typ: k2Typ
        });
    }
}
