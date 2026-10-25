// TARGET2-Geschäftstage (framework-frei). Alle Datumswerte sind ISO-Strings (JJJJ-MM-TT),
// gerechnet wird ausschließlich in UTC, damit keine Ortszeit-Verschiebungen auftreten.

const TAG_MS = 24 * 60 * 60 * 1000;

function zuUtc(iso) {
    const [j, m, t] = String(iso).split('-').map(Number);
    return Date.UTC(j, m - 1, t);
}

function zuIso(ms) {
    return new Date(ms).toISOString().slice(0, 10);
}

function addiereTage(iso, tage) {
    return zuIso(zuUtc(iso) + tage * TAG_MS);
}

// Ostersonntag (Anonymous-Gregorian-Algorithmus), Rückgabe: UTC-Millisekunden
function ostersonntag(jahr) {
    const a = jahr % 19;
    const b = Math.floor(jahr / 100);
    const c = jahr % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const monat = Math.floor((h + l - 7 * m + 114) / 31);
    const tag = ((h + l - 7 * m + 114) % 31) + 1;
    return Date.UTC(jahr, monat - 1, tag);
}

export function istTargetGeschaeftstag(isoDatum) {
    const ms = zuUtc(isoDatum);
    const wochentag = new Date(ms).getUTCDay();
    if (wochentag === 0 || wochentag === 6) return false;
    const d = new Date(ms);
    const monat = d.getUTCMonth() + 1;
    const tag = d.getUTCDate();
    if (monat === 1 && tag === 1) return false;
    if (monat === 5 && tag === 1) return false;
    if (monat === 12 && (tag === 25 || tag === 26)) return false;
    const ostern = ostersonntag(d.getUTCFullYear());
    if (ms === ostern - 2 * TAG_MS || ms === ostern + TAG_MS) return false;
    return true;
}

export function naechsterGeschaeftstag(isoDatum) {
    let iso = isoDatum;
    while (!istTargetGeschaeftstag(iso)) iso = addiereTage(iso, 1);
    return iso;
}

// n Geschäftstage nach dem Datum (n >= 0); das Ausgangsdatum selbst muss kein Geschäftstag sein.
export function addiereGeschaeftstage(isoDatum, n) {
    let iso = isoDatum;
    let rest = Math.max(0, Math.trunc(n));
    while (rest > 0) {
        iso = addiereTage(iso, 1);
        if (istTargetGeschaeftstag(iso)) rest -= 1;
    }
    return iso;
}

// L7: nächster Geschäftstag ab max(Rechnungsdatum + Vorabankündigungsfrist, heute + 1 Geschäftstag)
export function fruehestesFaelligkeitsdatum(rechnungsdatum, vorabTage, heute) {
    const nachFrist = addiereTage(rechnungsdatum, Number(vorabTage) || 0);
    const fruehestens = addiereGeschaeftstage(heute, 1);
    return naechsterGeschaeftstag(nachFrist > fruehestens ? nachFrist : fruehestens);
}
