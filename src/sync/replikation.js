// Live-Replikation Client <-> Hallen-Server (nur Client-Knoten). PouchDB-Sync in beide Richtungen
// mit automatischem Retry: bricht das WLAN weg, arbeitet der Client lokal weiter und die
// Replikation holt alles nach, sobald der Server wieder erreichbar ist.
//
// Zusätzlich führt sie Buch über "ausstehende" Änderungen: Dokumente, die DIESER Knoten geschrieben
// hat (geschrieben_von_knoten === clientId) und deren Revision noch nicht zum Server übertragen
// ist — Grundlage für die Statusanzeige ("offline – n Änderungen ausstehend") und für das
// Sichern verworfener Änderungen beim Turnierwechsel.

export function erzeugeReplikation({ PouchDB, konfig, clientId }) {
    let lokal = null;
    let sync = null;
    let feed = null;
    let getrennt = false; // nur Test-Endpunkt: Verbindung künstlich unterbrechen
    const ausstehend = new Map(); // docId -> lokale Revision
    const zustand = { aktiv: false, ruhend: false, fehler: null };

    function remoteDb(dbName) {
        // skip_setup: niemals eine DB auf dem Server anlegen (z.B. eine alte Instanz nach einem
        // Turnierwechsel) — existiert sie nicht, schlägt die Replikation fehl statt sie zu erzeugen.
        return new PouchDB(`${konfig.serverUrl}/db/${dbName}`, {
            skip_setup: true,
            fetch: (url, optionen = {}) => {
                optionen.headers = optionen.headers || new Headers();
                if (konfig.secret) optionen.headers.set('x-hajime-sync-secret', konfig.secret);
                return PouchDB.fetch(url, optionen);
            }
        });
    }

    function beobachteLokaleAenderungen() {
        feed = lokal.changes({ since: 'now', live: true, include_docs: true });
        feed.on('change', (change) => {
            const doc = change.doc;
            if (!doc) return;
            if (doc.geschrieben_von_knoten === clientId && doc.bearbeitet_von !== 'server') {
                ausstehend.set(doc._id, doc._rev);
            } else if (doc.bearbeitet_von === 'server') {
                // Server-Stand angekommen: die eigene Änderung ist verarbeitet (oder überholt).
                ausstehend.delete(doc._id);
            }
        });
    }

    function starteSync() {
        if (!lokal || getrennt || sync) return;
        sync = lokal.sync(remoteDb(lokal.name), { live: true, retry: true, back_off_function: (d) => (d === 0 ? 500 : Math.min(d * 2, 5000)) });
        sync.on('change', (info) => {
            zustand.fehler = null;
            if (info.direction === 'push') {
                for (const doc of info.change.docs) {
                    if (ausstehend.get(doc._id) === doc._rev) ausstehend.delete(doc._id);
                }
            }
        });
        sync.on('active', () => { zustand.aktiv = true; zustand.ruhend = false; });
        sync.on('paused', (err) => {
            zustand.aktiv = false;
            zustand.ruhend = !err;
            if (err) zustand.fehler = null; // offline: kein Konfigurationsfehler, nur keine Verbindung
        });
        sync.on('denied', (err) => { zustand.fehler = `Zugriff verweigert: ${err && err.message}`; });
        sync.on('error', (err) => {
            zustand.fehler = (err && (err.status === 401 || err.status === 403))
                ? 'Replikation abgelehnt (SYNC_SECRET prüfen)'
                : `Replikationsfehler: ${err && err.message}`;
            sync = null;
        });
    }

    function stoppeSync() {
        if (sync) {
            sync.cancel();
            sync = null;
        }
        zustand.aktiv = false;
        zustand.ruhend = false;
    }

    return {
        // Übernimmt eine (neue) lokale Turnier-DB und startet die Replikation dazu.
        async starte(lokaleDb) {
            await this.stoppe();
            lokal = lokaleDb;
            ausstehend.clear();
            // Eigene, noch nicht vom Server bestätigte Änderungen aus einer früheren Sitzung.
            const alle = await lokal.allDocs({ include_docs: true });
            for (const row of alle.rows) {
                if (row.doc && row.doc.geschrieben_von_knoten === clientId && row.doc.bearbeitet_von !== 'server') {
                    ausstehend.set(row.id, row.doc._rev);
                }
            }
            beobachteLokaleAenderungen();
            starteSync();
        },
        async stoppe() {
            stoppeSync();
            if (feed) {
                feed.cancel();
                feed = null;
            }
        },
        trennen() {
            getrennt = true;
            stoppeSync();
        },
        // Hebt die (Test-)Trennung auf; die Replikation startet erst über sicherstellen(), nachdem der
        // Client-Dienst die Turnier-Instanz beim Server geprüft hat (sonst liefe sie nach einem
        // Turnierwechsel kurz gegen die gelöschte alte DB).
        verbinden() {
            getrennt = false;
        },
        // Nach einem Replikationsfehler (z.B. Server-DB kurzzeitig nicht vorhanden) neu versuchen.
        sicherstellen() {
            if (!getrennt && !sync) starteSync();
        },
        ausstehendeIds: () => [...ausstehend.keys()],
        status: () => ({ getrennt, aktiv: zustand.aktiv, ruhend: zustand.ruhend, fehler: zustand.fehler, ausstehend: ausstehend.size })
    };
}
