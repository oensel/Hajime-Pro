# Offline-CouchDB-Fundament Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eine eingebettete, persistente lokale CouchDB (via `express-pouchdb`) im
Offline-Betrieb verfügbar machen, plus die zwei Fundament-Bausteine, auf denen alle
folgenden Offline-Cutover-Pläne aufbauen: eine Turnier-DB-Registry (öffnet/cached
CouchDB-Datenbanken pro Turnier-ID) und ein additiver `offline_accounts`-Bootstrap
(Offline-Mock-User/-Verein, parallel zur bestehenden Knex-Logik, ändert noch kein
sichtbares Verhalten).

**Architecture:** `express-pouchdb` wird unter `/_couch` in die bestehende Express-`app`
gemountet (nur wenn `IS_OFFLINE=true`), mit dem persistenten Standard-Node-Adapter von
PouchDB (kein Test-Memory-Adapter). `src/db/couch.js` (`connect`/`ensureDatabase`, bereits
vorhanden) verbindet sich per `nano` gegen diese eingebettete Instanz genauso wie gegen
eine echte CouchDB. Die neuen Module `turnierDbRegistry.js` und `offlineAccounts.js`
nutzen ausschließlich bereits vorhandene Bausteine (`ensureDatabase`,
`vereineRepository`/`benutzerRepository`/`mitgliedschaftenRepository`). Nichts in diesem
Plan ersetzt bestehende Knex/SQLite-Logik — alles ist additiv, siehe Spec.

**Tech Stack:** Node.js/Express, `nano` (CouchDB-Client), `express-pouchdb` + `pouchdb` +
`pouchdb-find` (eingebetteter CouchDB-kompatibler Server), `node --test` für Unit-Tests
gegen die bereits vorhandene In-Memory-Test-Infrastruktur (`tests/unit/helpers/couchTestServer.js`).

**Spec:** [docs/superpowers/specs/2026-09-24-offline-couchdb-cutover.md](../specs/2026-09-24-offline-couchdb-cutover.md)
(Abschnitt "Entscheidung 2" und "Umsetzungsreihenfolge", Schritt 1), aufbauend auf
[docs/superpowers/specs/2026-09-22-couchdb-pouchdb-migration-design.md](../specs/2026-09-22-couchdb-pouchdb-migration-design.md).

## Global Constraints

- Online-Betrieb (Postgres/Knex) bleibt in diesem und allen folgenden Offline-Cutover-Plänen
  vollständig unverändert.
- Jede Umstellung ist additiv, bis der konsumierende Bereich selbst migriert ist — nichts,
  was heute im Offline-Modus funktioniert, darf während der Migration kaputtgehen.
- Dokumenttypen/IDs folgen dem bestehenden `<typ>:<uuid>`-Schema (`src/db/documentId.js`),
  außer bei den hier neu eingeführten festen IDs für den Offline-Mock-User/-Verein.
- Tests folgen der bestehenden Konvention: ein `startTestCouchServer()`-Aufruf pro
  Testdatei, gegen `express-pouchdb` + `pouchdb-adapter-memory` (siehe
  `tests/unit/helpers/couchTestServer.js`).

---

### Task 1: Eingebettete lokale CouchDB

**Files:**
- Modify: `package.json` (verschiebt `express-pouchdb`, `pouchdb`, `pouchdb-find` von
  `devDependencies` nach `dependencies` — sie laufen jetzt auch produktiv, nicht mehr nur
  in Tests; `pouchdb-adapter-memory` bleibt eine reine Dev-Dependency, sie wird produktiv
  nicht verwendet)
- Create: `src/db/offline/embeddedCouch.js`
- Test: `tests/unit/db/offline/embeddedCouch.test.js`

**Interfaces:**
- Produces: `mountEmbeddedCouch(app, dataPath)` — mountet einen CouchDB-kompatiblen HTTP-Server
  unter dem Pfad-Präfix `/_couch` der übergebenen Express-`app`. `dataPath` ist ein
  Verzeichnispfad (wird bei Bedarf angelegt); jede CouchDB-Datenbank landet dort als
  eigenes, persistentes LevelDB-Verzeichnis. Rückgabewert: keiner.

- [ ] **Step 1: `package.json` anpassen**

In `package.json`: `"express-pouchdb"`, `"pouchdb"`, `"pouchdb-find"` aus dem
`devDependencies`-Block entfernen und mit denselben Versionsangaben (`"express-pouchdb":
"^4.2.0"`, `"pouchdb": "^9.0.0"`, `"pouchdb-find": "^9.0.0"`) in `dependencies` einfügen.
`pouchdb-adapter-memory` bleibt unverändert in `devDependencies`. `overrides` bleibt
unverändert.

- [ ] **Step 2: `npm install` ausführen, damit die Lockfile-Verschiebung nachgezogen wird**

Run: `npm install`
Expected: Exit-Code 0, `package-lock.json` wird aktualisiert (die Pakete waren bereits
installiert, nur der Abschnitt ändert sich).

- [ ] **Step 3: Fehlschlagenden Test schreiben**

`tests/unit/db/offline/embeddedCouch.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import { connect, ensureDatabase } from '../../../../src/db/couch.js';
import { mountEmbeddedCouch } from '../../../../src/db/offline/embeddedCouch.js';

test('mountEmbeddedCouch stellt eine funktionsfähige, persistente CouchDB-kompatible API bereit', async () => {
    const dataPath = await mkdtemp(path.join(tmpdir(), 'hajime-embedded-couch-'));
    const app = express();
    mountEmbeddedCouch(app, dataPath);

    const server = await new Promise((resolve) => {
        const s = app.listen(0, () => resolve(s));
    });

    try {
        const nano = connect(`http://127.0.0.1:${server.address().port}/_couch`);
        const db = await ensureDatabase(nano, 'fundament-test');
        const angelegt = await db.insert({ _id: 'kampf:1', typ: 'kampf', status: 'bereit' });
        assert.equal(angelegt.ok, true);

        const gelesen = await db.get('kampf:1');
        assert.equal(gelesen.status, 'bereit');
    } finally {
        await new Promise((resolve) => server.close(resolve));
        await rm(dataPath, { recursive: true, force: true });
    }
});
```

- [ ] **Step 4: Test ausführen, um das Fehlschlagen zu bestätigen**

Run: `node --test tests/unit/db/offline/embeddedCouch.test.js`
Expected: FAIL — `Cannot find module '../../../../src/db/offline/embeddedCouch.js'`

- [ ] **Step 5: `src/db/offline/embeddedCouch.js` implementieren**

```javascript
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
```

- [ ] **Step 6: Test ausführen, um das Bestehen zu bestätigen**

Run: `node --test tests/unit/db/offline/embeddedCouch.test.js`
Expected: PASS

- [ ] **Step 7: Committen**

```bash
git add package.json package-lock.json src/db/offline/embeddedCouch.js tests/unit/db/offline/embeddedCouch.test.js
git commit -m "feat: eingebettete lokale CouchDB (express-pouchdb) für Offline-Betrieb"
```

---

### Task 2: Turnier-DB-Registry

**Files:**
- Create: `src/db/offline/turnierDbRegistry.js`
- Test: `tests/unit/db/offline/turnierDbRegistry.test.js`

**Interfaces:**
- Consumes: `connect(url)`, `ensureDatabase(nano, dbName)` aus `../couch.js` (bereits
  vorhanden, siehe `src/db/couch.js`).
- Produces: `createTurnierDbRegistry(nano)` → `{ openTurnierDb(turnierId), listTurnierIds() }`.
  `openTurnierDb(turnierId)` gibt ein bereits-verbundenes `nano`-Datenbank-Handle für
  `turnier_<turnierId>` zurück (angelegt falls nicht vorhanden), cached pro `turnierId`
  innerhalb der Registry-Instanz. `listTurnierIds()` gibt ein Array aller lokal
  vorhandenen Turnier-IDs zurück (aus den Namen der `turnier_`-präfigierten Datenbanken,
  Präfix entfernt).

- [ ] **Step 1: Fehlschlagenden Test schreiben**

`tests/unit/db/offline/turnierDbRegistry.test.js`:

```javascript
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startTestCouchServer } from '../../helpers/couchTestServer.js';
import { connect } from '../../../../src/db/couch.js';
import { createTurnierDbRegistry } from '../../../../src/db/offline/turnierDbRegistry.js';

let server;
let nano;

before(async () => {
    server = await startTestCouchServer();
    nano = connect(server.url);
});

after(async () => {
    await server.close();
});

test('openTurnierDb legt eine Turnier-Datenbank an und gibt beim zweiten Aufruf dasselbe Handle aus dem Cache zurück', async () => {
    const registry = createTurnierDbRegistry(nano);
    const turnierId = randomUUID();

    const db1 = await registry.openTurnierDb(turnierId);
    await db1.insert({ _id: 'turnier:meta', typ: 'turnier', name: 'Test-Turnier' });

    const db2 = await registry.openTurnierDb(turnierId);
    assert.equal(db2, db1);

    const gelesen = await db2.get('turnier:meta');
    assert.equal(gelesen.name, 'Test-Turnier');
});

test('listTurnierIds findet alle lokal angelegten Turnier-Datenbanken', async () => {
    const registry = createTurnierDbRegistry(nano);
    const idA = randomUUID();
    const idB = randomUUID();

    await registry.openTurnierDb(idA);
    await registry.openTurnierDb(idB);

    const ids = await registry.listTurnierIds();
    assert.ok(ids.includes(idA));
    assert.ok(ids.includes(idB));
});
```

- [ ] **Step 2: Test ausführen, um das Fehlschlagen zu bestätigen**

Run: `node --test tests/unit/db/offline/turnierDbRegistry.test.js`
Expected: FAIL — `Cannot find module '../../../../src/db/offline/turnierDbRegistry.js'`

- [ ] **Step 3: `src/db/offline/turnierDbRegistry.js` implementieren**

```javascript
import { ensureDatabase } from '../couch.js';

const PRAEFIX = 'turnier_';

export function createTurnierDbRegistry(nano) {
    const cache = new Map();

    async function openTurnierDb(turnierId) {
        if (cache.has(turnierId)) return cache.get(turnierId);
        const db = await ensureDatabase(nano, `${PRAEFIX}${turnierId}`);
        cache.set(turnierId, db);
        return db;
    }

    async function listTurnierIds() {
        const alleDatenbanken = await nano.db.list();
        return alleDatenbanken
            .filter((name) => name.startsWith(PRAEFIX))
            .map((name) => name.slice(PRAEFIX.length));
    }

    return { openTurnierDb, listTurnierIds };
}
```

- [ ] **Step 4: Test ausführen, um das Bestehen zu bestätigen**

Run: `node --test tests/unit/db/offline/turnierDbRegistry.test.js`
Expected: PASS

- [ ] **Step 5: Committen**

```bash
git add src/db/offline/turnierDbRegistry.js tests/unit/db/offline/turnierDbRegistry.test.js
git commit -m "feat: Turnier-DB-Registry für Offline-CouchDB"
```

---

### Task 3: Offline-Accounts-Bootstrap

**Files:**
- Create: `src/db/offline/offlineAccounts.js`
- Test: `tests/unit/db/offline/offlineAccounts.test.js`

**Interfaces:**
- Consumes: `ensureDatabase(nano, dbName)` aus `../couch.js`; `createVereineRepository(db)`
  aus `../repositories/vereineRepository.js` (`findById`); `createBenutzerRepository(db)`
  aus `../repositories/benutzerRepository.js` (`findById`); `createMitgliedschaftenRepository(db)`
  aus `../repositories/mitgliedschaftenRepository.js` (`query`, `create`).
- Produces: `ensureOfflineAccountsDb(nano)` → gibt das `offline_accounts`-Datenbank-Handle
  zurück, nachdem Offline-Verein/-Benutzer/-Mitgliedschaft idempotent angelegt wurden.
  Zwei exportierte Konstanten: `OFFLINE_VEREIN_ID = 'verein:offline_club'`,
  `OFFLINE_BENUTZER_ID = 'benutzer:offline_user'` — spätere Aufgaben (Task 4 dieses Plans,
  sowie die Vereine-/Turniere-Controller-Migration) verwenden diese IDs, um den
  Offline-Mock-User/-Verein in CouchDB zu adressieren.

- [ ] **Step 1: Fehlschlagenden Test schreiben**

`tests/unit/db/offline/offlineAccounts.test.js`:

```javascript
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestCouchServer } from '../../helpers/couchTestServer.js';
import { connect } from '../../../../src/db/couch.js';
import { createMitgliedschaftenRepository } from '../../../../src/db/repositories/mitgliedschaftenRepository.js';
import {
    ensureOfflineAccountsDb,
    OFFLINE_VEREIN_ID,
    OFFLINE_BENUTZER_ID
} from '../../../../src/db/offline/offlineAccounts.js';

let server;
let nano;

before(async () => {
    server = await startTestCouchServer();
    nano = connect(server.url);
});

after(async () => {
    await server.close();
});

test('ensureOfflineAccountsDb legt Offline Club, offline_user und deren Mitgliedschaft an', async () => {
    const db = await ensureOfflineAccountsDb(nano);

    const verein = await db.get(OFFLINE_VEREIN_ID);
    assert.equal(verein.name, 'Offline Club');

    const benutzer = await db.get(OFFLINE_BENUTZER_ID);
    assert.equal(benutzer.email, 'offline@hajime.os');
    assert.equal(benutzer.aktiver_verein_id, OFFLINE_VEREIN_ID);

    const mitgliedschaftenRepository = createMitgliedschaftenRepository(db);
    const mitgliedschaften = await mitgliedschaftenRepository.query({
        benutzer_id: OFFLINE_BENUTZER_ID,
        verein_id: OFFLINE_VEREIN_ID
    });
    assert.equal(mitgliedschaften.length, 1);
    assert.equal(mitgliedschaften[0].freigegeben, true);
});

test('ensureOfflineAccountsDb ist idempotent -- ein zweiter Aufruf legt nichts doppelt an', async () => {
    await ensureOfflineAccountsDb(nano);
    const db = await ensureOfflineAccountsDb(nano);

    const mitgliedschaftenRepository = createMitgliedschaftenRepository(db);
    const mitgliedschaften = await mitgliedschaftenRepository.query({
        benutzer_id: OFFLINE_BENUTZER_ID,
        verein_id: OFFLINE_VEREIN_ID
    });
    assert.equal(mitgliedschaften.length, 1);
});
```

- [ ] **Step 2: Test ausführen, um das Fehlschlagen zu bestätigen**

Run: `node --test tests/unit/db/offline/offlineAccounts.test.js`
Expected: FAIL — `Cannot find module '../../../../src/db/offline/offlineAccounts.js'`

- [ ] **Step 3: `src/db/offline/offlineAccounts.js` implementieren**

```javascript
import { ensureDatabase } from '../couch.js';
import { createVereineRepository } from '../repositories/vereineRepository.js';
import { createBenutzerRepository } from '../repositories/benutzerRepository.js';
import { createMitgliedschaftenRepository } from '../repositories/mitgliedschaftenRepository.js';

export const OFFLINE_VEREIN_ID = 'verein:offline_club';
export const OFFLINE_BENUTZER_ID = 'benutzer:offline_user';

// Pendant zur Knex-Logik in requireAuth (src/middleware/auth.js): legt beim ersten
// Aufruf einen Offline-Verein und -Benutzer mit fester ID an, statt generierter UUIDs --
// req.user.id ist heute der Literal-String 'offline_user' und muss über Neustarts hinweg
// stabil bleiben.
export async function ensureOfflineAccountsDb(nano) {
    const db = await ensureDatabase(nano, 'offline_accounts');
    const vereineRepository = createVereineRepository(db);
    const benutzerRepository = createBenutzerRepository(db);
    const mitgliedschaftenRepository = createMitgliedschaftenRepository(db);

    const bestehenderVerein = await vereineRepository.findById(OFFLINE_VEREIN_ID);
    if (!bestehenderVerein) {
        await db.insert({
            _id: OFFLINE_VEREIN_ID,
            typ: 'verein',
            name: 'Offline Club',
            created_at: new Date().toISOString()
        });
    }

    const bestehenderBenutzer = await benutzerRepository.findById(OFFLINE_BENUTZER_ID);
    if (!bestehenderBenutzer) {
        await db.insert({
            _id: OFFLINE_BENUTZER_ID,
            typ: 'benutzer',
            email: 'offline@hajime.os',
            vorname: 'Offline',
            nachname: 'User',
            aktiver_verein_id: OFFLINE_VEREIN_ID,
            created_at: new Date().toISOString()
        });

        const bestehendeMitgliedschaften = await mitgliedschaftenRepository.query({
            benutzer_id: OFFLINE_BENUTZER_ID,
            verein_id: OFFLINE_VEREIN_ID
        });
        if (bestehendeMitgliedschaften.length === 0) {
            await mitgliedschaftenRepository.create({
                benutzer_id: OFFLINE_BENUTZER_ID,
                verein_id: OFFLINE_VEREIN_ID,
                freigegeben: true
            });
        }

        console.log('[DB] Offline-Mock-User "offline_user" (CouchDB) wurde angelegt.');
    }

    return db;
}
```

- [ ] **Step 4: Test ausführen, um das Bestehen zu bestätigen**

Run: `node --test tests/unit/db/offline/offlineAccounts.test.js`
Expected: PASS

- [ ] **Step 5: Committen**

```bash
git add src/db/offline/offlineAccounts.js tests/unit/db/offline/offlineAccounts.test.js
git commit -m "feat: additiver Offline-Accounts-Bootstrap (CouchDB) neben bestehender Knex-Logik"
```

---

### Task 4: Verdrahtung in app.js und auth.js (additiv, keine Verhaltensänderung)

**Files:**
- Modify: `src/app.js`
- Modify: `src/middleware/auth.js:8-42` (nur der `requireAuth`-Offline-Zweig)
- Test: `tests/unit/middleware/requireAuthOffline.test.js`

**Interfaces:**
- Consumes: `mountEmbeddedCouch(app, dataPath)` (Task 1), `connect(url)` aus `../db/couch.js`,
  `createTurnierDbRegistry(nano)` (Task 2), `ensureOfflineAccountsDb(nano)` (Task 3).
- Produces: `app.get('offlineCouchNano')` (der `nano`-Client gegen die eingebettete
  CouchDB, nur im Offline-Betrieb gesetzt) und `app.get('turnierDbRegistry')` (die
  Registry-Instanz aus Task 2) — werden von allen folgenden Offline-Cutover-Plänen
  konsumiert.

- [ ] **Step 1: Fehlschlagenden Test schreiben**

Dieser Test prüft direkt die neue, additive Verhaltenslogik des `requireAuth`-Offline-
Zweigs, ohne den ganzen `app.js`-Serverstart zu benötigen: eine kleine Express-App mit
`requireAuth` als einzige Middleware, `IS_OFFLINE=true`, und einem `offlineCouchNano`, der
gegen die Test-CouchDB zeigt.

`tests/unit/middleware/requireAuthOffline.test.js`:

```javascript
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { startTestCouchServer } from '../helpers/couchTestServer.js';
import { connect, ensureDatabase } from '../../../src/db/couch.js';
import { OFFLINE_BENUTZER_ID, OFFLINE_VEREIN_ID } from '../../../src/db/offline/offlineAccounts.js';
import { requireAuth } from '../../../src/middleware/auth.js';

let server;
let nano;
const urspruenglichesIsOffline = process.env.IS_OFFLINE;

before(async () => {
    server = await startTestCouchServer();
    nano = connect(server.url);
    process.env.IS_OFFLINE = 'true';
});

after(async () => {
    await server.close();
    process.env.IS_OFFLINE = urspruenglichesIsOffline;
});

test('requireAuth legt im Offline-Betrieb zusätzlich den Offline-Verein/-Benutzer in CouchDB an', async () => {
    const app = express();
    app.set('offlineCouchNano', nano);
    app.get('/geschuetzt', requireAuth, (req, res) => res.json({ userId: req.user.id }));

    const server2 = await new Promise((resolve) => {
        const s = app.listen(0, () => resolve(s));
    });

    try {
        const antwort = await fetch(`http://127.0.0.1:${server2.address().port}/geschuetzt`);
        const body = await antwort.json();
        assert.equal(body.userId, 'offline_user');

        const offlineAccountsDb = await ensureDatabase(nano, 'offline_accounts');
        const benutzer = await offlineAccountsDb.get(OFFLINE_BENUTZER_ID);
        assert.equal(benutzer.aktiver_verein_id, OFFLINE_VEREIN_ID);
    } finally {
        await new Promise((resolve) => server2.close(resolve));
    }
});
```

- [ ] **Step 2: Test ausführen, um das Fehlschlagen zu bestätigen**

Run: `node --test tests/unit/middleware/requireAuthOffline.test.js`
Expected: FAIL — `benutzer` wird nicht gefunden (404), da `requireAuth` die CouchDB-Seite
noch nicht bootstrapt.

- [ ] **Step 3: `requireAuth`-Offline-Zweig in `src/middleware/auth.js` erweitern**

In `src/middleware/auth.js` Zeile 1 den Import ergänzen:

```javascript
import { ensureOfflineAccountsDb } from '../db/offline/offlineAccounts.js';
```

Den bestehenden `requireAuth`-Offline-Zweig (Zeilen 8-42) wie folgt erweitern — die
bestehende Knex-Logik bleibt vollständig unverändert, es kommt nur ein zusätzlicher,
unabhängiger try/catch-Block für CouchDB dazu:

```javascript
export async function requireAuth(req, res, next) {
    if (process.env.IS_OFFLINE === 'true') {
        req.user = { id: 'offline_user', email: 'offline@hajime.os' };

        const knex = req.app.get('knex');
        if (knex) {
            try {
                const existing = await knex('benutzer').where({ id: 'offline_user' }).first();
                if (!existing) {
                    let offlineVerein = await knex('vereine').where({ name: 'Offline Club' }).first();
                    if (!offlineVerein) {
                        const [inserted] = await knex('vereine').insert({ name: 'Offline Club' }).returning('id');
                        offlineVerein = { id: typeof inserted === 'object' ? inserted.id : inserted };
                    }

                    await knex('benutzer').insert({
                        id: 'offline_user',
                        email: 'offline@hajime.os',
                        vorname: 'Offline',
                        nachname: 'User',
                        aktiver_verein_id: offlineVerein.id
                    });
                    await knex('benutzer_vereine').insert({
                        benutzer_id: 'offline_user',
                        verein_id: offlineVerein.id,
                        freigegeben: 1
                    });
                    console.log('[DB] Offline-Mock-User "offline_user" wurde angelegt.');
                }
            } catch (err) {
                console.error('[DB-Fehler Offline-User]:', err.message);
            }
        }

        // Additiver CouchDB-Bootstrap neben der obigen Knex-Logik (siehe
        // docs/superpowers/specs/2026-09-24-offline-couchdb-cutover.md) -- ändert noch
        // kein sichtbares Verhalten, bereitet nur die Folge-Pläne vor.
        const offlineCouchNano = req.app.get('offlineCouchNano');
        if (offlineCouchNano) {
            try {
                await ensureOfflineAccountsDb(offlineCouchNano);
            } catch (err) {
                console.error('[CouchDB-Fehler Offline-User]:', err.message);
            }
        }

        return next();
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, error: 'Authentifizierung erforderlich. Token fehlt.' });
    }

    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        return res.status(401).json({ success: false, error: 'Ungültiges oder abgelaufenes Token.' });
    }
}
```

- [ ] **Step 4: Test ausführen, um das Bestehen zu bestätigen**

Run: `node --test tests/unit/middleware/requireAuthOffline.test.js`
Expected: PASS

- [ ] **Step 5: `src/app.js` erweitern — eingebettete CouchDB nur im Offline-Betrieb mounten**

Nach der Zeile `const app = express();` (vor `app.set('knex', knex)` oder direkt danach)
in `src/app.js` ergänzen:

```javascript
import { mountEmbeddedCouch } from './db/offline/embeddedCouch.js';
import { connect as connectCouch } from './db/couch.js';
import { createTurnierDbRegistry } from './db/offline/turnierDbRegistry.js';
```

Import-Block ans bestehende Import-Ende anfügen (nach `import { ensureSuperAdmin } ...`).

Nach `app.set('knex', knex);` ergänzen:

```javascript
if (environment === 'offline') {
    const couchDataPath = process.env.COUCHDB_LOCAL_PATH || path.join(__dirname, '../data/couchdb');
    mountEmbeddedCouch(app, couchDataPath);
    const offlineCouchNano = connectCouch(`http://127.0.0.1:${PORT}/_couch`);
    app.set('offlineCouchNano', offlineCouchNano);
    app.set('turnierDbRegistry', createTurnierDbRegistry(offlineCouchNano));
}
```

Da `__dirname` erst weiter unten in der Datei definiert wird (`const __dirname = ...`),
muss dieser Block hinter die `__dirname`-Definition verschoben werden — direkt vor die
Zeile `app.use('/api/auth', getAuthRoutes(knex));` platzieren (nach den
`app.use(express.json(...))`/`app.use(express.static(...))`-Zeilen), damit `PORT` und
`__dirname` bereits verfügbar sind.

- [ ] **Step 6: Manuellen Rauchtest ausführen**

Run: `IS_OFFLINE=true node src/app.js` (in einer Shell, danach mit Strg+C beenden)
Expected: Server startet ohne Fehler auf dem konfigurierten Port, Konsolenausgabe zeigt
den gewohnten Start-Log (`🚀 Hajime Pro läuft auf ...`). Ein Verzeichnis `data/couchdb/`
wird angelegt (per `dir data\couchdb` prüfen). Danach `npx playwright test tests/e2e/registrierung.spec.js`
laufen lassen, um zu bestätigen, dass die bestehende Offline-Vereine-Funktionalität
(Knex-basiert) durch die zusätzliche CouchDB-Verdrahtung nicht beeinträchtigt wurde.
Expected: alle Tests weiterhin grün.

- [ ] **Step 7: Vollständige Unit-Test-Suite ausführen**

Run: `npm run test:unit`
Expected: alle Tests grün (bisherige Suite + die 4 neuen Testdateien dieses Plans).

- [ ] **Step 8: Committen**

```bash
git add src/app.js src/middleware/auth.js tests/unit/middleware/requireAuthOffline.test.js
git commit -m "feat: eingebettete CouchDB additiv in app.js/requireAuth verdrahten"
```
