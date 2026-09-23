// CouchDB-Pendant zur Begegnungs-ERZEUGUNG aus MannschaftJederGegenJedenManager.initialisierePool
// (src/services/MannschaftJederGegenJedenManager.js) -- dort direkt knex-gebunden, hier über die
// jeweiligen Repositories. Der anschließende aktualisiereTurnier-Aufruf des Originals delegiert an
// mannschaftsBegegnungEngine.js (Einzelkampf-Erzeugung je Gewichtsklasse, Stichkampf-Logik,
// Pool-Abschluss) -- diese Engine ist selbst noch nicht migriert und bewusst NICHT Teil dieser
// Kaskade; initialisierePool endet hier nach dem Begegnungs-Insert.
function ermittlePaarungen(n) {
    if (n === 2) return [[0, 1]];
    if (n === 3) return [[0, 1], [0, 2], [1, 2]];
    if (n === 4) return [[0, 1], [2, 3], [0, 3], [1, 2], [0, 2], [1, 3]];
    if (n === 5) {
        return [
            [0, 1], [2, 3], [1, 2], [3, 4], [0, 2],
            [1, 4], [0, 3], [2, 4], [0, 4], [1, 3]
        ];
    }
    const paarungen = [];
    for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
            paarungen.push([i, j]);
        }
    }
    return paarungen;
}

export async function initialisierePool(mannschaftskaempfeRepository, mannschaftenRepository, poolsRepository, poolId) {
    const mannschaften = await mannschaftenRepository.findByPool(poolId);

    if (mannschaften.length < 1) return;

    // Genau 1 Mannschaft -> Kampflos, Pool direkt abgeschlossen ohne Begegnung.
    if (mannschaften.length === 1) {
        await poolsRepository.update(poolId, { status: 'abgeschlossen' });
        return;
    }

    const paarungen = ermittlePaarungen(mannschaften.length);

    for (let idx = 0; idx < paarungen.length; idx++) {
        const [i, j] = paarungen[idx];
        await mannschaftskaempfeRepository.create({
            pool_id: poolId,
            status: 'bereit',
            // String, nicht Zahl -- anders als beim Einzel-Pendant (jederGegenJedenPoolKaskade.js),
            // exakt wie im knex-Original; keine versehentliche Abweichung.
            reihenfolge_nummer: String(idx + 1),
            mannschaft1_id: mannschaften[i]._id,
            mannschaft2_id: mannschaften[j]._id,
            sieger_mannschaft_id: null
        });
    }
}
