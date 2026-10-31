import { GRUPPEN_UEBERKREUZ_TOPOLOGIE, verknuepfeQuellenFuerPool } from '../shared/bracketTopologie.js';
import { berechneKaempferPatches } from '../shared/kampfProgression.js';
import { berechneGruppenUeberkreuzHalbfinalPatches } from '../shared/gruppenUeberkreuzProgression.js';
import { jgjPaarungen } from '../shared/jgjPaarungen.js';

export class GruppenUeberKreuzManager {
    /**
     * Erstellt einen Turnier-Manager für das Gruppensystem mit Überkreuz-Finale:
     * 6 bis 10 Teilnehmer in 2 Gruppen à 3 bis 5 (Gruppe A ist bei ungerader Zahl die größere),
     * jeder gegen jeden in der Gruppe, danach Halbfinale über Kreuz.
     */
    constructor() {
        this.bezeichnung = "Gruppensystem mit Überkreuz-Finale";
        this.minTeilnehmer = 6;
        this.maxTeilnehmer = 10;
    }

    /**
     * Initialisiert die Vorrunden-Kämpfe (Phase 1) direkt in der Datenbank.
     * @param {Object} knex - Die Knex-Instanz
     * @param {number} poolId - Die ID des Pools aus der Datenbank
     */
    async initialisierePool(knex, poolId) {
        // 1. Alle registrierten Teilnehmer für diesen Pool laden
        const teilnehmer = await knex('turnier_teilnehmer').where({ pool_id: poolId }).orderBy('id', 'asc');

        // Sortieren nach Gewicht aufsteigend
        teilnehmer.sort((a, b) => Number(a.gewicht) - Number(b.gewicht));

        if (teilnehmer.length < this.minTeilnehmer || teilnehmer.length > this.maxTeilnehmer) {
            throw new Error(`Das Gruppensystem über Kreuz benötigt ${this.minTeilnehmer} bis ${this.maxTeilnehmer} Teilnehmer.`);
        }

        // 2. Teilnehmer auf zwei Gruppen (Pool A und Pool B) aufteilen
        const gruppen = this._teileTeilnehmerAuf(teilnehmer);

        // 3. Kampfplan für die Vorrunde: jeder gegen jeden je Gruppe, die Gruppen im Wechsel (V_A_1, V_B_1, V_A_2, …).
        // Wir nutzen 'reihenfolge_nummer' als textuellen Match-Key (z.B. "V_A_1"),
        // um den Typ des Kampfes relational eindeutig identifizieren zu können.
        const jeGruppe = Object.entries(gruppen).map(([gruppe, mitglieder]) =>
            jgjPaarungen(mitglieder.length).map(([i, j], n) => ({ idKey: `V_${gruppe}_${n + 1}`, gruppe, k1: mitglieder[i].id, k2: mitglieder[j].id })));
        const paarungen = [];
        for (let runde = 0; runde < Math.max(...jeGruppe.map(l => l.length)); runde++) {
            jeGruppe.forEach(liste => { if (liste[runde]) paarungen.push(liste[runde]); });
        }

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

        // Zukünftige Kämpfe (HF1, HF2, F1) als leere Hüllen vorab anlegen. Kein kleines Finale:
        // beide Halbfinal-Verlierer sind Dritte.
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

        // 4. In die Datenbank schreiben
        await knex('kaempfe').insert(neueKaempfe);
        console.log(`[DB] ${paarungen.length} Vorrunden-Kämpfe und 3 Final-Hüllen für Gruppen-Überkreuz-Pool ID ${poolId} generiert.`);

        // Explizite Quell-Verknüpfung für F1 (HF1/HF2 bleiben unverknüpft, siehe
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
        // Gleichstände in den Gruppen, die die Turnierleitung entschieden hat, stehen in pools.gleichstand_entscheidung;
        // ohne Entscheidung (oder bei offenen Stichkämpfen) bleiben HF1/HF2 unbefüllt.
        const poolZeile = await knex('pools').where({ id: poolId }).first('gleichstand_entscheidung');
        const halbfinalPatches = berechneGruppenUeberkreuzHalbfinalPatches(kaempfe, { entscheidung: poolZeile?.gleichstand_entscheidung });
        for (const patch of halbfinalPatches) {
            const { id, ...updates } = patch;
            await knex('kaempfe').where({ id }).update(updates);
            changed = true;
        }

        // PHASE 2: HF1/HF2 -> F1 (bei älteren Pools auch F2) über die gemeinsame Engine (einfacher
        // 1:1-Sieger/Verlierer-Link, siehe GRUPPEN_UEBERKREUZ_TOPOLOGIE).
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
        // Kleines Finale gibt es nur noch in älteren Pools
        const platz3 = findeKampf("F2");

        if (istBeendetOderFreilos(finale) && (!platz3 || istBeendetOderFreilos(platz3))) {
            await knex('pools').where({ id: poolId }).update({ status: 'kaempfe_beendet' });
            console.log(`[DB] Gruppen-Überkreuz-Turnier ID ${poolId}: alle Kämpfe ausgetragen, wartet auf Bestätigung.`);
        }
    }

    /**
     * Teilt die (nach Gewicht sortierten) Teilnehmer auf die Gruppen auf: der Reihe nach in die Gruppe mit den
     * wenigsten Vereinskameraden, bei Gleichstand in die kleinere, dann die erste (solange sie Platz hat). Ohne
     * Vereinskonflikt ergibt das das bisherige Muster (1., 3., 5. → A, 2., 4., 6. → B); Vereinskameraden landen
     * nach Möglichkeit in verschiedenen Gruppen. Innerhalb einer Gruppe bleibt die Gewichtsreihenfolge.
     * @param {Array} teilnehmer - Array aus der Tabelle 'turnier_teilnehmer', nach Gewicht aufsteigend
     * @returns {{A: Array, B: Array}}
     */
    _teileTeilnehmerAuf(teilnehmer) {
        const namen = ['A', 'B'];
        const groesse = { A: Math.ceil(teilnehmer.length / 2), B: Math.floor(teilnehmer.length / 2) };
        const gruppen = { A: [], B: [] };
        const verein = t => t.verein || 'Kein Verein';

        for (const athlet of teilnehmer) {
            let beste = null;
            for (const g of namen) {
                const frei = groesse[g] - gruppen[g].length;
                if (frei <= 0) continue;
                const kameraden = gruppen[g].filter(t => verein(t) === verein(athlet)).length;
                const mitglieder = gruppen[g].length;
                if (!beste || kameraden < beste.kameraden || (kameraden === beste.kameraden && mitglieder < beste.mitglieder)) {
                    beste = { g, kameraden, mitglieder };
                }
            }
            gruppen[beste.g].push(athlet);
        }
        return gruppen;
    }
}
