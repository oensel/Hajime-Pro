import fs from 'node:fs';
import path from 'node:path';
import PouchDB from 'pouchdb';
import pouchdbFind from 'pouchdb-find';
import expressPouchDB from 'express-pouchdb';

PouchDB.plugin(pouchdbFind);

// /_couch ist die volle, unauthentifizierte CouchDB-HTTP-API (Lese-/Schreibzugriff auf
// alle Offline-Daten) -- auf demselben Port wie die restliche App, die bewusst im
// Hallen-WLAN erreichbar sein muss (siehe app.js). In dieser Phase spricht ausschließlich
// der eigene Node-Prozess (über 127.0.0.1) mit /_couch; es gibt noch keine PouchDB-Clients
// im Browser (das ist eine spätere, eigene Phase). Deshalb: Zugriff auf /_couch nur vom
// selben Rechner aus erlauben. Sobald Phase 2 echte PouchDB-Clients im WLAN einführt, muss
// diese Beschränkung durch echte CouchDB-Zugangsdaten ersetzt werden (nicht einfach
// zusätzlich bestehen bleiben).
export function nurLoopback(req, res, next) {
    const ip = req.socket.remoteAddress;
    if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') {
        return next();
    }
    return res.status(403).json({ error: 'Zugriff auf die lokale CouchDB ist nur vom selben Rechner aus erlaubt.' });
}

// Ein frischer PouchDB-Konstruktor pro Aufruf (PouchDB.defaults()) ist zwingend --
// express-pouchdb installiert beim Erstellen des Handlers einmalige, statische
// Daemons/Wrapper-Methoden auf dem übergebenen Konstruktor. Ein zweiter Aufruf mit
// demselben Konstruktor würde kollidieren, siehe tests/unit/helpers/couchTestServer.js.
export function mountEmbeddedCouch(app, dataPath) {
    fs.mkdirSync(dataPath, { recursive: true });
    const PouchDBLocal = PouchDB.defaults({ prefix: path.join(dataPath, path.sep) });
    app.use('/_couch', nurLoopback, expressPouchDB(PouchDBLocal, {
        logPath: undefined,
        configPath: path.join(dataPath, 'config.json')
    }));
}
