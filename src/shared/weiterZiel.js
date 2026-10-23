// Ziel, zu dem login.html nach der Anmeldung weiterleitet (?weiter=…, z. B. aus der Mail "Turnier teilen").
// Nur Seiten dieser Anwendung sind erlaubt: ein relativer Pfad auf eine .html-Datei mit einfachen Query-Zeichen.
// Alles andere (andere Hosts, "//", Schemata, Backslashes, Pfade mit Ordnern) gilt als ungültig.
const ERLAUBT = /^\/[A-Za-z0-9_-]+\.html(\?[A-Za-z0-9_\-=&.%]*)?$/;

/** @returns {string|null} der Pfad, wenn er als Weiterleitungsziel erlaubt ist, sonst null */
export function sichereWeiterleitung(wert) {
    if (typeof wert !== 'string') return null;
    return ERLAUBT.test(wert) && wert.length <= 200 ? wert : null;
}

/** Link zur Turnier-Ansicht (Ziel der Mail "Turnier teilen"). */
export function turnierAnsichtPfad(turnierId) {
    return `/turnier-ansicht.html?id=${encodeURIComponent(turnierId)}`;
}

/** Anmeldeseite, die nach dem Login zu `pfad` weiterleitet (für Konten, die schon existieren). */
export function loginMitWeiterleitung(pfad) {
    return `/login.html?weiter=${encodeURIComponent(pfad)}`;
}
