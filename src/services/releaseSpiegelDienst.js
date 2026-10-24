// Hält die Release-Ablage der Cloud aktuell: prüft stündlich (und auf Knopfdruck) das private Repository
// RELEASE_QUELLE_REPO mit dem Lesetoken RELEASE_QUELLE_TOKEN und spiegelt neue Releases (src/services/releaseSpeicher.js).
// Ohne RELEASE_QUELLE_REPO ist die Spiegelung aus (die Ablage kann dann von Hand gefüllt werden).
import { spiegleRelease, releaseVerzeichnis, STANDARD_BEHALTEN } from './releaseSpeicher.js';

export const PRUEFUNG_MS = 60 * 60 * 1000;

export function leseSpiegelKonfig(env = process.env) {
    return {
        repo: String(env.RELEASE_QUELLE_REPO || '').trim(),
        token: String(env.RELEASE_QUELLE_TOKEN || '').trim(),
        behalte: Number(env.RELEASE_BEHALTEN) > 0 ? Number(env.RELEASE_BEHALTEN) : STANDARD_BEHALTEN,
        dir: releaseVerzeichnis(env)
    };
}

export function erzeugeReleaseSpiegel({
    konfig = leseSpiegelKonfig(), schluessel, fetchFn = globalThis.fetch, apiBasis, log = console, spiegle = spiegleRelease
}) {
    const zustand = { laeuft: false, letzterLauf: null, letztesErgebnis: null, fehler: null, fortschritt: null };
    let timer = null;

    async function pruefeJetzt() {
        if (!konfig.repo) throw Object.assign(new Error('Die Spiegelung ist nicht eingerichtet (RELEASE_QUELLE_REPO).'), { status: 409 });
        if (zustand.laeuft) throw Object.assign(new Error('Die Spiegelung läuft bereits.'), { status: 409 });
        zustand.laeuft = true;
        zustand.fehler = null;
        try {
            const ergebnis = await spiegle({
                repo: konfig.repo, token: konfig.token, dir: konfig.dir, schluessel, behalte: konfig.behalte, fetchFn, apiBasis, log,
                beiFortschritt: (f) => { zustand.fortschritt = f; }
            });
            zustand.letztesErgebnis = ergebnis;
            return ergebnis;
        } catch (err) {
            zustand.fehler = err.message;
            log.warn(`[Releases] Spiegelung fehlgeschlagen: ${err.message}`);
            throw err;
        } finally {
            zustand.laeuft = false;
            zustand.fortschritt = null;
            zustand.letzterLauf = new Date().toISOString();
        }
    }

    return {
        konfiguriert: () => !!konfig.repo,
        status: () => ({ konfiguriert: !!konfig.repo, repo: konfig.repo || null, ...zustand }),
        pruefeJetzt,
        starte() {
            if (!konfig.repo || timer) return;
            const lauf = () => pruefeJetzt().catch(() => {});
            setTimeout(lauf, 5000).unref();
            timer = setInterval(lauf, PRUEFUNG_MS);
            timer.unref();
        },
        stoppe() {
            if (timer) clearInterval(timer);
            timer = null;
        }
    };
}
