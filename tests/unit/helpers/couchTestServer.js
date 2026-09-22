import express from 'express';
import PouchDB from 'pouchdb';
import memoryAdapter from 'pouchdb-adapter-memory';
import pouchdbFind from 'pouchdb-find';
import expressPouchDB from 'express-pouchdb';

PouchDB.plugin(memoryAdapter);
PouchDB.plugin(pouchdbFind);
const PouchDBMemory = PouchDB.defaults({ adapter: 'memory' });

// express-pouchdb schreibt pro Datenbank auf die Adapter-Instanz, die beim Erstellen des
// Express-Handlers festgelegt wird -- ohne .defaults({ adapter: 'memory' }) würde es
// versuchen, LevelDB-Dateien auf die Platte zu schreiben.
export function startTestCouchServer() {
    return new Promise((resolve) => {
        const app = express();
        app.use('/', expressPouchDB(PouchDBMemory, { logPath: undefined }));
        const server = app.listen(0, () => {
            const port = server.address().port;
            resolve({
                url: `http://127.0.0.1:${port}`,
                close: () => new Promise((res) => server.close(res))
            });
        });
    });
}
