import express from 'express';
import PouchDB from 'pouchdb';
import memoryAdapter from 'pouchdb-adapter-memory';
import pouchdbFind from 'pouchdb-find';
import expressPouchDB from 'express-pouchdb';

PouchDB.plugin(memoryAdapter);
PouchDB.plugin(pouchdbFind);

// express-pouchdb installiert beim Erstellen des Express-Handlers einmalige, statische
// Daemons/Wrapper-Methoden auf dem übergebenen PouchDB-Konstruktor (z.B. den Replikations-
// Daemon). Ein zweiter startTestCouchServer()-Aufruf im selben Prozess (z.B. zwei Tests in
// derselben Datei) würde mit dem GLEICHEN Konstruktor kollidieren ("already active" /
// "already installed") -- deshalb hier bewusst pro Aufruf ein frischer Konstruktor statt
// eines module-weiten Singletons.
export function startTestCouchServer() {
    return new Promise((resolve) => {
        const PouchDBMemory = PouchDB.defaults({ adapter: 'memory' });
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
