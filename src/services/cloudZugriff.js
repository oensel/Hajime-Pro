// HTTP-Zugriff eines Hallen-Servers auf die Cloud (Turniere des eigenen Vereins holen).
// Die Adresse kommt ausschließlich aus CLOUD_URL, nie vom Client. Zugangsdaten und Token werden
// nur durchgereicht, nicht gespeichert und nicht geloggt.
import { FachFehler } from '../utils/fachFehler.js';

const ERREICHBARKEIT_TIMEOUT_MS = 3000;
const ANFRAGE_TIMEOUT_MS = 15000;
const EXPORT_TIMEOUT_MS = 120000;

export function liesCloudUrl(env = process.env) {
    const roh = String(env.CLOUD_URL || '').trim();
    if (!roh) return null;
    try {
        const url = new URL(roh);
        if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
        return url.origin + url.pathname.replace(/\/+$/, '');
    } catch {
        return null;
    }
}

export function erzeugeCloudZugriff({ fetchFn = globalThis.fetch, env = process.env } = {}) {
    function basis() {
        const url = liesCloudUrl(env);
        if (!url) throw new FachFehler(503, 'Es ist keine Cloud-Adresse (CLOUD_URL) eingerichtet.');
        return url;
    }

    async function anfrage(pfad, { methode = 'GET', token = null, body = null, timeoutMs = ANFRAGE_TIMEOUT_MS } = {}) {
        const headers = { Accept: 'application/json' };
        if (body !== null) headers['Content-Type'] = 'application/json';
        if (token) headers.Authorization = `Bearer ${token}`;
        let antwort;
        try {
            antwort = await fetchFn(basis() + pfad, {
                method: methode,
                headers,
                body: body !== null ? JSON.stringify(body) : undefined,
                signal: AbortSignal.timeout(timeoutMs)
            });
        } catch (e) {
            if (e instanceof FachFehler) throw e;
            throw new FachFehler(502, 'Die Cloud ist gerade nicht erreichbar.');
        }
        return antwort;
    }

    async function lesJson(antwort, fallbackMeldung) {
        let daten = null;
        try { daten = await antwort.json(); } catch { /* keine JSON-Antwort */ }
        if (!antwort.ok) {
            const meldung = (daten && (daten.error || daten.message)) || fallbackMeldung;
            // 401 der Cloud-Anmeldung bleibt 401, alles andere fachlich durchreichen
            throw new FachFehler(antwort.status >= 400 && antwort.status < 600 ? antwort.status : 502, meldung);
        }
        return daten;
    }

    return {
        konfiguriert: () => liesCloudUrl(env) !== null,

        async pruefeErreichbar() {
            if (!liesCloudUrl(env)) return false;
            try {
                const antwort = await anfrage('/api/auth/mode', { timeoutMs: ERREICHBARKEIT_TIMEOUT_MS });
                return antwort.ok;
            } catch {
                return false;
            }
        },

        async meldeAn(email, password) {
            const antwort = await anfrage('/api/auth/login', { methode: 'POST', body: { email, password } });
            const daten = await lesJson(antwort, 'Anmeldung an der Cloud fehlgeschlagen.');
            if (!daten || !daten.token) throw new FachFehler(502, 'Unerwartete Antwort der Cloud bei der Anmeldung.');
            return { token: daten.token, user: daten.user || null };
        },

        async listeTurniere(token) {
            const antwort = await anfrage('/api/turniere', { token });
            const daten = await lesJson(antwort, 'Turniere konnten nicht aus der Cloud geladen werden.');
            if (!Array.isArray(daten)) throw new FachFehler(502, 'Unerwartete Antwort der Cloud bei der Turnierliste.');
            return daten;
        },

        async ladeExport(token, turnierId) {
            const antwort = await anfrage(`/api/turniere/${encodeURIComponent(turnierId)}/export`, { token, timeoutMs: EXPORT_TIMEOUT_MS });
            const daten = await lesJson(antwort, 'Das Turnier konnte nicht aus der Cloud geholt werden.');
            if (!daten || typeof daten !== 'object' || !daten.turnier) {
                throw new FachFehler(502, 'Unerwartete Antwort der Cloud beim Export.');
            }
            return daten;
        }
    };
}
