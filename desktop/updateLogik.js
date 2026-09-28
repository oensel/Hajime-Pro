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
