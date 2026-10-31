/**
 * Reine Regel, an welche Stelle der Warteschlange einer Matte ein nachträglich angelegter Kampf (Stichkampf,
 * Zusatzkampf) gehört: möglichst früh, aber so, dass seine beiden Kämpfer ihre Mindestpause (pausenRegel.js)
 * zum Kampf davor haben und die folgenden Kämpfe derselben Kämpfer nicht zu dicht auf ihn folgen. Wie die
 * Mattenplanung rechnet sie mit der echten Dauer beendeter Kämpfe und sonst mit der Kampfzeit des Pools als
 * Schätzung. Lässt sich die Pause nirgends einhalten (z. B. am Ende des Turniers), gilt die Stelle mit dem
 * geringsten Defizit; die Steuerung warnt dann zur Kampfzeit anhand echter Zeitstempel (berechnePausenwarnung).
 *
 * Keine Abhängigkeit von knex/DOM — nutzbar auf Server und Client-Geräten.
 */

/**
 * @param {{ kaempfer1_id: number|null, kaempfer2_id: number|null, dauer: number }} neu - der einzusortierende Kampf
 * @param {Array<{ kaempfer1_id: number|null, kaempfer2_id: number|null, dauer: number }>} vorher - gelaufene und laufende
 *   Kämpfe der Matte in ihrer Reihenfolge (Sekunden Dauer je Kampf)
 * @param {Array<{ id: number, kaempfer1_id: number|null, kaempfer2_id: number|null, dauer: number }>} warteschlange -
 *   bereite Kämpfe der Matte in ihrer Reihenfolge
 * @param {number} pausenSekunden - vorgeschriebene Mindestpause der Altersklasse
 * @returns {{ index: number, defizit: number }} Einfügeposition in der Warteschlange (0 = als Nächstes) und das
 *   verbleibende Pausendefizit in Sekunden (<= 0: Pause überall eingehalten)
 */
export function findeEinfuegeIndex({ neu, vorher = [], warteschlange = [], pausenSekunden }) {
    const betroffen = new Set([neu.kaempfer1_id, neu.kaempfer2_id].filter(id => id != null));

    // Bis zum Ende der bereits laufenden/gelaufenen Kämpfe vorspulen (wie planeEineMatte).
    let zeitNachVorher = 0;
    const endeNachVorher = new Map();
    for (const k of vorher) {
        zeitNachVorher += k.dauer;
        if (k.kaempfer1_id != null) endeNachVorher.set(k.kaempfer1_id, zeitNachVorher);
        if (k.kaempfer2_id != null) endeNachVorher.set(k.kaempfer2_id, zeitNachVorher);
    }

    // Größtes Pausendefizit der betroffenen Kämpfer in der Folge mit dem Kampf an Position `index`.
    const defizitBei = (index) => {
        const folge = [...warteschlange.slice(0, index), neu, ...warteschlange.slice(index)];
        let zeit = zeitNachVorher;
        const ende = new Map(endeNachVorher);
        let defizit = -Infinity;
        folge.forEach((k, position) => {
            // Nur der neue Kampf und die Kämpfe danach zählen: was davor liegt, ändert sich durch das Einfügen nicht.
            for (const id of position >= index ? [k.kaempfer1_id, k.kaempfer2_id] : []) {
                if (id == null || !betroffen.has(id) || !ende.has(id)) continue;
                defizit = Math.max(defizit, pausenSekunden - (zeit - ende.get(id)));
            }
            zeit += k.dauer;
            if (k.kaempfer1_id != null) ende.set(k.kaempfer1_id, zeit);
            if (k.kaempfer2_id != null) ende.set(k.kaempfer2_id, zeit);
        });
        return defizit === -Infinity ? 0 : defizit;
    };

    let bester = { index: warteschlange.length, defizit: Infinity };
    for (let index = 0; index <= warteschlange.length; index++) {
        const defizit = defizitBei(index);
        if (defizit <= 0) return { index, defizit };
        if (defizit < bester.defizit) bester = { index, defizit };
    }
    return bester;
}
