// Fragebogen „Ausstattung“ im Assistenten für neue Turniere (turnier.html, Schritt 4). Framework- und DB-frei:
// turnier.js (Browser, per import unter /js/shared/) und die Unit-Tests nutzen dieselben Regeln.
// Jede Funktion bleibt gesperrt, bis die passende Frage mit „Ja“ beantwortet ist; „Nein“ und unbeantwortet gelten als aus.
// Folgefragen erscheinen nur, wenn die vorige Antwort sie sinnvoll macht (ohne WLAN gibt es kein Internet, keine
// Teilnehmer-App und kein Live-Streaming, ohne USB-Kameras kein Video).

export const FRAGEN = [
    { id: 'orga', text: 'Möchten Sie die Vorbereitung mit Orga-Planer und Helfern organisieren?', hinweis: 'Checkliste mit Fristen und Helferplan, Helfer melden sich per App.' },
    { id: 'drucker', text: 'Haben Sie in der Halle einen Drucker?', hinweis: 'Für Urkunden und Wettkampfpläne direkt vor Ort.' },
    { id: 'anzeige', text: 'Wollen Sie den Teilnehmern per Monitor/Beamer Informationen anzeigen?', hinweis: 'Seiten „Wer kämpft wo“ und „Dashboard“.' },
    { id: 'pc', text: 'Haben Sie an jeder Wettkampffläche einen PC oder ein Notebook?', hinweis: 'Für Anzeigetafel und Steuerung der Kämpfe an der Matte.' },
    { id: 'kamera', text: 'Haben Sie USB-Kameras an den Wettkampfflächen?', folgeVon: 'pc', sichtbar: (a) => a.pc === 'ja' },
    { id: 'wlan', text: 'Haben Sie in der Halle WLAN?' },
    { id: 'internet', text: 'Haben Sie in der Halle Internetzugang für das WLAN oder den Server?', folgeVon: 'wlan', sichtbar: (a) => a.wlan === 'ja' },
    { id: 'app', text: 'Wollen Sie die Teilnehmer-App nutzen?', hinweis: 'Eltern und Trainer sehen Pools und Kämpfe live auf dem Handy.', folgeVon: 'internet', sichtbar: (a) => a.internet === 'ja' },
    { id: 'stream', text: 'Wollen Sie Live-Streaming nutzen?', hinweis: 'Live-Bild aller Matten auf einem Bildschirm.', folgeVon: 'wlan', sichtbar: (a) => a.kamera === 'ja' && a.wlan === 'ja' }
];

// Was die Antworten freischalten. `orga` ist die Spalte planungs_tools, alle anderen stehen in turniere.funktionen.
// `gesperrt` liefert true, wenn eine frühere Antwort die Funktion ausschließt.
export const AUSSTATTUNG = [
    { id: 'orga', frage: 'orga', name: 'Orga-Planer und Helfer-App', icon: 'checklist', gesperrt: () => false },
    { id: 'urkunden', frage: 'drucker', name: 'Urkunden-Druck', icon: 'workspace_premium', gesperrt: (a) => a.drucker === 'nein' },
    { id: 'wettkampfplaene', frage: 'drucker', name: 'Wettkampfpläne drucken', icon: 'print', gesperrt: (a) => a.drucker === 'nein' },
    { id: 'anzeige', frage: 'anzeige', name: 'Wer kämpft wo und Dashboard', icon: 'connected_tv', gesperrt: () => false },
    { id: 'teilnehmer_app', frage: 'app', name: 'Teilnehmer-App', icon: 'smartphone', gesperrt: (a) => a.wlan === 'nein' || a.internet === 'nein' },
    { id: 'video', frage: 'kamera', name: 'Videoaufnahme und Archiv', icon: 'videocam', gesperrt: (a) => a.pc === 'nein' || a.kamera === 'nein' },
    { id: 'streaming', frage: 'stream', name: 'Live-Streaming', icon: 'podcasts', gesperrt: (a) => a.pc === 'nein' || a.kamera === 'nein' || a.wlan === 'nein' }
];

export function istFrageSichtbar(frage, antworten) {
    return !frage.sichtbar || frage.sichtbar(antworten);
}

/** Entfernt Antworten auf Fragen, die nicht (mehr) gestellt werden, und alles außer „ja“/„nein“. */
export function bereinigeAntworten(antworten) {
    const bereinigt = {};
    for (const frage of FRAGEN) {
        const antwort = antworten && antworten[frage.id];
        if ((antwort === 'ja' || antwort === 'nein') && istFrageSichtbar(frage, bereinigt)) bereinigt[frage.id] = antwort;
    }
    return bereinigt;
}

/** Fragen, die gerade gestellt werden, und wie viele davon schon beantwortet sind. */
export function offeneFragen(antworten) {
    const sichtbar = FRAGEN.filter(f => istFrageSichtbar(f, antworten));
    return { fragen: sichtbar, beantwortet: sichtbar.filter(f => antworten[f.id] === 'ja' || antworten[f.id] === 'nein').length };
}

/** 'offen' (noch keine Antwort), 'gesperrt' (Nein oder ausgeschlossen) oder 'frei' (Ja). */
export function zustandAusstattung(eintrag, antworten) {
    if (eintrag.gesperrt(antworten)) return 'gesperrt';
    const antwort = antworten[eintrag.frage];
    if (antwort === 'ja') return 'frei';
    if (antwort === 'nein') return 'gesperrt';
    return 'offen';
}

/**
 * Zustand der Schalter zu den Antworten: { [id]: { an, aktiv, zustand } }.
 * - frei (Ja): aktiv und an, außer der Nutzer hat die Funktion in `abgewaehlt` wieder ausgeschaltet
 * - gesperrt (Nein oder ausgeschlossen): aus und nicht bedienbar
 * - offen (noch nicht beantwortet): beim Anlegen (`bisher` = null) aus und gesperrt; beim Bearbeiten (`bisher` = bisheriger
 *   Stand je Funktion) bleibt der Stand erhalten und der Schalter bedienbar
 * Live-Streaming setzt die Videoaufnahme voraus.
 */
export function berechneSchalter(antworten, { abgewaehlt = {}, bisher = null } = {}) {
    const ergebnis = {};
    for (const eintrag of AUSSTATTUNG) {
        const zustand = zustandAusstattung(eintrag, antworten);
        let an = false;
        let aktiv = false;
        if (zustand === 'frei') {
            an = abgewaehlt[eintrag.id] !== true;
            aktiv = true;
        } else if (zustand === 'offen' && bisher) {
            an = !!bisher[eintrag.id];
            aktiv = true;
        }
        ergebnis[eintrag.id] = { an, aktiv, zustand };
    }
    if (!ergebnis.video.an) {
        ergebnis.streaming.an = false;
        ergebnis.streaming.aktiv = false;
    }
    return ergebnis;
}

/**
 * Beim Öffnen eines gespeicherten Turniers: Funktionen, die laut Antwort frei wären, aber ausgeschaltet gespeichert sind,
 * gelten als abgewählt (sonst würde das Öffnen sie wieder einschalten).
 */
export function ermittleAbgewaehlt(antworten, gespeichert) {
    const abgewaehlt = {};
    for (const eintrag of AUSSTATTUNG) {
        if (zustandAusstattung(eintrag, antworten) === 'frei' && !gespeichert[eintrag.id]) abgewaehlt[eintrag.id] = true;
    }
    return abgewaehlt;
}

/**
 * Schaltet aus den Antworten die Funktionen ein (Anlegen). `abgewaehlt` = Funktionen, die der Nutzer trotz „Ja“ wieder ausgeschaltet hat.
 * @returns {{ planungs_tools: boolean, funktionen: Record<string, boolean> }} (streaming bleibt ohne video aus)
 */
export function waehleFunktionen(antworten, abgewaehlt = {}) {
    const schalter = berechneSchalter(antworten, { abgewaehlt });
    const an = Object.fromEntries(Object.entries(schalter).map(([id, werte]) => [id, werte.an]));
    const { orga, ...funktionen } = an;
    return { planungs_tools: orga, funktionen };
}
