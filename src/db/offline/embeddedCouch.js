import fs from 'node:fs';
import path from 'node:path';
import PouchDB from 'pouchdb';
import pouchdbFind from 'pouchdb-find';
import expressPouchDB from 'express-pouchdb';

PouchDB.plugin(pouchdbFind);

// Ein frischer PouchDB-Konstruktor pro Aufruf (PouchDB.defaults()) ist zwingend --
// express-pouchdb installiert beim Erstellen des Handlers einmalige, statische
// Daemons/Wrapper-Methoden auf dem übergebenen Konstruktor. Ein zweiter Aufruf mit
// demselben Konstruktor würde kollidieren, siehe tests/unit/helpers/couchTestServer.js.
export function mountEmbeddedCouch(app, dataPath) {
    fs.mkdirSync(dataPath, { recursive: true });
    const PouchDBLocal = PouchDB.defaults({ prefix: path.join(dataPath, path.sep) });
    app.use('/_couch', expressPouchDB(PouchDBLocal, { logPath: undefined }));
}
