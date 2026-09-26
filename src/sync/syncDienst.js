// Zentraler Sync-Dienst des Hallen-Servers: hält die Dokument-DB der aktuellen Turnier-Instanz,
// setzt beim Turnierwechsel alles zurück und bündelt Abgleich (SQL -> Dokumente) und Brücke
// (Dokumente -> SQL). Genau ein Turnier pro Hallen-Server (Spec CouchDB-Umbau, Abschnitt 8).
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

export async function starteSyncDienst({ knex, konfig }) {
    if (!konfig.istServer) return null;

    const dokumentDb = erzeugeDokumentDb(konfig);
    const zustand = { instanzId: null, turnierId: null, db: null };
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
        zustand.db = await dokumentDb.oeffneSicher(turnierDbName(instanzId));
        zustand.instanzId = instanzId;
        zustand.turnierId = turnier.id;
        await dienst.nachAktivierung();
    }

    async function vorTurnierwechsel() {
        await dienst.vorDeaktivierung();
        if (zustand.db) await zustand.db.destroy();
        zustand.db = null;
        zustand.instanzId = null;
        zustand.turnierId = null;
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
                db_name: zustand.instanzId ? turnierDbName(zustand.instanzId) : null
            };
        },
        planeAbgleich() { abgleich.plane(); },
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
    // starten den Server vor ihrem globalSetup), und eine früh geöffnete SQLite-Verbindung würde
    // unter Windows das Löschen der Testdatenbank blockieren.
    let initVersprechen = null;
    dienst.bereit = function bereit() {
        if (!initVersprechen) {
            initVersprechen = (async () => {
                const vorhanden = await knex('turniere').orderBy('id', 'desc').first();
                if (vorhanden) await aktiviereTurnier(vorhanden.id);
            })().catch((err) => {
                initVersprechen = null; // beim nächsten Request erneut versuchen
                throw err;
            });
        }
        return initVersprechen;
    };

    return dienst;
}
