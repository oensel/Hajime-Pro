import { GRUPPEN_UEBERKREUZ_TOPOLOGIE } from '../../shared/bracketTopologie.js';
import { berechneKaempferPatches } from '../../shared/kampfProgression.js';
import { berechneGruppenUeberkreuzHalbfinalPatches } from '../../shared/gruppenUeberkreuzProgression.js';
import { verknuepfeQuellenFuerPool } from './bracketVerknuepfung.js';

// CouchDB-Pendant zu GruppenUeberKreuzManager.initialisierePool/aktualisiereTurnier
// (src/services/GruppenUeberKreuzManager.js) -- dort direkt knex-gebunden, hier über die
// jeweiligen Repositories. Anders als bei den Doppel-KO-Systemen kombiniert aktualisiereTurnier
// zwei Patch-Quellen (Halbfinal-Ranglistenberechnung + generische Kaskade), analog zur
// Zwei-Phasen-Struktur des Originals.
const ANZAHL_TEILNEHMER = 6;

function mitId(kaempfe) {
    return kaempfe.map(kampf => ({ ...kampf, id: kampf._id }));
}

function teileTeilnehmerAuf(teilnehmer) {
    const poolA = [];
    const poolB = [];
    teilnehmer.forEach((athlet, index) => {
        (index % 2 === 0 ? poolA : poolB).push(athlet);
    });
    return { poolA, poolB };
}

export async function initialisierePool(kaempfeRepository, turnierTeilnehmerRepository, poolsRepository, poolId) {
    const teilnehmer = await turnierTeilnehmerRepository.findByPool(poolId);
    teilnehmer.sort((a, b) => Number(a.gewicht) - Number(b.gewicht));

    if (teilnehmer.length !== ANZAHL_TEILNEHMER) {
        throw new Error(`Das Gruppensystem über Kreuz benötigt exakt ${ANZAHL_TEILNEHMER} Teilnehmer.`);
    }

    const { poolA, poolB } = teileTeilnehmerAuf(teilnehmer);

    const paarungen = [
        { idKey: 'V_A_1', gruppe: 'A', k1: poolA[0]._id, k2: poolA[1]._id },
        { idKey: 'V_B_1', gruppe: 'B', k1: poolB[0]._id, k2: poolB[1]._id },
        { idKey: 'V_A_2', gruppe: 'A', k1: poolA[0]._id, k2: poolA[2]._id },
        { idKey: 'V_B_2', gruppe: 'B', k1: poolB[0]._id, k2: poolB[2]._id },
        { idKey: 'V_A_3', gruppe: 'A', k1: poolA[1]._id, k2: poolA[2]._id },
        { idKey: 'V_B_3', gruppe: 'B', k1: poolB[1]._id, k2: poolB[2]._id }
    ];

    for (const p of paarungen) {
        await kaempfeRepository.create({
            pool_id: poolId, status: 'bereit', reihenfolge_nummer: p.idKey, gruppe: p.gruppe,
            kaempfer1_id: p.k1, kaempfer2_id: p.k2, sieger_id: null,
            kampfzeit_in_sekunden: 0, unterbewertung_kaempfer1: 0, unterbewertung_kaempfer2: 0
        });
    }

    for (const reihenfolgeNummer of ['HF1', 'HF2', 'F1', 'F2']) {
        await kaempfeRepository.create({
            pool_id: poolId, status: 'angelegt', reihenfolge_nummer: reihenfolgeNummer,
            kaempfer1_id: null, kaempfer2_id: null, sieger_id: null,
            kampfzeit_in_sekunden: 0, unterbewertung_kaempfer1: 0, unterbewertung_kaempfer2: 0
        });
    }

    await verknuepfeQuellenFuerPool(kaempfeRepository, poolId, GRUPPEN_UEBERKREUZ_TOPOLOGIE);
    await aktualisiereTurnier(kaempfeRepository, poolsRepository, poolId);
}

export async function aktualisiereTurnier(kaempfeRepository, poolsRepository, poolId) {
    let kaempfe = await kaempfeRepository.findByPool(poolId);
    let changed = false;

    const halbfinalPatches = berechneGruppenUeberkreuzHalbfinalPatches(mitId(kaempfe));
    for (const patch of halbfinalPatches) {
        const { id, ...aenderungen } = patch;
        await kaempfeRepository.update(id, aenderungen);
        changed = true;
    }

    if (changed) {
        kaempfe = await kaempfeRepository.findByPool(poolId);
    }
    const patches = berechneKaempferPatches(mitId(kaempfe));
    for (const patch of patches) {
        const { id, ...aenderungen } = patch;
        await kaempfeRepository.update(id, aenderungen);
        changed = true;
    }

    if (changed) {
        return aktualisiereTurnier(kaempfeRepository, poolsRepository, poolId);
    }

    const istBeendetOderFreilos = (k) => k?.status === 'beendet' || k?.status === 'freilos';
    const findeKampf = (idKey) => kaempfe.find(k => k.reihenfolge_nummer === idKey);
    const finale = findeKampf('F1');
    const platz3 = findeKampf('F2');
    if (istBeendetOderFreilos(finale) && istBeendetOderFreilos(platz3)) {
        await poolsRepository.update(poolId, { status: 'kaempfe_beendet' });
    }
}
