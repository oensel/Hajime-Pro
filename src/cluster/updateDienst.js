// Update-Dienst eines Cluster-Servers: kennt das neueste Release (GitHub, zwischengespeichert), startet das Root-Skript
// (CLUSTER_UPDATE_BEFEHL) und liest dessen Statusdatei. Die Zielversion ist ausschließlich x.y.z und fließt nur geprüft
// in den Befehl (Spec 2026-10-14-cluster-update-design.md).
import { readFileSync } from 'fs';
import { istVersion } from './updateLogik.js';

const ZWISCHENSPEICHER_MS = 10 * 60_000;
const ABFRAGE_TIMEOUT_MS = 5000;

export function erzeugeUpdateDienst({ repo, token = '', statusDatei, updateBefehl, fuehreBefehlAus, fetchFn = fetch, jetzt = () => Date.now(), env = process.env }) {
    let zwischen = null; // { version, zeit }
    let laeuftGerade = false;

    async function neuesteVersion() {
        if (env.NODE_ENV === 'test' && env.CLUSTER_RELEASE_VERSION) return env.CLUSTER_RELEASE_VERSION;
        if (zwischen && jetzt() - zwischen.zeit < ZWISCHENSPEICHER_MS) return zwischen.version;
        let version = null;
        try {
            const antwort = await fetchFn(`https://api.github.com/repos/${repo}/releases/latest`, {
                signal: AbortSignal.timeout(ABFRAGE_TIMEOUT_MS),
                headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'hajime-pro', ...(token ? { Authorization: `Bearer ${token}` } : {}) }
            });
            if (antwort.ok) {
                const tag = String((await antwort.json()).tag_name || '').replace(/^v/, '');
                version = istVersion(tag) ? tag : null;
            }
        } catch {
            version = null;
        }
        zwischen = { version, zeit: jetzt() };
        return version;
    }

    function status() {
        try {
            return JSON.parse(readFileSync(statusDatei, 'utf-8'));
        } catch {
            return null;
        }
    }

    async function starte(ziel) {
        if (!istVersion(ziel)) throw Object.assign(new Error('Ungültige Zielversion.'), { status: 400 });
        if (laeuftGerade) throw Object.assign(new Error('Ein Update läuft bereits.'), { status: 409 });
        laeuftGerade = true;
        try {
            await fuehreBefehlAus(`${updateBefehl} ${ziel}`);
        } finally {
            laeuftGerade = false;
        }
    }

    return { neuesteVersion, status, laeuft: () => laeuftGerade, starte };
}
