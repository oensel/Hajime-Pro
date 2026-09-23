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
//
// Zusätzlich zur reinen Konvention (ein Aufruf pro Testdatei, via before()/after()) wird das
// hier auch technisch erzwungen: node --test isoliert jede Testdatei in einen eigenen Prozess
// (bestätigt per process.pid-Probe), daher setzt sich dieses module-scope Flag zwischen
// Dateien automatisch zurück und schlägt nur bei tatsächlichem Mehrfachaufruf INNERHALB
// derselben Datei zu.
let bereitsAufgerufen = false;

export function startTestCouchServer() {
    if (bereitsAufgerufen) {
        throw new Error(
            'startTestCouchServer() darf pro Testdatei nur einmal aufgerufen werden - siehe Kommentar in couch.test.js'
        );
    }
    bereitsAufgerufen = true;

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
