// Persistente, dateibasierte Ablage der während des Vollablauf-Testlaufs in der ECHTEN
// Online-Cloud-DB erzeugten Turnier-IDs. Bewusst eine Datei statt nur ein In-Memory-Objekt im
// Testprozess: global-teardown.js läuft in einem eigenen Prozess und muss auch dann aufräumen
// können, wenn ein test()-Schritt mitten im Lauf fehlschlägt/abbricht (siehe Plan, Abschnitt
// "Cleanup/Safety-Net"). Jede Schreib-Operation ist synchron und überschreibt die Datei komplett —
// bei diesem Datenvolumen (eine Handvoll IDs) unproblematisch und robuster als nebenläufige
// Zugriffe zu koordinieren (die Test-Suite läuft ohnehin seriell, ein Worker).
//
// WICHTIG (siehe Vorfall-Historie in helpers.js): trackt bewusst NUR turnierIds, keine
// Vereins-/Benutzer-IDs mehr — jan/tim/tom@test.de sind echte, dauerhafte Accounts des Nutzers
// (nicht Testdaten dieses Laufs), dieser Test loggt sich nur mit ihnen ein, legt für sie weder
// Verein noch Account an und darf sie deshalb unter keinen Umständen wieder löschen können.
import { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const RUN_STATE_PATH = path.resolve(__dirname, '.run-state.json');

// Eindeutiges Präfix für alle in diesem Lauf angelegten Turnier-Bezeichnungen — zweite Sicherung
// für global-teardown.js (siehe dort), falls einzelne IDs aus irgendeinem Grund nicht in der
// Statusdatei gelandet sind (z.B. Absturz zwischen DB-Insert und writeState()-Aufruf).
export const MARKER_PREFIX = `[E2E-VOLLABLAUF ${new Date().toISOString().replace(/[:.]/g, '-')}]`;

function leererStatus() {
    return { markerPrefix: MARKER_PREFIX, turnierIds: [] };
}

export function liesStatus() {
    if (!existsSync(RUN_STATE_PATH)) return leererStatus();
    try {
        return JSON.parse(readFileSync(RUN_STATE_PATH, 'utf-8'));
    } catch {
        return leererStatus();
    }
}

function schreibeStatus(status) {
    writeFileSync(RUN_STATE_PATH, JSON.stringify(status, null, 2), 'utf-8');
}

export function initialisiereStatus() {
    schreibeStatus(leererStatus());
}

// Merkt eine einzelne ID in der jeweiligen Kategorie sofort persistent vor (siehe Datei-Kommentar:
// so früh wie möglich nach jeder Erzeug-Aktion aufrufen, nicht erst am Ende des Tests).
export function merkeId(kategorie, id) {
    const status = liesStatus();
    if (!status[kategorie]) status[kategorie] = [];
    if (!status[kategorie].includes(id)) status[kategorie].push(id);
    schreibeStatus(status);
}
