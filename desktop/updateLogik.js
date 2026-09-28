// Reine Entscheidungslogik des Desktop-Client-Updaters (Spec Desktop-Client Abschnitt 6) — ohne
// Electron-, Netz- oder Dateizugriff, damit sie per node:test prüfbar ist.
import { createHash, verify } from 'crypto';

export const MAX_UPDATE_VERSUCHE = 2;

export function plattformSchluessel(platform, arch) {
    if (platform === 'darwin') return 'darwin-universal';
    if (platform === 'win32' && arch === 'x64') return 'win32-x64';
    if (platform === 'linux' && arch === 'x64') return 'linux-x64';
    return null;
}

export function signaturNachricht({ datei, version, sha256 }) {
    return `${datei}\n${version}\n${sha256}`;
}

export function sha256Hex(puffer) {
    return createHash('sha256').update(puffer).digest('hex');
}

export function pruefeDatei({ puffer, eintrag, version, oeffentlicherSchluessel }) {
    if (sha256Hex(puffer) !== eintrag.sha256) return { ok: false, grund: 'sha256' };
    let gueltig = false;
    try {
        gueltig = verify(null, Buffer.from(signaturNachricht({ datei: eintrag.datei, version, sha256: eintrag.sha256 })),
            oeffentlicherSchluessel, Buffer.from(String(eintrag.signatur), 'base64'));
    } catch {
        gueltig = false;
    }
    return gueltig ? { ok: true } : { ok: false, grund: 'signatur' };
}

// Versionskopplung: jede Abweichung ist ein Update (auch nach unten). Je Zielversion höchstens
// MAX_UPDATE_VERSUCHE, damit ein kaputtes Update nicht bei jedem Start erneut scheitert.
export function entscheideUpdate({ eigeneVersion, serverVersion, versuche }) {
    if (!serverVersion || serverVersion === eigeneVersion) return 'kein';
    return (versuche[serverVersion] || 0) >= MAX_UPDATE_VERSUCHE ? 'aufgegeben' : 'aktualisieren';
}

export function waehleServer(kandidaten) {
    if (!kandidaten.length) return null;
    return kandidaten.find(k => k.rolle === 'master') || kandidaten[0];
}

// Adresse eines per mDNS gefundenen Dienstes: bevorzugt die Absenderadresse der Antwort
// (referer.address) — bonjour-service kündigt A-Records für ALLE Netzwerkkarten des Servers an
// (auch docker0/VM-Adapter), die erste davon ist oft aus dem Hallen-WLAN nicht erreichbar.
const IPV4 = /^\d+\.\d+\.\d+\.\d+$/;
export function adresseAusDienst(dienst) {
    const absender = dienst && dienst.referer && dienst.referer.address;
    if (absender && IPV4.test(absender)) return absender;
    return ((dienst && dienst.addresses) || []).find(a => IPV4.test(a)) || null;
}

// Manuelle Server-Adresse aus dem Start-Fenster (Fallback, wenn mDNS blockiert ist): akzeptiert
// "192.168.1.10", "192.168.1.10:3000", "turnier.local" oder eine volle http(s)-URL und liefert
// http(s)://host:port ohne Pfad — oder null bei ungültiger Eingabe. Ohne Portangabe gilt
// STANDARD_PORT (der Server-PORT, den auch die mDNS-Ankündigung liefert); Port 80 leitet nur per
// 302 weiter und taugt nicht für die Replikation.
export const STANDARD_PORT = 3000;
export function normalisiereServerAdresse(eingabe) {
    const text = String(eingabe || '').trim();
    if (!text) return null;
    const mitSchema = /^[a-z][a-z0-9+.-]*:\/\//i.test(text);
    if (mitSchema && !/^https?:\/\//i.test(text)) return null;
    let url;
    try { url = new URL(mitSchema ? text : `http://${text}`); } catch { return null; }
    if (!url.hostname || url.username || url.password) return null;
    const port = url.port || String(STANDARD_PORT);
    return `${url.protocol}//${url.hostname}:${port}`;
}
