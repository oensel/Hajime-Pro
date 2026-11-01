// Standard-Altersklassen nach Alter im Wettkampfjahr (NWJV-Tabelle "Alters- und Gewichtsklassen",
// maßgeblich ist der Jahrgang: Alter = Wettkampfjahr - Geburtsjahr). Die Klassen überlappen an
// ihren Rändern (Übergangsrecht/Doppelstartrecht): z.B. 2026 ist der Jahrgang 2016 ältester U11- und
// jüngster U13-Jahrgang, 2014 ältester U13- und jüngster U15-Jahrgang. Ein Judoka wird zuerst in
// die jüngere Klasse eingeordnet; wird diese im Turnier nicht ausgetragen, in die ältere.
// Gemeinsam genutzt von teilnehmerController.js (Import/Anlage) und waage-modal.js (Dialog).

// U9 ist keine NWJV-Klasse und reicht bewusst nur bis 7 (keine Überlappung mit der U11).
const STANDARD_ALTERSSPANNEN = [
    { id: 'U9', von: 0, bis: 7 },
    { id: 'U11', von: 8, bis: 10 },
    { id: 'U13', von: 10, bis: 12 },
    { id: 'U15', von: 12, bis: 14 },
    { id: 'U18', von: 15, bis: 17 },
    { id: 'U21', von: 17, bis: 20 },
    { id: 'Erwachsene', von: 17, bis: Infinity }
];

const erwachsenenKlasse = (geschlecht) => geschlecht === 'weiblich' ? 'Frauen' : (geschlecht === 'mixed' ? 'Mixed' : 'Männer');

// Alle Standardklassen, in denen ein Judoka dieses Alters starten darf, jüngste zuerst.
export function standardAltersklassenFuerAlter(alter, geschlecht) {
    if (!Number.isFinite(alter) || alter < 0) return [];
    return STANDARD_ALTERSSPANNEN
        .filter(s => alter >= s.von && alter <= s.bis)
        .map(s => s.id === 'Erwachsene' ? erwachsenenKlasse(geschlecht) : s.id);
}

// Erste der möglichen Standardklassen, die das Turnier austrägt (istAktiviert), sonst ''.
export function waehleStandardAltersklasse(alter, geschlecht, istAktiviert) {
    return standardAltersklassenFuerAlter(alter, geschlecht).find(id => istAktiviert(id)) || '';
}

// "2014–2016" für die Standardklasse im Wettkampfjahr; '' für unbekannte/frei benannte Klassen.
export function jahrgaengeText(id, wettkampfJahr) {
    const spanne = STANDARD_ALTERSSPANNEN.find(s => s.id === id)
        || (['Männer', 'Frauen', 'Mixed'].includes(id) ? STANDARD_ALTERSSPANNEN.find(s => s.id === 'Erwachsene') : null);
    if (!spanne || !wettkampfJahr) return '';
    const juengster = wettkampfJahr - spanne.von;
    if (spanne.bis === Infinity) return `bis ${juengster}`;
    return `${wettkampfJahr - spanne.bis}–${juengster}`;
}
