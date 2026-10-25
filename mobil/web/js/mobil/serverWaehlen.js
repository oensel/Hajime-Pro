// Start der Android-App mit Hallen-Server UND Cloud-Turnier gekoppelt (boot.js leitet hierher): erst im WLAN nach dem Hallen-Server
// sehen (er ist der bevorzugte Weg), sonst nach Rückfrage die Cloud nehmen. Die Wahl gilt bis die App geschlossen wird
// (sessionStorage); danach läuft die Browser-Laufzeit (boot.js) mit der gewählten Verbindung.
import { waehleServer } from '/js/shared/serverAuswahl.js';

const AKTIV = 'hajime_mobil_verbindung';
const VERBINDUNGEN = 'hajime_mobil_verbindungen';
const GEWAEHLT = 'hajime_mobil_gewaehlt';
const el = (id) => document.getElementById(id);

function lies(schluessel) {
    try { return JSON.parse(localStorage.getItem(schluessel)); } catch { return null; }
}

// Ist unter der gekoppelten Adresse ein aktiver (nicht Reserve-)Hallen-Server erreichbar?
async function hallenServerErreichbar(verbindung) {
    if (!verbindung || !verbindung.serverUrl) return false;
    try {
        const antwort = await fetch(`${verbindung.serverUrl}/api/sync/status`, { signal: AbortSignal.timeout(3000) });
        if (!antwort.ok) return false;
        const status = await antwort.json();
        return status.rolle === 'server' && status.modus !== 'secondary';
    } catch {
        return false;
    }
}

function frageCloud() {
    el('text').textContent = 'Kein Turnier-Server im WLAN gefunden. Mit der Cloud verbinden?';
    el('frage').style.display = '';
    return new Promise((fertig) => {
        el('jaBtn').addEventListener('click', () => fertig(true), { once: true });
        el('neinBtn').addEventListener('click', () => fertig(false), { once: true });
    });
}

const verbindungen = lies(VERBINDUNGEN) || {};
const wahl = await waehleServer({
    hallenServerErreichbar: await hallenServerErreichbar(verbindungen.hallenserver),
    cloud: verbindungen.cloud || null,
    frageCloud
});
// 'keiner': mit dem Hallen-Server weiterarbeiten, die Laufzeit repliziert, sobald er wieder erreichbar ist (lokaler Stand bleibt).
const aktiv = wahl === 'cloud' ? verbindungen.cloud : verbindungen.hallenserver;
if (aktiv) localStorage.setItem(AKTIV, JSON.stringify(aktiv));
sessionStorage.setItem(GEWAEHLT, '1');
location.replace('/client.html');
