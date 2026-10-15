// Rein: gruppiert die verfolgten Teilnehmer nach Dringlichkeit (Spec Phase 2b, Entscheidung 8).
const JETZT = new Set(['laeuft']);

// Eine Reihenfolge für Übersicht und Vereinsansicht: wer gerade dran ist oben, dann nach Abstand; danach alles ohne Kampf in Sicht.
const VEREIN_RANG = {
    laeuft: 0, als_naechstes: 1, wartet_auf_gegner: 1000, nicht_ausgelost: 1100, ohne_matte: 1200,
    verspaetet: 1300, wartet: 1250, keine_weiteren: 1400, abgeschlossen: 1500, nicht_erschienen: 1600
};
function vereinRang(t) {
    if (t.zustand === 'in_n') return 2 + (Number.isInteger(t.abstand) ? t.abstand : 998);
    if (t.zustand === 'abgeschlossen') return VEREIN_RANG.abgeschlossen + (Number.isInteger(t.platz) ? t.platz : 99);
    return VEREIN_RANG[t.zustand] ?? 1700;
}
const vergleich = (a, b) => vereinRang(a) - vereinRang(b)
    || `${a.nachname}${a.vorname}`.localeCompare(`${b.nachname}${b.vorname}`, 'de');

export function sortiereVerein(teilnehmer) {
    return [...teilnehmer].sort(vergleich);
}

// Abschnitte: bald dran / noch nicht dran (kein Pool oder Pool beginnt auch in POOL_BALD Kämpfen noch nicht) / fertig.
export const POOL_BALD = 3;
const OHNE_KAMPF = new Set(['keine_weiteren', 'abgeschlossen', 'nicht_erschienen']);
const NOCH_NICHT = new Set(['nicht_ausgelost', 'ohne_matte', 'verspaetet', 'wartet']);
export const ABSCHNITTE = [
    { id: 'bald', titel: 'Bald dran' },
    { id: 'spaeter', titel: 'Noch nicht dran' },
    { id: 'fertig', titel: 'Fertig' }
];

export function abschnittVon(t) {
    if (OHNE_KAMPF.has(t.zustand)) return 'fertig';
    if (NOCH_NICHT.has(t.zustand)) return 'spaeter';
    if (t.zustand === 'laeuft' || t.zustand === 'als_naechstes') return 'bald';
    if (t.poolBegonnen === undefined) return 'bald'; // ältere Antwort ohne Pool-Beginn
    if (t.poolBegonnen || (Number.isInteger(t.poolStartetIn) && t.poolStartetIn <= POOL_BALD)) return 'bald';
    return 'spaeter';
}

export function teileInAbschnitte(teilnehmer) {
    const sortiert = [...teilnehmer].sort(vergleich);
    return ABSCHNITTE
        .map(a => ({ ...a, eintraege: sortiert.filter(t => abschnittVon(t) === a.id) }))
        .filter(a => a.eintraege.length);
}

export function gruppiereUebersicht(teilnehmer, { teilnehmer: einzelne = [], vereine = [], abgewaehlt = [] } = {}) {
    const einzeln = new Set(einzelne);
    const ausgenommen = new Set(abgewaehlt);
    const sortiert = [...teilnehmer].sort(vergleich);
    const eigene = sortiert.filter(t => einzeln.has(t.key));
    const jetzt = eigene.filter(t => JETZT.has(t.zustand));
    const bald = eigene.filter(t => !JETZT.has(t.zustand) && abschnittVon(t) === 'bald');
    const spaeter = eigene.filter(t => abschnittVon(t) === 'spaeter');
    const fertig = eigene.filter(t => abschnittVon(t) === 'fertig');
    const gruppen = [];
    if (jetzt.length) gruppen.push({ id: 'jetzt', titel: 'Gerade dran', eintraege: jetzt });
    if (bald.length) gruppen.push({ id: 'bald', titel: 'Als Nächstes', eintraege: bald });
    for (const vereinKey of vereine) {
        const mitglieder = sortiert.filter(t => t.vereinKey === vereinKey && !einzeln.has(t.key) && !ausgenommen.has(t.key));
        if (mitglieder.length) {
            const abschnitte = teileInAbschnitte(mitglieder);
            gruppen.push({ id: 'verein', vereinKey, titel: mitglieder[0].verein, eintraege: abschnitte.flatMap(a => a.eintraege), abschnitte });
        }
    }
    if (spaeter.length) gruppen.push({ id: 'spaeter', titel: 'Noch nicht dran', eintraege: spaeter });
    if (fertig.length) gruppen.push({ id: 'fertig', titel: 'Fertig', eintraege: fertig });
    return { gruppen };
}
