// Gleichstand im Einzel-Jeder-gegen-Jeden und in den Vorrundengruppen des Gruppen-Überkreuz: Prüfung, Entscheidung
// nach Siegzeit und Stichkämpfe. Rein und knex-/DOM-frei (Server, Client-Geräte und Browser nutzen dieselbe Logik).
//
// Die DJB-Wettkampfordnung (Stand 17.12.2025) regelt den Gleichstand nur für Liga-Mannschaftstabellen (4.1.7.2:
// direkter Vergleich, dann Stichkampf oder Los). Siege, Wertungspunkte und direkter Vergleich entscheidet
// jgjRangfolge.js; bleibt ein Block danach gleich und betrifft er einen relevanten Platz, entscheidet die
// Turnierleitung: nach der Gesamtzeit der Siege oder durch Stichkämpfe.
import { ordneEinzelRangfolge } from './jgjRangfolge.js';

// Relevante Plätze: im Pool zählen die Plätze 1 bis 3 (Urkunden), in einer Überkreuz-Vorrundengruppe Platz 1 und 2
// (sie ziehen ins Halbfinale ein).
export const RELEVANT_BIS_POOL = 3;
export const RELEVANT_BIS_GRUPPE = 2;

const fertig = k => k.status === 'beendet' || k.status === 'freilos';

// pools.gleichstand_entscheidung: { pool?: [[ids]], A?: [[ids]], B?: [[ids]] } als JSON-Text oder Objekt;
// je Block die Kämpfer in der entschiedenen Reihenfolge.
export function leseEntscheidung(wert) {
    let o = wert;
    if (typeof o === 'string') {
        try { o = JSON.parse(o); } catch { return {}; }
    }
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
}

// Summe der Kampfzeiten (Sekunden) der gewonnenen Kämpfe je Kämpfer.
export function siegzeiten(kaempfe, ids) {
    const z = new Map(ids.map(id => [id, 0]));
    kaempfe.forEach(k => {
        if (k.status !== 'beendet' || !k.sieger_id || !z.has(k.sieger_id)) return;
        z.set(k.sieger_id, z.get(k.sieger_id) + (Number(k.kampfzeit_in_sekunden) || 0));
    });
    return z;
}

// Alle Paarungen unter den Betroffenen (zwei: ein Kampf, drei: drei Kämpfe).
export function stichkampfPaarungen(ids) {
    const paare = [];
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) paare.push([ids[i], ids[j]]);
    return paare;
}

/**
 * Prüft, ob die Plätze bis `bis` eindeutig sind. Erst wenn alle Kämpfe beendet sind (`bereit`), ist `offen` aussagekräftig.
 * @param {Array<number>} ids - Kämpfer der Gruppe bzw. des Pools (Reihenfolge gilt bei unentschiedenem Gleichstand)
 * @param {Array<Object>} kaempfe - die Kämpfe dieser Gruppe bzw. dieses Pools
 * @param {{ bis?: number, entscheidung?: Array<Array<number>> }} [optionen]
 * @returns {{ bereit: boolean, offen: boolean, bloecke: Array<{ ids: Array<number>, vonPlatz: number, bisPlatz: number,
 *   zeiten: Object, siegzeitEindeutig: boolean, siegzeitReihenfolge: Array<number>, paarungen: Array<Array<number>> }> }}
 */
export function pruefeGleichstand(ids, kaempfe, optionen = {}) {
    const bis = optionen.bis ?? RELEVANT_BIS_POOL;
    const bereit = kaempfe.length > 0 && kaempfe.every(fertig);
    const r = ordneEinzelRangfolge(ids, kaempfe.filter(k => k.status === 'beendet'), { entscheidung: optionen.entscheidung });
    const z = siegzeiten(kaempfe, ids);
    const bloecke = r.offeneBloecke.filter(b => b.start < bis).map(b => {
        const nachZeit = [...b.ids].sort((x, y) => z.get(x) - z.get(y));
        let eindeutig = true;
        for (let i = 0; i < nachZeit.length;) {
            let j = i;
            while (j + 1 < nachZeit.length && z.get(nachZeit[j + 1]) === z.get(nachZeit[i])) j++;
            if (j > i && b.start + i < bis) eindeutig = false;
            i = j + 1;
        }
        return {
            ids: b.ids,
            vonPlatz: b.start + 1,
            bisPlatz: b.start + b.ids.length,
            zeiten: Object.fromEntries(b.ids.map(id => [id, z.get(id)])),
            siegzeitEindeutig: eindeutig,
            siegzeitReihenfolge: nachZeit,
            paarungen: stichkampfPaarungen(b.ids)
        };
    });
    return { bereit, offen: bereit && bloecke.length > 0, bloecke };
}

// Entscheidung "nach Siegzeit" für alle offenen Blöcke; null, wenn die Zeit bei einem Block nichts entscheidet.
export function entscheideNachSiegzeit(pruefung) {
    if (!pruefung.offen || pruefung.bloecke.some(b => !b.siegzeitEindeutig)) return null;
    return pruefung.bloecke.map(b => b.siegzeitReihenfolge);
}
