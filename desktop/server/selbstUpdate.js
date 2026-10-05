// Selbst-Update des Server-Pakets beim Start (nur Logik, ohne Electron): fragt das neueste GitHub-Release ab und
// lädt den Installer, wenn dessen Version NEUER ist als die laufende. Ist kein Internet da, gibt es kein Release oder
// ist nichts Neueres veröffentlicht, liefert pruefeUndLade() einen Status ohne Datei und der Server startet normal.
// Der Installer wird gegen die Ed25519-Signatur aus server-version.json geprüft (desktop/update-schluessel.pub),
// derselbe Schlüssel und dasselbe Schema wie bei den Client-Dateien (desktop/updateLogik.js).
import { closeSync, createReadStream, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from 'fs';
import { createHash } from 'crypto';
import path from 'path';
import { MAX_UPDATE_VERSUCHE, plattformSchluessel, pruefeSignatur } from '../updateLogik.js';

export const VERSION_DATEI = 'server-version.json';

// "1.10.2" > "1.9.9": nur reine x.y.z-Versionen, alles andere (Vorabversionen) gilt als nicht vergleichbar.
export function istNeuer(kandidat, aktuell) {
    const teile = (v) => {
        const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(v || '').trim());
        return m ? m.slice(1).map(Number) : null;
    };
    const a = teile(kandidat);
    const b = teile(aktuell);
    if (!a || !b) return false;
    for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
    return false;
}

// Zähler der Versuche je Zielversion (Datei im Profilordner): ein kaputtes Update darf nicht bei jedem Start erneut
// laufen und den Server nie hochkommen lassen.
export function liesVersuche(datei) {
    try { return JSON.parse(readFileSync(datei, 'utf8')) || {}; } catch { return {}; }
}

export function merkeVersuch(datei, version) {
    const versuche = liesVersuche(datei);
    versuche[version] = (versuche[version] || 0) + 1;
    mkdirSync(path.dirname(datei), { recursive: true });
    writeFileSync(datei, JSON.stringify(versuche));
}

/**
 * @returns {Promise<{status: string, version?: string, datei?: string, grund?: string}>}
 *   status: 'aktuell' | 'keine-verbindung' | 'kein-release' | 'aufgegeben' | 'nicht-unterstuetzt' | 'fehler' | 'bereit'
 *   Nur bei 'bereit' liegt der geprüfte Installer unter `datei`.
 */
export async function pruefeUndLade({
    repo, token = '', aktuelleVersion, schluessel, zielVerzeichnis, versuchsDatei,
    platform = process.platform, arch = process.arch, fetchFn = fetch, apiBasis = 'https://api.github.com',
    timeoutMs = 6000, leerlaufMs = 60000, beiFortschritt = () => {}, log = console
}) {
    const plattform = plattformSchluessel(platform, arch);
    // Nur Windows: der NSIS-Installer läuft still durch; AppImage/dmg lassen sich nicht ohne Weiteres austauschen.
    if (plattform !== 'win32-x64') return { status: 'nicht-unterstuetzt' };

    const kopf = { Accept: 'application/vnd.github+json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
    const mitZeitlimit = (url, extra = {}) => fetchFn(url, { ...extra, signal: AbortSignal.timeout(timeoutMs) });

    let release;
    try {
        const antwort = await mitZeitlimit(`${apiBasis}/repos/${repo}/releases/latest`, { headers: kopf });
        if (antwort.status === 404) return { status: 'kein-release' };
        if (!antwort.ok) return { status: 'fehler', grund: `GitHub antwortet mit HTTP ${antwort.status}` };
        release = await antwort.json();
    } catch (err) {
        // Kein Netz, DNS-Fehler, Zeitüberschreitung: der normale Fall im Hallen-Hotspot.
        return { status: 'keine-verbindung', grund: err.message };
    }

    const version = String(release.tag_name || '').replace(/^v/, '');
    if (!istNeuer(version, aktuelleVersion)) return { status: 'aktuell', version };
    if ((liesVersuche(versuchsDatei)[version] || 0) >= MAX_UPDATE_VERSUCHE) return { status: 'aufgegeben', version };

    try {
        const assets = release.assets || [];
        const lade = async (asset, timeout = timeoutMs) => {
            const r = await fetchFn(asset.url, { headers: { ...kopf, Accept: 'application/octet-stream' }, signal: AbortSignal.timeout(timeout) });
            if (!r.ok) throw new Error(`${asset.name}: HTTP ${r.status}`);
            return Buffer.from(await r.arrayBuffer());
        };
        const vjAsset = assets.find(a => a.name === VERSION_DATEI);
        if (!vjAsset) return { status: 'fehler', version, grund: `Release v${version} enthält keine ${VERSION_DATEI}` };
        const vj = JSON.parse((await lade(vjAsset)).toString('utf8'));
        if (vj.version !== version) return { status: 'fehler', version, grund: `${VERSION_DATEI} nennt ${vj.version}, erwartet ${version}` };
        const eintrag = vj.dateien && vj.dateien[plattform] && vj.dateien[plattform].installieren;
        const asset = eintrag && assets.find(a => a.name === eintrag.datei);
        if (!asset) return { status: 'fehler', version, grund: `Kein Installer für ${plattform} in Release v${version}` };
        // Eine ungültige Signatur gilt schon vor dem Download (kleine Datei) als Fehler.
        if (!pruefeSignatur({ eintrag, version, oeffentlicherSchluessel: schluessel })) {
            return { status: 'fehler', version, grund: `Installer ${eintrag.datei}: Prüfung fehlgeschlagen (signatur)` };
        }

        mkdirSync(zielVerzeichnis, { recursive: true });
        const ziel = path.join(zielVerzeichnis, eintrag.datei);
        // Schon vollständig und geprüft geladen (z.B. "Später" im letzten Lauf): nicht erneut herunterladen.
        if (existsSync(ziel) && (await sha256Datei(ziel)) === eintrag.sha256) return { status: 'bereit', version, datei: ziel };
        if (existsSync(ziel)) rmSync(ziel);

        log.log(`[Selbst-Update] Lade Version ${version} (${eintrag.datei}) …`);
        try {
            await ladeInDatei({ asset, kopf, ziel: `${ziel}.teil`, fetchFn, beiFortschritt: (stand) => beiFortschritt({ version, ...stand }), leerlaufMs });
        } catch (err) {
            // Verbindung riss ab o. Ä.: die Teildatei bleibt, der nächste Versuch setzt dort fort. Kein Fehlversuch.
            return { status: 'keine-verbindung', version, grund: err.message };
        }
        if ((await sha256Datei(`${ziel}.teil`)) !== eintrag.sha256) {
            rmSync(`${ziel}.teil`, { force: true });
            return { status: 'fehler', version, grund: `Installer ${eintrag.datei}: Prüfung fehlgeschlagen (sha256)` };
        }
        renameSync(`${ziel}.teil`, ziel);
        return { status: 'bereit', version, datei: ziel };
    } catch (err) {
        return { status: 'keine-verbindung', version, grund: err.message };
    }
}

export function sha256Datei(datei) {
    return new Promise((resolve, reject) => {
        const hash = createHash('sha256');
        createReadStream(datei).on('data', d => hash.update(d)).on('error', reject).on('end', () => resolve(hash.digest('hex')));
    });
}

// Lädt asset.url in die Datei `ziel` (Teildatei): direkt auf die Platte statt in den Arbeitsspeicher (der Installer ist
// über 600 MB groß), mit Fortschritt und Wiederaufnahme per Range, falls schon ein Stück da ist. Bricht erst ab, wenn
// `leerlaufMs` lang gar keine Daten kommen (nicht nach fester Gesamtzeit: langsame Leitungen dürfen lange brauchen).
export async function ladeInDatei({ asset, kopf, ziel, fetchFn, beiFortschritt = () => {}, leerlaufMs = 60000 }) {
    const vorhanden = existsSync(ziel) ? statSync(ziel).size : 0;
    const steuerung = new AbortController();
    let uhr = setTimeout(() => steuerung.abort(), leerlaufMs);
    const lebenszeichen = () => { clearTimeout(uhr); uhr = setTimeout(() => steuerung.abort(), leerlaufMs); };
    let fd = null;
    try {
        const header = { ...kopf, Accept: 'application/octet-stream', ...(vorhanden ? { Range: `bytes=${vorhanden}-` } : {}) };
        const r = await fetchFn(asset.url, { headers: header, signal: steuerung.signal });
        if (r.status === 416) return; // Teildatei ist schon vollständig; die Prüfsumme entscheidet
        if (!r.ok) throw new Error(`${asset.name}: HTTP ${r.status}`);
        const fortsetzen = vorhanden > 0 && r.status === 206;
        const laenge = Number(r.headers && r.headers.get && r.headers.get('content-length')) || 0;
        const gesamt = laenge ? laenge + (fortsetzen ? vorhanden : 0) : (asset.size || 0);
        let geladen = fortsetzen ? vorhanden : 0;
        fd = openSync(ziel, fortsetzen ? 'a' : 'w');
        const schreibe = (stueck) => {
            writeSync(fd, stueck);
            geladen += stueck.length;
            lebenszeichen();
            beiFortschritt({ geladen, gesamt });
        };
        if (r.body && typeof r.body.getReader === 'function') {
            const leser = r.body.getReader();
            for (;;) {
                const { done, value } = await leser.read();
                if (done) break;
                schreibe(Buffer.from(value));
            }
        } else {
            schreibe(Buffer.from(await r.arrayBuffer()));
        }
    } catch (err) {
        if (steuerung.signal.aborted) throw new Error(`Keine Daten mehr seit ${Math.round(leerlaufMs / 1000)} Sekunden`);
        throw err;
    } finally {
        clearTimeout(uhr);
        if (fd !== null) closeSync(fd);
    }
}
