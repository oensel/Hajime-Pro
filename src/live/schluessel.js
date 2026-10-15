// Schlüssel und Vereins-Normalisierung für den Live-Snapshot (Spec Abschnitt 5.2).
// turnier_teilnehmer.verein ist Freitext; ohne Normalisierung zerfällt "JC Musterstadt" und "Judoclub Musterstadt e.V."
// in zwei Vereine. Die Abkürzungsliste ist bewusst klein und wird bei Bedarf erweitert.
import crypto from 'node:crypto';

export function teilnehmerSchluessel(geheimnis, passnummerHash) {
    return crypto.createHmac('sha256', String(geheimnis)).update(String(passnummerHash)).digest('hex').slice(0, 24);
}

// Schlüssel einer Mannschaft: stabil über Re-Importe, solange Verein und Bezeichnung gleich bleiben
// (Mannschaften haben keine Passnummer).
export function mannschaftsSchluessel(geheimnis, turnierKey, verein, bezeichnung) {
    const basis = `${turnierKey}:team:${normalisiereVerein(verein)}:${String(bezeichnung || '').trim().toLowerCase()}`;
    return crypto.createHmac('sha256', String(geheimnis)).update(basis).digest('hex').slice(0, 24);
}

const ABKUERZUNGEN = [
    [/\bjudo\s*club\b/g, 'jc'],
    [/\bjudoclub\b/g, 'jc'],
    [/\bturnverein\b/g, 'tv'],
    [/\bsportverein\b/g, 'sv'],
    [/\bsportgemeinschaft\b/g, 'sg']
];

export function normalisiereVerein(name) {
    if (name == null) return '';
    let text = String(name).toLowerCase()
        .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
    text = text.normalize('NFKD').replace(/[̀-ͯ]/g, '');
    text = text.replace(/[.,;:\-_/()]+/g, ' ');
    text = text.replace(/\be\s*v\b/g, ' ');
    for (const [muster, ersatz] of ABKUERZUNGEN) text = text.replace(muster, ersatz);
    return text.replace(/\s+/g, ' ').trim();
}

export function vereinSchluessel(name) {
    return crypto.createHash('sha256').update(normalisiereVerein(name)).digest('hex').slice(0, 12);
}

export function waehleAnzeigename(namen) {
    const zaehler = new Map();
    for (const n of namen) {
        const bereinigt = String(n || '').trim();
        if (bereinigt) zaehler.set(bereinigt, (zaehler.get(bereinigt) || 0) + 1);
    }
    const sortiert = [...zaehler.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    return sortiert.length ? sortiert[0][0] : '';
}
