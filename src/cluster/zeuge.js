// Zeuge gegen Split-Brain (Spec Abschnitt 9): ein Server, der den Hallen-Router nicht erreicht,
// erreicht auch keinen Client und darf deshalb nicht Master sein. CLUSTER_ZEUGE ist eine IP
// (Ping) oder eine http(s)-URL (GET, 2xx = erreichbar); leer = Default-Gateway (nur Linux).
import { execFile } from 'child_process';

function fuehreAus(befehl, argumente, timeoutMs) {
    return new Promise((resolve) => {
        execFile(befehl, argumente, { timeout: timeoutMs, windowsHide: true }, (fehler, stdout) => {
            resolve({ ok: !fehler, stdout: String(stdout || '') });
        });
    });
}

async function defaultGateway() {
    if (process.platform !== 'linux') return null;
    const { ok, stdout } = await fuehreAus('ip', ['route', 'show', 'default'], 1000);
    const treffer = ok && stdout.match(/default via (\S+)/);
    return treffer ? treffer[1] : null;
}

export function erzeugeZeuge(ziel) {
    let aufgeloest = ziel || null;

    async function erreichbar() {
        if (!aufgeloest) aufgeloest = await defaultGateway();
        if (!aufgeloest) return { erreichbar: true, ziel: null, hinweis: 'kein Zeuge konfiguriert' };
        if (/^https?:\/\//.test(aufgeloest)) {
            try {
                const antwort = await fetch(aufgeloest, { signal: AbortSignal.timeout(1000), cache: 'no-store' });
                return { erreichbar: antwort.ok, ziel: aufgeloest };
            } catch {
                return { erreichbar: false, ziel: aufgeloest };
            }
        }
        const argumente = process.platform === 'win32' ? ['-n', '1', '-w', '1000', aufgeloest] : ['-c', '1', '-W', '1', aufgeloest];
        const { ok } = await fuehreAus('ping', argumente, 2000);
        return { erreichbar: ok, ziel: aufgeloest };
    }

    return { erreichbar };
}
