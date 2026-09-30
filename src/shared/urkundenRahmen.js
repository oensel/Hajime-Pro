// Mitgelieferte Standard-Designs (nur Rahmen, A4 hoch) für neue Urkunden-Vorlagen. Die PDFs liegen
// in public/urkunden-rahmen/ und werden von scripts/erzeuge-urkunden-rahmen.mjs erzeugt.
export const URKUNDEN_RAHMEN = [
    { id: 'klassisch', name: 'Klassisch', datei: 'klassisch.pdf' },
    { id: 'ornament', name: 'Ornament', datei: 'ornament.pdf' },
    { id: 'modern', name: 'Modern', datei: 'modern.pdf' },
    { id: 'judo', name: 'Judo', datei: 'judo.pdf' },
    { id: 'schlicht', name: 'Schlicht', datei: 'schlicht.pdf' }
];

export function findeRahmen(id) {
    return URKUNDEN_RAHMEN.find(r => r.id === id);
}
