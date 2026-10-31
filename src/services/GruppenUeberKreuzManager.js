import { GRUPPEN_UEBERKREUZ_TOPOLOGIE, GRUPPEN_KO_TOPOLOGIE, verknuepfeQuellenFuerPool } from '../shared/bracketTopologie.js';
import { berechneKaempferPatches } from '../shared/kampfProgression.js';
import { berechneGruppenUeberkreuzHalbfinalPatches } from '../shared/gruppenUeberkreuzProgression.js';
import { jgjPaarungen } from '../shared/jgjPaarungen.js';

// Gruppen-Überkreuz: 6 bis 10 Teilnehmer in 2 Gruppen à 3 bis 5, danach Halbfinale über Kreuz.
const UEBERKREUZ = {
    bezeichnung: 'Gruppensystem mit Überkreuz-Finale',
    gruppen: ['A', 'B'], minTeilnehmer: 6, maxTeilnehmer: 10,
    endrunde: ['HF1', 'HF2', 'F1'], topologie: GRUPPEN_UEBERKREUZ_TOPOLOGIE
};
// Gruppen-KO: 12 bis 20 Teilnehmer in 4 Gruppen à 3 bis 5, Erste und Zweite ins Viertelfinale, danach KO.
export const GRUPPEN_KO = {
    bezeichnung: 'Gruppen-Vorrunde mit KO-Endrunde',
    gruppen: ['A', 'B', 'C', 'D'], minTeilnehmer: 12, maxTeilnehmer: 20,
    endrunde: ['VF1', 'VF2', 'VF3', 'VF4', 'HF1', 'HF2', 'F1'], topologie: GRUPPEN_KO_TOPOLOGIE
};

export class GruppenUeberKreuzManager {
    /**
     * Erstellt einen Turnier-Manager für ein Gruppensystem: jeder gegen jeden in der Gruppe, danach die Endrunde
     * (Plätze aus den Gruppen siehe ENDRUNDE_* in gruppenUeberkreuzProgression.js). Kein kleines Finale: beide
     * Halbfinal-Verlierer sind Dritte. Ohne Angabe das Gruppen-Überkreuz (bei ungerader Zahl ist Gruppe A größer).
     * @param {Object} [system] - UEBERKREUZ oder GRUPPEN_KO
     */
    constructor(system = UEBERKREUZ) {
        Object.assign(this, system);
    }

    /**
     * Initialisiert die Vorrunden-Kämpfe (Phase 1) und die leeren Endrunden-Hüllen direkt in der Datenbank.
     * @param {Object} knex - Die Knex-Instanz
     * @param {number} poolId - Die ID des Pools aus der Datenbank
     */
    async initialisierePool(knex, poolId) {
        // 1. Alle registrierten Teilnehmer für diesen Pool laden
        const teilnehmer = await knex('turnier_teilnehmer').where({ pool_id: poolId }).orderBy('id', 'asc');

        // Sortieren nach Gewicht aufsteigend
        teilnehmer.sort((a, b) => Number(a.gewicht) - Number(b.gewicht));

        if (teilnehmer.length < this.minTeilnehmer || teilnehmer.length > this.maxTeilnehmer) {
            throw new Error(`Das ${this.bezeichnung} benötigt ${this.minTeilnehmer} bis ${this.maxTeilnehmer} Teilnehmer.`);
        }

        // 2. Teilnehmer auf die Gruppen aufteilen
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

        // Zukünftige Kämpfe der Endrunde als leere Hüllen vorab anlegen.
        for (const nummer of this.endrunde) {
            neueKaempfe.push({
                pool_id: poolId, status: 'angelegt', reihenfolge_nummer: nummer,
                kaempfer1_id: null, kaempfer2_id: null, sieger_id: null, kampfzeit_in_sekunden: 0, unterbewertung_kaempfer1: 0, unterbewertung_kaempfer2: 0
            });
        }

        // 4. In die Datenbank schreiben
        await knex('kaempfe').insert(neueKaempfe);
        console.log(`[DB] ${paarungen.length} Vorrunden-Kämpfe und ${this.endrunde.length} Final-Hüllen (${this.bezeichnung}) für Pool ID ${poolId} generiert.`);

        // Explizite Quell-Verknüpfung für die KO-Kämpfe der Endrunde (die ersten Endrunden-Kämpfe bleiben
        // unverknüpft — deren Kämpfer kommen aus der Ranglistenberechnung)
        await verknuepfeQuellenFuerPool(knex, poolId, this.topologie);

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

        // PHASE 1: Gruppen ausgekämpft -> erste Endrunden-Kämpfe (HF1/HF2 bzw. VF1-VF4). Bleibt Ranglisten-basiert
        // (N-zu-2-Aggregation über die Vorrundenkämpfe einer Gruppe) — lässt sich nicht auf einen simplen
        // 1:1-Link reduzieren, daher eigene, gemeinsam mit dem Offline-Scoreboard genutzte
        // Engine statt der Quelle-Kampf-basierten kampfProgression.js (siehe
        // gruppenUeberkreuzProgression.js).
        // Gleichstände in den Gruppen, die die Turnierleitung entschieden hat, stehen in pools.gleichstand_entscheidung;
        // ohne Entscheidung (oder bei offenen Stichkämpfen) bleiben die Endrunden-Kämpfe der Gruppe unbefüllt.
        const poolZeile = await knex('pools').where({ id: poolId }).first('gleichstand_entscheidung');
        const halbfinalPatches = berechneGruppenUeberkreuzHalbfinalPatches(kaempfe, { entscheidung: poolZeile?.gleichstand_entscheidung });
        for (const patch of halbfinalPatches) {
            const { id, ...updates } = patch;
            await knex('kaempfe').where({ id }).update(updates);
            changed = true;
        }

        // PHASE 2: die KO-Kämpfe der Endrunde (bei älteren Pools auch F2) über die gemeinsame Engine (einfacher
        // 1:1-Sieger/Verlierer-Link, siehe GRUPPEN_UEBERKREUZ_TOPOLOGIE / GRUPPEN_KO_TOPOLOGIE).
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
            console.log(`[DB] ${this.bezeichnung} ID ${poolId}: alle Kämpfe ausgetragen, wartet auf Bestätigung.`);
        }
    }

    /**
     * Teilt die (nach Gewicht sortierten) Teilnehmer auf die Gruppen auf: der Reihe nach in die Gruppe mit den
     * wenigsten Vereinskameraden, bei Gleichstand in die kleinere, dann die erste (solange sie Platz hat). Ohne
     * Vereinskonflikt ergibt das das bisherige Muster (1., 3., 5. → A, 2., 4., 6. → B; bei vier Gruppen reihum);
     * Vereinskameraden landen nach Möglichkeit in verschiedenen Gruppen. Innerhalb einer Gruppe bleibt die
     * Gewichtsreihenfolge. Die vorderen Gruppen sind bei ungleicher Verteilung die größeren.
     * @param {Array} teilnehmer - Array aus der Tabelle 'turnier_teilnehmer', nach Gewicht aufsteigend
     * @returns {Object<string, Array>} je Gruppe ('A', 'B', …) die Mitglieder
     */
    _teileTeilnehmerAuf(teilnehmer) {
        const namen = this.gruppen;
        const basis = Math.floor(teilnehmer.length / namen.length);
        const rest = teilnehmer.length % namen.length;
        const groesse = Object.fromEntries(namen.map((g, i) => [g, basis + (i < rest ? 1 : 0)]));
        const gruppen = Object.fromEntries(namen.map(g => [g, []]));
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
