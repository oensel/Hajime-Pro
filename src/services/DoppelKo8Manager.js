import { DOPPEL_KO_8_TOPOLOGIE, verknuepfeQuellenFuerPool } from '../shared/bracketTopologie.js';
import { berechneKaempferPatches } from '../shared/kampfProgression.js';

export class DoppelKo8Manager {
    constructor() {
        // Fester Verteilungsschlüssel des DJB für 8er-Raster
        this.djbSchluessel = [0, 4, 2, 6, 1, 5, 3, 7];
        this.rasterGroesse = 8;
    }

    /**
     * Initialisiert die Hauptrunde 1 direkt in der Datenbank.
     * @param {Object} knex - Die Knex-Instanz
     * @param {number} poolId - Die ID des Pools aus der Datenbank
     */
    async initialisierePool(knex, poolId) {
        // 1. Pool-Daten und registrierte Teilnehmer laden
        const pool = await knex('pools').where({ id: poolId }).first();
        const teilnehmer = await knex('turnier_teilnehmer').where({ pool_id: poolId }).orderBy('id', 'asc');

        const N = teilnehmer.length;
        const F = this.rasterGroesse - N;

        // Freilose nach Regelwerk an exakten Positionen (1-indexed: 8, 1, 5, 4)
        // 0-indexed: 7, 0, 4, 3
        const freilosIndices = [7, 0, 4, 3];
        const freilosSlots = new Set(freilosIndices.slice(0, F));

        const poolSlots = {
            A: [0, 1].filter(s => !freilosSlots.has(s)),
            B: [2, 3].filter(s => !freilosSlots.has(s)),
            C: [4, 5].filter(s => !freilosSlots.has(s)),
            D: [6, 7].filter(s => !freilosSlots.has(s))
        };

        // Vereinstrennung & Gewichtssortierung
        // 1. Gruppieren nach Verein
        const vereine = {};
        teilnehmer.forEach(t => {
            const vName = t.verein || 'Kein Verein';
            if (!vereine[vName]) vereine[vName] = [];
            vereine[vName].push(t);
        });

        // 2. Vereine nach Teilnehmeranzahl absteigend sortieren
        const sortierteVereinsNamen = Object.keys(vereine).sort((a, b) => vereine[b].length - vereine[a].length);

        const poolAssignments = { A: [], B: [], C: [], D: [] };

        // 3. Teilnehmer auf Pools verteilen
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

        // 4. Raster befüllen
        const rasterListe = new Array(this.rasterGroesse).fill(null);
        for (const p of ['A', 'B', 'C', 'D']) {
            poolAssignments[p].sort((a, b) => Number(a.gewicht) - Number(b.gewicht));
            
            poolAssignments[p].forEach((athlet, idx) => {
                const zielIndex = poolSlots[p][idx];
                rasterListe[zielIndex] = athlet;
            });
        }

        // 3. Alle 11 Kämpfe des 8er Doppel-KO Systems initial vordefinieren
        const neueKaempfe = [];

        // H1-H4 (Erste Hauptrunde)
        for (let i = 0; i < rasterListe.length; i += 2) {
            const k1 = rasterListe[i];
            const k2 = rasterListe[i + 1];
            const neuerKampf = {
                pool_id: poolId,
                status: 'bereit',
                reihenfolge_nummer: `H${(i/2) + 1}`,
                kaempfer1_id: k1 ? k1.id : null,
                kaempfer2_id: k2 ? k2.id : null,
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
                neuerKampf.sieger_id = sieger.id;
            }
            neueKaempfe.push(neuerKampf);
        }

        // Halbfinale (H5-H6)
        neueKaempfe.push({
            pool_id: poolId, status: 'angelegt', reihenfolge_nummer: 'H5',
            kaempfer1_id: null, kaempfer2_id: null, sieger_id: null, kampfzeit_in_sekunden: 0, unterbewertung_kaempfer1: 0, unterbewertung_kaempfer2: 0
        });
        neueKaempfe.push({
            pool_id: poolId, status: 'angelegt', reihenfolge_nummer: 'H6',
            kaempfer1_id: null, kaempfer2_id: null, sieger_id: null, kampfzeit_in_sekunden: 0, unterbewertung_kaempfer1: 0, unterbewertung_kaempfer2: 0
        });

        // Trostrunde R1 (T1-T2)
        neueKaempfe.push({
            pool_id: poolId, status: 'angelegt', reihenfolge_nummer: 'T1',
            kaempfer1_id: null, kaempfer2_id: null, sieger_id: null, kampfzeit_in_sekunden: 0, unterbewertung_kaempfer1: 0, unterbewertung_kaempfer2: 0
        });
        neueKaempfe.push({
            pool_id: poolId, status: 'angelegt', reihenfolge_nummer: 'T2',
            kaempfer1_id: null, kaempfer2_id: null, sieger_id: null, kampfzeit_in_sekunden: 0, unterbewertung_kaempfer1: 0, unterbewertung_kaempfer2: 0
        });

        // Trostrunde R2 / Bronze-Matches (T3-T4)
        neueKaempfe.push({
            pool_id: poolId, status: 'angelegt', reihenfolge_nummer: 'T3',
            kaempfer1_id: null, kaempfer2_id: null, sieger_id: null, kampfzeit_in_sekunden: 0, unterbewertung_kaempfer1: 0, unterbewertung_kaempfer2: 0
        });
        neueKaempfe.push({
            pool_id: poolId, status: 'angelegt', reihenfolge_nummer: 'T4',
            kaempfer1_id: null, kaempfer2_id: null, sieger_id: null, kampfzeit_in_sekunden: 0, unterbewertung_kaempfer1: 0, unterbewertung_kaempfer2: 0
        });

        // Großes Finale (F)
        neueKaempfe.push({
            pool_id: poolId, status: 'angelegt', reihenfolge_nummer: 'F',
            kaempfer1_id: null, kaempfer2_id: null, sieger_id: null, kampfzeit_in_sekunden: 0, unterbewertung_kaempfer1: 0, unterbewertung_kaempfer2: 0
        });

        await knex('kaempfe').insert(neueKaempfe);

        // 4. Explizite Quell-Verknüpfungen setzen (welcher Kampf speist welchen späteren Kampf)
        await verknuepfeQuellenFuerPool(knex, poolId, DOPPEL_KO_8_TOPOLOGIE);

        // 5. Kaskade: Folgekämpfe berechnen, falls Freilose existierten
        await this.aktualisiereTurnier(knex, poolId);
    }

    /**
     * Berechnet den Turnierbaum anhand des aktuellen DB-Zustands neu.
     * Wird nach jedem Kampf aufgerufen, der auf 'beendet' gesetzt wird.
     */
    async aktualisiereTurnier(knex, poolId) {
        const kaempfe = await knex('kaempfe').where({ pool_id: poolId });
        if (kaempfe.length === 0) return;

        const patches = berechneKaempferPatches(kaempfe);
        for (const patch of patches) {
            const { id, ...updates } = patch;
            await knex('kaempfe').where({ id }).update(updates);
        }

        // Falls sich etwas geändert hat, rekursiv neu triggern (löst weitere Kaskaden aus)
        if (patches.length > 0) {
            return this.aktualisiereTurnier(knex, poolId);
        }

        // Abschluss prüfen
        const istBeendetOderFreilos = (k) => k?.status === 'beendet' || k?.status === 'freilos';
        const f = kaempfe.find(k => k.reihenfolge_nummer === 'F');
        const t3 = kaempfe.find(k => k.reihenfolge_nummer === 'T3');
        const t4 = kaempfe.find(k => k.reihenfolge_nummer === 'T4');
        if (istBeendetOderFreilos(f) && istBeendetOderFreilos(t3) && istBeendetOderFreilos(t4)) {
            await knex('pools').where({ id: poolId }).update({ status: 'kaempfe_beendet' });
            console.log(`[DB] 8er Turnier im Pool-ID ${poolId}: alle Kämpfe ausgetragen, wartet auf Bestätigung.`);
        }
    }
}
