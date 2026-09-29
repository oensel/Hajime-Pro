// Mitgelieferte Urkunden-Schriften (SIL OFL, Dateien in public/fonts/urkunden/). Browser lädt sie
// per FontFace, der Server bettet dieselben Dateien per fontkit ein (urkundenRenderer.js).
export const URKUNDEN_SCHRIFTEN = [
    { id: 'noto-sans', anzeigename: 'Noto Sans', datei: 'NotoSans-Regular.ttf' },
    { id: 'noto-sans-bold', anzeigename: 'Noto Sans Fett', datei: 'NotoSans-Bold.ttf' },
    { id: 'noto-serif', anzeigename: 'Noto Serif', datei: 'NotoSerif-Regular.ttf' },
    { id: 'noto-serif-bold', anzeigename: 'Noto Serif Fett', datei: 'NotoSerif-Bold.ttf' },
    { id: 'great-vibes', anzeigename: 'Great Vibes (Schreibschrift)', datei: 'GreatVibes-Regular.ttf' },
    { id: 'cinzel', anzeigename: 'Cinzel (Titel)', datei: 'Cinzel-Regular.ttf' }
];

export const STANDARD_SCHRIFT_ID = 'noto-sans';

export function findeSchrift(id) {
    return URKUNDEN_SCHRIFTEN.find(s => s.id === id);
}
