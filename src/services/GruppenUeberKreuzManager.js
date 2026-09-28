import { GRUPPEN_UEBERKREUZ_TOPOLOGIE, verknuepfeQuellenFuerPool } from '../shared/bracketTopologie.js';
import { berechneKaempferPatches } from '../shared/kampfProgression.js';
import { berechneGruppenUeberkreuzHalbfinalPatches } from '../shared/gruppenUeberkreuzProgression.js';

export class GruppenUeberKreuzManager {
    /**
     * Erstellt einen Turnier-Manager für das Gruppensystem mit Überkreuz-Finale.
     * Dieses System ist auf genau 6 Teilnehmer ausgelegt:
     * 2 Gruppen à 3 Personen, danach Halbfinale über Kreuz.
     */
    constructor() {
        this.bezeichnung = "Gruppensystem mit Überkreuz-Finale";
        this.anzahlTeilnehmer = 6;
    }

    /**
     * Initialisiert die 6 Vorrunden-Kämpfe (Phase 1) direkt in der Datenbank.
     * @param {Object} knex - Die Knex-Instanz
     * @param {number} poolId - Die ID des Pools aus der Datenbank
     */
    async initialisierePool(knex, poolId) {
        // 1. Alle registrierten Teilnehmer für diesen Pool laden
        const teilnehmer = await knex('turnier_teilnehmer').where({ pool_id: poolId });

        // Sortieren nach Gewicht aufsteigend
        teilnehmer.sort((a, b) => Number(a.gewicht) - Number(b.gewicht));

        if (teilnehmer.length !== this.anzahlTeilnehmer) {
            throw new Error(`Das Gruppensystem über Kreuz benötigt exakt ${this.anzahlTeilnehmer} Teilnehmer.`);
        }

        // 2. Teilnehmer fair nach Judo-Muster auf zwei Gruppen (Pool A und Pool B) aufteilen
        const { poolA, poolB } = this._teileTeilnehmerAuf(teilnehmer);

        // 3. Kampfplan für die Vorrunde (6 Kämpfe) vorbereiten
        // Wir nutzen 'reihenfolge_nummer' als textuellen Match-Key (z.B. "V_A_1"),
        // um den Typ des Kampfes relational eindeutig identifizieren zu können.
        const paarungen = [
            { idKey: "V_A_1", gruppe: 'A', k1: poolA[0].id, k2: poolA[1].id },
            { idKey: "V_B_1", gruppe: 'B', k1: poolB[0].id, k2: poolB[1].id },
            { idKey: "V_A_2", gruppe: 'A', k1: poolA[0].id, k2: poolA[2].id },
            { idKey: "V_B_2", gruppe: 'B', k1: poolB[0].id, k2: poolB[2].id },
            { idKey: "V_A_3", gruppe: 'A', k1: poolA[1].id, k2: poolA[2].id },
            { idKey: "V_B_3", gruppe: 'B', k1: poolB[1].id, k2: poolB[2].id }
        ];

        const neueKaempfe = paarungen.map(p => ({
            pool_id: poolId,
            status: 'bereit',
            reihenfolge_nummer: p.idKey,
            gruppe: p.gruppe,
            kaempfer1_id: p.k1,
            kaempfer2_id: p.k2,
            sieger_id: null,
            kampfzeit_in_sekunden: 0,
            unterbewertung_kaempfer1: 0,
            unterbewertung_kaempfer2: 0
        }));

        // Zukünftige Kämpfe (HF1, HF2, F1, F2) als leere Hüllen vorab anlegen
        neueKaempfe.push({
            pool_id: poolId, status: 'angelegt', reihenfolge_nummer: "HF1",
            kaempfer1_id: null, kaempfer2_id: null, sieger_id: null, kampfzeit_in_sekunden: 0, unterbewertung_kaempfer1: 0, unterbewertung_kaempfer2: 0
        });
        neueKaempfe.push({
            pool_id: poolId, status: 'angelegt', reihenfolge_nummer: "HF2",
            kaempfer1_id: null, kaempfer2_id: null, sieger_id: null, kampfzeit_in_sekunden: 0, unterbewertung_kaempfer1: 0, unterbewertung_kaempfer2: 0
        });
        neueKaempfe.push({
            pool_id: poolId, status: 'angelegt', reihenfolge_nummer: "F1", // Finale
            kaempfer1_id: null, kaempfer2_id: null, sieger_id: null, kampfzeit_in_sekunden: 0, unterbewertung_kaempfer1: 0, unterbewertung_kaempfer2: 0
        });
        neueKaempfe.push({
            pool_id: poolId, status: 'angelegt', reihenfolge_nummer: "F2", // Kleines Finale (Platz 3)
            kaempfer1_id: null, kaempfer2_id: null, sieger_id: null, kampfzeit_in_sekunden: 0, unterbewertung_kaempfer1: 0, unterbewertung_kaempfer2: 0
        });

        // 4. In die Datenbank schreiben
        await knex('kaempfe').insert(neueKaempfe);
        console.log(`[DB] 6 Vorrunden-Kämpfe und 4 Final-Hüllen für Gruppen-Überkreuz-Pool ID ${poolId} generiert.`);

        // Explizite Quell-Verknüpfung für F1/F2 (HF1/HF2 bleiben unverknüpft, siehe
        // GRUPPEN_UEBERKREUZ_TOPOLOGIE — deren Kämpfer kommen aus der Ranglistenberechnung)
        await verknuepfeQuellenFuerPool(knex, poolId, GRUPPEN_UEBERKREUZ_TOPOLOGIE);

        // Initialen Status prüfen (falls theoretisch sofort etwas berechenbar wäre)
        await this.aktualisiereTurnier(knex, poolId);
    }

    /**
     * Kern-Kaskade: Prüft nach jedem Kampf, ob die aktuelle Phase vorbei ist
     * und aktualisiert die Hüllen-Kämpfe in der Datenbank.
     * @param {Object} knex - Die Knex-Instanz
     * @param {number} poolId - Die ID des Pools aus der Datenbank
     */
    async aktualisiereTurnier(knex, poolId) {
        // Alle generierten Kämpfe des Pools laden
        let kaempfe = await knex('kaempfe').where({ pool_id: poolId });

        const findeKampf = (idKey) => kaempfe.find(k => k.reihenfolge_nummer === idKey);

        let changed = false;

        // PHASE 1: Vorrunde beendet -> Halbfinale (HF1, HF2). Bleibt Ranglisten-basiert (N-zu-2-
        // Aggregation über je 3 Vorrundenkämpfe pro Gruppe) — lässt sich nicht auf einen simplen
        // 1:1-Link reduzieren, daher eigene, gemeinsam mit dem Offline-Scoreboard genutzte
        // Engine statt der Quelle-Kampf-basierten kampfProgression.js (siehe
        // gruppenUeberkreuzProgression.js).
        const halbfinalPatches = berechneGruppenUeberkreuzHalbfinalPatches(kaempfe);
        for (const patch of halbfinalPatches) {
            const { id, ...updates } = patch;
            await knex('kaempfe').where({ id }).update(updates);
            changed = true;
        }

        // PHASE 2: HF1/HF2 -> F1/F2 über die gemeinsame Engine (einfacher 1:1-Sieger/Verlierer-Link,
        // siehe GRUPPEN_UEBERKREUZ_TOPOLOGIE).
        if (changed) {
            kaempfe = await knex('kaempfe').where({ pool_id: poolId });
        }
        const patches = berechneKaempferPatches(kaempfe);
        for (const patch of patches) {
            const { id, ...updates } = patch;
            await knex('kaempfe').where({ id }).update(updates);
            changed = true;
        }

        if (changed) {
            return this.aktualisiereTurnier(knex, poolId);
        }

        // ==========================================================
        // PHASE 3: Turnier vollständig abschließen
        // ==========================================================
        const istBeendetOderFreilos = (k) => k?.status === 'beendet' || k?.status === 'freilos';
        const finale = findeKampf("F1");
        const platz3 = findeKampf("F2");

        if (istBeendetOderFreilos(finale) && istBeendetOderFreilos(platz3)) {
            await knex('pools').where({ id: poolId }).update({ status: 'kaempfe_beendet' });
            console.log(`[DB] Gruppen-Überkreuz-Turnier ID ${poolId}: alle Kämpfe ausgetragen, wartet auf Bestätigung.`);
        }
    }

    /**
     * Teilt sechs Teilnehmer fair nach dem DJB/Judo-Muster auf zwei Gruppen auf.
     * Index 0, 2, 4 (1., 3., 5. gesetzter Athlet) -> Pool A
     * Index 1, 3, 5 (2., 4., 6. gesetzter Athlet) -> Pool B
     * @param {Array} teilnehmer - Array aus der Tabelle 'turnier_teilnehmer'
     * @returns {{poolA: Array, poolB: Array}}
     */
    _teileTeilnehmerAuf(teilnehmer) {
        const poolA = [];
        const poolB = [];

        teilnehmer.forEach((athlet, index) => {
            if (index % 2 === 0) {
                poolA.push(athlet);
            } else {
                poolB.push(athlet);
            }
        });

        return { poolA, poolB };
    }
}
