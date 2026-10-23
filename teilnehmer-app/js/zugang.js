// Zugangscodes der Teilnehmer-App im Gerät: je Turnier der Code aus dem ausgehängten QR-Code (Spec docs/specs/2026-10-24-teilnehmer-app-zugang.md).
// Ohne Code liefert die Cloud nichts. Der Code steht nur hier (localStorage dieses Browsers) und wird bei jeder Abfrage im Kopf X-Live-Zugang gesendet;
// den Namen und das Datum merkt sich die App dazu, damit der Start auch ohne Verbindung die Turniere benennen kann.
// Eigener Präfix, den die Bereinigung der Turnierdaten (speicher.js, Präfix hajime-live:) nicht anfasst.
const PRAEFIX = 'hajime-live-zugang:';
export const CODE_MUSTER = /^[A-Za-z0-9_-]{22}$/;

const lager = () => { try { return window.localStorage; } catch { return null; } };

export function speichereZugang(key, code, { name = '', datum = '' } = {}) {
    const s = lager();
    if (!s || !CODE_MUSTER.test(String(code))) return false;
    try {
        s.setItem(`${PRAEFIX}${key}`, JSON.stringify({ code, name, datum }));
        return true;
    } catch { return false; }
}

export function holeZugang(key) {
    const s = lager();
    if (!s) return null;
    try {
        const eintrag = JSON.parse(s.getItem(`${PRAEFIX}${key}`));
        return eintrag && CODE_MUSTER.test(String(eintrag.code)) ? eintrag : null;
    } catch { return null; }
}

export function entferneZugang(key) {
    const s = lager();
    try { if (s) s.removeItem(`${PRAEFIX}${key}`); } catch { /* ohne Speicher */ }
}

/** Alle gemerkten Turniere, neueste zuerst: [{ key, name, datum }] (der Code gehört nicht in die Liste). */
export function listeZugaenge() {
    const s = lager();
    const ergebnis = [];
    if (!s) return ergebnis;
    try {
        for (let i = 0; i < s.length; i += 1) {
            const k = s.key(i);
            if (!k || !k.startsWith(PRAEFIX)) continue;
            const key = k.slice(PRAEFIX.length);
            const z = holeZugang(key);
            if (z) ergebnis.push({ key, name: z.name, datum: z.datum });
        }
    } catch { /* Speicher nicht verfügbar */ }
    return ergebnis.sort((a, b) => String(b.datum).localeCompare(String(a.datum)) || a.name.localeCompare(b.name));
}
