// Browser-Laufzeit der Android-App: ersetzt den Node-Prozess eines Desktop-Clients. Dieselbe
// Client-Logik (src/shared/clientKern.js: lokale Turnier-DB, Replikation zum Hallen-Server,
// Turnierwechsel, Mattenwahl, Offline-Kaskade) läuft hier in der WebView, die Lese-API der Seiten
// kommt aus src/shared/clientAntworten.js. Die Turnier-DB liegt in IndexedDB (PouchDB), die
// Kopplung (Server-Adresse + Geheimnis) in localStorage.
import { erzeugeClientKern } from '/js/shared/clientKern.js';
import { erzeugeClientKonfig } from '/js/shared/clientKonfig.js';
import { beantworteClientAnfrage, NUR_AM_SERVER } from '/js/shared/clientAntworten.js';
import { APP_VERSION } from '/js/mobil/appVersion.js';
import { waehleAndroidUpdate } from '/js/shared/appUpdate.js';

function antwort(status, body) {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

async function sha256Hex(text) {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function geraetename() {
    const treffer = /Android [\d.]+; ([^)]+)\)/.exec(navigator.userAgent);
    return treffer ? `Android ${treffer[1].replace(/ Build.*$/, '')}` : 'Android-Gerät';
}

async function leseBody(eingabe, optionen) {
    let roh = null;
    if (optionen && optionen.body !== undefined) roh = optionen.body;
    else if (eingabe && typeof eingabe.clone === 'function') roh = await eingabe.clone().text();
    if (typeof roh !== 'string' || !roh) return null;
    try { return JSON.parse(roh); } catch (e) { return null; }
}

function leseKopfzeilen(eingabe, optionen) {
    const kopfzeilen = {};
    const quellen = [eingabe && eingabe.headers, optionen && optionen.headers].filter(Boolean);
    for (const quelle of quellen) {
        for (const [name, wert] of new Headers(quelle).entries()) kopfzeilen[name.toLowerCase()] = wert;
    }
    return kopfzeilen;
}

export async function starteLaufzeit(mobil) {
    const verbindung = mobil.verbindung;
    // Noch nicht gekoppelt (verbinden.html): keine Datenbank, die Seite spricht selbst mit dem Server.
    if (!verbindung) {
        return { kern: null, behandle: async () => antwort(503, { error: 'Gerät ist noch nicht mit einem Hallen-Server gekoppelt.' }) };
    }

    const PouchDB = window.PouchDB;
    const konfigDb = new PouchDB('hajime_client');
    const clientKonfig = await erzeugeClientKonfig({ db: konfigDb, neueId: () => crypto.randomUUID(), geraet: geraetename() });
    const konfig = { serverUrl: verbindung.serverUrl, secret: verbindung.secret };

    let versionsHinweis = null;
    const kern = await erzeugeClientKern({
        konfig,
        PouchDB,
        oeffneDb: async (name) => new PouchDB(name),
        clientKonfig,
        // Nicht übertragene Änderungen eines abgelösten Turniers bleiben als Dokument in der
        // Geräte-Datenbank erhalten (analog zur JSON-Datei im Node-Client).
        async sichereVerworfene({ alteInstanzId, neueInstanzId, dokumente }) {
            await konfigDb.put({
                _id: `verworfen:${alteInstanzId}:${new Date().toISOString()}`,
                alte_instanz_id: alteInstanzId,
                neue_instanz_id: neueInstanzId,
                dokumente
            });
            console.warn(`[Client-Sync] Turnierwechsel: ${dokumente.length} nicht übertragene Änderung(en) gesichert.`);
        },
        holeUpdateHinweis: () => versionsHinweis
    });
    // Offline sofort mit den lokalen Daten starten; die Serverprüfung läuft im Hintergrund weiter.
    await kern.starte({ warteAufServer: false });

    // Client und Server sind versionsgekoppelt (wie beim Desktop-Client). Gibt der Server eine NEUERE App-Version aus,
    // lädt die App die APK vom Server (SHA-256 aus dessen version.json), öffnet den Android-Installationsdialog und der
    // Nutzer bestätigt. Pro App-Sitzung höchstens ein Versuch je Version (die Seiten laden sich bei jedem Wechsel neu).
    // Weicht die Version anders ab (Server älter) oder geht es nicht (kein Plugin, Download-Fehler), bleibt der Hinweis
    // in der Statusleiste.
    (async () => {
        try {
            const resp = await mobil.echteFetch(`${konfig.serverUrl}/api/client/version`, { signal: AbortSignal.timeout(4000) });
            if (!resp.ok) return;
            const versionJson = await resp.json();
            const version = versionJson && versionJson.version;
            if (!version || version === APP_VERSION) return;
            versionsHinweis = `Server hat Version ${version}, diese App ${APP_VERSION} – neue App unter ${konfig.serverUrl}/download laden`;
            const update = waehleAndroidUpdate({ versionJson, appVersion: APP_VERSION });
            const plugin = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()
                ? window.Capacitor.registerPlugin('AppUpdate') : null;
            if (!update || !plugin) return;
            const marke = `hajime_update_versucht_${update.version}`;
            if (sessionStorage.getItem(marke)) return;
            sessionStorage.setItem(marke, '1');
            versionsHinweis = `Update auf Version ${update.version} wird geladen …`;
            const ergebnis = await plugin.installiere({ url: `${konfig.serverUrl}${update.pfad}`, sha256: update.sha256 });
            versionsHinweis = ergebnis && ergebnis.status === 'erlaubnis'
                ? `Update ${update.version}: bitte „Installation unbekannter Apps“ für Hajime Pro erlauben und die App neu starten`
                : `Update ${update.version} bereit – bitte die Installation bestätigen`;
        } catch (e) {
            if (versionsHinweis && /wird geladen/.test(versionsHinweis)) versionsHinweis = `Update fehlgeschlagen (${e.message || e}) – neue App unter ${konfig.serverUrl}/download laden`;
            /* offline: kein Hinweis */
        }
    })();

    async function sync(methode, pfad, query, body) {
        if (pfad === '/api/sync/status' && methode === 'GET') {
            return antwort(200, { ...(await kern.status()), app: true, app_version: APP_VERSION, server_url: konfig.serverUrl });
        }
        if (pfad === '/api/sync/client/matte' && methode === 'GET') {
            return antwort(200, { matte_id: await clientKonfig.matteId() });
        }
        if (pfad === '/api/sync/client/matte/pruefen' && methode === 'GET') {
            return antwort(200, await kern.pruefeMattenwechsel(Number(query.matte_id)));
        }
        if (pfad === '/api/sync/client/matte' && methode === 'PUT') {
            if (!body || !body.matte_id) return antwort(400, { success: false, error: 'matte_id fehlt.' });
            await kern.setzeMatte(Number(body.matte_id));
            return antwort(200, { success: true, matte_id: Number(body.matte_id) });
        }
        return antwort(404, { success: false, error: 'Nur am Hallen-Server.' });
    }

    return {
        kern,
        clientKonfig,
        // Ersetzt fetch() für Aufrufe an die eigene Herkunft unter /api/.
        async behandle(eingabe, optionen, url) {
            const methode = String((optionen && optionen.method) || (eingabe && eingabe.method) || 'GET').toUpperCase();
            const query = Object.fromEntries(url.searchParams);
            const body = await leseBody(eingabe, optionen);
            try {
                if (url.pathname.startsWith('/api/sync/')) return await sync(methode, url.pathname, query, body);
                if (url.pathname === '/api/config') {
                    return antwort(200, { isOffline: true, syncRolle: 'client', betriebsmodus: 'client' });
                }
                // Statische Konfiguration (im Build als Datei mitgeliefert, siehe scripts/baue-android-www.mjs).
                if (url.pathname === '/api/djb-klassen') return await mobil.echteFetch('/config/altersklassen.json');
                if (url.pathname === '/api/graduierungen') return await mobil.echteFetch('/config/graduierungen.json');
                if (url.pathname === '/api/cluster/status') return antwort(200, { aktiv: false });
                if (url.pathname.startsWith('/api/cluster/')) return antwort(404, { success: false, error: NUR_AM_SERVER });
                if (!kern.zustand.db) {
                    return antwort(503, { error: 'Noch keine Turnierdaten — bitte einmal mit dem Hallen-Server verbinden.' });
                }
                const ergebnis = await beantworteClientAnfrage(
                    { methode, pfad: url.pathname.slice('/api'.length), query, body, kopfzeilen: leseKopfzeilen(eingabe, optionen) },
                    { db: kern.zustand.db, sha256Hex }
                );
                return antwort(ergebnis.status, ergebnis.body);
            } catch (err) {
                console.error('[Laufzeit] Fehler bei', url.pathname, err);
                return antwort(500, { error: 'Interner Fehler' });
            }
        }
    };
}
