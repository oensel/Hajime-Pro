// Suchtext der Teilnehmer-App. Alles wird auf [a-z0-9] und Leerzeichen reduziert: damit kann ein Suchbegriff nie
// LIKE-Platzhalter (% _) enthalten, und "Müller" wird sowohl über "mueller" als auch über "muller" gefunden.
const UMLAUTE = [[/ä/g, 'ae'], [/ö/g, 'oe'], [/ü/g, 'ue'], [/ß/g, 'ss']];
const AKZENTE = /[̀-ͯ]/g;

export function normalisiereSuche(text) {
    let t = String(text ?? '').toLowerCase().normalize('NFC');
    for (const [muster, ersatz] of UMLAUTE) t = t.replace(muster, ersatz);
    t = t.normalize('NFKD').replace(AKZENTE, '');
    return t.replace(/[^a-z0-9]+/g, ' ').trim();
}

function ohneUmlautAufloesung(text) {
    return String(text ?? '').toLowerCase().replace(/ß/g, 'ss').normalize('NFKD').replace(AKZENTE, '')
        .replace(/[^a-z0-9]+/g, ' ').trim();
}

export function suchtextFuer(vorname, nachname) {
    const roh = `${vorname ?? ''} ${nachname ?? ''}`;
    return `${normalisiereSuche(roh)} ${ohneUmlautAufloesung(roh)}`.trim();
}

export function suchbegriffe(text) {
    const normalisiert = normalisiereSuche(text);
    if (normalisiert.replace(/ /g, '').length < 2) return [];
    return normalisiert.split(' ').filter(Boolean).slice(0, 5).map(b => b.slice(0, 30));
}
