// SEPA-Zeichensatz: a-z A-Z 0-9 / - ? : ( ) . , ' + und Leerzeichen (framework-frei).

const UMLAUTE = { 'ä': 'ae', 'ö': 'oe', 'ü': 'ue', 'ß': 'ss', 'Ä': 'Ae', 'Ö': 'Oe', 'Ü': 'Ue', '&': '+' };

export function sepaText(text, maxLaenge) {
    let s = '';
    for (const z of String(text ?? '')) {
        if (UMLAUTE[z]) s += UMLAUTE[z];
        else if (/[A-Za-z0-9/\-?:().,'+ ]/.test(z)) s += z;
        else s += ' ';
    }
    s = s.replace(/ {2,}/g, ' ').trim();
    if (Number.isInteger(maxLaenge) && maxLaenge >= 0) s = s.slice(0, maxLaenge).trim();
    return s;
}

export function sepaKennung(text, maxLaenge = 35) {
    return sepaText(text, Infinity).replace(/ /g, '').slice(0, maxLaenge);
}
