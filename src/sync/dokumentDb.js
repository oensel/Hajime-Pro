// Eingebettete, CouchDB-kompatible Dokument-DB: PouchDB auf LevelDB, per express-pouchdb unter
// /db über HTTP erreichbar (Replikationsprotokoll wie echtes CouchDB, siehe Spec Abschnitt 5).
import PouchDBBasis from 'pouchdb-node';
import pouchFind from 'pouchdb-find';
import expressPouchdb from 'express-pouchdb';
import { mkdirSync } from 'fs';
import path from 'path';
import { turnierDbName } from '../shared/dokumentNamen.js';

PouchDBBasis.plugin(pouchFind);

const MAX_VERSUCHE = 6;

export async function oeffneMitWiederholung(PouchDB, name) {
    let letzterFehler = null;
    for (let versuch = 1; versuch <= MAX_VERSUCHE; versuch++) {
        const db = new PouchDB(name);
        try {
            await db.info();
            return db;
        } catch (err) {
            letzterFehler = err;
            await db.close().catch(() => {});
            console.warn(`[Dokument-DB] Öffnen von ${name} fehlgeschlagen (Versuch ${versuch}/${MAX_VERSUCHE}): ${err.message}`);
            await new Promise(r => setTimeout(r, 150 * versuch));
        }
    }
    throw letzterFehler;
}

export { turnierDbName };

export function erzeugeDokumentDb({ datenverzeichnis }) {
    const verzeichnis = path.resolve(datenverzeichnis);
    mkdirSync(verzeichnis, { recursive: true });
    const PouchDB = PouchDBBasis.defaults({ prefix: verzeichnis + path.sep });
    const pouchApp = expressPouchdb(PouchDB, {
        mode: 'minimumForPouchDB',
        configPath: path.join(verzeichnis, 'config.json'),
        logPath: path.join(verzeichnis, 'log.txt')
    });
    // express-pouchdb bringt Express 4 mit und tauscht beim Mounten den Request-Prototyp aus. In der
    // Express-5-Hauptapp ist req.query nur ein Getter auf dem (ausgetauschten) Prototyp, danach fehlt
    // es express-pouchdb ("reading 'rev'"). Daher vorab als eigene, beschreibbare Eigenschaft setzen.
    const middleware = (req, res, next) => {
        if (!Object.prototype.hasOwnProperty.call(req, 'query')) {
            const query = {};
            for (const [schluessel, wert] of new URL(req.url, 'http://localhost').searchParams) query[schluessel] = wert;
            Object.defineProperty(req, 'query', { value: query, writable: true, configurable: true, enumerable: true });
        }
        return pouchApp(req, res, next);
    };
    return {
        PouchDB,
        middleware,
        oeffne(name) {
            return new PouchDB(name);
        },
        // Öffnet (und legt ggf. an) mit Wiederholung: unter Windows scheitert das Anlegen einer
        // frischen LevelDB gelegentlich mit "IO error: RenameFile ... CURRENT: Zugriff verweigert",
        // wenn Virenscanner oder Suchindexer kurz auf die neue Datei zugreifen.
        async oeffneSicher(name) {
            return oeffneMitWiederholung(PouchDB, name);
        }
    };
}
