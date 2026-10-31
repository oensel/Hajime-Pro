import { baueKoRepechage, KO_REPECHAGE_FREILOS, KO_REPECHAGE_RASTER } from '../shared/koRepechage.js';
import { verknuepfeQuellenFuerPool } from '../shared/bracketTopologie.js';
import { berechneKaempferPatches } from '../shared/kampfProgression.js';

const POOLS = ['A', 'B', 'C', 'D'];

export class KoRepechageManager {
    /**
     * Turnier-Manager für das KO-System mit Hoffnungsrunde (IJF-Repechage), siehe src/shared/koRepechage.js.
     * @param {number} rasterGroesse - 16, 32 oder 64
     */
    constructor(rasterGroesse) {
        this.rasterGroesse = rasterGroesse;
        this.struktur = baueKoRepechage(rasterGroesse);
    }

    /**
     * Legt alle Kämpfe des Pools an: die erste Hauptrunde mit Kämpfern und Freilosen, alle weiteren als Platzhalter.
     * Verteilung wie im Doppel-KO: Freilose an festen Plätzen, Vereine möglichst auf verschiedene Pools (A-D),
     * innerhalb eines Pools nach Gewicht.
     * @param {Object} knex - Die Knex-Instanz
     * @param {number} poolId - Die ID des Pools aus der Datenbank
     */
    async initialisierePool(knex, poolId) {
        const teilnehmer = await knex('turnier_teilnehmer').where({ pool_id: poolId }).orderBy('id', 'asc');
        const rasterListe = this.verteileAufRaster(teilnehmer);

        const platzhalter = nr => ({
            pool_id: poolId, status: 'angelegt', reihenfolge_nummer: nr,
            kaempfer1_id: null, kaempfer2_id: null, sieger_id: null, kampfzeit_in_sekunden: 0, unterbewertung_kaempfer1: 0, unterbewertung_kaempfer2: 0
        });

        const [ersteRunde, ...folgeRunden] = this.struktur.runden;
        const neueKaempfe = ersteRunde.map((nr, i) => {
            const k1 = rasterListe[2 * i];
            const k2 = rasterListe[2 * i + 1];
            const kampf = { ...platzhalter(nr), status: 'bereit', kaempfer1_id: k1 ? k1.id : null, kaempfer2_id: k2 ? k2.id : null };
            if (!k1 || !k2) {
                kampf.status = 'freilos';
                kampf.sieger_id = (k1 || k2)?.id ?? null;
            }
            return kampf;
        });
        for (const runde of folgeRunden) neueKaempfe.push(...runde.map(platzhalter));
        neueKaempfe.push(...['T1', 'T2', 'T3', 'T4', 'F1'].map(platzhalter));

        await knex('kaempfe').insert(neueKaempfe);
        console.log(`[DB] ${neueKaempfe.length} Kämpfe für ${this.rasterGroesse}er-KO-Repechage Pool ID ${poolId} generiert.`);

        await verknuepfeQuellenFuerPool(knex, poolId, this.struktur.topologie);
        await this.aktualisiereTurnier(knex, poolId);
    }

    // Rasterplätze 0..raster-1 mit Teilnehmern (null = Freilos).
    verteileAufRaster(teilnehmer) {
        const raster = this.rasterGroesse;
        const freilosSlots = new Set(KO_REPECHAGE_FREILOS[raster].slice(0, Math.max(0, raster - teilnehmer.length)));
        const viertel = raster / 4;
        const poolSlots = Object.fromEntries(POOLS.map((p, i) =>
            [p, Array.from({ length: viertel }, (_, j) => i * viertel + j).filter(s => !freilosSlots.has(s))]));

        // Vereine nach Größe absteigend; jeder Athlet in den Pool mit den wenigsten Vereinskameraden,
        // bei Gleichstand in den mit den meisten freien Plätzen.
        const vereine = new Map();
        teilnehmer.forEach(t => {
            const name = t.verein || 'Kein Verein';
            if (!vereine.has(name)) vereine.set(name, []);
            vereine.get(name).push(t);
        });
        const zuordnung = Object.fromEntries(POOLS.map(p => [p, []]));
        [...vereine.entries()].sort((a, b) => b[1].length - a[1].length).forEach(([name, athleten]) => {
            athleten.sort((a, b) => Number(a.gewicht) - Number(b.gewicht));
            for (const athlet of athleten) {
                let bester = null;
                let besteVereinsZahl = Number.POSITIVE_INFINITY;
                let besteFreie = -1;
                for (const p of POOLS) {
                    const freie = poolSlots[p].length - zuordnung[p].length;
                    if (freie <= 0) continue;
                    const vereinsZahl = zuordnung[p].filter(a => (a.verein || 'Kein Verein') === name).length;
                    if (vereinsZahl < besteVereinsZahl || (vereinsZahl === besteVereinsZahl && freie > besteFreie)) {
                        bester = p;
                        besteVereinsZahl = vereinsZahl;
                        besteFreie = freie;
                    }
                }
                if (bester) zuordnung[bester].push(athlet);
            }
        });

        const rasterListe = new Array(raster).fill(null);
        for (const p of POOLS) {
            zuordnung[p].sort((a, b) => Number(a.gewicht) - Number(b.gewicht));
            zuordnung[p].forEach((athlet, i) => { rasterListe[poolSlots[p][i]] = athlet; });
        }
        return rasterListe;
    }

    /**
     * Wird nach jedem Kampf aufgerufen: befüllt Folgekämpfe über die Kaskade und meldet den Pool als ausgekämpft,
     * sobald Finale und beide Bronzekämpfe entschieden sind.
     */
    async aktualisiereTurnier(knex, poolId) {
        const kaempfe = await knex('kaempfe').where({ pool_id: poolId });
        if (kaempfe.length === 0) return;

        const patches = berechneKaempferPatches(kaempfe);
        for (const { id, ...updates } of patches) {
            await knex('kaempfe').where({ id }).update(updates);
        }
        if (patches.length > 0) return this.aktualisiereTurnier(knex, poolId);

        const fertig = nr => ['beendet', 'freilos'].includes(kaempfe.find(k => k.reihenfolge_nummer === nr)?.status);
        if (['F1', 'T3', 'T4'].every(fertig)) {
            await knex('pools').where({ id: poolId }).update({ status: 'kaempfe_beendet' });
            console.log(`[DB] ${this.rasterGroesse}er-KO-Repechage im Pool ID ${poolId}: alle Kämpfe ausgetragen, wartet auf Bestätigung.`);
        }
    }
}

// Ein Manager je Modus ('KO-Repechage-16' → 16er-Raster usw.), gemeinsam für Pool- und Kampf-Controller.
export const KO_REPECHAGE_MANAGER = Object.fromEntries(
    Object.entries(KO_REPECHAGE_RASTER).map(([modus, raster]) => [modus, new KoRepechageManager(raster)]));
