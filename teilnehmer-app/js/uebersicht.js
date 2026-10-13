// Rein: gruppiert die verfolgten Teilnehmer nach Dringlichkeit (Spec Phase 2b, Entscheidung 8).
const JETZT = new Set(['laeuft']);
const BALD = new Set(['als_naechstes', 'in_n', 'wartet_auf_gegner']);

// Kleiner Wert = dringender.
function rang(t) {
    if (t.zustand === 'laeuft') return 0;
    if (t.zustand === 'als_naechstes') return 1;
    if (t.zustand === 'in_n') return 2 + (Number.isInteger(t.abstand) ? t.abstand : 999);
    if (t.zustand === 'wartet_auf_gegner') return 1000;
    if (t.zustand === 'keine_weiteren') return 2000;
    if (t.zustand === 'abgeschlossen') return 3000 + (Number.isInteger(t.platz) ? t.platz : 99);
    return 4000;
}
const vergleich = (a, b) => rang(a) - rang(b) || `${a.nachname}${a.vorname}`.localeCompare(`${b.nachname}${b.vorname}`, 'de');

export function gruppiereUebersicht(teilnehmer, { teilnehmer: einzelne = [], vereine = [] } = {}) {
    const einzeln = new Set(einzelne);
    const sortiert = [...teilnehmer].sort(vergleich);
    const jetzt = sortiert.filter(t => einzeln.has(t.key) && JETZT.has(t.zustand));
    const bald = sortiert.filter(t => einzeln.has(t.key) && BALD.has(t.zustand));
    const fertig = sortiert.filter(t => einzeln.has(t.key) && !JETZT.has(t.zustand) && !BALD.has(t.zustand));
    const gruppen = [];
    if (jetzt.length) gruppen.push({ id: 'jetzt', titel: 'Gerade dran', eintraege: jetzt });
    if (bald.length) gruppen.push({ id: 'bald', titel: 'Als Nächstes', eintraege: bald });
    for (const vereinKey of vereine) {
        const mitglieder = sortiert.filter(t => t.vereinKey === vereinKey && !einzeln.has(t.key));
        if (mitglieder.length) gruppen.push({ id: 'verein', vereinKey, titel: `Vereinsregel: ${mitglieder[0].verein}`, eintraege: mitglieder });
    }
    if (fertig.length) gruppen.push({ id: 'fertig', titel: 'Fertig oder wartend', eintraege: fertig });
    return { gruppen };
}
