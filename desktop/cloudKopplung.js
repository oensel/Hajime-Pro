// Kopplung des Desktop-Clients mit einem Turnier, das die Cloud live führt: der Link/QR-Text aus „Live in der Cloud“
// (<cloud>/turnierlive/<schluessel>#code=123456) enthält Adresse und Code. Ohne Electron-Abhängigkeit, damit testbar.
import { leseKopplungsUrl } from '../src/shared/kopplungsQr.js';

const NUR_CLOUD = 'Bitte den Link oder QR-Text eines Cloud-Turniers einfügen (Seite „Live in der Cloud“ in der Cloud).';

/** @returns {Promise<{ ok: true, serverUrl: string, secret: string } | { ok: false, fehler: string }>} */
export async function koppleCloud(eingabe, { clientId, fetchFn = fetch, timeoutMs = 8000 }) {
    const kopplung = leseKopplungsUrl(String(eingabe || ''));
    if (!kopplung || !/\/turnierlive\//.test(kopplung.serverUrl)) return { ok: false, fehler: NUR_CLOUD };
    let antwort;
    try {
        antwort = await fetchFn(`${kopplung.serverUrl}/api/client/koppeln`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code: kopplung.code, clientId }),
            signal: AbortSignal.timeout(timeoutMs)
        });
    } catch {
        return { ok: false, fehler: `Die Cloud unter ${new URL(kopplung.serverUrl).host} ist nicht erreichbar – Internetverbindung prüfen.` };
    }
    const daten = await antwort.json().catch(() => ({}));
    if (antwort.status === 401) return { ok: false, fehler: 'Code falsch – vielleicht wurde er in der Cloud erneuert. Aktuellen Link verwenden.' };
    if (antwort.status === 429) return { ok: false, fehler: `Zu viele Fehlversuche – bitte ${daten.restSekunden || 60} s warten.` };
    if (antwort.status === 403) return { ok: false, fehler: daten.grund === 'abgelaufen' ? 'Der Zugang zu diesem Turnier ist abgelaufen.' : 'Der Zugang zu diesem Turnier ist gesperrt.' };
    if (antwort.status === 410) return { ok: false, fehler: 'Der Live-Betrieb dieses Turniers wurde beendet.' };
    if (antwort.status === 404) return { ok: false, fehler: 'Unter dieser Adresse läuft kein Turnier (mehr).' };
    if (!antwort.ok || !daten.secret) return { ok: false, fehler: `Die Cloud antwortet nicht wie erwartet (HTTP ${antwort.status}).` };
    return { ok: true, serverUrl: kopplung.serverUrl, secret: daten.secret };
}
