// Text-Logik der Urkunden, identisch im Editor (Browser) und beim Rendern (Server).
export const PLATZHALTER = ['Name', 'Verein', 'Platzierung', 'Altersklasse', 'Geschlecht', 'Gewichtsklasse', 'Mannschaft'];

// Unbekannte {…} bleiben stehen, bekannte ohne Wert werden leer.
export function ersetzePlatzhalter(text, datensatz) {
    return text.replace(/\{([^{}]+)\}/g, (roh, schluessel) =>
        Object.prototype.hasOwnProperty.call(datensatz, schluessel) ? String(datensatz[schluessel] ?? '') : roh);
}

// Verkleinert in 0,5-pt-Schritten, höchstens bis 50 % der Ausgangsgröße.
// misstBreite(text, groesse) wird injiziert (Browser: Canvas, Server: pdf-lib-Font).
export function passeGroesseAn(text, groesse, breite, misstBreite) {
    const minimum = groesse / 2;
    let g = groesse;
    while (misstBreite(text, g) > breite && g - 0.5 >= minimum) g -= 0.5;
    return { groesse: g, passt: misstBreite(text, g) <= breite };
}

export function berechneX(ausrichtung, x, breite, textBreite) {
    if (ausrichtung === 'zentriert') return x + (breite - textBreite) / 2;
    if (ausrichtung === 'rechts') return x + breite - textBreite;
    return x;
}

export function platzierungsText(platz) {
    return platz ? `${platz}. Platz` : 'Teilnahme';
}

export function geschlechtText(g) {
    if (g === 'm') return 'männlich';
    if (g === 'w') return 'weiblich';
    return g || '';
}
