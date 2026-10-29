// HTTP-Zugriff eines Hallen-Servers auf die Cloud (Turniere des eigenen Vereins holen und zurückspielen).
// Die Adresse kommt ausschließlich aus CLOUD_URL, nie vom Client. Zugangsdaten und Token werden
// nur durchgereicht, nicht gespeichert und nicht geloggt.
import { FachFehler } from '../utils/fachFehler.js';
import { liesCloudUrl as liesCloudUrlQuelle } from '../utils/releaseQuelle.js';

const ERREICHBARKEIT_TIMEOUT_MS = 3000;
const ANFRAGE_TIMEOUT_MS = 15000;
const EXPORT_TIMEOUT_MS = 120000;

// Nur CLOUD_URL; der Desktop-Server füllt sie beim Start aus update.json bzw. dem Paket (desktop/server/main.js).
export function liesCloudUrl(env = process.env) {
    return liesCloudUrlQuelle({ env });
}

export function erzeugeCloudZugriff({ fetchFn = globalThis.fetch, env = process.env } = {}) {
    function basis() {
        const url = liesCloudUrl(env);
        if (!url) throw new FachFehler(503, 'Es ist keine Cloud-Adresse (CLOUD_URL) eingerichtet.');
        return url;
    }

    async function anfrage(pfad, { methode = 'GET', token = null, body = null, timeoutMs = ANFRAGE_TIMEOUT_MS, zusatzHeader = {} } = {}) {
        const headers = { Accept: 'application/json', ...zusatzHeader };
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
            // 401 der Cloud-Anmeldung bleibt 401, alles andere fachlich durchreichen (samt Fehlercode, z. B. 'zwei_faktor')
            const code = daten && typeof daten.code === 'string' ? daten.code : null;
            throw new FachFehler(antwort.status >= 400 && antwort.status < 600 ? antwort.status : 502, meldung, { code });
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

        // Super-Admins melden sich in der Cloud mit zweitem Faktor an: die Cloud antwortet dann mit einem Zwischen-Token,
        // das zusammen mit dem Code der Authenticator-App (oder einem Backup-Code) die Sitzung liefert.
        async meldeAn(email, password, { code = null } = {}) {
            const antwort = await anfrage('/api/auth/login', { methode: 'POST', body: { email, password } });
            let daten = await lesJson(antwort, 'Anmeldung an der Cloud fehlgeschlagen.');
            if (daten && daten.zweiFaktor === 'einrichtung') {
                throw new FachFehler(409, 'Bitte die Zwei-Faktor-Anmeldung zuerst in der Cloud einrichten.');
            }
            if (daten && daten.zweiFaktor === 'pruefen') {
                const eingabe = code == null ? '' : String(code).trim();
                if (!eingabe) throw new FachFehler(422, 'Bitte den Code der Authenticator-App eingeben.', { code: 'zwei_faktor' });
                const pruefung = await anfrage('/api/auth/2fa/pruefen', {
                    methode: 'POST', body: { zwischenToken: daten.zwischenToken, code: eingabe }
                });
                try {
                    daten = await lesJson(pruefung, 'Der Code wurde von der Cloud nicht angenommen.');
                } catch (e) {
                    // abgelehnter Code: die Oberfläche lässt das Code-Feld stehen
                    if (e instanceof FachFehler) throw new FachFehler(e.statusCode, e.message, { code: 'zwei_faktor' });
                    throw e;
                }
            }
            if (!daten || !daten.token) throw new FachFehler(502, 'Unerwartete Antwort der Cloud bei der Anmeldung.');
            return { token: daten.token, user: daten.user || null };
        },

        // Geräteschlüssel für Updates (Spec docs/specs/2026-10-24-downloads-ueber-cloud-design.md): gebunden an den angemeldeten Benutzer.
        async holeGeraeteSchluessel(token, bezeichnung = 'Hallen-Server') {
            const antwort = await anfrage('/api/downloads/geraet', { methode: 'POST', token, body: { bezeichnung } });
            const daten = await lesJson(antwort, 'Der Geräteschlüssel konnte nicht aus der Cloud geholt werden.');
            if (!daten || !daten.schluessel) throw new FachFehler(502, 'Unerwartete Antwort der Cloud beim Geräteschlüssel.');
            return daten.schluessel;
        },

        async listeTurniere(token) {
            const antwort = await anfrage('/api/turniere', { token });
            const daten = await lesJson(antwort, 'Turniere konnten nicht aus der Cloud geladen werden.');
            if (!Array.isArray(daten)) throw new FachFehler(502, 'Unerwartete Antwort der Cloud bei der Turnierliste.');
            return daten;
        },

        // liveToken: die Cloud stellt zusätzlich ein Ingest-Token für die Teilnehmer-App aus (nur beim Holen, nicht beim Aktualisieren des Helferplans).
        async ladeExport(token, turnierId, { liveToken = false } = {}) {
            const pfad = `/api/turniere/${encodeURIComponent(turnierId)}/export${liveToken ? '?liveToken=1' : ''}`;
            const antwort = await anfrage(pfad, { token, timeoutMs: EXPORT_TIMEOUT_MS });
            const daten = await lesJson(antwort, 'Das Turnier konnte nicht aus der Cloud geholt werden.');
            if (!daten || typeof daten !== 'object' || !daten.turnier) {
                throw new FachFehler(502, 'Unerwartete Antwort der Cloud beim Export.');
            }
            return daten;
        },

        // Turnier nach dem Wettkampftag in die Cloud zurückspielen: dieselbe Datei wie beim Upload „Ergebnisse hochladen“.
        // Der Code (X-2FA-Code) ist nur für Super-Admins nötig, deren Anmeldung länger als 10 Minuten zurückliegt.
        async spieleZurueck(token, cloudTurnierId, daten, { code = null } = {}) {
            const contentBase64 = Buffer.from(JSON.stringify(daten), 'utf8').toString('base64');
            const eingabe = code == null ? '' : String(code).trim();
            const antwort = await anfrage(`/api/turniere/${encodeURIComponent(cloudTurnierId)}/import-ergebnisse`, {
                methode: 'POST', token, body: { contentBase64 }, timeoutMs: EXPORT_TIMEOUT_MS,
                zusatzHeader: eingabe ? { 'X-2FA-Code': eingabe } : {}
            });
            const ergebnis = await lesJson(antwort, 'Das Turnier konnte nicht in die Cloud zurückgespielt werden.');
            if (!ergebnis || typeof ergebnis !== 'object') {
                throw new FachFehler(502, 'Unerwartete Antwort der Cloud beim Zurückspielen.');
            }
            return ergebnis;
        }
    };
}
