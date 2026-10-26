// Fehlerprotokoll („Konsole“, nur Cloud): sammelt Fehler und Warnungen an einer Stelle, damit der Super-Admin sie sieht, ohne auf den
// Server zu schauen.
//   - Infos über wichtige Ereignisse (meldeInfo): Start, Migration, Sicherung, Aufräumen
//   - console.error / console.warn des Servers (155 Stellen im Code melden Fehler so) werden mitgeschrieben, die Ausgabe bleibt wie sie war
//   - uncaughtException (auch unbehandelte Promise-Fehler): wird eingetragen, danach beendet sich der Prozess wie bisher (Neustart durch
//     systemd bzw. den Überwacher); es läuft nie in einem unklaren Zustand weiter
//   - Express-Fehler (5xx) über die Fehlerbehandlung am Ende der Routen, als JSON-Antwort ohne Interna
//   - Fehler im Browser (window.onerror, unhandledrejection) über POST /api/fehler/browser (public/js/menu.js, login.html)
// Eingetragen wird gebündelt und mit Obergrenze (bei Fehlerflut werden Einträge verworfen und das als eigener Eintrag gemeldet); ein Fehler
// beim Eintragen löst nie einen neuen Eintrag aus. Aufbewahrung FEHLER_AUFBEWAHRUNG_TAGE (Standard 30).
import util from 'util';
import { IBAN_MUSTER } from '../shared/iban.js';

export const STANDARD_AUFBEWAHRUNG_TAGE = 30;
const MAX_MELDUNG = 500;
const MAX_DETAILS = 8000;
const MAX_PRO_MINUTE = 200;
const FLUSH_MS = 1500;

const SCHWAERZEN = [
    [/Bearer\s+[A-Za-z0-9._~+/=-]+/g, 'Bearer ***'],
    [/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '***jwt***'],
    [/((?:passwort|password|token|secret|schluessel)["']?\s*[:=]\s*["']?)[^\s"',;}]+/gi, '$1***'],
    [IBAN_MUSTER, '***IBAN***']
];

export function schwaerze(text) {
    return SCHWAERZEN.reduce((t, [muster, ersatz]) => t.replace(muster, ersatz), String(text));
}

/** Aus console-Argumenten: erste Zeile und (bei mehrzeiligen Texten oder Fehlerobjekten) die vollständige Meldung. */
export function formatiereMeldung(args) {
    const voll = schwaerze(util.format(...args));
    const erste = voll.split('\n')[0].trim() || '(leere Meldung)';
    const hatStack = args.some((a) => a instanceof Error);
    return { meldung: erste.slice(0, MAX_MELDUNG), details: voll.includes('\n') || hatStack || voll.length > MAX_MELDUNG ? voll.slice(0, MAX_DETAILS) : null };
}

let zustand = null;
// Infos vor der Installation (z. B. Migrationen beim Start) werden aufgehoben und danach eingetragen
const vorlauf = [];

/**
 * Meldet ein Ereignis als Info (Server gestartet, Migration, Sicherung, Aufräumen …) in die Konsole. Ohne Erfassung (Hallen-Server) passiert
 * nichts. `quelle`: 'server' (Standard) oder 'prozess' für Hintergrundläufe.
 */
export function meldeInfo(text, { quelle = 'server', pfad = null } = {}) {
    if (zustand) zustand.erfasse('info', quelle, ['%s', text], { pfad });
    else if (vorlauf.length < 50) vorlauf.push({ quelle, text, pfad });
}

/**
 * Hängt die Erfassung ein (einmal je Prozess). @returns {{ erfasse, leere: () => Promise<void>, stop: () => void }}
 * `knex`: Ziel; `konsole`/`prozess`: austauschbar für Tests.
 */
export function installiereFehlerErfassung(knex, { konsole = console, prozess = process, beendeBeiAbsturz = true } = {}) {
    if (zustand) zustand.stop();
    const original = { error: konsole.error.bind(konsole), warn: konsole.warn.bind(konsole) };
    const warteschlange = [];
    let imMinuten = { minute: 0, anzahl: 0, verworfen: 0 };
    let timer = null;
    let flushLaeuft = Promise.resolve();

    const jetztMinute = () => Math.floor(Date.now() / 60_000);

    function erfasse(ebene, quelle, args, zusatz = {}) {
        try {
            const { meldung, details } = Array.isArray(args) ? formatiereMeldung(args) : { meldung: String(args).slice(0, MAX_MELDUNG), details: null };
            if (imMinuten.minute !== jetztMinute()) {
                if (imMinuten.verworfen > 0) {
                    warteschlange.push({ ebene: 'warn', quelle: 'server', meldung: `${imMinuten.verworfen} weitere Meldungen in einer Minute verworfen (Fehlerflut)`, details: null, pfad: null, benutzer: null });
                }
                imMinuten = { minute: jetztMinute(), anzahl: 0, verworfen: 0 };
            }
            if (imMinuten.anzahl >= MAX_PRO_MINUTE) { imMinuten.verworfen += 1; return; }
            imMinuten.anzahl += 1;
            warteschlange.push({ ebene, quelle, meldung, details, pfad: zusatz.pfad ? String(zusatz.pfad).slice(0, 300) : null, benutzer: zusatz.benutzer ? String(zusatz.benutzer).slice(0, 254) : null });
            if (!timer) {
                timer = setTimeout(() => { timer = null; flushLaeuft = flushLaeuft.then(leere); }, FLUSH_MS);
                timer.unref?.();
            }
        } catch { /* Erfassen darf nie stören */ }
    }

    async function leere() {
        if (timer) { clearTimeout(timer); timer = null; }
        const paket = warteschlange.splice(0, warteschlange.length);
        if (paket.length === 0) return;
        try {
            await knex('fehlerprotokoll').insert(paket);
        } catch (err) {
            original.error('[Fehlerprotokoll] Eintragen fehlgeschlagen:', err.message); // original: kein neuer Eintrag
        }
    }

    konsole.error = (...args) => { original.error(...args); erfasse('error', 'server', args); };
    konsole.warn = (...args) => { original.warn(...args); erfasse('warn', 'server', args); };

    const beiAbsturz = (err, herkunft) => {
        erfasse('error', 'prozess', [`Prozess abgestürzt (${herkunft || 'uncaughtException'}):`, err]);
        const beenden = () => { if (beendeBeiAbsturz) prozess.exit(1); };
        Promise.race([leere(), new Promise((r) => setTimeout(r, 2000))]).then(beenden, beenden);
        if (!beendeBeiAbsturz) return;
        original.error(err);
    };
    prozess.on('uncaughtException', beiAbsturz);

    zustand = {
        erfasse,
        stop() {
            konsole.error = original.error;
            konsole.warn = original.warn;
            prozess.off('uncaughtException', beiAbsturz);
            if (timer) clearTimeout(timer);
            zustand = null;
        }
    };
    for (const v of vorlauf.splice(0)) erfasse('info', v.quelle, ['%s', v.text], { pfad: v.pfad });
    return { erfasse, leere, stop: () => zustand && zustand.stop(), original };
}

/** Express-Fehlerbehandlung (ans Ende der Routen): 5xx werden protokolliert und als JSON ohne Interna beantwortet. */
export function fehlerBehandlung(err, req, res, next) {
    const status = Number(err && (err.status || err.statusCode)) || 500;
    if (res.headersSent) return next(err);
    if (status >= 500) {
        console.error(`[${req.method} ${String(req.originalUrl || req.url).split('?')[0]}]`, err);
        return res.status(status).json({ success: false, error: 'Interner Server-Fehler.' });
    }
    // Client-Fehler (zu großer oder ungültiger Body, …): kein Eintrag, kurze Antwort wie bisher
    return res.status(status).json({ success: false, error: status === 413 ? 'Die Anfrage ist zu groß.' : 'Ungültige Anfrage.' });
}

// --- Lesen ---
export const EINTRAEGE_JE_ABFRAGE = 200;

/**
 * @param {{ ebene?: 'info'|'error'|'warn'|'alle', quelle?: string, suche?: string, nach?: number|string, vor?: number|string, limit?: number, gruppiert?: boolean }} f
 * Liefert zusätzlich `zaehler` (gesamt, info, warn, error) für die Kacheln: gezählt wird mit Quelle und Suche, aber ohne Ebene.
 */
export async function listeFehler(knex, f = {}) {
    const limit = Math.min(500, Math.max(1, Number(f.limit) || EINTRAEGE_JE_ABFRAGE));
    const ganzzahl = (w) => (/^\d+$/.test(String(w ?? '')) ? Number(w) : null);
    const wie = (text) => `%${String(text).trim().replace(/[\\%_]/g, (z) => `\\${z}`)}%`;
    const ohneEbene = () => {
        const q = knex('fehlerprotokoll');
        if (['server', 'prozess', 'browser'].includes(f.quelle)) q.where('quelle', f.quelle);
        if (f.suche && String(f.suche).trim()) q.where((b) => b.whereILike('meldung', wie(f.suche)).orWhereILike('details', wie(f.suche)).orWhereILike('pfad', wie(f.suche)));
        return q;
    };
    const basis = () => {
        const q = ohneEbene();
        if (['info', 'warn', 'error'].includes(f.ebene)) q.where('ebene', f.ebene);
        const nach = ganzzahl(f.nach);
        const vor = ganzzahl(f.vor);
        if (nach != null) q.where('id', '>', nach);
        if (vor != null) q.where('id', '<', vor);
        return q;
    };
    const neuesteId = (await knex('fehlerprotokoll').max('id as m').first()).m;
    const zaehler = { gesamt: 0, info: 0, warn: 0, error: 0 };
    for (const z of await ohneEbene().groupBy('ebene').select('ebene').count('* as n')) {
        zaehler[z.ebene] = Number(z.n);
        zaehler.gesamt += Number(z.n);
    }
    const kopf = { neuesteId: neuesteId == null ? null : String(neuesteId), zaehler };
    if (f.gruppiert) {
        const gruppen = await basis().groupBy('meldung', 'ebene', 'quelle')
            .select('meldung', 'ebene', 'quelle').count('* as anzahl').max('zeitpunkt as zuletzt').min('zeitpunkt as erstmals').max('id as letzte_id')
            .orderBy('zuletzt', 'desc').limit(limit);
        return { ...kopf, gruppen: gruppen.map((g) => ({ ...g, anzahl: Number(g.anzahl), zuletzt: new Date(g.zuletzt).toISOString(), erstmals: new Date(g.erstmals).toISOString(), letzte_id: String(g.letzte_id) })) };
    }
    const zeilen = await basis().orderBy('id', 'desc').limit(limit).select('id', 'zeitpunkt', 'ebene', 'quelle', 'meldung', 'details', 'pfad', 'benutzer');
    return { ...kopf, eintraege: zeilen.map((z) => ({ ...z, id: String(z.id), zeitpunkt: new Date(z.zeitpunkt).toISOString() })) };
}

export async function bereinigeFehler(knex, tage = STANDARD_AUFBEWAHRUNG_TAGE) {
    const n = Number(tage);
    if (!Number.isFinite(n) || n < 1) return 0;
    return knex('fehlerprotokoll').where('zeitpunkt', '<', knex.raw("now() - (? * interval '1 day')", [n])).del();
}
