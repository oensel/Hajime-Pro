import { GRUPPEN_UEBERKREUZ_TOPOLOGIE, verknuepfeQuellenFuerPool } from '../shared/bracketTopologie.js';
import { berechneKaempferPatches } from '../shared/kampfProgression.js';

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

        const vorrundenKaempfe = kaempfe.filter(k => k.reihenfolge_nummer?.startsWith("V_"));
        const vorrundeFertig = vorrundenKaempfe.length === 6 && vorrundenKaempfe.every(k => k.status === 'beendet');

        const hf1 = findeKampf("HF1");
        const hf2 = findeKampf("HF2");

        let changed = false;

        // PHASE 1: Vorrunde beendet -> Halbfinale (HF1, HF2). Bleibt Ranglisten-basiert (N-zu-2-
        // Aggregation über je 3 Vorrundenkämpfe pro Gruppe) — lässt sich nicht auf einen simplen
        // 1:1-Link reduzieren, daher hier weiterhin manuell statt über die gemeinsame Engine.
        if (vorrundeFertig && hf1 && hf2 && (!hf1.kaempfer1_id || !hf2.kaempfer1_id)) {
            const ranglisteA = await this._berechneTeilRangliste(knex, poolId, "V_A_");
            const ranglisteB = await this._berechneTeilRangliste(knex, poolId, "V_B_");

            const ersterA = ranglisteA[0]?.id;
            const zweiterA = ranglisteA[1]?.id;

            const ersterB = ranglisteB[0]?.id;
            const zweiterB = ranglisteB[1]?.id;

            if (ersterA && zweiterA && ersterB && zweiterB) {
                await knex('kaempfe').where({ id: hf1.id }).update({ kaempfer1_id: ersterA, kaempfer2_id: zweiterB });
                await knex('kaempfe').where({ id: hf2.id }).update({ kaempfer1_id: ersterB, kaempfer2_id: zweiterA });
                changed = true;
            }
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

    /**
     * Berechnet die mathematische Rangliste eines Unterpools (Gruppe A oder B) aus der DB.
     * Sortierung nach Judo-Regelwerk:
     * 1. Meiste Siege
     * 2. Höhere Unterbewertung (Punkte aus Ippon/Waza-ari)
     * @param {Object} knex - Die Knex-Instanz
     * @param {number} poolId - Die ID des Hauptpools
     * @param {string} turnierIdPraefix - Filter nach Phasen-Schlüssel (z.B. "V_A_" oder "V_B_")
     * @returns {Promise<Array>} Sortierte Liste mit Objekten { id, siege, unterbewertung }
     */
    async _berechneTeilRangliste(knex, poolId, turnierIdPraefix) {
        const gruppenKaempfe = await knex('kaempfe')
            .where({ pool_id: poolId })
            .andWhere('status', 'beendet')
            .andWhereLike('reihenfolge_nummer', `${turnierIdPraefix}%`);

        const teilnehmerIds = new Set();
        gruppenKaempfe.forEach(k => {
            if (k.kaempfer1_id) teilnehmerIds.add(k.kaempfer1_id);
            if (k.kaempfer2_id) teilnehmerIds.add(k.kaempfer2_id);
        });

        const tabelle = Array.from(teilnehmerIds).map(tId => ({
            id: tId,
            siege: 0,
            unterbewertung: 0
        }));

        gruppenKaempfe.forEach(kampf => {
            if (!kampf.sieger_id) return;

            const siegerEintrag = tabelle.find(e => e.id === kampf.sieger_id);
            if (!siegerEintrag) return;

            siegerEintrag.siege += 1;

            const siegerIstKaempfer1 = kampf.sieger_id === kampf.kaempfer1_id;
            siegerEintrag.unterbewertung += siegerIstKaempfer1
                ? kampf.unterbewertung_kaempfer1
                : kampf.unterbewertung_kaempfer2;
        });

        return tabelle.sort((a, b) => {
            if (b.siege !== a.siege) {
                return b.siege - a.siege;
            }
            return b.unterbewertung - a.unterbewertung;
        });
    }
}
