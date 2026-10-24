// Release-Ablage der Cloud: Installer, Update-Pakete und die signierten Verzeichnisse (version.json, server-version.json),
// gespiegelt aus dem privaten Repository (Spec docs/specs/2026-10-24-downloads-ueber-cloud-design.md).
//   <RELEASE_VERZEICHNIS>/<version>/<dateien…> + release.json (zuletzt geschrieben: ist sie da, ist das Release vollständig)
// Jede gespiegelte Datei wird gegen Prüfsumme und Ed25519-Signatur geprüft, bevor das Release sichtbar wird.
import { createHash } from 'crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'fs';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import path from 'path';
import { vergleicheVersionen, istVersion } from '../cluster/updateLogik.js';

export const INDEX_DATEI = 'release.json';
export const STANDARD_BEHALTEN = 3;
const NAME_MUSTER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/;

export function releaseVerzeichnis(env = process.env) {
    return path.resolve(env.RELEASE_VERZEICHNIS || './data/releases');
}

export const pruefeDateiname = (name) => typeof name === 'string' && NAME_MUSTER.test(name);

/** Gruppe und Beschriftung einer Datei für die Downloads-Seite, abgeleitet aus den beiden signierten Verzeichnissen. */
export function beschreibeDateien(dateinamen, clientVj, serverVj) {
    const PLATTFORM_TEXT = { 'win32-x64': 'Windows', 'darwin-universal': 'macOS', 'linux-x64': 'Linux', android: 'Android', 'linux-dienst': 'Linux-Dienst (ohne Oberfläche)' };
    const zuordnung = new Map();
    const lies = (vj, gruppe) => {
        for (const [plattform, rollen] of Object.entries((vj && vj.dateien) || {})) {
            for (const eintrag of Object.values(rollen)) {
                if (!zuordnung.has(eintrag.datei)) zuordnung.set(eintrag.datei, { gruppe, plattform, bezeichnung: PLATTFORM_TEXT[plattform] || plattform });
            }
        }
    };
    lies(serverVj, 'server');
    lies(clientVj, 'client');
    return dateinamen.map((name) => {
        if (zuordnung.has(name)) return { name, ...zuordnung.get(name) };
        // Nur was in den signierten Verzeichnissen steht, wird angeboten; alles andere (auch ein unsigniertes Hol-Skript) bleibt intern.
        return { name, gruppe: 'intern', plattform: null, bezeichnung: name };
    });
}

export function liesIndex(dir, version) {
    if (!istVersion(version)) return null;
    try {
        const index = JSON.parse(readFileSync(path.join(dir, version, INDEX_DATEI), 'utf8'));
        return index && index.version === version && Array.isArray(index.dateien) ? index : null;
    } catch {
        return null;
    }
}

/** Alle vollständigen Versionen, neueste zuerst. */
export function listeVersionen(dir) {
    if (!existsSync(dir)) return [];
    return readdirSync(dir, { withFileTypes: true })
        .filter(e => e.isDirectory() && istVersion(e.name) && liesIndex(dir, e.name))
        .map(e => e.name)
        .sort((a, b) => -vergleicheVersionen(a, b));
}

export function neuesteRelease(dir) {
    const version = listeVersionen(dir)[0];
    return version ? liesIndex(dir, version) : null;
}

/** Pfad einer Datei der Ablage (nur Dateien, die im Index stehen; kein Pfad außerhalb). */
export function dateiPfad(dir, version, name) {
    if (!pruefeDateiname(name)) return null;
    const index = liesIndex(dir, version);
    const eintrag = index && index.dateien.find(d => d.name === name);
    return eintrag ? { pfad: path.join(dir, version, name), eintrag } : null;
}

export function raeumeAuf(dir, behalte = STANDARD_BEHALTEN) {
    for (const version of listeVersionen(dir).slice(Math.max(1, behalte))) {
        rmSync(path.join(dir, version), { recursive: true, force: true });
    }
}

function liesJson(datei) {
    return existsSync(datei) ? JSON.parse(readFileSync(datei, 'utf8')) : null;
}

/** Prüft alle Dateien eines gespiegelten Release gegen version.json/server-version.json (Prüfsumme + Signatur) und SHA256SUMS-Server.txt. */
export async function pruefeSpiegel({ ziel, version, schluessel, dateien }) {
    // Erst hier geladen: desktop/ darf nicht statisch von src/app.js aus erreichbar sein (siehe tests/unit/appImports.test.js).
    const { pruefeSignatur } = await import('../../desktop/updateLogik.js');
    const clientVj = liesJson(path.join(ziel, 'version.json'));
    const serverVj = liesJson(path.join(ziel, 'server-version.json'));
    if (!clientVj && !serverVj) throw new Error('Das Release enthält weder version.json noch server-version.json.');
    const geprueft = new Set();
    for (const vj of [clientVj, serverVj].filter(Boolean)) {
        if (vj.version !== version) throw new Error(`Verzeichnis nennt Version ${vj.version}, erwartet ${version}.`);
        for (const rollen of Object.values(vj.dateien || {})) {
            for (const eintrag of Object.values(rollen)) {
                if (geprueft.has(eintrag.datei)) continue;
                const datei = dateien.find(d => d.name === eintrag.datei);
                if (!datei) throw new Error(`Datei ${eintrag.datei} fehlt im Release.`);
                if (datei.sha256 !== eintrag.sha256) throw new Error(`${eintrag.datei}: Prüfsumme stimmt nicht.`);
                if (!pruefeSignatur({ eintrag, version, oeffentlicherSchluessel: schluessel })) throw new Error(`${eintrag.datei}: Signatur ungültig.`);
                geprueft.add(eintrag.datei);
            }
        }
    }
    const summen = dateien.find(d => d.name === 'SHA256SUMS-Server.txt');
    if (summen) {
        for (const zeile of readFileSync(path.join(ziel, summen.name), 'utf8').split(/\r?\n/)) {
            const m = /^([0-9a-f]{64})\s+\*?(.+)$/i.exec(zeile.trim());
            const datei = m && dateien.find(d => d.name === m[2]);
            if (datei && datei.sha256 !== m[1].toLowerCase()) throw new Error(`${datei.name}: Prüfsumme laut SHA256SUMS-Server.txt stimmt nicht.`);
        }
    }
    return { clientVj, serverVj };
}

/**
 * Spiegelt das neueste (oder das angegebene) Release aus dem privaten Repository in die Ablage.
 * Rückgabe: { status: 'aktuell' | 'gespiegelt' | 'kein-release', version }. Wirft bei Netz-, Prüf- und Dateifehlern.
 */
export async function spiegleRelease({
    repo, token, dir, schluessel, version = null, behalte = STANDARD_BEHALTEN, fetchFn = globalThis.fetch,
    apiBasis = 'https://api.github.com', log = console, beiFortschritt = () => {}
}) {
    const kopf = { Accept: 'application/vnd.github+json', 'User-Agent': 'hajime-pro', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
    const antwort = await fetchFn(`${apiBasis}/repos/${repo}/releases/${version ? `tags/v${version}` : 'latest'}`, { headers: kopf, signal: AbortSignal.timeout(15_000) });
    if (antwort.status === 404) return { status: 'kein-release', version };
    if (!antwort.ok) throw new Error(`Quelle antwortet mit HTTP ${antwort.status}${antwort.status === 401 || antwort.status === 403 ? ' (Lesetoken prüfen)' : ''}.`);
    const release = await antwort.json();
    const neu = String(release.tag_name || '').replace(/^v/, '');
    if (!istVersion(neu)) throw new Error(`Unerwarteter Release-Name: ${release.tag_name}`);
    if (liesIndex(dir, neu)) return { status: 'aktuell', version: neu };

    const ziel = path.join(dir, `${neu}.teil`);
    rmSync(ziel, { recursive: true, force: true });
    mkdirSync(ziel, { recursive: true });
    try {
        const assets = (release.assets || []).filter(a => pruefeDateiname(a.name));
        const dateien = [];
        for (const [i, asset] of assets.entries()) {
            beiFortschritt({ datei: asset.name, fertig: i, gesamt: assets.length });
            const r = await fetchFn(asset.url, { headers: { ...kopf, Accept: 'application/octet-stream' } });
            if (!r.ok || !r.body) throw new Error(`${asset.name}: HTTP ${r.status}`);
            const hash = createHash('sha256');
            let groesse = 0;
            const messen = async function* (quelle) { for await (const stueck of quelle) { hash.update(stueck); groesse += stueck.length; yield stueck; } };
            await pipeline(Readable.fromWeb(r.body), messen, createWriteStream(path.join(ziel, asset.name)));
            dateien.push({ name: asset.name, groesse, sha256: hash.digest('hex') });
        }
        const { clientVj, serverVj } = await pruefeSpiegel({ ziel, version: neu, schluessel, dateien });
        const beschrieben = beschreibeDateien(dateien.map(d => d.name), clientVj, serverVj);
        const index = {
            version: neu, tag: release.tag_name, veroeffentlicht: release.published_at || null, gespiegelt: new Date().toISOString(),
            dateien: dateien.map((d, i) => ({ ...d, ...beschrieben[i], name: d.name }))
        };
        writeFileSync(path.join(ziel, INDEX_DATEI), JSON.stringify(index, null, 2));
        rmSync(path.join(dir, neu), { recursive: true, force: true });
        renameSync(ziel, path.join(dir, neu));
    } catch (err) {
        rmSync(ziel, { recursive: true, force: true });
        throw err;
    }
    raeumeAuf(dir, behalte);
    log.log(`[Releases] Version ${neu} aus ${repo} gespiegelt.`);
    return { status: 'gespiegelt', version: neu };
}

/** Größe und Existenz für Range-Auslieferung. */
export function dateiGroesse(pfad) {
    return statSync(pfad).size;
}

/**
 * Die Cloud aktualisiert sich aus ihrer eigenen Ablage: ein fetch-Ersatz, der die GitHub-Form (releases/latest, tags, Assets)
 * aus dem Verzeichnis beantwortet. So bleibt src/utils/cloudUpdate.js (pruefeUndLade) unverändert.
 */
export function erzeugeLokalenReleaseZugriff(dir) {
    const basis = 'lokal://releases';
    const alsRelease = (index) => ({
        tag_name: `v${index.version}`, published_at: index.veroeffentlicht,
        assets: index.dateien.map(d => ({ name: d.name, size: d.groesse, url: `${basis}/assets/${index.version}/${encodeURIComponent(d.name)}` }))
    });
    const json = (status, daten) => new Response(JSON.stringify(daten), { status, headers: { 'content-type': 'application/json' } });
    const fetchFn = async (url, optionen = {}) => {
        const pfad = String(url).slice(basis.length);
        let m = /^\/repos\/[^/]+\/releases\/latest$/.exec(pfad);
        if (m) { const index = neuesteRelease(dir); return index ? json(200, alsRelease(index)) : json(404, { message: 'Not Found' }); }
        m = /^\/repos\/[^/]+\/releases\/tags\/v?([0-9.]+)$/.exec(pfad);
        if (m) { const index = liesIndex(dir, m[1]); return index ? json(200, alsRelease(index)) : json(404, { message: 'Not Found' }); }
        m = /^\/assets\/([0-9.]+)\/([^/]+)$/.exec(pfad);
        if (m) {
            const ziel = dateiPfad(dir, m[1], decodeURIComponent(m[2]));
            if (!ziel) return json(404, { message: 'Not Found' });
            const groesse = dateiGroesse(ziel.pfad);
            const range = /^bytes=(\d+)-$/.exec(String((optionen.headers && optionen.headers.Range) || ''));
            const start = range ? Number(range[1]) : 0;
            if (start >= groesse) return new Response(null, { status: 416 });
            const strom = Readable.toWeb(createReadStream(ziel.pfad, { start }));
            return new Response(strom, { status: range ? 206 : 200, headers: { 'content-length': String(groesse - start) } });
        }
        return json(404, { message: 'Not Found' });
    };
    return { fetchFn, apiBasis: basis, repo: 'lokal' };
}

export function neuesteLokaleVersion(dir) {
    const index = neuesteRelease(dir);
    return index ? index.version : null;
}
