/**
 * Reine, seiteneffektfreie Kern-Engine der Begegnungs-Kaskade für Mannschafts-Pools — das
 * Pendant zu kampfProgression.js auf Ebene der Begegnungen (mannschaftskaempfe) statt der
 * Einzelkämpfe. Bewusst ein eigenständiges Duplikat statt Wiederverwendung von
 * kampfProgression.js: die dortigen Feldnamen (kaempferN_id) auf Mannschaften umzubiegen wäre
 * irreführend, und kampfProgression.js läuft bereits client-seitig im Offline-Scoreboard — ein
 * Umbau mit Konfigurationsparametern würde unnötiges Regressionsrisiko für den bestehenden
 * Einzelwettkampf-Pfad schaffen. Der Algorithmus selbst ist identisch.
 *
 * Eine Begegnung wird erst angefasst, wenn BEIDE Mannschafts-Slots feststehen (bereits gesetzt,
 * oder ihre jeweilige Quelle ist bereits 'beendet') — kein verfrühtes Teil-Befüllen mit
 * späterem Zurücksetzen.
 *
 * Keine Abhängigkeit von knex/DOM — nutzbar sowohl server- als auch client-seitig.
 */

/**
 * Ermittelt die unterlegene Mannschaft einer beendeten Begegnung.
 * @param {Object|undefined} begegnung
 * @returns {number|null} null, falls keine Siegermannschaft feststeht (z.B. "doppeltes Freilos")
 */
function holeVerliererMannschaftId(begegnung) {
    if (!begegnung || !begegnung.sieger_mannschaft_id) return null;
    return begegnung.sieger_mannschaft_id === begegnung.mannschaft1_id
        ? begegnung.mannschaft2_id
        : begegnung.mannschaft1_id;
}

/**
 * Löst einen einzelnen Mannschafts-Slot auf. Wird bei JEDEM Aufruf frisch aus dem aktuellen
 * Sieger/Verlierer der Quell-Begegnung abgeleitet (statt einen einmal gesetzten Wert dauerhaft
 * beizubehalten), damit eine nachträgliche Ergebniskorrektur durchschlägt. Bereits gestartete/
 * beendete Folge-Begegnungen werden davon nicht berührt (siehe berechneMannschaftsPatches).
 *
 * @returns {{bekannt: boolean, wert: number|null}} bekannt=false, falls die Quelle noch nicht
 *   'beendet' ist — die Begegnung darf dann noch nicht angefasst werden.
 */
function loeseSlotAuf(aktuellerWert, quelleKampfId, quelleTyp, byId) {
    if (!quelleKampfId) {
        return { bekannt: true, wert: aktuellerWert ?? null };
    }
    const quelle = byId.get(quelleKampfId);
    if (!quelle || (quelle.status !== 'beendet' && quelle.status !== 'freilos')) {
        return { bekannt: false, wert: null };
    }
    const wert = quelleTyp === 'sieger' ? quelle.sieger_mannschaft_id : holeVerliererMannschaftId(quelle);
    return { bekannt: true, wert };
}

/**
 * Berechnet, welche Begegnungen sich aufgrund gerade beendeter Quell-Begegnungen ändern müssen.
 * Ändert die Eingabe nicht (rein funktional) — der Aufrufer wendet die Patches an (DB-Update)
 * und ruft die Funktion danach erneut mit dem aktualisierten Zustand auf, bis eine leere
 * Patch-Liste zurückkommt.
 *
 * @param {Array<Object>} begegnungen - mannschaftskaempfe eines Pools: id, status,
 *   mannschaft1_id, mannschaft2_id, sieger_mannschaft_id, mannschaft1_quelle_kampf_id,
 *   mannschaft1_quelle_typ, mannschaft2_quelle_kampf_id, mannschaft2_quelle_typ
 * @returns {Array<{id: number, mannschaft1_id?: number|null, mannschaft2_id?: number|null,
 *   status?: string, sieger_mannschaft_id?: number|null}>}
 */
export function berechneMannschaftsPatches(begegnungen) {
    const byId = new Map(begegnungen.map(b => [b.id, b]));
    const patches = [];

    for (const begegnung of begegnungen) {
        // 'beendet'/'freilos' sind endgültig entschieden und werden nie mehr angefasst.
        // 'gestartet' läuft gerade — die Mannschaften dürfen dem Kampfgericht nicht unter den
        // Füßen weggezogen werden, selbst wenn sich eine Quell-Begegnung nachträglich ändert.
        if (begegnung.status === 'beendet' || begegnung.status === 'freilos' || begegnung.status === 'gestartet') continue;
        if (!begegnung.mannschaft1_quelle_kampf_id && !begegnung.mannschaft2_quelle_kampf_id) continue;

        const slot1 = loeseSlotAuf(begegnung.mannschaft1_id, begegnung.mannschaft1_quelle_kampf_id, begegnung.mannschaft1_quelle_typ, byId);
        const slot2 = loeseSlotAuf(begegnung.mannschaft2_id, begegnung.mannschaft2_quelle_kampf_id, begegnung.mannschaft2_quelle_typ, byId);

        if (!slot1.bekannt || !slot2.bekannt) continue;

        const patch = { id: begegnung.id };
        let hatAenderung = false;

        if (begegnung.mannschaft1_id !== slot1.wert) { patch.mannschaft1_id = slot1.wert; hatAenderung = true; }
        if (begegnung.mannschaft2_id !== slot2.wert) { patch.mannschaft2_id = slot2.wert; hatAenderung = true; }

        if (slot1.wert === null && slot2.wert === null) {
            patch.status = 'freilos';
            patch.sieger_mannschaft_id = null;
            hatAenderung = true;
        } else if (slot1.wert === null || slot2.wert === null) {
            patch.status = 'freilos';
            patch.sieger_mannschaft_id = slot1.wert !== null ? slot1.wert : slot2.wert;
            hatAenderung = true;
        } else if (begegnung.status === 'angelegt') {
            // Beide Slots sind jetzt echte Mannschaften -> der Platzhalter wird zur echten,
            // startbereiten Begegnung. Ihre Einzelkämpfe legt der aufrufende Manager an (siehe
            // MannschaftJederGegenJedenManager.js etc.), da das die kaempfe-Tabelle betrifft.
            patch.status = 'bereit';
            hatAenderung = true;
        }

        if (hatAenderung) patches.push(patch);
    }

    return patches;
}
