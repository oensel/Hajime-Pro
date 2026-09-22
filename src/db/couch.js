import nanoLib from 'nano';

export function connect(url) {
    return nanoLib(url);
}

// CouchDB liefert beim Anlegen einer bereits existierenden Datenbank statusCode 412
// (file_exists) statt eines Erfolgs -- das ist hier der Normalfall (Server neu gestartet,
// Datenbank existiert schon), kein echter Fehler.
export async function ensureDatabase(nano, dbName) {
    try {
        await nano.db.create(dbName);
    } catch (error) {
        if (error.statusCode !== 412) throw error;
    }
    return nano.db.use(dbName);
}
