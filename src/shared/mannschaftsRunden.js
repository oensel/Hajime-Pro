// Rundeneinteilung und Mattenverteilung für Mannschafts-Begegnungen (Jeder gegen Jeden).
// Rein und DB-frei. Eine Runde enthält keine Mannschaft zweimal, daher kann ein Team nie auf zwei
// Matten gleichzeitig stehen, wenn Runde n+1 erst nach Runde n beginnt.

// Kreismethode (Berger-Tabelle): n Teams -> n-1 (gerade) bzw. n (ungerade) Runden.
export function berechneRunden(begegnungen) {
    const ids = [];
    for (const b of begegnungen) {
        for (const m of [b.mannschaft1_id, b.mannschaft2_id]) {
            if (m != null && !ids.includes(m)) ids.push(m);
        }
    }
    const rundeJePaar = new Map();
    const schluessel = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`);
    if (ids.length >= 2) {
        const feld = ids.length % 2 === 0 ? [...ids] : [...ids, null];
        const n = feld.length;
        for (let runde = 1; runde <= n - 1; runde++) {
            for (let i = 0; i < n / 2; i++) {
                const a = feld[i];
                const b = feld[n - 1 - i];
                if (a != null && b != null) rundeJePaar.set(schluessel(a, b), runde);
            }
            feld.splice(1, 0, feld.pop());
        }
    }
    const ergebnis = new Map();
    const belegt = new Map(); // Runde -> Set(Mannschaft), für Begegnungen außerhalb der Tabelle
    for (const b of begegnungen) {
        const runde = rundeJePaar.get(schluessel(b.mannschaft1_id, b.mannschaft2_id));
        if (runde == null) continue;
        ergebnis.set(b.id, runde);
        if (!belegt.has(runde)) belegt.set(runde, new Set());
        belegt.get(runde).add(b.mannschaft1_id).add(b.mannschaft2_id);
    }
    // Sonderfälle (unbekannte Teams/Paare): in die erste Runde, in der beide Teams frei sind.
    for (const b of begegnungen) {
        if (ergebnis.has(b.id)) continue;
        let runde = 1;
        while (belegt.has(runde) && (belegt.get(runde).has(b.mannschaft1_id) || belegt.get(runde).has(b.mannschaft2_id))) runde++;
        if (!belegt.has(runde)) belegt.set(runde, new Set());
        belegt.get(runde).add(b.mannschaft1_id).add(b.mannschaft2_id);
        ergebnis.set(b.id, runde);
    }
    return ergebnis;
}

// Verteilt die Begegnungen jeder Runde reihum auf die Matten (laufender Zähler, damit die Matten
// über alle Runden gleich ausgelastet sind). Liefert Map Begegnungs-ID -> Matten-ID.
export function verteileRundenAufMatten(begegnungen, rundeJeBegegnung, mattenIds) {
    const ergebnis = new Map();
    if (!mattenIds.length) return ergebnis;
    const nachRunde = new Map();
    for (const b of begegnungen) {
        const runde = rundeJeBegegnung.get(b.id) ?? 1;
        if (!nachRunde.has(runde)) nachRunde.set(runde, []);
        nachRunde.get(runde).push(b);
    }
    let zaehler = 0;
    for (const runde of [...nachRunde.keys()].sort((a, b) => a - b)) {
        for (const b of nachRunde.get(runde).sort((x, y) => x.id - y.id)) {
            ergebnis.set(b.id, mattenIds[zaehler % mattenIds.length]);
            zaehler++;
        }
    }
    return ergebnis;
}
