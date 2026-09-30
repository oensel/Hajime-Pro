// Waagerechte Linien der Urkunden, identisch im Editor (Fabric) und beim Rendern (pdf-lib).
// Linienfeld: { typ: 'linie', x, y, breite, staerke, stil, farbe } — y = Mitte der Linie, in pt.
export const LINIEN_STILE = [
    { id: 'durchgezogen', anzeigename: 'durchgezogen' },
    { id: 'gepunktet', anzeigename: 'gepunktet' },
    { id: 'gestrichelt', anzeigename: 'gestrichelt' }
];

// Strichmuster in pt (null = durchgezogen) und Linienende. Punkte entstehen aus Strichen der
// Länge 0 mit runden Enden, deshalb hängen Abstände von der Linienstärke ab.
export function linienMuster(stil, staerke) {
    if (stil === 'gepunktet') return { muster: [0, staerke * 2], kappe: 'round' };
    if (stil === 'gestrichelt') return { muster: [Math.max(3, staerke * 3), Math.max(2, staerke * 2)], kappe: 'butt' };
    return { muster: null, kappe: 'butt' };
}

export const istLinie = feld => feld?.typ === 'linie';
