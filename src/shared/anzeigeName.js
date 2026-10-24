// Namen und Texte der Anzeigetafel am Fernseher (anzeige.html ohne ?controls=1).
// Reine Funktionen ohne DOM, damit sie sich testen lassen und am Server wie im Browser/in der App gleich laufen.

/**
 * Kürzt "Nachname, Vorname" auf "Nachname, V." ("Lückmann, Patrick" → "Lückmann, P."), der Nachname steht also immer vorn.
 * Mehrere Vornamen zählen nur mit dem ersten Buchstaben des ersten Vornamens, alles nach dem ersten Komma
 * ist Vorname ("Müller, Hans, Dr." → "Müller, H."). Ohne Komma oder ohne Vornamen bleibt der Text unverändert.
 */
export function kuerzeName(name) {
    const text = String(name ?? '').trim();
    const stelle = text.indexOf(',');
    if (stelle <= 0) return text;
    const nachname = text.slice(0, stelle).trim();
    const vorname = text.slice(stelle + 1).trim();
    if (!nachname || !vorname) return text;
    return `${nachname}, ${Array.from(vorname)[0].toLocaleUpperCase('de-DE')}.`;
}

/** Kurzform der Meldung für den Fernseher: "NICHT ANGETRETEN" wird "N. ANGETRETEN", alles andere bleibt. */
export function kurzeMeldung(text) {
    return text === 'NICHT ANGETRETEN' ? 'N. ANGETRETEN' : text;
}

/**
 * Schriftgröße (in Pixeln), mit der ein Text in die verfügbare Breite passt, oder null, wenn er schon passt.
 * `inhaltsbreite` ist die Breite des Textes bei `schriftgroesse`, `verfuegbar` die Breite des Platzes.
 */
export function angepasstSchrift(schriftgroesse, inhaltsbreite, verfuegbar) {
    if (!(schriftgroesse > 0) || !(inhaltsbreite > verfuegbar) || !(verfuegbar > 0)) return null;
    return Math.max(1, Math.floor(schriftgroesse * verfuegbar / inhaltsbreite));
}
