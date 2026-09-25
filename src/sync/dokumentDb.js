// Eingebettete, CouchDB-kompatible Dokument-DB: PouchDB auf LevelDB, per express-pouchdb unter
// /db über HTTP erreichbar (Replikationsprotokoll wie echtes CouchDB, siehe Spec Abschnitt 5).
import PouchDBBasis from 'pouchdb-node';
import pouchFind from 'pouchdb-find';
import expressPouchdb from 'express-pouchdb';
import { mkdirSync } from 'fs';
import path from 'path';

PouchDBBasis.plugin(pouchFind);

export function turnierDbName(instanzId) {
    return `turnier_${instanzId}`;
}

export function erzeugeDokumentDb({ datenverzeichnis }) {
    const verzeichnis = path.resolve(datenverzeichnis);
    mkdirSync(verzeichnis, { recursive: true });
    const PouchDB = PouchDBBasis.defaults({ prefix: verzeichnis + path.sep });
    const middleware = expressPouchdb(PouchDB, {
        mode: 'minimumForPouchDB',
        configPath: path.join(verzeichnis, 'config.json'),
        logPath: path.join(verzeichnis, 'log.txt')
    });
    return {
        PouchDB,
        middleware,
        oeffne(name) {
            return new PouchDB(name);
        }
    };
}
