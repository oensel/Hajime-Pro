// Mitgelieferte Urkunden-Schriften (SIL OFL, Dateien in public/fonts/urkunden/). Browser lädt sie
// per FontFace, der Server bettet dieselben Dateien per fontkit ein (urkundenRenderer.js).
// Ein Feld speichert die Schrift-ID (= ein Schnitt); der Editor zeigt Familie + Stil daraus.
export const URKUNDEN_SCHRIFTEN = [
    { id: 'noto-sans', familie: 'Noto Sans', stil: 'normal', anzeigename: 'Noto Sans', datei: 'NotoSans-Regular.ttf' },
    { id: 'noto-sans-bold', familie: 'Noto Sans', stil: 'fett', anzeigename: 'Noto Sans Fett', datei: 'NotoSans-Bold.ttf' },
    { id: 'noto-sans-italic', familie: 'Noto Sans', stil: 'kursiv', anzeigename: 'Noto Sans Kursiv', datei: 'NotoSans-Italic.ttf' },
    { id: 'noto-serif', familie: 'Noto Serif', stil: 'normal', anzeigename: 'Noto Serif', datei: 'NotoSerif-Regular.ttf' },
    { id: 'noto-serif-bold', familie: 'Noto Serif', stil: 'fett', anzeigename: 'Noto Serif Fett', datei: 'NotoSerif-Bold.ttf' },
    { id: 'noto-serif-italic', familie: 'Noto Serif', stil: 'kursiv', anzeigename: 'Noto Serif Kursiv', datei: 'NotoSerif-Italic.ttf' },
    { id: 'great-vibes', familie: 'Great Vibes (Schreibschrift)', stil: 'normal', anzeigename: 'Great Vibes (Schreibschrift)', datei: 'GreatVibes-Regular.ttf' },
    { id: 'cinzel', familie: 'Cinzel (Titel)', stil: 'normal', anzeigename: 'Cinzel (Titel)', datei: 'Cinzel-Regular.ttf' },
    { id: 'pinyon-script', familie: 'Pinyon Script (Schreibschrift)', stil: 'normal', anzeigename: 'Pinyon Script (Schreibschrift)', datei: 'PinyonScript-Regular.ttf' },
    { id: 'alex-brush', familie: 'Alex Brush (Schreibschrift)', stil: 'normal', anzeigename: 'Alex Brush (Schreibschrift)', datei: 'AlexBrush-Regular.ttf' },
    { id: 'unifraktur-maguntia', familie: 'UnifrakturMaguntia (Fraktur)', stil: 'normal', anzeigename: 'UnifrakturMaguntia (Fraktur)', datei: 'UnifrakturMaguntia-Book.ttf' }
];

export const STANDARD_SCHRIFT_ID = 'noto-sans';

export const SCHRIFT_STILE = [
    { id: 'normal', anzeigename: 'Normal' },
    { id: 'fett', anzeigename: 'Fett' },
    { id: 'kursiv', anzeigename: 'Kursiv' }
];

export function findeSchrift(id) {
    return URKUNDEN_SCHRIFTEN.find(s => s.id === id);
}

// Familien in der Reihenfolge der Liste, je einmal.
export const SCHRIFT_FAMILIEN = [...new Set(URKUNDEN_SCHRIFTEN.map(s => s.familie))];

export const stileDerFamilie = familie => URKUNDEN_SCHRIFTEN.filter(s => s.familie === familie).map(s => s.stil);

// Schnitt zu Familie + Stil; gibt es den Stil in der Familie nicht, den normalen Schnitt.
export function schriftFuer(familie, stil) {
    const schnitte = URKUNDEN_SCHRIFTEN.filter(s => s.familie === familie);
    return (schnitte.find(s => s.stil === stil) || schnitte.find(s => s.stil === 'normal') || schnitte[0])?.id;
}
