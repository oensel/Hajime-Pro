// Die 16 Bundesländer (Schreibweise wie in vereine.bundesland) und das Erkennen von Eingaben (Name in beliebiger
// Groß-/Kleinschreibung oder Kürzel, z. B. „NRW“). Framework-/DB-frei.
export const BUNDESLAENDER = [
    'Baden-Württemberg', 'Bayern', 'Berlin', 'Brandenburg', 'Bremen', 'Hamburg', 'Hessen', 'Mecklenburg-Vorpommern',
    'Niedersachsen', 'Nordrhein-Westfalen', 'Rheinland-Pfalz', 'Saarland', 'Sachsen', 'Sachsen-Anhalt',
    'Schleswig-Holstein', 'Thüringen'
];

const KUERZEL = {
    bw: 'Baden-Württemberg', by: 'Bayern', be: 'Berlin', bb: 'Brandenburg', hb: 'Bremen', hh: 'Hamburg', he: 'Hessen',
    mv: 'Mecklenburg-Vorpommern', ni: 'Niedersachsen', nw: 'Nordrhein-Westfalen', nrw: 'Nordrhein-Westfalen',
    rp: 'Rheinland-Pfalz', sl: 'Saarland', sn: 'Sachsen', st: 'Sachsen-Anhalt', sh: 'Schleswig-Holstein', th: 'Thüringen'
};

const vereinfache = (text) => String(text).toLowerCase().replace(/\s+/g, ' ').trim();

/** Bundesland zu einer Eingabe (Name oder Kürzel); null, wenn nichts passt. */
export function findeBundesland(eingabe) {
    if (typeof eingabe !== 'string') return null;
    const schluessel = vereinfache(eingabe);
    if (!schluessel) return null;
    const treffer = BUNDESLAENDER.find((land) => vereinfache(land) === schluessel);
    return treffer || KUERZEL[schluessel] || null;
}
