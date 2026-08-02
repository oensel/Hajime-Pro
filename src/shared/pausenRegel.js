/**
 * Reine, seiteneffektfreie Regeln für die Mindest-Pausenzeit zwischen zwei Kämpfen desselben
 * Kämpfers auf derselben Matte. Analog zu kampfProgression.js server- und client-seitig
 * (Browser-Offline-Modus) identisch nutzbar — keine Abhängigkeit von knex/DOM.
 *
 * Zwei getrennte Anwendungsfälle nutzen dieselben Regeln:
 *  - Vorausschauende Matten-Planung (planeKaempfeFuerKampfflaeche): rechnet mit GESCHÄTZTEN
 *    Kampfdauern (pools.kampfzeit_sekunden), da zukünftige Kämpfe naturgemäß noch keine echte
 *    Dauer haben.
 *  - Reaktive Pausen-Prüfung in der Steuerung (berechnePausenwarnung): rechnet mit ECHTEN
 *    Zeitstempeln (kaempfe.updated_at des letzten 'beendet'en Kampfes je Teilnehmer) gegen die
 *    aktuelle Uhrzeit — das ist die verbindliche, tatsächliche Pause, unabhängig davon, wie die
 *    Schätzung der Planung ausgefallen ist.
 */

const PAUSE_SEKUNDEN_JUNG = 6 * 60;  // U15 und jünger
const PAUSE_SEKUNDEN_ALT = 10 * 60;  // U18, U21, Männer, Frauen, Mixed, Ü.., etc.

/**
 * Ermittelt die vorgeschriebene Mindest-Pause (in Sekunden) für eine Altersklasse.
 * "U<Zahl>" mit Zahl <= 15 (U9, U11, U13, U15) -> 6 Minuten, alles andere (U18, U21, Männer,
 * Frauen, Mixed, freie Klassen wie "Ü30"/"Veteranen") -> 10 Minuten (sicherer Default für
 * Erwachsene/nicht erkannte Klassen).
 * @param {string} altersklasse
 * @returns {number} Sekunden
 */
export function ermittlePausensekunden(altersklasse) {
    const match = String(altersklasse || '').trim().match(/^U\s*(\d+)$/i);
    if (match && parseInt(match[1], 10) <= 15) {
        return PAUSE_SEKUNDEN_JUNG;
    }
    return PAUSE_SEKUNDEN_ALT;
}

/**
 * Baut aus einer Liste von Kämpfen (mit id, kaempfer1_id, kaempfer2_id, status, updated_at) eine
 * Zuordnung Teilnehmer-ID -> Zeitpunkt (ms seit Epoch) des Endes seines letzten ECHTEN Kampfes.
 * 'freilos' zählt nicht (kein echter Kampf, keine körperliche Belastung, kein Mattenzeit-Verbrauch).
 * @param {Array<Object>} kaempfe
 * @returns {Map<number, number>}
 */
export function letztesKampfEndeProTeilnehmer(kaempfe) {
    const ergebnis = new Map();
    for (const kampf of kaempfe) {
        if (kampf.status !== 'beendet') continue;
        const ende = new Date(kampf.updated_at).getTime();
        if (Number.isNaN(ende)) continue;
        for (const kaempferId of [kampf.kaempfer1_id, kampf.kaempfer2_id]) {
            if (!kaempferId) continue;
            const bisher = ergebnis.get(kaempferId);
            if (bisher === undefined || ende > bisher) {
                ergebnis.set(kaempferId, ende);
            }
        }
    }
    return ergebnis;
}

/**
 * Reaktive Prüfung mit ECHTEN Zeitstempeln: hat jeder Kämpfer eines anstehenden Kampfes seit
 * seinem letzten echten Kampfende genug Pause gehabt (Stand jetzt)?
 * @param {Object} kampf - der zu prüfende, noch nicht gestartete Kampf
 * @param {string} altersklasse - Altersklasse des Pools dieses Kampfes
 * @param {Map<number, number>} letztesEndeMap - siehe letztesKampfEndeProTeilnehmer()
 * @param {number} jetztMs - aktuelle Zeit in ms seit Epoch (new Date().getTime())
 * @returns {{ ok: boolean, kaempfer: Array<{ id: number, verstricheneSekunden: number, benoetigteSekunden: number, fehlendeSekunden: number }> }}
 */
export function pruefeKampfPause(kampf, altersklasse, letztesEndeMap, jetztMs) {
    const benoetigteSekunden = ermittlePausensekunden(altersklasse);
    const betroffene = [];

    for (const kaempferId of [kampf.kaempfer1_id, kampf.kaempfer2_id]) {
        if (!kaempferId) continue;
        const letztesEnde = letztesEndeMap.get(kaempferId);
        if (letztesEnde === undefined) continue; // noch kein vorheriger Kampf -> keine Pausenpflicht

        const verstricheneSekunden = Math.max(0, Math.round((jetztMs - letztesEnde) / 1000));
        if (verstricheneSekunden < benoetigteSekunden) {
            betroffene.push({
                id: kaempferId,
                verstricheneSekunden,
                benoetigteSekunden,
                fehlendeSekunden: benoetigteSekunden - verstricheneSekunden
            });
        }
    }

    return { ok: betroffene.length === 0, kaempfer: betroffene };
}
