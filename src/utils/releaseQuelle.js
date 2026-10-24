// Woher ein Server seine Updates und Client-Dateien holt (Spec docs/specs/2026-10-24-downloads-ueber-cloud-design.md).
// Hat der Server einen Geräteschlüssel der Cloud (Datei <Datenverzeichnis>/release-schluessel oder RELEASE_SCHLUESSEL), kommt
// alles aus der Cloud (/api/releases/v1, dieselbe Form wie die GitHub-API). Ohne Schlüssel gilt wie bisher das öffentliche
// GitHub-Repository (Übergangszeit: bestehende Installationen aktualisieren sich weiter, bis sie einen Schlüssel haben).
// Der Schlüssel entsteht ohne Handarbeit: aus dem Einlösecode im Dateinamen des Installers (loeseEinloesecodeEin) oder bei
// der ersten Anmeldung an der Cloud („Turnier aus der Cloud holen“, siehe cloudRoutes.js).
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs';
import path from 'path';

export const GITHUB_STANDARD_REPO = 'oensel/Hajime-Pro-Releases';
export const SCHLUESSEL_DATEI = 'release-schluessel';
export const FAKADE_PFAD = '/api/releases/v1';

// Einlösecode im Dateinamen: Hajime-Pro-Server-1.2.3-win-x64.k7Hq9x2Lm4Ab3Cd5.exe (16 Zeichen, Buchstaben und Ziffern).
const CODE_IM_NAMEN = /\.([A-Za-z0-9]{16})\.(?:exe|AppImage|apk|deb|dmg|zip)$/i;

export function leseCodeAusDateiname(name) {
    const treffer = CODE_IM_NAMEN.exec(String(name || '').trim());
    return treffer ? treffer[1] : null;
}

function normalisiereUrl(roh) {
    try {
        const url = new URL(String(roh || '').trim());
        if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
        return url.origin + url.pathname.replace(/\/+$/, '');
    } catch {
        return null;
    }
}

function liesJsonDatei(datei) {
    try { return JSON.parse(readFileSync(datei, 'utf8')) || {}; } catch { return {}; }
}

/** Adresse der Cloud: RELEASE_URL / CLOUD_URL, dann `cloudUrl` in <Datenverzeichnis>/update.json, dann die ins Paket gelegte Standarddatei. */
export function liesCloudUrl({ env = process.env, datenDir = '', standardDatei = '' } = {}) {
    const ausEnv = normalisiereUrl(env.RELEASE_URL) || normalisiereUrl(env.CLOUD_URL);
    if (ausEnv) return ausEnv;
    if (datenDir) {
        const ausKonfig = normalisiereUrl(liesJsonDatei(path.join(datenDir, 'update.json')).cloudUrl);
        if (ausKonfig) return ausKonfig;
    }
    if (standardDatei && existsSync(standardDatei)) {
        try { return normalisiereUrl(readFileSync(standardDatei, 'utf8').split(/\r?\n/)[0]); } catch { /* keine Standardadresse */ }
    }
    return null;
}

export function liesGeraeteSchluessel({ env = process.env, datenDir = '' } = {}) {
    if (env.RELEASE_SCHLUESSEL && String(env.RELEASE_SCHLUESSEL).trim()) return String(env.RELEASE_SCHLUESSEL).trim();
    if (!datenDir) return '';
    try { return readFileSync(path.join(datenDir, SCHLUESSEL_DATEI), 'utf8').trim(); } catch { return ''; }
}

export function speichereGeraeteSchluessel(datenDir, schluessel) {
    mkdirSync(datenDir, { recursive: true });
    const ziel = path.join(datenDir, SCHLUESSEL_DATEI);
    writeFileSync(`${ziel}.tmp`, `${schluessel}\n`, { mode: 0o600 });
    renameSync(`${ziel}.tmp`, ziel);
    try { chmodSync(ziel, 0o600); } catch { /* Windows kennt keine Unix-Rechte */ }
}

/**
 * Quelle für Updates: { art, repo, token, apiBasis }. Mit Schlüssel und Cloud-Adresse die Cloud, sonst GitHub (Übergangszeit).
 * githubRepo/githubToken sind die bisherigen Einstellungen (CLIENT_RELEASE_REPO/-TOKEN, update.json).
 */
export function ermittleReleaseQuelle({ env = process.env, datenDir = '', standardDatei = '', githubRepo = '', githubToken = '' } = {}) {
    const schluessel = liesGeraeteSchluessel({ env, datenDir });
    const cloud = liesCloudUrl({ env, datenDir, standardDatei });
    if (schluessel && cloud) return { art: 'cloud', repo: 'cloud', token: schluessel, apiBasis: `${cloud}${FAKADE_PFAD}` };
    return { art: 'github', repo: githubRepo || env.CLIENT_RELEASE_REPO || GITHUB_STANDARD_REPO, token: githubToken || env.CLIENT_RELEASE_TOKEN || env.GITHUB_TOKEN || '', apiBasis: undefined };
}

/**
 * Tauscht einen Einlösecode (aus dem Dateinamen des Installers) gegen den Geräteschlüssel.
 * Liefert 'vorhanden' (es gibt schon einen Schlüssel), 'eingeloest', 'kein-code' oder 'fehler' (+ grund). Wirft nie.
 * Bei einem endgültig abgelehnten Code (4xx) wird der Code verworfen, bei Netzfehlern bleibt er für den nächsten Start.
 */
export async function loeseEinloesecodeEin({ code, datenDir, cloudUrl, fetchFn = globalThis.fetch, timeoutMs = 8000, beiAbgelehnt = () => {} }) {
    if (liesGeraeteSchluessel({ datenDir })) return { status: 'vorhanden' };
    if (!code) return { status: 'kein-code' };
    if (!cloudUrl) return { status: 'fehler', grund: 'keine Cloud-Adresse bekannt' };
    try {
        const antwort = await fetchFn(`${cloudUrl}/api/downloads/einloesen`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ code, bezeichnung: 'Hallen-Server' }),
            signal: AbortSignal.timeout(timeoutMs)
        });
        if (antwort.status >= 400 && antwort.status < 500) {
            beiAbgelehnt();
            return { status: 'fehler', grund: `Cloud lehnt den Code ab (HTTP ${antwort.status})`, endgueltig: true };
        }
        if (!antwort.ok) return { status: 'fehler', grund: `Cloud antwortet mit HTTP ${antwort.status}` };
        const daten = await antwort.json();
        if (!daten || !daten.schluessel) return { status: 'fehler', grund: 'unerwartete Antwort der Cloud' };
        speichereGeraeteSchluessel(datenDir, daten.schluessel);
        return { status: 'eingeloest' };
    } catch (err) {
        return { status: 'fehler', grund: err.message };
    }
}

/** Liest die vom Windows-Installer abgelegte Datei mit dem Installernamen (desktop/build/server-installer.nsh). */
export function liesInstallerNamen(kandidaten) {
    for (const datei of kandidaten) {
        try {
            if (existsSync(datei)) return readFileSync(datei, 'utf8').replace(/^﻿/, '').trim();
        } catch { /* nächste Möglichkeit */ }
    }
    return '';
}

export function loescheDatei(datei) {
    try { rmSync(datei, { force: true }); } catch { /* ignorieren */ }
}
