// Funktionen je Turnier (Spalte turniere.funktionen, Migration 20261105100000). Framework- und DB-frei: Server
// (turnierController), menu.js und turnier.js (Browser, per import unter /js/shared/) und die Unit-Tests nutzen dieselben Regeln.
// Orga-Planer und Helfer-App hängen weiter an turniere.planungs_tools. Ein fehlender Schlüssel gilt als „an“, damit
// Bestandsturniere und per API angelegte Turniere unverändert alles zeigen; erst der Assistent in turnier.html schaltet aus.

export const FUNKTIONEN = ['urkunden', 'wettkampfplaene', 'anzeige', 'teilnehmer_app', 'video', 'streaming'];

function alsBoolean(wert) {
    return wert === true || wert === 1 || wert === '1' || wert === 'true';
}

/**
 * Macht aus Datenbankwert (Objekt oder JSON-Text) oder Request-Body ein vollständiges Objekt mit allen Schlüsseln.
 * Unbekannte Schlüssel entfallen. Live-Streaming setzt die Videoaufnahme voraus.
 * @returns {{urkunden: boolean, wettkampfplaene: boolean, anzeige: boolean, teilnehmer_app: boolean, video: boolean, streaming: boolean}}
 */
export function normalisiereFunktionen(roh) {
    let quelle = roh;
    if (typeof quelle === 'string') {
        try { quelle = JSON.parse(quelle); } catch { quelle = {}; }
    }
    if (!quelle || typeof quelle !== 'object' || Array.isArray(quelle)) quelle = {};
    const ergebnis = {};
    for (const schluessel of FUNKTIONEN) {
        const wert = quelle[schluessel];
        ergebnis[schluessel] = wert === undefined || wert === null || wert === '' ? true : alsBoolean(wert);
    }
    if (!ergebnis.video) ergebnis.streaming = false;
    return ergebnis;
}

/** Ist die Funktion für dieses Turnier eingeschaltet? `turnier` ist die Turnierzeile bzw. die API-Antwort. */
export function istFunktionAn(turnier, schluessel) {
    return normalisiereFunktionen(turnier && turnier.funktionen)[schluessel] !== false;
}
