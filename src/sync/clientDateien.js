// Stellt die Client-Dateien (Windows, macOS, Linux, Android) der Serverversion unter
// <CLIENT_DOWNLOADS_VERZEICHNIS>/<version>/ bereit, damit /download und der Selbst-Update der
// Desktop-Clients ohne Handarbeit funktionieren. Zwei Quellen, in dieser Reihenfolge:
//  1. Mitgeliefert: Das Server-Paket (desktop/electron-builder.server.yml) enthält die in der Release-
//     Pipeline signierten Dateien (CLIENT_DATEIEN_MITGELIEFERT). Sie werden beim ersten Start des
//     Servers kopiert — ohne Internet, ohne Zugangsdaten.
//  2. GitHub-Release zur Serverversion (CLIENT_RELEASE_REPO, bei privatem Repository mit
//     CLIENT_RELEASE_TOKEN) — für Server aus dem Quellcode (deploy/linux/install.sh) und Entwicklung.
// Jede Datei wird gegen die Ed25519-Signatur aus version.json geprüft (desktop/update-schluessel.pub),
// version.json wird als LETZTES geschrieben: ist sie da, ist alles vollständig.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import path from 'path';
import { pruefeDatei } from '../../desktop/updateLogik.js';

export function liesOeffentlichenSchluessel() {
    return readFileSync(new URL('../../desktop/update-schluessel.pub', import.meta.url), 'utf8');
}

function schreibeAtomar(datei, inhalt) {
    const temp = `${datei}.teil`;
    writeFileSync(temp, inhalt);
    renameSync(temp, datei);
}

// Liegt die Datei schon richtig im Ziel (Wiederaufnahme nach Abbruch)?
function istSchonDa(ziel, eintrag, version, schluessel) {
    const datei = path.join(ziel, eintrag.datei);
    if (!existsSync(datei)) return false;
    try {
        return pruefeDatei({ puffer: readFileSync(datei), eintrag, version, oeffentlicherSchluessel: schluessel }).ok;
    } catch {
        return false;
    }
}

function dateiEintraege(vj) {
    const nachName = new Map();
    for (const plattform of Object.values(vj.dateien || {})) {
        for (const eintrag of Object.values(plattform)) nachName.set(eintrag.datei, eintrag);
    }
    return [...nachName.values()];
}

function pruefeUndSchreibe({ ziel, eintrag, puffer, version, schluessel }) {
    const pruefung = pruefeDatei({ puffer, eintrag, version, oeffentlicherSchluessel: schluessel });
    if (!pruefung.ok) throw new Error(`${eintrag.datei}: Prüfung fehlgeschlagen (${pruefung.grund})`);
    schreibeAtomar(path.join(ziel, eintrag.datei), puffer);
}

// Kopiert die mitgelieferten Dateien. Liefert false, wenn nichts (Passendes) mitgeliefert wurde.
export async function kopiereMitgelieferte({ quelle, version, ziel, schluessel, beiFortschritt = () => {} }) {
    const vjDatei = path.join(quelle, 'version.json');
    if (!quelle || !existsSync(vjDatei)) return false;
    const vj = JSON.parse(readFileSync(vjDatei, 'utf8'));
    if (vj.version !== version) return false;
    mkdirSync(ziel, { recursive: true });
    const eintraege = dateiEintraege(vj);
    for (const [i, eintrag] of eintraege.entries()) {
        beiFortschritt({ datei: eintrag.datei, fertig: i, gesamt: eintraege.length });
        if (istSchonDa(ziel, eintrag, version, schluessel)) continue;
        pruefeUndSchreibe({ ziel, eintrag, puffer: readFileSync(path.join(quelle, eintrag.datei)), version, schluessel });
        await new Promise(r => setImmediate(r)); // der Server bleibt beim Kopieren ansprechbar
    }
    schreibeAtomar(path.join(ziel, 'version.json'), JSON.stringify(vj, null, 2));
    return true;
}

// Lädt die Dateien des GitHub-Releases v<version>. Wirft bei jedem Fehler (kein Release, Netz, Prüfung).
export async function holeClientRelease({ repo, version, token, ziel, schluessel, apiBasis = 'https://api.github.com', fetchFn = fetch, beiFortschritt = () => {} }) {
    const kopf = { Accept: 'application/vnd.github+json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
    const release = await fetchFn(`${apiBasis}/repos/${repo}/releases/tags/v${version}`, { headers: kopf });
    if (!release.ok) {
        const hinweis = release.status === 404 && !token ? ' (bei privatem Repository CLIENT_RELEASE_TOKEN setzen)' : '';
        throw new Error(`Kein Release v${version} in ${repo} gefunden (HTTP ${release.status})${hinweis}.`);
    }
    const { assets } = await release.json();
    const lade = async (asset) => {
        const r = await fetchFn(asset.url, { headers: { ...kopf, Accept: 'application/octet-stream' } });
        if (!r.ok) throw new Error(`${asset.name}: HTTP ${r.status}`);
        return Buffer.from(await r.arrayBuffer());
    };
    const vjAsset = assets.find(a => a.name === 'version.json');
    if (!vjAsset) throw new Error('Release enthält keine version.json.');
    const vj = JSON.parse((await lade(vjAsset)).toString('utf8'));
    if (vj.version !== version) throw new Error(`version.json nennt ${vj.version}, erwartet ${version}.`);

    mkdirSync(ziel, { recursive: true });
    const eintraege = dateiEintraege(vj);
    for (const [i, eintrag] of eintraege.entries()) {
        beiFortschritt({ datei: eintrag.datei, fertig: i, gesamt: eintraege.length });
        if (istSchonDa(ziel, eintrag, version, schluessel)) continue;
        const asset = assets.find(a => a.name === eintrag.datei);
        if (!asset) throw new Error(`Datei ${eintrag.datei} fehlt im Release.`);
        pruefeUndSchreibe({ ziel, eintrag, puffer: await lade(asset), version, schluessel });
    }
    schreibeAtomar(path.join(ziel, 'version.json'), JSON.stringify(vj, null, 2));
    return vj;
}

// Läuft im Hintergrund des Servers: stellt die Dateien bereit und versucht es nach Fehlern erneut.
// status() speist /api/client/version und die Download-Seite.
export function erzeugeClientDateien({
    downloadsVerzeichnis, version, mitgeliefert = '', repo = '', token = '', autoHolen = true,
    schluessel = null, fetchFn = fetch, apiBasis, wiederholungMs = 15 * 60 * 1000, log = console
}) {
    const ziel = path.join(path.resolve(downloadsVerzeichnis), version);
    const zustand = { phase: 'unbekannt', datei: null, fertig: 0, gesamt: 0, fehler: null };
    let timer = null;
    let laeuft = false;
    let letzteMeldung = null;

    const istBereit = () => existsSync(path.join(ziel, 'version.json'));
    const fortschritt = (phase) => (f) => Object.assign(zustand, f, { phase, fehler: null });

    async function versuche() {
        if (laeuft) return;
        laeuft = true;
        try {
            if (istBereit()) {
                Object.assign(zustand, { phase: 'bereit', fehler: null });
                return;
            }
            const sk = schluessel || liesOeffentlichenSchluessel();
            if (await kopiereMitgelieferte({ quelle: mitgeliefert, version, ziel, schluessel: sk, beiFortschritt: fortschritt('kopiere') })) {
                log.log(`[Client-Dateien] Mitgelieferte Client-Dateien für Version ${version} bereitgestellt.`);
                Object.assign(zustand, { phase: 'bereit', fehler: null });
                return;
            }
            if (!autoHolen || !repo) {
                Object.assign(zustand, { phase: 'inaktiv', fehler: null });
                return;
            }
            Object.assign(zustand, { phase: 'lade', fehler: null });
            await holeClientRelease({ repo, version, token, ziel, schluessel: sk, fetchFn, apiBasis, beiFortschritt: fortschritt('lade') });
            log.log(`[Client-Dateien] Client-Dateien der Version ${version} aus dem Release ${repo} geladen.`);
            Object.assign(zustand, { phase: 'bereit', fehler: null });
        } catch (err) {
            Object.assign(zustand, { phase: 'fehler', fehler: err.message });
            // Nur einmal pro Fehlertext melden (der Versuch wiederholt sich alle paar Minuten).
            if (letzteMeldung !== err.message) log.warn(`[Client-Dateien] ${err.message} – neuer Versuch in ${Math.round(wiederholungMs / 60000)} Min.`);
            letzteMeldung = err.message;
        } finally {
            laeuft = false;
            if (zustand.phase === 'fehler') {
                timer = setTimeout(versuche, wiederholungMs);
                if (timer.unref) timer.unref();
            }
        }
    }

    return {
        ziel,
        status: () => ({ ...zustand }),
        // Startet den ersten Versuch, ohne den Serverstart zu verzögern; liefert dessen Ende (Tests).
        starte() {
            return versuche();
        },
        stoppe() {
            if (timer) clearTimeout(timer);
            timer = null;
        }
    };
}
