import { DOPPEL_KO_32_TOPOLOGIE } from '../../shared/bracketTopologie.js';
import { verknuepfeQuellenFuerPool } from './bracketVerknuepfung.js';
import { wendeKaempfeKaskadeAn } from './kaempfeKaskade.js';

// CouchDB-Pendant zu DoppelKo32Manager.initialisierePool/aktualisiereTurnier
// (src/services/DoppelKo32Manager.js) -- strukturell identisch zu doppelKo16PoolKaskade.js, nur
// mit nochmals doppelter Rastergröße und eigenen Freilos-Positionen. Wiederverwendet dieselben
// bereits migrierten Bausteine (verknuepfeQuellenFuerPool, wendeKaempfeKaskadeAn).
const RASTER_GROESSE = 32;
const FREILOS_INDICES = [1, 31, 17, 15, 9, 23, 25, 7, 5, 27, 21, 11, 13, 19, 29, 3];

function ermittleRasterListe(teilnehmer) {
    const N = teilnehmer.length;
    const F = RASTER_GROESSE - N;
    const freilosSlots = new Set(FREILOS_INDICES.slice(0, F));

    const poolSlots = {
        A: [0, 1, 2, 3, 4, 5, 6, 7].filter(s => !freilosSlots.has(s)),
        B: [8, 9, 10, 11, 12, 13, 14, 15].filter(s => !freilosSlots.has(s)),
        C: [16, 17, 18, 19, 20, 21, 22, 23].filter(s => !freilosSlots.has(s)),
        D: [24, 25, 26, 27, 28, 29, 30, 31].filter(s => !freilosSlots.has(s))
    };

    const vereine = {};
    teilnehmer.forEach(t => {
        const vName = t.verein || 'Kein Verein';
        if (!vereine[vName]) vereine[vName] = [];
        vereine[vName].push(t);
    });

    const sortierteVereinsNamen = Object.keys(vereine).sort((a, b) => vereine[b].length - vereine[a].length);
    const poolAssignments = { A: [], B: [], C: [], D: [] };

    for (const vName of sortierteVereinsNamen) {
        const athleten = vereine[vName];
        athleten.sort((a, b) => Number(a.gewicht) - Number(b.gewicht));

        for (const athlet of athleten) {
            let besterPool = null;
            let minVereinCount = Number.POSITIVE_INFINITY;
            let maxFreieSlots = -1;

            for (const p of ['A', 'B', 'C', 'D']) {
                const freieSlots = poolSlots[p].length - poolAssignments[p].length;
                if (freieSlots <= 0) continue;

                const vereinCountInPool = poolAssignments[p].filter(a => a.verein === vName).length;

                if (vereinCountInPool < minVereinCount) {
                    minVereinCount = vereinCountInPool;
                    maxFreieSlots = freieSlots;
                    besterPool = p;
                } else if (vereinCountInPool === minVereinCount) {
                    if (freieSlots > maxFreieSlots) {
                        maxFreieSlots = freieSlots;
                        besterPool = p;
                    }
                }
            }

            if (besterPool) {
                poolAssignments[besterPool].push(athlet);
            }
        }
    }

    const rasterListe = new Array(RASTER_GROESSE).fill(null);
    for (const p of ['A', 'B', 'C', 'D']) {
        poolAssignments[p].sort((a, b) => Number(a.gewicht) - Number(b.gewicht));
        poolAssignments[p].forEach((athlet, idx) => {
            rasterListe[poolSlots[p][idx]] = athlet;
        });
    }

    return rasterListe;
}

export async function initialisierePool(kaempfeRepository, turnierTeilnehmerRepository, poolsRepository, poolId) {
    const teilnehmer = await turnierTeilnehmerRepository.findByPool(poolId);
    const rasterListe = ermittleRasterListe(teilnehmer);

    for (let i = 0; i < rasterListe.length; i += 2) {
        const k1 = rasterListe[i];
        const k2 = rasterListe[i + 1];
        const neuerKampf = {
            pool_id: poolId,
            status: 'bereit',
            reihenfolge_nummer: `H${(i / 2) + 1}`,
            kaempfer1_id: k1 ? k1._id : null,
            kaempfer2_id: k2 ? k2._id : null,
            sieger_id: null,
            kampfzeit_in_sekunden: 0,
            unterbewertung_kaempfer1: 0,
            unterbewertung_kaempfer2: 0
        };
        if (k1 === null && k2 === null) {
            neuerKampf.status = 'freilos';
            neuerKampf.sieger_id = null;
        } else if (k1 === null || k2 === null) {
            const sieger = k1 || k2;
            neuerKampf.status = 'freilos';
            neuerKampf.sieger_id = sieger._id;
            neuerKampf.unterbewertung_kaempfer1 = k1 ? 10 : 0;
            neuerKampf.unterbewertung_kaempfer2 = k2 ? 10 : 0;
        }
        await kaempfeRepository.create(neuerKampf);
    }

    const huellenReihenfolgeNummern = [
        ...[17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30].map(i => `H${i}`),
        ...Array.from({ length: 28 }, (_, i) => `T${i + 1}`),
        'F1'
    ];
    for (const reihenfolgeNummer of huellenReihenfolgeNummern) {
        await kaempfeRepository.create({
            pool_id: poolId, status: 'angelegt', reihenfolge_nummer: reihenfolgeNummer,
            kaempfer1_id: null, kaempfer2_id: null, sieger_id: null,
            kampfzeit_in_sekunden: 0, unterbewertung_kaempfer1: 0, unterbewertung_kaempfer2: 0
        });
    }

    await verknuepfeQuellenFuerPool(kaempfeRepository, poolId, DOPPEL_KO_32_TOPOLOGIE);
    await aktualisiereTurnier(kaempfeRepository, poolsRepository, poolId);
}

export async function aktualisiereTurnier(kaempfeRepository, poolsRepository, poolId) {
    const kaempfe = await wendeKaempfeKaskadeAn(kaempfeRepository, poolId);
    if (kaempfe.length === 0) return;

    const istBeendetOderFreilos = (k) => k?.status === 'beendet' || k?.status === 'freilos';
    const f1 = kaempfe.find(k => k.reihenfolge_nummer === 'F1');
    const t27 = kaempfe.find(k => k.reihenfolge_nummer === 'T27');
    const t28 = kaempfe.find(k => k.reihenfolge_nummer === 'T28');
    if (istBeendetOderFreilos(f1) && istBeendetOderFreilos(t27) && istBeendetOderFreilos(t28)) {
        await poolsRepository.update(poolId, { status: 'kaempfe_beendet' });
    }
}
