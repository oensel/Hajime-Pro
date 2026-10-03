import { DOPPEL_KO_32_TOPOLOGIE, verknuepfeQuellenFuerPool } from '../shared/bracketTopologie.js';
import { berechneKaempferPatches } from '../shared/kampfProgression.js';

export class DoppelKo32Manager {
    /**
     * Erstellt einen Turnier-Manager für das 32er-Doppel-KO-System.
     */
    constructor() {
        this.rasterGroesse = 32;
    }

    /**
     * Initialisiert die erste Hauptrunde (H1 bis H16) direkt in der Datenbank.
     * Verteilt Freilose so, dass sie in der Trostrunde nicht kollidieren.
     * @param {Object} knex - Die Knex-Instanz
     * @param {number} poolId - Die ID des Pools aus der Datenbank
     */
    async initialisierePool(knex, poolId) {
        const pool = await knex('pools').where({ id: poolId }).first();
        const teilnehmer = await knex('turnier_teilnehmer').where({ pool_id: poolId }).orderBy('id', 'asc');

        const N = teilnehmer.length;
        const F = this.rasterGroesse - N;

        // Freilose nach Regelwerk an exakten Positionen (1-indexed: 2, 32, 18, 16, 10, 24, 26, 8,
        // 6, 28, 22, 12, 14, 20, 30, 4)
        const freilosIndices = [1, 31, 17, 15, 9, 23, 25, 7, 5, 27, 21, 11, 13, 19, 29, 3];
        const freilosSlots = new Set(freilosIndices.slice(0, F));

        const poolSlots = {
            A: [0, 1, 2, 3, 4, 5, 6, 7].filter(s => !freilosSlots.has(s)),
            B: [8, 9, 10, 11, 12, 13, 14, 15].filter(s => !freilosSlots.has(s)),
            C: [16, 17, 18, 19, 20, 21, 22, 23].filter(s => !freilosSlots.has(s)),
            D: [24, 25, 26, 27, 28, 29, 30, 31].filter(s => !freilosSlots.has(s))
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

        // Paarungen für Hauptrunde 1 (H1 bis H16) erzeugen
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
                neuerKampf.unterbewertung_kaempfer1 = k1 ? 10 : 0;
                neuerKampf.unterbewertung_kaempfer2 = k2 ? 10 : 0;
            }
            neueKaempfe.push(neuerKampf);
        }

        const leereHuellenAnlegen = (nummern) => {
            for (const nr of nummern) {
                neueKaempfe.push({
                    pool_id: poolId, status: 'angelegt', reihenfolge_nummer: nr,
                    kaempfer1_id: null, kaempfer2_id: null, sieger_id: null, kampfzeit_in_sekunden: 0, unterbewertung_kaempfer1: 0, unterbewertung_kaempfer2: 0
                });
            }
        };

        // H17-H24 (Hauptrunde 2)
        leereHuellenAnlegen([17, 18, 19, 20, 21, 22, 23, 24].map(i => `H${i}`));
        // H25-H28 (Hauptrunde 3)
        leereHuellenAnlegen([25, 26, 27, 28].map(i => `H${i}`));
        // H29-H30 (Hauptrunde 4 / Halbfinale)
        leereHuellenAnlegen([29, 30].map(i => `H${i}`));

        // T1-T8 (Trostrunde R1)
        leereHuellenAnlegen([1, 2, 3, 4, 5, 6, 7, 8].map(i => `T${i}`));
        // T9-T16 (Trostrunde R2)
        leereHuellenAnlegen([9, 10, 11, 12, 13, 14, 15, 16].map(i => `T${i}`));
        // T17-T20 (Trostrunde R3)
        leereHuellenAnlegen([17, 18, 19, 20].map(i => `T${i}`));
        // T21-T24 (Trostrunde R4)
        leereHuellenAnlegen([21, 22, 23, 24].map(i => `T${i}`));
        // T25-T26 (Trostrunde R5)
        leereHuellenAnlegen([25, 26].map(i => `T${i}`));
        // T27-T28 (Trostrunde R6 / Kleines Finale, Bronze)
        leereHuellenAnlegen([27, 28].map(i => `T${i}`));

        // F1 (Großes Finale)
        neueKaempfe.push({
            pool_id: poolId, status: 'angelegt', reihenfolge_nummer: 'F1',
            kaempfer1_id: null, kaempfer2_id: null, sieger_id: null, kampfzeit_in_sekunden: 0, unterbewertung_kaempfer1: 0, unterbewertung_kaempfer2: 0
        });

        await knex('kaempfe').insert(neueKaempfe);
        console.log(`[DB] 59 Kämpfe für 32er-Doppel-KO Pool ID ${poolId} generiert.`);

        // Explizite Quell-Verknüpfungen setzen (welcher Kampf speist welchen späteren Kampf)
        await verknuepfeQuellenFuerPool(knex, poolId, DOPPEL_KO_32_TOPOLOGIE);

        // Kaskade starten
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
        const t27 = kaempfe.find(k => k.reihenfolge_nummer === 'T27');
        const t28 = kaempfe.find(k => k.reihenfolge_nummer === 'T28');
        if (istBeendetOderFreilos(f1) && istBeendetOderFreilos(t27) && istBeendetOderFreilos(t28)) {
            await knex('pools').where({ id: poolId }).update({ status: 'kaempfe_beendet' });
            console.log(`[DB] 32er-Doppel-KO Turnier im Pool ID ${poolId}: alle Kämpfe ausgetragen, wartet auf Bestätigung.`);
        }
    }
}
