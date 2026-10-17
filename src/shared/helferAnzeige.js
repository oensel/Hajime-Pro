// Anzeigelogik der Helfer-App (public/helfer.html), rein: kein DOM, keine DB, keine Node-Importe.
// Im Browser über /js/shared/helferAnzeige.js geladen.

const MIN_ZEICHEN = 2;
const vergleich = (a, b) => a.localeCompare(b, 'de', { numeric: true, sensitivity: 'base' });
const nameVon = (eintrag) => (typeof eintrag === 'string' ? eintrag : String(eintrag?.name ?? ''));

/**
 * Vereinssuche der Autovervollständigung: ab 2 Zeichen, Teilstring an beliebiger Stelle, ohne Beachtung
 * von Groß-/Kleinschreibung; Treffer mit passendem Anfang zuerst, beide Teile alphabetisch.
 * @template {string|{id:number,name:string}} T
 * @param {T[]} liste - Namen oder Objekte mit `name` (dann kommen die Objekte zurück)
 * @param {string} eingabe
 * @returns {T[]}
 */
export function filtereVereine(liste, eingabe) {
    const suche = String(eingabe ?? '').trimStart().toLowerCase();
    if (suche.trim().length < MIN_ZEICHEN) return [];
    const anfang = [];
    const mitte = [];
    for (const eintrag of liste || []) {
        const name = nameVon(eintrag).toLowerCase();
        if (name.startsWith(suche)) anfang.push(eintrag);
        else if (name.includes(suche)) mitte.push(eintrag);
    }
    const sortiert = (teil) => teil.sort((a, b) => vergleich(nameVon(a), nameVon(b)));
    return [...sortiert(anfang), ...sortiert(mitte)];
}

/** 'noch 1 Platz frei' / 'noch 3 Plätze frei' */
export function platzText(frei) {
    return frei === 1 ? 'noch 1 Platz frei' : `noch ${frei} Plätze frei`;
}

/**
 * Gruppiert Slots nach Tätigkeit (alphabetisch, Zahlen numerisch: „Matte 2“ vor „Matte 10“),
 * innerhalb einer Gruppe nach Beginn.
 * @param {Array<{taetigkeit:string, von_min:number}>} slots
 * @returns {Array<{bezeichnung:string, slots:Array}>}
 */
export function gruppiereNachBezeichnung(slots) {
    const gruppen = new Map();
    for (const slot of slots || []) {
        const name = String(slot.taetigkeit ?? '');
        if (!gruppen.has(name)) gruppen.set(name, []);
        gruppen.get(name).push(slot);
    }
    return [...gruppen.entries()]
        .sort(([a], [b]) => vergleich(a, b))
        .map(([bezeichnung, liste]) => ({
            bezeichnung,
            slots: liste.slice().sort((a, b) => a.von_min - b.von_min || (a.slotId ?? 0) - (b.slotId ?? 0))
        }));
}

/**
 * Hinweis „Deine Registrierung muss noch freigeschaltet werden.“: das Konto hat keine freigeschaltete
 * Mitgliedschaft. Ohne geladenes Profil (null/undefined) keine Aussage → false.
 * @param {Array<{freigegeben:boolean}>|null|undefined} vereine
 */
export function wartetAufFreischaltung(vereine) {
    if (!Array.isArray(vereine)) return false;
    return !vereine.some(v => v && v.freigegeben);
}

const WOCHENTAGE =['So.', 'Mo.', 'Di.', 'Mi.', 'Do.', 'Fr.', 'Sa.'];

/** 'YYYY-MM-DD' → 'Sa., 14.11.2026' (ohne Zeitzonenabhängigkeit). */
export function datumText(datum) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(datum ?? ''));
    if (!m) return String(datum ?? '');
    const tag = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay();
    return `${WOCHENTAGE[tag]}, ${m[3]}.${m[2]}.${m[1]}`;
}
