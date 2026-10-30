// Rangfolge im Einzel-Jeder-gegen-Jeden (Pool und Vorrundengruppen), gemeinsam für Platzierungen und
// Gruppen-Überkreuz. Die DJB-Wettkampfordnung (Stand 17.12.2025) regelt den Gleichstand nur für die
// Tabellen der DJB-Ligen (4.1.7.2): erst Siege/Punkte, dann der direkte Vergleich, danach Stichkampf bzw. Los.
// Sinngemäß für Einzelkämpfer: Siege, dann Wertungspunkte der Siege (wie bisher), dann der direkte Vergleich
// unter den Punktgleichen (Siege, dann Wertungspunkte aus den Kämpfen untereinander; bei einem Dreierkreis
// bleibt der Gleichstand bestehen). Was danach gleich ist, wird als Gleichstand gemeldet (Stichkampf = Zusatzkampf);
// seine Reihenfolge bleibt die der übergebenen ids.
function wertungDerKaempfe(kaempfe, ids) {
    const w = new Map(ids.map(id => [id, { siege: 0, punkte: 0 }]));
    kaempfe.forEach(k => {
        if (k.status !== 'beendet' || !k.sieger_id || !w.has(k.sieger_id)) return;
        const e = w.get(k.sieger_id);
        e.siege += 1;
        e.punkte += Number(k.sieger_id === k.kaempfer1_id ? k.unterbewertung_kaempfer1 : k.unterbewertung_kaempfer2) || 0;
    });
    return w;
}

// Teilt die bereits nach Siegen/Punkten absteigend sortierte Liste in Blöcke gleicher Wertung.
function blockeGleicherWertung(ids, w) {
    const bloecke = [];
    ids.forEach(id => {
        const letzter = bloecke.at(-1);
        const x = w.get(id), y = letzter && w.get(letzter[0]);
        if (letzter && x.siege === y.siege && x.punkte === y.punkte) letzter.push(id);
        else bloecke.push([id]);
    });
    return bloecke;
}

// Ordnet eine Gruppe punktgleicher Kämpfer über den direkten Vergleich; liefert Blöcke, die weiter gleichauf sind.
function direkterVergleich(ids, kaempfe) {
    if (ids.length < 2) return [ids];
    const untereinander = kaempfe.filter(k => ids.includes(k.kaempfer1_id) && ids.includes(k.kaempfer2_id));
    const w = wertungDerKaempfe(untereinander, ids);
    const sortiert = [...ids].sort((x, y) => (w.get(y).siege - w.get(x).siege) || (w.get(y).punkte - w.get(x).punkte));
    const bloecke = blockeGleicherWertung(sortiert, w);
    // Ein einziger Block heißt: kein Unterschied gefunden (z. B. Dreierkreis). Sonst die kleineren Blöcke erneut vergleichen.
    if (bloecke.length === 1) return bloecke;
    return bloecke.flatMap(blk => direkterVergleich(blk, kaempfe));
}

/**
 * @param {Array<number>} ids - die Kämpfer, in der Reihenfolge, die bei verbleibendem Gleichstand gilt
 * @param {Array<Object>} kaempfe - kaempfer1_id/2_id, sieger_id, status, unterbewertung_kaempfer1/2
 * @param {{ entscheidung?: Array<Array<number>> }} [optionen] - entscheidung: von der Turnierleitung entschiedene
 *   Gleichstände, je Eintrag die Kämpfer eines Blocks in der entschiedenen Reihenfolge (siehe gleichstand.js);
 *   sie gilt nur für einen Block, der genau diese Kämpfer umfasst und sonst unentschieden bliebe
 * @returns {{ reihenfolge: Array<number>, gleichstand: Set<number>, offeneBloecke: Array<{ ids: Array<number>, start: number }>,
 *   wertung: Map<number, {siege: number, punkte: number}> }} offeneBloecke: unentschiedene Blöcke mit ihrer 0-basierten Startposition
 */
export function ordneEinzelRangfolge(ids, kaempfe, optionen = {}) {
    const entscheidungen = (optionen.entscheidung || []).filter(e => Array.isArray(e) && e.length > 1);
    const w = wertungDerKaempfe(kaempfe, ids);
    const vorsortiert = [...ids].sort((x, y) => (w.get(y).siege - w.get(x).siege) || (w.get(y).punkte - w.get(x).punkte));
    const reihenfolge = [];
    const gleichstand = new Set();
    const offeneBloecke = [];
    blockeGleicherWertung(vorsortiert, w).forEach(block => {
        direkterVergleich(block, kaempfe).forEach(rest => {
            const start = reihenfolge.length;
            const entschieden = rest.length > 1
                && entscheidungen.find(e => e.length === rest.length && rest.every(id => e.includes(id)));
            if (entschieden) {
                entschieden.forEach(id => reihenfolge.push(id));
                return;
            }
            rest.forEach(id => reihenfolge.push(id));
            if (rest.length > 1) {
                rest.forEach(id => gleichstand.add(id));
                offeneBloecke.push({ ids: [...rest], start });
            }
        });
    });
    return { reihenfolge, gleichstand, offeneBloecke, wertung: w };
}
