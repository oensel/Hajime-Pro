// Anzeige des Update-Ablaufs (reine Funktionen, ohne Electron/DOM): Texte, Fortschrittsbalken und eine Konsolenausgabe
// für Installationen ohne Fenster (Linux-Dienst: Terminal bzw. journalctl). Fenster und App zeigen dieselben Texte.

export const MELDUNG = {
    suche: 'Suche nach Updates …',
    holeGit: (version) => `Hole Update ${version} aus git (GitHub-Release) …`,
    holeServer: (version) => `Hole Update ${version} vom Server …`,
    aktuell: (version) => `Kein Update: Version ${version} ist aktuell.`,
    keineVerbindung: (quelle, version) => `Keine Verbindung zu ${quelle} – starte Version ${version}.`,
    neustart: (sekunden) => `Update installiert – Neustart in ${sekunden} Sekunden …`
};

const mb = (bytes) => Math.round(bytes / 1048576 * 10) / 10;

// Textbalken: [██████░░░░] – anteil 0..1.
export function balken(anteil, breite = 20) {
    const a = Math.max(0, Math.min(1, Number.isFinite(anteil) ? anteil : 0));
    const voll = Math.round(a * breite);
    return `[${'█'.repeat(voll)}${'░'.repeat(breite - voll)}]`;
}

// "Lade 38,5 von 62 MB" (ohne Gesamtgröße nur der Stand).
export function ladeText({ geladen, gesamt }) {
    const zahl = (n) => String(mb(n)).replace('.', ',');
    return gesamt ? `${zahl(geladen)} von ${zahl(gesamt)} MB` : `${zahl(geladen)} MB`;
}

export function fortschrittsZeile({ text, geladen, gesamt }) {
    if (!gesamt) return `${text} ${ladeText({ geladen, gesamt })}`;
    return `${text} ${balken(geladen / gesamt)} ${Math.floor(geladen / gesamt * 100)} % (${ladeText({ geladen, gesamt })})`;
}

// Schrittanzeige beim Installieren: "(2/4) Installiere Abhängigkeiten … [██████████░░░░░░░░░░]".
export function schrittZeile(nr, gesamt, text) {
    return `(${nr}/${gesamt}) ${text} ${balken((nr - 1) / gesamt, 10)}`;
}

/**
 * Konsolenausgabe: meldung() schreibt eine Zeile, fortschritt() zeigt einen Balken — im Terminal in einer sich
 * überschreibenden Zeile, sonst (journald, Logdatei) nur in 10-%-Schritten, damit das Log nicht überläuft.
 */
export function erzeugeKonsolenAnzeige({ schreibe = (s) => process.stdout.write(s), tty = !!process.stdout.isTTY, praefix = '[Selbst-Update] ' } = {}) {
    let letzteStufe = -1;
    let offeneZeile = false;
    const abschliessen = () => { if (offeneZeile) { schreibe('\n'); offeneZeile = false; } };
    return {
        meldung(text) {
            abschliessen();
            letzteStufe = -1;
            schreibe(`${praefix}${text}\n`);
        },
        fortschritt({ text, geladen, gesamt }) {
            const zeile = `${praefix}${fortschrittsZeile({ text, geladen, gesamt })}`;
            if (tty) {
                schreibe(`\r${zeile}\x1b[K`);
                offeneZeile = true;
                return;
            }
            const stufe = gesamt ? Math.floor(geladen / gesamt * 10) : Math.floor(geladen / (50 * 1048576));
            if (stufe === letzteStufe) return;
            letzteStufe = stufe;
            schreibe(`${zeile}\n`);
        },
        ende: abschliessen
    };
}
