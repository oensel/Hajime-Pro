// Altersklassenabhängige Kampfregeln (DJB-Wettkampfordnung, ergänzt die IJF-Wettkampfregeln).
// Reine Funktionen, server- (Pool-Bildung) und client-seitig (Steuerung über /js/shared) nutzbar.

// "U<Zahl>" -> Zahl, sonst null (Frauen, Männer, Ü30, frei benannte Klassen).
function uZahl(altersklasse) {
    const match = String(altersklasse || '').trim().match(/^U\s*(\d+)$/i);
    return match ? parseInt(match[1], 10) : null;
}

// DJB-Wettkampfordnung Art. 3.12.9: Golden Score ist altersklassenabhängig — unterhalb der U15
// (U9/U11/U13) gibt es gar keinen Golden Score, sondern sofortige Hantei-Entscheidung bei
// Gleichstand; bei der U15 ist Golden Score auf 3 Minuten (180 s) begrenzt, danach Hantei; ab
// U18 gilt die unbegrenzte IJF-Regel ohne Hantei. Nicht erkannte/freie Klassen (Frauen, Männer,
// Ü30 etc.) fallen auf die unbegrenzte Erwachsenen-Regel zurück.
export function ermittleGoldenScoreEinstellungen(altersklasse) {
    const jahre = uZahl(altersklasse);
    if (jahre !== null) {
        if (jahre <= 13) return { aktiv: false, maxSekunden: null };
        if (jahre === 15) return { aktiv: true, maxSekunden: 180 };
    }
    return { aktiv: true, maxSekunden: null };
}

// DJB-Wettkampfordnung Art. 3.3.1: Ü30 kämpft 3 Minuten, über 59 Jahre 2,5 Minuten. Ü30 ist keine
// Standardklasse in altersklassen.json, sondern wird im Turnier frei benannt ("Ü30", "Ü60",
// "Veteranen" = Ü30, siehe ermittleAltersklasse in teilnehmerController.js). null = keine Ü-Klasse.
export function ermittleKampfzeitUeKlasse(altersklasse) {
    const name = String(altersklasse || '');
    const ue = name.match(/Ü\s*(\d+)/i);
    if (!ue && !/veteranen/i.test(name)) return null;
    const abAlter = ue ? parseInt(ue[1], 10) : 30;
    return abAlter >= 60 ? 150 : 180;
}

// Medizinische Versorgung: DJB-Wettkampfordnung Art. 3.12.10 gibt nur der U11, U13 und U15 zwei
// Untersuchungen, die dritte beendet den Kampf durch Kiken-gachi. Ab U18 gilt IJF Art. 20: ruft der
// Kämpfer oder sein Arzt den Arzt, endet der Kampf sofort durch Kiken-gachi (0 freie Versorgungen).
// Ohne Altersklasse (Kampf ohne Pool-Kontext) bleibt es bei den zwei freien Versorgungen.
export function ermittleFreieBehandlungen(altersklasse) {
    if (!String(altersklasse || '').trim()) return 2;
    const jahre = uZahl(altersklasse);
    return jahre !== null && jahre <= 15 ? 2 : 0;
}
