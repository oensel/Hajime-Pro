import { DOPPEL_KO_16_TOPOLOGIE, verknuepfeQuellenFuerPool } from '../shared/bracketTopologie.js';
import { berechneKaempferPatches } from '../shared/kampfProgression.js';

export class DoppelKo16Manager {
    /**
     * Erstellt einen Turnier-Manager für das 16er-Doppel-KO-System.
     */
    constructor() {
        // Fester Verteilungsschlüssel des Deutschen Judo-Bundes für 16er-Raster (Achtelfinale)
        this.djbSchluessel = [0, 8, 4, 12, 2, 10, 6, 14, 1, 9, 5, 13, 3, 11, 7, 15];
        this.rasterGroesse = 16;
    }

    /**
     * Initialisiert die erste Hauptrunde (Achtelfinale: H1 bis H8) direkt in der Datenbank.
     * Verteilt Freilose so, dass sie in der Trostrunde nicht kollidieren.
     * @param {Object} knex - Die Knex-Instanz
     * @param {number} poolId - Die ID des Pools aus der Datenbank
     */
    async initialisierePool(knex, poolId) {
        const pool = await knex('pools').where({ id: poolId }).first();
        const teilnehmer = await knex('turnier_teilnehmer').where({ pool_id: poolId }).orderBy('id', 'asc');

        const N = teilnehmer.length;
        const F = this.rasterGroesse - N;

        // Freilose nach Regelwerk an exakten Positionen (1-indexed: 16, 1, 9, 8, 5, 12, 13, 4)
        // 0-indexed: 15, 0, 8, 7, 4, 11, 12, 3
        const freilosIndices = [15, 0, 8, 7, 4, 11, 12, 3];
        const freilosSlots = new Set(freilosIndices.slice(0, F));

        const poolSlots = {
            A: [0, 1, 2, 3].filter(s => !freilosSlots.has(s)),
            B: [4, 5, 6, 7].filter(s => !freilosSlots.has(s)),
            C: [8, 9, 10, 11].filter(s => !freilosSlots.has(s)),
            D: [12, 13, 14, 15].filter(s => !freilosSlots.has(s))
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

        // 2. Paarungen für Hauptrunde 1 (Achtelfinale: H1 bis H8) erzeugen
        const neueKaempfe = [];

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

        // H9-H12 (Hauptrunde 2 / Viertelfinale)
        for (let i = 9; i <= 12; i++) {
            neueKaempfe.push({
                pool_id: poolId, status: 'angelegt', reihenfolge_nummer: `H${i}`,
                kaempfer1_id: null, kaempfer2_id: null, sieger_id: null, kampfzeit_in_sekunden: 0, unterbewertung_kaempfer1: 0, unterbewertung_kaempfer2: 0
            });
        }

        // H13-H14 (Hauptrunde 3 / Halbfinale)
        for (let i = 13; i <= 14; i++) {
            neueKaempfe.push({
                pool_id: poolId, status: 'angelegt', reihenfolge_nummer: `H${i}`,
                kaempfer1_id: null, kaempfer2_id: null, sieger_id: null, kampfzeit_in_sekunden: 0, unterbewertung_kaempfer1: 0, unterbewertung_kaempfer2: 0
            });
        }

        // T1-T4 (Trostrunde R1)
        for (let i = 1; i <= 4; i++) {
            neueKaempfe.push({
                pool_id: poolId, status: 'angelegt', reihenfolge_nummer: `T${i}`,
                kaempfer1_id: null, kaempfer2_id: null, sieger_id: null, kampfzeit_in_sekunden: 0, unterbewertung_kaempfer1: 0, unterbewertung_kaempfer2: 0
            });
        }

        // T5-T8 (Trostrunde R2)
        for (let i = 5; i <= 8; i++) {
            neueKaempfe.push({
                pool_id: poolId, status: 'angelegt', reihenfolge_nummer: `T${i}`,
                kaempfer1_id: null, kaempfer2_id: null, sieger_id: null, kampfzeit_in_sekunden: 0, unterbewertung_kaempfer1: 0, unterbewertung_kaempfer2: 0
            });
        }

        // T9-T10 (Trostrunde R3)
        for (let i = 9; i <= 10; i++) {
            neueKaempfe.push({
                pool_id: poolId, status: 'angelegt', reihenfolge_nummer: `T${i}`,
                kaempfer1_id: null, kaempfer2_id: null, sieger_id: null, kampfzeit_in_sekunden: 0, unterbewertung_kaempfer1: 0, unterbewertung_kaempfer2: 0
            });
        }

        // T11-T12 (Trostrunde R4 / Kleines Finale)
        for (let i = 11; i <= 12; i++) {
            neueKaempfe.push({
                pool_id: poolId, status: 'angelegt', reihenfolge_nummer: `T${i}`,
                kaempfer1_id: null, kaempfer2_id: null, sieger_id: null, kampfzeit_in_sekunden: 0, unterbewertung_kaempfer1: 0, unterbewertung_kaempfer2: 0
            });
        }

        // F1 (Großes Finale)
        neueKaempfe.push({
            pool_id: poolId, status: 'angelegt', reihenfolge_nummer: 'F1',
            kaempfer1_id: null, kaempfer2_id: null, sieger_id: null, kampfzeit_in_sekunden: 0, unterbewertung_kaempfer1: 0, unterbewertung_kaempfer2: 0
        });

        await knex('kaempfe').insert(neueKaempfe);
        console.log(`[DB] 27 Kämpfe für 16er-Doppel-KO Pool ID ${poolId} generiert.`);

        // 3. Explizite Quell-Verknüpfungen setzen (welcher Kampf speist welchen späteren Kampf)
        await verknuepfeQuellenFuerPool(knex, poolId, DOPPEL_KO_16_TOPOLOGIE);

        // 4. Kaskade starten
        await this.aktualisiereTurnier(knex, poolId);
    }

    /**
     * Wird nach jedem Kampf aufgerufen. Prüft beendete Begegnungen,
     * fügt neue ermittelbare Kämpfe hinzu und schließt den Pool am Ende ab.
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
        const f1 = kaempfe.find(k => k.reihenfolge_nummer === 'F1');
        const t11 = kaempfe.find(k => k.reihenfolge_nummer === 'T11');
        const t12 = kaempfe.find(k => k.reihenfolge_nummer === 'T12');
        if (istBeendetOderFreilos(f1) && istBeendetOderFreilos(t11) && istBeendetOderFreilos(t12)) {
            await knex('pools').where({ id: poolId }).update({ status: 'kaempfe_beendet' });
            console.log(`[DB] 16er-Doppel-KO Turnier im Pool ID ${poolId}: alle Kämpfe ausgetragen, wartet auf Bestätigung.`);
        }
    }
}