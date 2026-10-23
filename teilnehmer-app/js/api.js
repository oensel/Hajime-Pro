// Dünne Schicht über die App-API der Cloud (/api/live). Wirft bei Netzfehlern und Nicht-2xx; die Oberfläche fällt dann
// auf den zuletzt gespeicherten Stand zurück. Jede Abfrage eines Turniers sendet den Zugangscode aus dem QR-Code (zugang.js)
// im Kopf X-Live-Zugang. Verliert ein Code seine Gültigkeit (ersetzt, gesperrt, abgelaufen), meldet das Ereignis
// `hajime:zugang-verloren` { key, grund } und die App räumt auf (app.js).
import { holeZugang } from './zugang.js';

const BASIS = '/api/live';
const GRUENDE = new Set(['zugang', 'gesperrt', 'abgelaufen']);

async function hole(pfad, optionen = {}) {
    const turnier = /^\/turniere\/([^/?]+)/.exec(pfad);
    const key = turnier ? decodeURIComponent(turnier[1]) : null;
    const zugang = key ? holeZugang(key) : null;
    const antwort = await fetch(BASIS + pfad, {
        cache: 'no-store', ...optionen,
        headers: { ...(zugang ? { 'X-Live-Zugang': zugang.code } : {}), ...(optionen.headers || {}) }
    });
    if (!antwort.ok) {
        const koerper = await antwort.json().catch(() => ({}));
        const fehler = Object.assign(new Error(`HTTP ${antwort.status}`), { status: antwort.status, code: koerper.code || null });
        if (key && (antwort.status === 401 || antwort.status === 403) && GRUENDE.has(fehler.code)) {
            window.dispatchEvent(new CustomEvent('hajime:zugang-verloren', { detail: { key, grund: fehler.code } }));
        }
        throw fehler;
    }
    return antwort.status === 204 ? null : antwort.json();
}

const t = (key) => `/turniere/${encodeURIComponent(key)}`;

export const api = {
    // Tauscht den Code aus dem QR-Code gegen das Turnier ein (ohne gültigen Code erfährt die App nichts über Turniere).
    zugangAufloesen: (code) => hole('/zugang/aufloesen', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code })
    }),
    turnier: (key) => hole(t(key)),
    suche: (key, q) => hole(`${t(key)}/suche?q=${encodeURIComponent(q)}`),
    pools: (key) => hole(`${t(key)}/pools`),
    dashboard: (key) => hole(`${t(key)}/dashboard`),
    mannschaften: (key) => hole(`${t(key)}/mannschaften`),
    mannschaft: (key, teamKey) => hole(`${t(key)}/mannschaften/${encodeURIComponent(teamKey)}`),
    pool: (key, poolId) => hole(`${t(key)}/pools/${encodeURIComponent(poolId)}`),
    verein: (key, vereinKey) => hole(`${t(key)}/vereine/${encodeURIComponent(vereinKey)}`),
    uebersicht: (key, anfrage) => hole(`${t(key)}/uebersicht`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(anfrage)
    }),
    pushSchluessel: () => hole('/push/schluessel'),
    pushAnmelden: (key, daten) => hole(`${t(key)}/push`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(daten)
    }),
    pushAbmelden: (key, endpoint) => hole(`${t(key)}/push`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint })
    })
};
