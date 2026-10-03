// Zentraler Sync-Dienst des Hallen-Servers: hält die Dokument-DB der aktuellen Turnier-Instanz,
// setzt beim Turnierwechsel alles zurück und bündelt Abgleich (SQL -> Dokumente) und Brücke
// (Dokumente -> SQL). Genau ein Turnier pro Hallen-Server (Spec CouchDB-Umbau, Abschnitt 8).
//
// Im Server-Cluster (src/cluster/) läuft der Dienst in einem von zwei Modi:
//  - 'master':    Abgleich + Brücke aktiv, nimmt Schreibzugriffe an, schreibt die Instanz-ID.
//  - 'secondary': PostgreSQL ist Hot Standby (nur lesend). Keine Brücke, kein Abgleich; die
//                 aktuelle Instanz wird aus der replizierten DB gelesen und alle 2 s geprüft.
// In beiden Modi zieht er die Dokumente des Partners (Pull-Replikation) — zusammen mit dem
// Pull des Partners ergibt das eine Replikation in beide Richtungen.
import { randomUUID } from 'crypto';
import { erzeugeDokumentDb, turnierDbName } from './dokumentDb.js';
import { erzeugeAbgleich } from './abgleich.js';
import { erzeugeBruecke } from './bruecke.js';

// Löscht alle Turnierdaten; benutzer/vereine bleiben erhalten (Login am Hallen-Server).
export async function leereTurnierdaten(knex) {
    await knex('kaempfe').del();
    await knex('mannschaftskaempfe').del();
    await knex('mannschaft_mitglieder').del();
    await knex('mannschaften').del();
    await knex('turnier_teilnehmer').del();
    await knex('pools').del();
    await knex('kampfflaechen').del();
    await knex('turniere').del();
    await knex('sync_angewendet').del();
}

const INSTANZ_PRUEFUNG_MS = 2000;

export async function starteSyncDienst({ knex, konfig, partnerUrl = null, startModus = 'master' }) {
    if (!konfig.istServer) return null;

    const dokumentDb = erzeugeDokumentDb(konfig);
    const zustand = { instanzId: null, turnierId: null, db: null, epoche: 0 };
    let modus = startModus;
    let schreibenErlaubt = () => modus === 'master';
    let instanzTimer = null;
    const partnerRepl = { repl: null, aktiv: false, lastSeq: null, fehler: null };
    const abgleich = erzeugeAbgleich({ knex, zustand });
    const bruecke = erzeugeBruecke({ knex, zustand, abgleich });

    // Nur die DB der aktuellen Instanz ist über /db erreichbar — alle anderen Namen (alte
    // Instanzen, Tippfehler) liefern 404, damit niemand eine gelöschte DB versehentlich per
    // Replikation wieder anlegt. GET /db/ (Server-Info) bleibt erlaubt, PouchDB-Clients brauchen es.
    function middleware(req, res, next) {
        // SYNC_SECRET (optional): Replikationsanfragen von Client-Knoten müssen es mitsenden.
        // Browser des Server-Frontends (erkennbar an Sec-Fetch-Site: same-origin, das nur ein
        // Browser für Anfragen seiner eigenen Seite setzt) sind ausgenommen — die Hallen-REST-API
        // ist ohnehin offen (Offline-Mock-User). Schutz gegen versehentliche fremde Replikation,
        // nicht gegen Angreifer im Hallennetz.
        const browserDerEigenenSeite = req.headers['sec-fetch-site'] === 'same-origin';
        if (konfig.secret && !browserDerEigenenSeite && req.headers['x-hajime-sync-secret'] !== konfig.secret) {
            return res.status(401).json({ error: 'unauthorized', reason: 'SYNC_SECRET fehlt oder ist falsch' });
        }
        // Secondary (bzw. Master während einer Übergabe): Browser dürfen nur lesen. Die Replikation
        // mit dem Partner und den Clients (keine Browser-Anfragen) läuft weiter.
        if (browserDerEigenenSeite && !['GET', 'HEAD'].includes(req.method) && !schreibenErlaubt()) {
            return res.status(409).json({ error: 'conflict', reason: 'Secondary – nur lesend' });
        }
        const erstesSegment = decodeURIComponent(req.path.split('/')[1] || '');
        if (erstesSegment === '' || erstesSegment.startsWith('_')) {
            if (erstesSegment === '' && req.method === 'GET') return dokumentDb.middleware(req, res, next);
            return res.status(404).json({ error: 'not_found' });
        }
        if (!zustand.instanzId || erstesSegment !== turnierDbName(zustand.instanzId)) {
            return res.status(404).json({ error: 'not_found', reason: 'Keine aktuelle Turnier-DB' });
        }
        return dokumentDb.middleware(req, res, next);
    }

    async function aktiviereTurnier(turnierId) {
        const turnier = await knex('turniere').where({ id: turnierId }).first();
        if (!turnier) return;
        let instanzId = turnier.instanz_id;
        if (!instanzId) {
            instanzId = randomUUID();
            await knex('turniere').where({ id: turnierId }).update({ instanz_id: instanzId });
        }
        if (zustand.instanzId !== instanzId) {
            if (zustand.db) await schliesseInstanz({ loeschen: true });
            await oeffneInstanz(instanzId, turnier.id);
        }
        if (modus === 'master') await dienst.nachAktivierung();
    }

    // --- Dokument-Replikation mit dem Partner-Server (nur Cluster) ---
    function startePartnerReplikation() {
        if (!partnerUrl || !zustand.db || partnerRepl.repl) return;
        const remote = new dokumentDb.PouchDB(`${partnerUrl}/db/${turnierDbName(zustand.instanzId)}`, {
            skip_setup: true,
            fetch: (url, optionen = {}) => {
                optionen.headers = optionen.headers || new Headers();
                if (konfig.secret) optionen.headers.set('x-hajime-sync-secret', konfig.secret);
                return dokumentDb.PouchDB.fetch(url, optionen);
            }
        });
        const repl = zustand.db.replicate.from(remote, {
            live: true, retry: true, back_off_function: (d) => (d === 0 ? 500 : Math.min(d * 2, 3000))
        });
        partnerRepl.repl = repl;
        partnerRepl.lastSeq = null;
        repl.on('change', (info) => { partnerRepl.lastSeq = info.last_seq; partnerRepl.fehler = null; });
        repl.on('active', () => { partnerRepl.aktiv = true; });
        repl.on('paused', (err) => {
            partnerRepl.aktiv = false;
            partnerRepl.fehler = err ? String(err.message || err) : null;
        });
        repl.on('error', (err) => { partnerRepl.fehler = String(err.message || err); });
    }

    async function stoppePartnerReplikation() {
        const { repl } = partnerRepl;
        if (!repl) return;
        partnerRepl.repl = null;
        partnerRepl.aktiv = false;
        const fertig = new Promise(r => { repl.on('complete', r); repl.on('error', r); setTimeout(r, 2000); });
        repl.cancel();
        await fertig;
    }

    async function oeffneInstanz(instanzId, turnierId) {
        zustand.db = await dokumentDb.oeffneSicher(turnierDbName(instanzId));
        zustand.instanzId = instanzId;
        zustand.turnierId = turnierId;
        startePartnerReplikation();
    }

    async function schliesseInstanz({ loeschen }) {
        await stoppePartnerReplikation();
        if (zustand.db) await (loeschen ? zustand.db.destroy() : zustand.db.close());
        zustand.db = null;
        zustand.instanzId = null;
        zustand.turnierId = null;
    }

    // Secondary: Instanz aus der (replizierten, nur lesbaren) relationalen DB übernehmen. Hat der
    // Master das Turnier gewechselt, wird die alte Dokument-DB verworfen.
    async function synchronisiereInstanzLesend() {
        const turnier = await knex('turniere').orderBy('id', 'desc').first();
        const instanzId = turnier ? turnier.instanz_id : null;
        if (instanzId === zustand.instanzId) return;
        if (zustand.db) await schliesseInstanz({ loeschen: true });
        if (instanzId) await oeffneInstanz(instanzId, turnier.id);
    }

    function starteInstanzPruefung() {
        if (instanzTimer) return;
        let laeuft = false;
        instanzTimer = setInterval(async () => {
            if (laeuft) return;
            laeuft = true;
            try { await synchronisiereInstanzLesend(); } catch (err) { /* PostgreSQL evtl. gerade im Umbau */ }
            laeuft = false;
        }, INSTANZ_PRUEFUNG_MS);
    }

    function stoppeInstanzPruefung() {
        if (instanzTimer) clearInterval(instanzTimer);
        instanzTimer = null;
    }

    async function vorTurnierwechsel() {
        await dienst.vorDeaktivierung();
        await schliesseInstanz({ loeschen: true });
        await leereTurnierdaten(knex);
    }

    const dienst = {
        rolle: 'server',
        zustand,
        middleware,
        aktiviereTurnier,
        vorTurnierwechsel,
        status() {
            return {
                rolle: konfig.rolle,
                instanz_id: zustand.instanzId,
                turnier_id: zustand.turnierId,
                db_name: zustand.instanzId ? turnierDbName(zustand.instanzId) : null,
                // 'master' | 'secondary' — Desktop-Clients suchen neu, wenn ihr Server Secondary ist.
                modus
            };
        },
        modus: () => modus,
        // Heartbeat-Dokumente der Client-Geräte (Cluster-Seite).
        async listeClients() {
            if (!zustand.db) return [];
            const res = await zustand.db.allDocs({ startkey: 'client:', endkey: 'client:￰', include_docs: true });
            return res.rows.map(r => r.doc).map(d => ({
                client_id: d.client_id, geraet: d.geraet, matte_id: d.matte_id,
                letzter_kontakt: d.letzter_kontakt, ausstehend: d.ausstehend
            }));
        },
        darfSchreiben: () => schreibenErlaubt(),
        setzeSchreibpruefung(fn) { schreibenErlaubt = fn; },
        setzeEpoche(epoche) { zustand.epoche = epoche; },
        async dokumentStatus() {
            const info = zustand.db ? await zustand.db.info().catch(() => null) : null;
            return {
                db_name: zustand.instanzId ? turnierDbName(zustand.instanzId) : null,
                update_seq: info ? info.update_seq : null,
                doc_count: info ? info.doc_count : null,
                partner_pull: { laeuft: !!partnerRepl.repl, aktiv: partnerRepl.aktiv, last_seq: partnerRepl.lastSeq, fehler: partnerRepl.fehler }
            };
        },
        // Cluster: Beförderung. Brücke und Abgleich starten; fehlt noch die Instanz (Turnier nie
        // aktiviert), wird sie jetzt — als Primary — angelegt.
        async alsMaster() {
            modus = 'master';
            stoppeInstanzPruefung();
            await synchronisiereInstanzLesend().catch(() => {});
            const turnier = await knex('turniere').orderBy('id', 'desc').first();
            if (turnier) await aktiviereTurnier(turnier.id);
        },
        // Cluster: VIP abgegeben bzw. Start als Secondary.
        async alsSecondary() {
            modus = 'secondary';
            await dienst.vorDeaktivierung();
            starteInstanzPruefung();
        },
        planeAbgleich() { if (modus === 'master') abgleich.plane(); },
        async leerlauf() { await abgleich.leerlauf(); await bruecke.leerlauf(); },
        async nachAktivierung() { await abgleich.fuehreAus(); bruecke.starte(); },
        async vorDeaktivierung() { await bruecke.stoppe(); await abgleich.leerlauf(); },
        async brueckeNeuStarten() { await bruecke.neuStarten(); },
        listeKonflikte: () => bruecke.listeKonflikte(),
        erledigeKonflikt: (id) => bruecke.erledigeKonflikt(id),
        wiederholeKonflikt: (id) => bruecke.wiederholeKonflikt(id)
    };

    // Das (einzige) vorhandene Turnier wird verzögert beim ERSTEN Request aktiviert, nicht beim
    // Serverstart: vor dem ersten Request ist die DB evtl. noch gar nicht migriert (die E2E-Suites
    // starten den Server vor ihrem globalSetup), und eine früh geöffnete Datenbankverbindung würde
    // unter Windows das Löschen der Testdaten blockieren.
    let initVersprechen = null;
    dienst.bereit = function bereit() {
        if (!initVersprechen) {
            initVersprechen = (async () => {
                if (modus !== 'master') return synchronisiereInstanzLesend();
                const vorhanden = await knex('turniere').orderBy('id', 'desc').first();
                if (vorhanden) await aktiviereTurnier(vorhanden.id);
            })().catch((err) => {
                initVersprechen = null; // beim nächsten Request erneut versuchen
                throw err;
            });
        }
        return initVersprechen;
    };

    if (modus === 'secondary') starteInstanzPruefung();
    return dienst;
}
