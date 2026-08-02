/**
 * Reine, seiteneffektfreie Kern-Engine der Kampf-Kaskade — ersetzt die bisher pro Modus (und
 * zusätzlich pro Server/Offline-Client) duplizierte Array-Index-/String-Match-Logik. Nutzt
 * ausschließlich die expliziten kaempfer1/2_quelle_kampf_id/_typ-Verknüpfungen (siehe
 * bracketTopologie.js) statt Konventionen über Einfüge-Reihenfolge oder reihenfolge_nummer.
 *
 * Ein Kampf wird erst angefasst, wenn BEIDE Kämpfer-Slots feststehen (bereits gesetzt, oder ihre
 * jeweilige Quelle ist bereits 'beendet') — kein verfrühtes Teil-Befüllen mit späterem
 * Zurücksetzen, damit nie ein falscher Zwischen-Sieger sichtbar wird.
 *
 * Keine Abhängigkeit von knex/DOM/localStorage — nutzbar sowohl server- (Node) als auch
 * client-seitig (Browser, ES-Modul).
 */

/**
 * Ermittelt den Verlierer eines beendeten Kampfes.
 * @param {Object|undefined} kampf
 * @returns {number|null} null, falls kein Sieger feststeht (z.B. "doppeltes Freilos")
 */
function holeVerliererId(kampf) {
    if (!kampf || !kampf.sieger_id) return null;
    return kampf.sieger_id === kampf.kaempfer1_id ? kampf.kaempfer2_id : kampf.kaempfer1_id;
}

/**
 * Löst einen einzelnen Kämpfer-Slot auf.
 *
 * Hat der Slot einen Quellkampf, wird der Wert bei JEDEM Aufruf frisch aus dessen aktuellem
 * Sieger/Verlierer abgeleitet (statt einen einmal gesetzten Wert dauerhaft beizubehalten) —
 * nur so schlägt eine nachträgliche Ergebniskorrektur des Quellkampfes (z.B. Schiedsrichter-
 * Protest) auf einen bereits befüllten, aber noch nicht ausgetragenen Folgekampf durch. Ohne
 * das blieb ein einmal gesetzter Kämpfer für immer stehen, auch wenn sein Quellkampf sich
 * längst geändert hatte. Bereits gestartete/beendete Folgekämpfe werden davon nicht berührt,
 * da berechneKaempferPatches solche Kämpfe schon vorher komplett überspringt (siehe unten).
 *
 * @returns {{bekannt: boolean, wert: number|null}} bekannt=false, falls die Quelle noch nicht
 *   'beendet' ist — der Kampf darf dann noch nicht angefasst werden.
 */
function loeseSlotAuf(aktuellerWert, quelleKampfId, quelleTyp, byId) {
    if (!quelleKampfId) {
        // Kein Verweis auf einen Quellkampf: der Slot wurde direkt gesetzt (oder bleibt leer).
        return { bekannt: true, wert: aktuellerWert ?? null };
    }
    const quelle = byId.get(quelleKampfId);
    if (!quelle || (quelle.status !== 'beendet' && quelle.status !== 'freilos')) {
        return { bekannt: false, wert: null };
    }
    const wert = quelleTyp === 'sieger' ? quelle.sieger_id : holeVerliererId(quelle);
    return { bekannt: true, wert };
}

/**
 * Berechnet, welche Kämpfe sich aufgrund gerade beendeter Quell-Kämpfe ändern müssen.
 * Ändert die Eingabe nicht (rein funktional) — der Aufrufer wendet die Patches an (DB-Update
 * server-seitig, direkte Objekt-Mutation client-seitig) und ruft die Funktion danach erneut mit
 * dem aktualisierten Zustand auf, bis eine leere Patch-Liste zurückkommt.
 *
 * @param {Array<Object>} kaempfe - Kämpfe eines Pools: id, status, kaempfer1_id, kaempfer2_id,
 *   sieger_id, kaempfer1_quelle_kampf_id, kaempfer1_quelle_typ, kaempfer2_quelle_kampf_id,
 *   kaempfer2_quelle_typ
 * @returns {Array<{id: number, kaempfer1_id?: number|null, kaempfer2_id?: number|null,
 *   status?: string, sieger_id?: number|null, unterbewertung_kaempfer1?: number,
 *   unterbewertung_kaempfer2?: number}>}
 */
export function berechneKaempferPatches(kaempfe) {
    const byId = new Map(kaempfe.map(k => [k.id, k]));
    const patches = [];

    for (const kampf of kaempfe) {
        // 'beendet'/'freilos' sind endgültig entschieden und werden nie mehr angefasst.
        // 'gestartet' läuft gerade auf der Matte — die Kämpfer dürfen dem Kampfgericht nicht
        // unter den Füßen weggezogen werden, selbst wenn sich ein Quellkampf nachträglich ändert.
        if (kampf.status === 'beendet' || kampf.status === 'freilos' || kampf.status === 'gestartet') continue;
        if (!kampf.kaempfer1_quelle_kampf_id && !kampf.kaempfer2_quelle_kampf_id) continue;

        const slot1 = loeseSlotAuf(kampf.kaempfer1_id, kampf.kaempfer1_quelle_kampf_id, kampf.kaempfer1_quelle_typ, byId);
        const slot2 = loeseSlotAuf(kampf.kaempfer2_id, kampf.kaempfer2_quelle_kampf_id, kampf.kaempfer2_quelle_typ, byId);

        // Beide Quellen müssen feststehen, bevor dieser Kampf überhaupt angefasst wird.
        if (!slot1.bekannt || !slot2.bekannt) continue;

        const patch = { id: kampf.id };
        let hatAenderung = false;

        if (kampf.kaempfer1_id !== slot1.wert) { patch.kaempfer1_id = slot1.wert; hatAenderung = true; }
        if (kampf.kaempfer2_id !== slot2.wert) { patch.kaempfer2_id = slot2.wert; hatAenderung = true; }

        // Freilos-Nachbehandlung: beide Slots leer -> ergebnislos freilos;
        // genau ein Slot leer -> automatischer Sieg des vorhandenen Kämpfers (auch freilos).
        if (slot1.wert === null && slot2.wert === null) {
            patch.status = 'freilos';
            patch.sieger_id = null;
            hatAenderung = true;
        } else if (slot1.wert === null || slot2.wert === null) {
            const sieger = slot1.wert !== null ? slot1.wert : slot2.wert;
            patch.status = 'freilos';
            patch.sieger_id = sieger;
            patch.unterbewertung_kaempfer1 = slot1.wert !== null ? 10 : 0;
            patch.unterbewertung_kaempfer2 = slot2.wert !== null ? 10 : 0;
            hatAenderung = true;
        } else if (kampf.status === 'angelegt') {
            // Beide Slots sind jetzt echte Kämpfer -> der Platzhalter wird zum echten,
            // in der Matten-Pipeline wartenden Kampf. Nur von 'angelegt' aus (nie 'bereit'/
            // 'gestartet'/'vorbereiten' überschreiben, die haben ihre Kämpfer schon längst).
            patch.status = 'bereit';
            hatAenderung = true;
        }

        if (hatAenderung) patches.push(patch);
    }

    return patches;
}
