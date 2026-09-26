// Eingebettete, CouchDB-kompatible Dokument-DB: PouchDB auf LevelDB, per express-pouchdb unter
// /db über HTTP erreichbar (Replikationsprotokoll wie echtes CouchDB, siehe Spec Abschnitt 5).
import PouchDBBasis from 'pouchdb-node';
import pouchFind from 'pouchdb-find';
import expressPouchdb from 'express-pouchdb';
import { mkdirSync } from 'fs';
import path from 'path';

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
        },
        // Öffnet (und legt ggf. an) mit Wiederholung: unter Windows scheitert das Anlegen einer
        // frischen LevelDB gelegentlich mit "IO error: RenameFile ... CURRENT: Zugriff verweigert",
        // wenn Virenscanner oder Suchindexer kurz auf die neue Datei zugreifen.
        async oeffneSicher(name) {
            return oeffneMitWiederholung(PouchDB, name);
        }
    };
}
