# CouchDB-Fundament Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eine eigenständige, vollständig getestete CouchDB-Datenzugriffsschicht (Verbindung, ID-Schema, generisches Repository mit Mango-Query-Unterstützung) als Fundament für die schrittweise Ablösung von Knex — ohne bestehenden Anwendungscode anzufassen. Die App bleibt nach diesem Plan unverändert lauffähig; nichts wird noch verdrahtet.

**Architecture:** Neues Verzeichnis `src/db/` mit drei kleinen, unabhängigen Modulen (Verbindung, ID-Erzeugung, generisches Repository), die zusammen die in der Spec festgelegten Grundregeln umsetzen: eine CouchDB-Datenbank pro Turnier, Dokumenttypen mit präfigierten IDs (`kampf:<uuid>`) statt Auto-Increment, Mango-Queries als Ersatz für SQL-`WHERE`. Getestet wird gegen eine echte, aber In-Memory laufende CouchDB-kompatible HTTP-API (`express-pouchdb` + `pouchdb-adapter-memory`), damit keine externe CouchDB-Installation für die Tests nötig ist.

**Tech Stack:** `nano` (CouchDB-Client), `pouchdb` + `pouchdb-adapter-memory` + `pouchdb-find` + `express-pouchdb` (nur als Dev-Dependency für die Testinfrastruktur), Node-eigener Test-Runner (`node --test`, keine neue Testframework-Abhängigkeit für die Produktivseite nötig).

**Spec:** [docs/superpowers/specs/2026-09-22-couchdb-pouchdb-migration-design.md](../specs/2026-09-22-couchdb-pouchdb-migration-design.md)

## Global Constraints

- ESM-Only (`"type": "module"` in `package.json`) — alle neuen Dateien nutzen `import`/`export`, kein `require`.
- Dokument-IDs folgen dem Schema `<typePrefix>:<uuid>` (siehe Spec, Abschnitt "Datenmodell").
- Kein Login/Auth in dieser Schicht — das ist hier nicht relevant, `src/db/` kennt keine Turniere, Vereine oder Benutzer, nur generische Dokumente.
- Keine Kommentare, die nur wiederholen, was der Code schon sagt — nur wo eine nicht offensichtliche Entscheidung erklärt werden muss (Projekt-Konvention, siehe bestehender Code in `src/controllers/`).
- Diese Schicht wird in diesem Plan **nicht** in `src/app.js`, `src/routes/` oder `src/controllers/` verdrahtet — das ist Gegenstand eines Folgeplans, sobald diese Bausteine stehen.

---

### Task 1: In-Memory-CouchDB-Testserver + Abhängigkeiten

**Files:**
- Modify: `package.json`
- Create: `tests/unit/helpers/couchTestServer.js`
- Test: `tests/unit/helpers/couchTestServer.test.js`

**Interfaces:**
- Produces: `startTestCouchServer(): Promise<{ url: string, close: () => Promise<void> }>` — startet eine CouchDB-kompatible HTTP-API auf einem freien Port, `close()` fährt sie sauber herunter. Wird von allen folgenden Tasks in ihren Tests verwendet.

- [ ] **Step 1: Abhängigkeiten hinzufügen**

In `package.json` folgende Einträge ergänzen:

```json
  "dependencies": {
    "@material-design-icons/font": "^0.14.15",
    "dotenv": "^16.4.5",
    "express": "^4.19.2",
    "jsonwebtoken": "^9.0.2",
    "jsqr": "^1.4.0",
    "knex": "^3.1.0",
    "material-components-web": "^14.0.0",
    "nano": "^11.0.7",
    "nodemailer": "^6.9.15",
    "pg": "^8.11.5",
    "qrcode-generator": "^2.0.4",
    "sqlite3": "^5.1.7",
    "xlsx": "https://cdn.sheetjs.com/xlsx-0.20.2/xlsx-0.20.2.tgz"
  },
  "devDependencies": {
    "@playwright/test": "^1.62.1",
    "express-pouchdb": "^4.2.0",
    "pouchdb": "^9.0.0",
    "pouchdb-adapter-memory": "^9.0.0",
    "pouchdb-find": "^9.0.0"
  }
```

Und im `scripts`-Block ergänzen:

```json
    "test:unit": "node --test tests/unit"
```

Danach installieren:

```bash
npm install
```

- [ ] **Step 2: Verzeichnisse anlegen und failing Test schreiben**

`tests/unit/helpers/couchTestServer.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import nanoLib from 'nano';
import { startTestCouchServer } from './couchTestServer.js';

test('startTestCouchServer stellt eine funktionsfähige CouchDB-kompatible HTTP-API bereit', async () => {
    const { url, close } = await startTestCouchServer();
    try {
        const nano = nanoLib(url);
        await nano.db.create('smoke');
        const db = nano.db.use('smoke');

        await db.insert({ _id: 'doc1', wert: 42 });
        const doc = await db.get('doc1');

        assert.equal(doc.wert, 42);
    } finally {
        await close();
    }
});
```

- [ ] **Step 3: Test ausführen, Fehlschlag bestätigen**

Run: `npm run test:unit`
Expected: FAIL — `Cannot find module '.../tests/unit/helpers/couchTestServer.js'`

- [ ] **Step 4: Testserver-Helper implementieren**

`tests/unit/helpers/couchTestServer.js`:

```javascript
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
```

- [ ] **Step 5: Test ausführen, Erfolg bestätigen**

Run: `npm run test:unit`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json tests/unit/helpers/couchTestServer.js tests/unit/helpers/couchTestServer.test.js
git commit -m "feat: In-Memory-CouchDB-Testserver für die neue Datenzugriffsschicht"
```

---

### Task 2: Dokument-ID-Schema

**Files:**
- Create: `src/db/documentId.js`
- Test: `tests/unit/db/documentId.test.js`

**Interfaces:**
- Produces: `createId(typePrefix: string): string` (Format `<typePrefix>:<uuid>`), `getTypeFromId(id: string): string`. Wird von `baseRepository.js` (Task 4) und allen künftigen Entitäts-Repositories verwendet.

- [ ] **Step 1: Failing Test schreiben**

`tests/unit/db/documentId.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createId, getTypeFromId } from '../../../src/db/documentId.js';

test('createId erzeugt eine ID mit Typ-Präfix und UUID', () => {
    const id = createId('kampf');
    assert.match(id, /^kampf:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
});

test('createId erzeugt bei jedem Aufruf eine andere ID', () => {
    const a = createId('pool');
    const b = createId('pool');
    assert.notEqual(a, b);
});

test('getTypeFromId liest das Typ-Präfix aus einer ID', () => {
    assert.equal(getTypeFromId('kampf:abc-123'), 'kampf');
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag bestätigen**

Run: `npm run test:unit`
Expected: FAIL — `Cannot find module '.../src/db/documentId.js'`

- [ ] **Step 3: Implementieren**

`src/db/documentId.js`:

```javascript
import { randomUUID } from 'node:crypto';

export function createId(typePrefix) {
    return `${typePrefix}:${randomUUID()}`;
}

export function getTypeFromId(id) {
    return id.split(':')[0];
}
```

- [ ] **Step 4: Test ausführen, Erfolg bestätigen**

Run: `npm run test:unit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/db/documentId.js tests/unit/db/documentId.test.js
git commit -m "feat: Dokument-ID-Schema mit Typ-Präfix für CouchDB-Dokumente"
```

---

### Task 3: CouchDB-Verbindung & Datenbank-Provisionierung

**Files:**
- Create: `src/db/couch.js`
- Test: `tests/unit/db/couch.test.js`

**Interfaces:**
- Consumes: `startTestCouchServer()` aus Task 1 (nur im Test).
- Produces: `connect(url: string): NanoInstance`, `ensureDatabase(nano: NanoInstance, dbName: string): Promise<NanoDbHandle>`. Wird von `baseRepository.js` (Task 4) und allen künftigen Entitäts-Repositories verwendet.

- [ ] **Step 1: Failing Test schreiben**

`tests/unit/db/couch.test.js`:

```javascript
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startTestCouchServer } from '../helpers/couchTestServer.js';
import { connect, ensureDatabase } from '../../../src/db/couch.js';

// Genau EIN Server pro Testdatei (before/after), geteilt von allen test()-Blöcken darin --
// mehrere startTestCouchServer()-Aufrufe in derselben Datei (= demselben Prozess, node --test
// isoliert nur zwischen Dateien, nicht innerhalb einer Datei) bringen express-pouchdbs interne
// Datenbank-Registrierung durcheinander (bestätigt per Spike, unabhängig vom gewählten
// Datenbanknamen). Jeder einzelne Test bekommt trotzdem seine eigene, isolierte Datenbank
// über einen zufälligen Namen innerhalb dieses einen Servers.
let server;
let nano;

before(async () => {
    server = await startTestCouchServer();
    nano = connect(server.url);
});

after(async () => {
    await server.close();
});

test('ensureDatabase legt eine neue Datenbank an und liefert einen nutzbaren Handle', async () => {
    const db = await ensureDatabase(nano, `test-${randomUUID()}`);

    await db.insert({ _id: 'probe', ok: true });
    const doc = await db.get('probe');

    assert.equal(doc.ok, true);
});

test('ensureDatabase ist idempotent, wenn die Datenbank schon existiert', async () => {
    const dbName = `test-${randomUUID()}`;
    await ensureDatabase(nano, dbName);
    const db = await ensureDatabase(nano, dbName);

    await db.insert({ _id: 'probe', ok: true });
    const doc = await db.get('probe');

    assert.equal(doc.ok, true);
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag bestätigen**

Run: `npm run test:unit`
Expected: FAIL — `Cannot find module '.../src/db/couch.js'`

- [ ] **Step 3: Implementieren**

`src/db/couch.js`:

```javascript
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
```

- [ ] **Step 4: Test ausführen, Erfolg bestätigen**

Run: `npm run test:unit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/db/couch.js tests/unit/db/couch.test.js
git commit -m "feat: CouchDB-Verbindung und idempotente Datenbank-Provisionierung"
```

---

### Task 4: Generisches Repository (CRUD + Mango-Query)

**Files:**
- Create: `src/db/baseRepository.js`
- Test: `tests/unit/db/baseRepository.test.js`

**Interfaces:**
- Consumes: `startTestCouchServer()` (Task 1), `connect`/`ensureDatabase` aus `src/db/couch.js` (Task 3, nur im Test), `createId` aus `src/db/documentId.js` (Task 2).
- Produces: `createRepository({ db, typePrefix }): { create(data), findById(id), update(id, patch), remove(id), query(selector) }`. Dies ist die Basis, auf der künftige Entitäts-Repositories (z.B. `kampfflaechenRepository.js`) in Folgeplänen aufbauen.

- [ ] **Step 1: Failing Test schreiben**

`tests/unit/db/baseRepository.test.js`:

```javascript
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startTestCouchServer } from '../helpers/couchTestServer.js';
import { connect, ensureDatabase } from '../../../src/db/couch.js';
import { createRepository } from '../../../src/db/baseRepository.js';

// Genau EIN Server für die ganze Datei (before/after) -- siehe Kommentar in couch.test.js:
// mehrere startTestCouchServer()-Aufrufe in derselben Datei bringen express-pouchdbs interne
// Datenbank-Registrierung durcheinander. Jeder Test bekommt trotzdem sein eigenes Repository
// auf einer frischen, zufällig benannten Datenbank innerhalb dieses einen Servers.
let server;
let nano;

before(async () => {
    server = await startTestCouchServer();
    nano = connect(server.url);
});

after(async () => {
    await server.close();
});

async function neuesRepository(typePrefix) {
    const db = await ensureDatabase(nano, `test-${randomUUID()}`);
    return createRepository({ db, typePrefix });
}

test('create legt ein Dokument mit Typ-Präfix-ID an und liefert es vollständig zurück', async () => {
    const repo = await neuesRepository('kampffl');
    const doc = await repo.create({ bezeichnung: 'Matte 1' });

    assert.match(doc._id, /^kampffl:/);
    assert.equal(doc.typ, 'kampffl');
    assert.equal(doc.bezeichnung, 'Matte 1');
    assert.ok(doc._rev);
});

test('findById liefert ein vorhandenes Dokument', async () => {
    const repo = await neuesRepository('kampffl');
    const created = await repo.create({ bezeichnung: 'Matte 1' });

    const found = await repo.findById(created._id);

    assert.equal(found.bezeichnung, 'Matte 1');
});

test('findById liefert null für ein nicht vorhandenes Dokument', async () => {
    const repo = await neuesRepository('kampffl');

    const found = await repo.findById('kampffl:nicht-vorhanden');

    assert.equal(found, null);
});

test('update ändert einzelne Felder, ohne die übrigen zu verlieren', async () => {
    const repo = await neuesRepository('kampffl');
    const created = await repo.create({ bezeichnung: 'Matte 1', status: 'frei' });

    const updated = await repo.update(created._id, { status: 'pausiert' });

    assert.equal(updated.status, 'pausiert');
    assert.equal(updated.bezeichnung, 'Matte 1');
});

test('remove löscht ein Dokument endgültig', async () => {
    const repo = await neuesRepository('kampffl');
    const created = await repo.create({ bezeichnung: 'Matte 1' });

    await repo.remove(created._id);
    const found = await repo.findById(created._id);

    assert.equal(found, null);
});

test('query findet Dokumente über zusätzliche Selector-Felder, beschränkt auf den eigenen Typ', async () => {
    const repo = await neuesRepository('kampffl');
    await repo.create({ bezeichnung: 'Matte 1', turnier_id: 'turnier:1' });
    await repo.create({ bezeichnung: 'Matte 2', turnier_id: 'turnier:1' });
    await repo.create({ bezeichnung: 'Matte 3', turnier_id: 'turnier:2' });

    const treffer = await repo.query({ turnier_id: 'turnier:1' });

    assert.equal(treffer.length, 2);
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag bestätigen**

Run: `npm run test:unit`
Expected: FAIL — `Cannot find module '.../src/db/baseRepository.js'`

- [ ] **Step 3: Implementieren**

`src/db/baseRepository.js`:

```javascript
import { createId } from './documentId.js';

export function createRepository({ db, typePrefix }) {
    async function create(data) {
        const _id = createId(typePrefix);
        const doc = { ...data, _id, typ: typePrefix };
        const result = await db.insert(doc);
        return { ...doc, _rev: result.rev };
    }

    async function findById(id) {
        try {
            return await db.get(id);
        } catch (error) {
            if (error.statusCode === 404) return null;
            throw error;
        }
    }

    async function update(id, patch) {
        const current = await db.get(id);
        const merged = { ...current, ...patch, _id: current._id, _rev: current._rev };
        const result = await db.insert(merged);
        return { ...merged, _rev: result.rev };
    }

    async function remove(id) {
        const current = await db.get(id);
        await db.destroy(id, current._rev);
    }

    // CouchDB/PouchDB können Mango-Queries auch ohne vorher angelegten Index beantworten
    // (Vollscan) -- bei den kleinen Dokumentmengen eines einzelnen Turniers (siehe Spec)
    // ist das ausreichend performant, ein Index-Management ist hier bewusst nicht Teil des
    // Fundaments.
    async function query(selector) {
        const result = await db.find({ selector: { typ: typePrefix, ...selector } });
        return result.docs;
    }

    return { create, findById, update, remove, query };
}
```

- [ ] **Step 4: Test ausführen, Erfolg bestätigen**

Run: `npm run test:unit`
Expected: PASS (6 Tests)

- [ ] **Step 5: Commit**

```bash
git add src/db/baseRepository.js tests/unit/db/baseRepository.test.js
git commit -m "feat: generisches CouchDB-Repository mit CRUD und Mango-Query"
```

---

### Task 5: Dokumentation aktualisieren

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Neue Test- und Datenzugriffsschicht in CLAUDE.md dokumentieren**

In `CLAUDE.md` im Abschnitt "Commands" nach der Zeile zum `test/`-Verzeichnis (Zeile beginnend mit `` `test/` (Singular, Repo-Root) ``) ergänzen:

```markdown
- **`tests/unit/`** — Node-eigener Test-Runner (`npm run test:unit`, `node --test`), unabhängig von der Playwright-E2E-Suite; deckt aktuell die neue CouchDB-Datenzugriffsschicht (`src/db/`) ab, getestet gegen eine In-Memory-CouchDB-kompatible HTTP-API (`tests/unit/helpers/couchTestServer.js`, `express-pouchdb` + `pouchdb-adapter-memory`), ohne dass dafür eine echte CouchDB-Installation nötig ist
```

Im Abschnitt "Zentrale Architekturkonzepte" nach dem Punkt zu `src/shared/` ergänzen:

```markdown
- **`src/db/`** — CouchDB-Datenzugriffsschicht (Fundament der CouchDB/PouchDB-Migration, siehe `docs/superpowers/specs/2026-09-22-couchdb-pouchdb-migration-design.md`): `couch.js` (Verbindung, Datenbank-Provisionierung), `documentId.js` (ID-Schema `<typ>:<uuid>`), `baseRepository.js` (generisches CRUD + Mango-Query). Noch nicht in `app.js`/Controller verdrahtet — das ist Gegenstand der Folgepläne, die die einzelnen Entitäten (kampfflaechen, pools, kaempfe, ...) migrieren
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: CouchDB-Fundament (src/db, tests/unit) in CLAUDE.md dokumentieren"
```

---

## Self-Review-Notizen

- **Spec-Abdeckung:** Dieser Plan deckt ausschließlich den Fundament-Teil von Phase 1 ab (Verbindung, ID-Schema, generischer Datenzugriff mit Mango-Query). Die eigentliche Migration einzelner Entitäten (kampfflaechen, pools, kaempfe, mannschaften, vereine/benutzer) sowie das Verdrahten in `app.js`/Controller ist bewusst **nicht** Teil dieses Plans — dafür braucht es eigene, entitätsweise Folgepläne, da schon `kampfflaechenController.js` beim Löschen quer in `pools`/`kaempfe` schreibt und keine der bestehenden Entitäten sauber isoliert migrierbar ist.
- **Platzhalter-Scan:** Keine TBD/TODO-Stellen; jeder Schritt enthält vollständigen, lauffähigen Code.
- **Typ-Konsistenz:** `createRepository({ db, typePrefix })` und seine Rückgabewerte (`create`, `findById`, `update`, `remove`, `query`) sind über Task 4 hinweg konsistent benannt und werden von keiner anderen Task widersprüchlich verwendet.
