// CouchDB-Pendant zu verknuepfeQuellenFuerPool aus src/shared/bracketTopologie.js -- dort direkt
// knex-gebunden (eine bestehende Ausnahme von der sonst in src/shared/ durchgehaltenen
// DB-Freiheit), hier über kaempfeRepository. topologie bleibt bewusst ein reiner Parameter --
// die *_TOPOLOGIE-Konstanten selbst sind unverändert wiederverwendbare, reine Daten und werden
// hier nicht importiert.
export async function verknuepfeQuellenFuerPool(kaempfeRepository, poolId, topologie) {
    const kaempfe = await kaempfeRepository.findByPool(poolId);
    const idByReihenfolge = new Map(kaempfe.map(k => [k.reihenfolge_nummer, k._id]));

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

        await kaempfeRepository.update(kampf._id, {
            kaempfer1_quelle_kampf_id: k1QuelleId,
            kaempfer1_quelle_typ: k1Typ,
            kaempfer2_quelle_kampf_id: k2QuelleId,
            kaempfer2_quelle_typ: k2Typ
        });
    }
}
