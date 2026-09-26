// Client-Knoten (SYNC_ROLLE=client, Notebook/Tablet an Matte oder Waage): keine relationale DB,
// nur eine lokale PouchDB, die per Live-Replikation mit der Turnier-DB des Hallen-Servers
// abgeglichen wird. Der Browser arbeitet ausschließlich gegen http://localhost — fällt das WLAN
// aus, läuft alles lokal weiter (Spec CouchDB-Umbau, Abschnitte 3, 4, 8).
import { mkdirSync, writeFileSync, readdirSync, readFileSync } from 'fs';
import path from 'path';
import { erzeugeDokumentDb, turnierDbName } from './dokumentDb.js';
import { erzeugeReplikation } from './replikation.js';
import { erzeugeClientKonfig } from './clientKonfig.js';
import { erzeugeKaskadeLokal } from './kaskadeLokal.js';

const PRUEF_INTERVALL_MS = 5000;
const HEARTBEAT_INTERVALL_MS = 30000;
const HEARTBEAT_AKTIV_MS = 2 * 60 * 1000;

export async function starteClientDienst({ konfig }) {
    const dokumentDb = erzeugeDokumentDb(konfig);
    const clientKonfig = await erzeugeClientKonfig(dokumentDb.PouchDB);
    const replikation = erzeugeReplikation({ PouchDB: dokumentDb.PouchDB, konfig, clientId: clientKonfig.clientId });

    const verworfenVerzeichnis = path.join(path.resolve(konfig.datenverzeichnis), 'verworfen');
    const zustand = {
        instanzId: null,
        db: null,
        serverErreichbar: false,
        uhrOffsetMs: 0,
        instanzwechselLaeuft: false
    };
    const beiNeuerDb = []; // Rückrufe (kaskadeLokal, clientApi-Caches), wenn die lokale DB wechselt

    async function oeffneInstanz(instanzId) {
        zustand.instanzId = instanzId;
        zustand.db = await dokumentDb.oeffneSicher(turnierDbName(instanzId));
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
            return status;
        } catch (err) {
            zustand.serverErreichbar = false;
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
        dokumentDb,
        beiNeuerDb(rueckruf) {
            beiNeuerDb.push(rueckruf);
            if (zustand.db) rueckruf(zustand.db);
        },
        // Nur localhost, nur die DB der aktuellen Instanz (und GET /db/ für PouchDB im Browser).
        middleware(req, res, next) {
            const adresse = req.socket.remoteAddress || '';
            const lokal = adresse === '127.0.0.1' || adresse === '::1' || adresse === '::ffff:127.0.0.1';
            if (!lokal) return res.status(403).json({ error: 'forbidden', reason: 'Nur von diesem Gerät aus erreichbar' });
            const erstesSegment = decodeURIComponent(req.path.split('/')[1] || '');
            if (erstesSegment === '' && req.method === 'GET') return dokumentDb.middleware(req, res, next);
            if (!zustand.instanzId || erstesSegment !== turnierDbName(zustand.instanzId)) {
                return res.status(404).json({ error: 'not_found', reason: 'Keine aktuelle Turnier-DB' });
            }
            return dokumentDb.middleware(req, res, next);
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
                instanzwechsel_laeuft: zustand.instanzwechselLaeuft,
                uhr_offset_ms: zustand.uhrOffsetMs,
                matte_id: await clientKonfig.matteId()
            };
        },
        // Turnierwechsel am Server (Spec Abschnitt 8): noch nicht übertragene eigene Änderungen des
        // alten Turniers gehören zu keinem Turnier mehr — sie werden als JSON gesichert
        // (<SYNC_DATENVERZEICHNIS>/verworfen/<alte_instanz>_<zeitstempel>.json) statt still zu
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
                        mkdirSync(verworfenVerzeichnis, { recursive: true });
                        const datei = path.join(verworfenVerzeichnis, `${zustand.instanzId}_${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
                        writeFileSync(datei, JSON.stringify({ alte_instanz_id: zustand.instanzId, neue_instanz_id: neueInstanzId, dokumente }, null, 2));
                        console.warn(`[Client-Sync] Turnierwechsel: ${dokumente.length} nicht übertragene Änderung(en) gesichert in ${datei}`);
                    }
                    await zustand.db.destroy();
                }
                await oeffneInstanz(neueInstanzId);
            } finally {
                zustand.instanzwechselLaeuft = false;
            }
        },
        verworfeneDateien() {
            try {
                return readdirSync(verworfenVerzeichnis)
                    .filter(n => n.endsWith('.json'))
                    .map(n => ({ datei: n, ...JSON.parse(readFileSync(path.join(verworfenVerzeichnis, n), 'utf-8')) }));
            } catch (err) {
                return [];
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
        // Test-Hilfe: wartet, bis alle eigenen Änderungen übertragen sind und die Replikation ruht.
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
        }
    };

    const kaskade = erzeugeKaskadeLokal({ client: dienst });

    // Start: zuletzt bekannte Instanz sofort öffnen (offline-fähig), danach den Server fragen.
    const letzte = await clientKonfig.letzteInstanz();
    if (letzte) await oeffneInstanz(letzte);
    await pruefeSeriell();
    setInterval(pruefeSeriell, PRUEF_INTERVALL_MS).unref();
    setInterval(() => { schreibeHeartbeat(); }, HEARTBEAT_INTERVALL_MS).unref();
    schreibeHeartbeat();

    return dienst;
}
