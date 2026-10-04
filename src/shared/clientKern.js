// Gemeinsamer Kern eines Client-Geräts (Notebook/Tablet per Node-Prozess UND Android-App im
// Browser): lokale Turnier-DB, Live-Replikation zum Hallen-Server, Turnierwechsel, Mattenwahl,
// Heartbeat, Offline-Kaskade. Bewusst ohne Node- und Browser-Abhängigkeiten — alles
// Plattformspezifische (DB öffnen, Verworfenes sichern, Geräteeinstellungen) kommt von außen.
import { turnierDbName } from './dokumentNamen.js';
import { erzeugeReplikation } from './replikation.js';
import { erzeugeKaskadeLokal } from './kaskadeLokal.js';

const PRUEF_INTERVALL_MS = 5000;
const HEARTBEAT_INTERVALL_MS = 30000;
const HEARTBEAT_AKTIV_MS = 2 * 60 * 1000;

// konfig: { serverUrl, secret } — wird zur Laufzeit verändert (setzeVerbindung), die Replikation
//         liest dasselbe Objekt.
// oeffneDb(name): öffnet/legt die lokale DB an.
// sichereVerworfene({ alteInstanzId, neueInstanzId, dokumente }): sichert nicht übertragene
//         Änderungen des alten Turniers.
// holeUpdateHinweis(): Text, wenn ein Selbst-Update aufgegeben wurde (nur Desktop), sonst null.
export async function erzeugeClientKern({ konfig, PouchDB, oeffneDb, clientKonfig, sichereVerworfene, holeUpdateHinweis = () => null }) {
    const replikation = erzeugeReplikation({ PouchDB, konfig, clientId: clientKonfig.clientId });

    const zustand = {
        instanzId: null,
        db: null,
        serverErreichbar: false,
        serverModus: null, // 'master' | 'secondary' laut /api/sync/status des Servers
        uhrOffsetMs: 0,
        instanzwechselLaeuft: false
    };
    const beiNeuerDb = []; // Rückrufe (kaskadeLokal, clientApi-Caches), wenn die lokale DB wechselt

    async function oeffneInstanz(instanzId) {
        zustand.instanzId = instanzId;
        zustand.db = await oeffneDb(turnierDbName(instanzId));
        await clientKonfig.merkeInstanz(instanzId);
        await replikation.starte(zustand.db);
        for (const rueckruf of beiNeuerDb) await rueckruf(zustand.db);
    }

    async function frageServer() {
        try {
            const resp = await fetch(`${konfig.serverUrl}/api/sync/status`, { signal: AbortSignal.timeout(3000) });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const status = await resp.json();
            const serverZeit = Date.parse(resp.headers.get('date'));
            if (!Number.isNaN(serverZeit)) zustand.uhrOffsetMs = serverZeit - Date.now();
            zustand.serverErreichbar = true;
            zustand.serverModus = status.modus || null;
            return status;
        } catch (err) {
            zustand.serverErreichbar = false;
            zustand.serverModus = null;
            return null;
        }
    }

    // ALLE Serverprüfungen (Intervall, Wiederverbinden, Test-Leerlauf) laufen strikt nacheinander:
    // zwei gleichzeitig erkannte Turnierwechsel würden sonst die lokale DB parallel löschen und neu
    // öffnen (Zustand kaputt, Client hinge auf der alten Instanz fest).
    let pruefung = Promise.resolve();
    function pruefeSeriell() {
        pruefung = pruefung
            .then(pruefeServer)
            .catch(err => console.error('[Client-Sync] Prüfung fehlgeschlagen:', err));
        return pruefung;
    }

    async function pruefeServer() {
        if (replikation.status().getrennt) {
            zustand.serverErreichbar = false;
            return;
        }
        const status = await frageServer();
        if (!status || !status.instanz_id) return;
        if (!zustand.instanzId) {
            await oeffneInstanz(status.instanz_id);
        } else if (status.instanz_id !== zustand.instanzId) {
            await dienst.wechsleInstanz(status.instanz_id);
        } else {
            replikation.sicherstellen();
        }
    }

    // Heartbeat client:<clientId>: welches Gerät bedient welche Matte (für die Warnung beim
    // Mattenwechsel eines anderen Geräts und die Client-Übersicht am Server). Nur solange verbunden
    // — ein offline gelaufener Heartbeat hätte keine Aussagekraft.
    async function schreibeHeartbeat() {
        if (!zustand.db || !zustand.serverErreichbar || replikation.status().getrennt) return;
        const id = `client:${clientKonfig.clientId}`;
        const alt = await zustand.db.get(id).catch(() => null);
        await zustand.db.put({
            ...(alt || {}),
            _id: id,
            dokumenttyp: 'client',
            client_id: clientKonfig.clientId,
            geraet: clientKonfig.geraet,
            matte_id: await clientKonfig.matteId(),
            letzter_kontakt: new Date(Date.now() + zustand.uhrOffsetMs).toISOString(),
            ausstehend: replikation.status().ausstehend,
            bearbeitet_von: 'client-heartbeat'
        }).catch(err => {
            if (err.status !== 409) console.error('[Client-Sync] Heartbeat fehlgeschlagen:', err);
        });
    }

    async function kampfDokumenteDerMatte(matteId) {
        const alle = await zustand.db.allDocs({ include_docs: true });
        const docs = alle.rows.map(r => r.doc).filter(Boolean);
        const poolIds = new Set(docs.filter(d => d.dokumenttyp === 'pool' && Number(d.kampfflaeche_id) === Number(matteId)).map(d => d.id));
        return { docs, kaempfe: docs.filter(d => d.dokumenttyp === 'kampf' && poolIds.has(d.pool_id)) };
    }

    const dienst = {
        rolle: 'client',
        zustand,
        clientKonfig,
        replikation,
        beiNeuerDb(rueckruf) {
            beiNeuerDb.push(rueckruf);
            if (zustand.db) rueckruf(zustand.db);
        },
        async status() {
            const r = replikation.status();
            return {
                rolle: 'client',
                client_id: clientKonfig.clientId,
                instanz_id: zustand.instanzId,
                db_name: zustand.instanzId ? turnierDbName(zustand.instanzId) : null,
                verbunden: zustand.serverErreichbar && !r.getrennt && !r.fehler,
                ausstehend: r.ausstehend,
                fehler: r.fehler,
                // Gesetzt vom Desktop-Updater (desktop/updater.js), wenn ein Update aufgegeben wurde.
                update_hinweis: holeUpdateHinweis(),
                instanzwechsel_laeuft: zustand.instanzwechselLaeuft,
                uhr_offset_ms: zustand.uhrOffsetMs,
                matte_id: await clientKonfig.matteId()
            };
        },
        // Turnierwechsel am Server (Spec Abschnitt 8): noch nicht übertragene eigene Änderungen des
        // alten Turniers gehören zu keinem Turnier mehr — sie werden gesichert statt still zu
        // verschwinden, danach wird die lokale DB durch die neue Instanz ersetzt.
        async wechsleInstanz(neueInstanzId) {
            zustand.instanzwechselLaeuft = true;
            try {
                await replikation.stoppe();
                if (zustand.db) {
                    const ids = replikation.ausstehendeIds();
                    if (ids.length) {
                        const res = await zustand.db.allDocs({ keys: ids, include_docs: true });
                        const dokumente = res.rows.map(r => r.doc).filter(Boolean);
                        await sichereVerworfene({ alteInstanzId: zustand.instanzId, neueInstanzId, dokumente });
                    }
                    await zustand.db.destroy();
                }
                await oeffneInstanz(neueInstanzId);
            } finally {
                zustand.instanzwechselLaeuft = false;
            }
        },
        async setzeMatte(matteId) {
            await clientKonfig.setzeMatte(matteId);
            await schreibeHeartbeat();
        },
        async pruefeMattenwechsel(neueMatteId) {
            const ergebnis = { ausstehend: replikation.status().ausstehend, laufender_kampf: false, warnung: null };
            if (!zustand.db) return ergebnis;
            const bisher = await clientKonfig.matteId();
            if (bisher) {
                const { kaempfe } = await kampfDokumenteDerMatte(bisher);
                ergebnis.laufender_kampf = kaempfe.some(k => k.status === 'gestartet');
            }
            const { docs } = await kampfDokumenteDerMatte(neueMatteId);
            const jetzt = Date.now() + zustand.uhrOffsetMs;
            const anderer = docs.find(d => d.dokumenttyp === 'client' && d.client_id !== clientKonfig.clientId
                && Number(d.matte_id) === Number(neueMatteId) && jetzt - Date.parse(d.letzter_kontakt) < HEARTBEAT_AKTIV_MS);
            if (anderer) {
                const matte = docs.find(d => d.dokumenttyp === 'kampfflaeche' && Number(d.id) === Number(neueMatteId));
                ergebnis.warnung = `Achtung: ${matte ? matte.bezeichnung : 'Diese Matte'} wird bereits vom Gerät "${anderer.geraet}" bedient.`;
            }
            return ergebnis;
        },
        trennen() {
            replikation.trennen();
            zustand.serverErreichbar = false;
        },
        async verbinden() {
            replikation.verbinden();
            await pruefeSeriell();
        },
        // Server-Adresse (neuer Master nach mDNS-Suche) oder Geheimnis (nach erneuter Kopplung) zur
        // Laufzeit ändern. konfig ist dasselbe Objekt, das replikation.js für die Remote-DB liest —
        // ein Neustart der Replikation genügt. Läuft in derselben Kette wie pruefeSeriell: ein
        // gleichzeitig laufender Turnierwechsel (wechsleInstanz stoppt/startet die Replikation)
        // darf sich nicht mit dem Neustart hier überschneiden.
        setzeVerbindung({ serverUrl, secret } = {}) {
            const schritt = pruefung.then(async () => {
                if (serverUrl) konfig.serverUrl = String(serverUrl).replace(/\/+$/, '');
                if (secret !== undefined) konfig.secret = secret;
                zustand.serverModus = null;
                if (zustand.db) await replikation.starte(zustand.db);
                await pruefeServer();
            });
            pruefung = schritt.catch(err => console.error('[Client-Sync] Verbindungswechsel fehlgeschlagen:', err));
            return schritt;
        },
        // Wartet, bis alle eigenen Änderungen übertragen sind und die Replikation ruht.
        async leerlauf(maxMs = 15000) {
            const ende = Date.now() + maxMs;
            await kaskade.leerlauf();
            await pruefeSeriell();
            while (Date.now() < ende) {
                const r = replikation.status();
                if (r.getrennt) {
                    await kaskade.leerlauf();
                    return;
                }
                if (zustand.serverErreichbar && r.ruhend && r.ausstehend === 0) {
                    await new Promise(res => setTimeout(res, 300));
                    const r2 = replikation.status();
                    if (r2.ruhend && r2.ausstehend === 0) return;
                }
                await new Promise(res => setTimeout(res, 100));
            }
        },
        // Wartet, bis eine lokale Turnier-DB offen ist (nach der Kopplung eines neuen Geräts).
        async warteAufInstanz(maxMs = 15000) {
            const ende = Date.now() + maxMs;
            while (!zustand.instanzId && Date.now() < ende) {
                await pruefeSeriell();
                if (!zustand.instanzId) await new Promise(res => setTimeout(res, 500));
            }
            return zustand.instanzId;
        }
    };

    const kaskade = erzeugeKaskadeLokal({ client: dienst });

    // Start: zuletzt bekannte Instanz sofort öffnen (offline-fähig), danach den Server fragen.
    // Die Intervalle laufen für die Lebensdauer des Prozesses/der Seite.
    // warteAufServer=false: nicht auf die erste Serverprüfung warten (Android-App: eine Seite soll
    // offline sofort mit den lokalen Daten starten, nicht erst nach dem Verbindungs-Timeout).
    dienst.starte = async function starte({ warteAufServer = true } = {}) {
        const letzte = await clientKonfig.letzteInstanz();
        if (letzte) await oeffneInstanz(letzte);
        const erstePruefung = pruefeSeriell();
        if (warteAufServer) await erstePruefung;
        const unref = (t) => { if (t && t.unref) t.unref(); };
        unref(setInterval(pruefeSeriell, PRUEF_INTERVALL_MS));
        unref(setInterval(() => { schreibeHeartbeat(); }, HEARTBEAT_INTERVALL_MS));
        schreibeHeartbeat();
        return dienst;
    };

    return dienst;
}
