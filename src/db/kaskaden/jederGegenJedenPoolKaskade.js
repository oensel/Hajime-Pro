// CouchDB-Pendant zu JederGegenJedenManager.initialisierePool/aktualisiereTurnier aus
// src/services/JederGegenJedenManager.js -- dort direkt knex-gebunden, hier über die
// jeweiligen Repositories. Anders als bei den Doppel-KO-Systemen gibt es hier keine
// Bracket-Verknüpfung: alle Paarungen stehen von Anfang an fest.
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

export async function initialisierePool(kaempfeRepository, turnierTeilnehmerRepository, poolsRepository, poolId) {
    const teilnehmer = await turnierTeilnehmerRepository.findByPool(poolId);
    teilnehmer.sort((a, b) => Number(a.gewicht) - Number(b.gewicht));

    if (teilnehmer.length < 1) return;

    // Genau 1 Teilnehmer -> Kampflos, Pool direkt abgeschlossen ohne Zwischenschritt.
    if (teilnehmer.length === 1) {
        await poolsRepository.update(poolId, { status: 'abgeschlossen' });
        return;
    }

    const paarungen = ermittlePaarungen(teilnehmer.length);

    for (let idx = 0; idx < paarungen.length; idx++) {
        const [i, j] = paarungen[idx];
        await kaempfeRepository.create({
            pool_id: poolId,
            status: 'bereit',
            reihenfolge_nummer: idx + 1,
            kaempfer1_id: teilnehmer[i]._id,
            kaempfer2_id: teilnehmer[j]._id,
            sieger_id: null,
            kampfzeit_in_sekunden: 0,
            unterbewertung_kaempfer1: 0,
            unterbewertung_kaempfer2: 0
        });
    }

    await aktualisiereTurnier(kaempfeRepository, poolsRepository, poolId);
}

export async function aktualisiereTurnier(kaempfeRepository, poolsRepository, poolId) {
    const kaempfe = await kaempfeRepository.findByPool(poolId);
    if (kaempfe.length === 0) return;

    const alleBeendet = kaempfe.every(kampf => kampf.status === 'beendet');
    if (alleBeendet) {
        await poolsRepository.update(poolId, { status: 'kaempfe_beendet' });
    }
}
