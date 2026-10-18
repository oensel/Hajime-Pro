// Anzeigelogik der Orga-Aufgaben in der Helfer-App (Reiter „Aufgaben“), rein: kein DOM, keine DB, keine Node-Importe.
// Im Browser über /js/shared/orgaAnzeige.js geladen. Datumswerte sind 'YYYY-MM-DD' (bzw. ISO-Text davon).

const TAG_MS = 86400000;
const WOCHE_TAGE = 7;

function alsTageszahl(datum) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(datum ?? ''));
    if (!m) return null;
    return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / TAG_MS;
}

/** Heutiges Datum 'YYYY-MM-DD' in Europe/Berlin (die Fristen der Turniere gelten dort). */
export function heuteBerlin(jetzt = new Date()) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(jetzt);
}

/** Kalendertage von `heute` bis `faelligAm` (negativ = überfällig); null ohne gültiges Datum. */
export function tageBis(faelligAm, heute) {
    const f = alsTageszahl(faelligAm);
    const h = alsTageszahl(heute);
    if (f == null || h == null) return null;
    return f - h;
}

const tageText = (n) => (n === 1 ? '1 Tag' : `${n} Tagen`);

/** 'heute fällig' / 'morgen fällig' / 'fällig in 3 Tagen' / 'seit 2 Tagen überfällig' / 'ohne Frist' */
export function faelligkeitText(faelligAm, heute) {
    const n = tageBis(faelligAm, heute);
    if (n == null) return 'ohne Frist';
    if (n === 0) return 'heute fällig';
    if (n === 1) return 'morgen fällig';
    if (n > 1) return `fällig in ${n} Tagen`;
    return `seit ${tageText(-n)} überfällig`;
}

/** 'Offen' / '1 von 3 erledigt' / 'Erledigt' aus dem Status-Objekt der API. */
export function statusText(status) {
    if (!status || status.status === 'offen') return 'Offen';
    if (status.status === 'erledigt') return 'Erledigt';
    if (status.status === 'angefangen') return `${status.erledigt} von ${status.gesamt} erledigt`;
    return 'Offen';
}

export const istErledigt = (aufgabe) => !!(aufgabe && aufgabe.status && aufgabe.status.status === 'erledigt');

/**
 * Gruppiert die eigenen Aufgaben: überfällig (Frist vor heute), diese Woche (heute bis +7 Tage), später (auch ohne
 * Frist), erledigt. Innerhalb nach Frist, ohne Frist zuletzt, dann nach Titel.
 */
export function gruppiereAufgaben(aufgaben, heute) {
    const gruppen = { ueberfaellig: [], dieseWoche: [], spaeter: [], erledigt: [] };
    for (const a of aufgaben || []) {
        if (istErledigt(a)) { gruppen.erledigt.push(a); continue; }
        const n = tageBis(a.faellig_am, heute);
        if (n != null && n < 0) gruppen.ueberfaellig.push(a);
        else if (n != null && n <= WOCHE_TAGE) gruppen.dieseWoche.push(a);
        else gruppen.spaeter.push(a);
    }
    const frist = (a) => alsTageszahl(a.faellig_am) ?? Infinity;
    const vergleich = (x, y) => (frist(x) === frist(y) ? 0 : frist(x) < frist(y) ? -1 : 1)
        || String(x.titel ?? '').localeCompare(String(y.titel ?? ''), 'de', { numeric: true, sensitivity: 'base' });
    for (const liste of Object.values(gruppen)) liste.sort(vergleich);
    return gruppen;
}

/** Anzahl nicht erledigter Aufgaben (Zähler am Reiter). */
export function zaehleOffene(aufgaben) {
    return (aufgaben || []).filter((a) => !istErledigt(a)).length;
}
