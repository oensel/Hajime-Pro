# Teilnehmer- und Pools-Repository Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zwei weitere entitätsspezifische CouchDB-Repositories (`turnierTeilnehmerRepository.js`, `poolsRepository.js`) nach exakt demselben, bereits etablierten Muster wie `kampfflaechenRepository.js`. Vollständig getestet, weiterhin **nicht** in `src/app.js`/`src/routes/`/`src/controllers/` verdrahtet.

**Architecture:** Beide Repositories sind dünne Wrapper um `createRepository({ db, typePrefix })` (CouchDB-Fundament) — exakt dasselbe Muster wie `kampfflaechenRepository.js`: ein expliziter `created_at`-Zeitstempel bei der Erstellung (ersetzt die fehlende SQL-Auto-Increment-Reihenfolge) und eine `findByTurnier(turnierId)`-Abfrage. Weitere, speziellere Abfragen (z.B. "Teilnehmer eines Pools", "Pools einer Kampffläche") sind bewusst nicht Teil dieses Plans — sie werden erst ergänzt, wenn ein konkreter Cutover-Plan sie tatsächlich braucht (YAGNI).

**Tech Stack:** Kein neuer Dependency-Bedarf — nutzt ausschließlich bereits vorhandene Module aus dem CouchDB-Fundament.

**Spec:** [docs/superpowers/specs/2026-09-22-couchdb-pouchdb-migration-design.md](../specs/2026-09-22-couchdb-pouchdb-migration-design.md)

## Global Constraints

- ESM-Only (`"type": "module"` in `package.json`) — alle neuen Dateien nutzen `import`/`export`, kein `require`.
- Dokument-IDs folgen dem Schema `<typePrefix>:<uuid>` (hier `teilnehmer:<uuid>` bzw. `pool:<uuid>`, via `createRepository`).
- Keine Kommentare, die nur wiederholen, was der Code schon sagt — nur wo eine nicht offensichtliche Entscheidung erklärt werden muss.
- Genau EIN `startTestCouchServer()`-Aufruf pro Testdatei via `before()`/`after()` (technisch erzwungen — ein zweiter Aufruf wirft einen Fehler); jeder einzelne Test bekommt eine eigene, zufällig benannte Datenbank innerhalb dieses einen Servers.
- Diese Schicht wird in diesem Plan **nicht** in `src/app.js`, `src/routes/` oder `src/controllers/` verdrahtet — `teilnehmerController.js` und `poolController.js` bleiben vollständig unverändert und weiterhin auf Knex.
- Beide Repositories bilden bewusst nur `create` (mit `created_at`) und `findByTurnier` zusätzlich zum generischen `createRepository`-Verhalten ab — keine weiteren, spekulativen Abfragemethoden (siehe Architecture).

---

### Task 1: `turnierTeilnehmerRepository.js` mit `findByTurnier`

**Files:**
- Create: `src/db/repositories/turnierTeilnehmerRepository.js`
- Test: `tests/unit/db/repositories/turnierTeilnehmerRepository.test.js`

**Interfaces:**
- Consumes: `createRepository({ db, typePrefix })` aus `src/db/baseRepository.js`, `connect`/`ensureDatabase` aus `src/db/couch.js`, `startTestCouchServer` aus `tests/unit/helpers/couchTestServer.js` (nur im Test).
- Produces: `createTurnierTeilnehmerRepository(db): { create(data), findById(id), update(id, patch), remove(id), query(selector), findByTurnier(turnierId) }`.

- [ ] **Step 1: Failing Test schreiben**

`tests/unit/db/repositories/turnierTeilnehmerRepository.test.js`:

```javascript
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startTestCouchServer } from '../../helpers/couchTestServer.js';
import { connect, ensureDatabase } from '../../../../src/db/couch.js';
import { createTurnierTeilnehmerRepository } from '../../../../src/db/repositories/turnierTeilnehmerRepository.js';

let server;
let nano;

before(async () => {
    server = await startTestCouchServer();
    nano = connect(server.url);
});

after(async () => {
    await server.close();
});

async function neuesRepository() {
    const db = await ensureDatabase(nano, `test-${randomUUID()}`);
    return createTurnierTeilnehmerRepository(db);
}

test('create legt einen Teilnehmer mit Erstellungszeitpunkt an', async () => {
    const repo = await neuesRepository();
    const teilnehmer = await repo.create({
        turnier_id: 'turnier:1',
        vorname: 'Max',
        nachname: 'Mustermann',
        geburtsjahr: 2005,
        geschlecht: 'm',
        verein: 'JC Beispiel',
        gewicht: 73.5,
        altersklasse: 'U18',
        gewichtsklasse: '-73kg'
    });

    assert.match(teilnehmer._id, /^teilnehmer:/);
    assert.equal(teilnehmer.nachname, 'Mustermann');
    assert.ok(teilnehmer.created_at);
});

test('findByTurnier liefert nur Teilnehmer des angegebenen Turniers', async () => {
    const repo = await neuesRepository();
    await repo.create({ turnier_id: 'turnier:1', vorname: 'Max', nachname: 'Mustermann' });
    await repo.create({ turnier_id: 'turnier:2', vorname: 'Erika', nachname: 'Beispiel' });
    await repo.create({ turnier_id: 'turnier:1', vorname: 'Anna', nachname: 'Musterfrau' });

    const gefunden = await repo.findByTurnier('turnier:1');

    assert.equal(gefunden.length, 2);
    assert.ok(gefunden.every(t => t.turnier_id === 'turnier:1'));
});

test('findByTurnier liefert die Teilnehmer in Erstellungsreihenfolge', async () => {
    const repo = await neuesRepository();
    await repo.create({ turnier_id: 'turnier:1', nachname: 'Erste' });
    await repo.create({ turnier_id: 'turnier:1', nachname: 'Zweite' });
    await repo.create({ turnier_id: 'turnier:1', nachname: 'Dritte' });

    const gefunden = await repo.findByTurnier('turnier:1');

    assert.deepEqual(gefunden.map(t => t.nachname), ['Erste', 'Zweite', 'Dritte']);
});

test('findById, update und remove funktionieren wie im generischen Repository', async () => {
    const repo = await neuesRepository();
    const teilnehmer = await repo.create({ turnier_id: 'turnier:1', nachname: 'Mustermann' });

    const gefunden = await repo.findById(teilnehmer._id);
    assert.equal(gefunden.nachname, 'Mustermann');

    const aktualisiert = await repo.update(teilnehmer._id, { status: 'kampfbereit' });
    assert.equal(aktualisiert.status, 'kampfbereit');

    await repo.remove(teilnehmer._id);
    const nachDemLoeschen = await repo.findById(teilnehmer._id);
    assert.equal(nachDemLoeschen, null);
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag bestätigen**

Run: `npm run test:unit`
Expected: FAIL — `Cannot find module '.../src/db/repositories/turnierTeilnehmerRepository.js'`

- [ ] **Step 3: Implementieren**

`src/db/repositories/turnierTeilnehmerRepository.js`:

```javascript
import { createRepository } from '../baseRepository.js';

const TYPE_PREFIX = 'teilnehmer';

// Wie bei kampfflaechenRepository.js: CouchDB-Dokumente haben keine implizite
// Einfüge-Reihenfolge wie die bisherige SQL-Auto-Increment-ID -- ein expliziter Zeitstempel
// bei der Erstellung ersetzt sie für die Sortierung in findByTurnier.
export function createTurnierTeilnehmerRepository(db) {
    const repo = createRepository({ db, typePrefix: TYPE_PREFIX });

    async function create(data) {
        return repo.create({ ...data, created_at: new Date().toISOString() });
    }

    async function findByTurnier(turnierId) {
        const gefunden = await repo.query({ turnier_id: turnierId });
        return gefunden.sort((a, b) => a.created_at.localeCompare(b.created_at));
    }

    return { ...repo, create, findByTurnier };
}
```

- [ ] **Step 4: Test ausführen, Erfolg bestätigen**

Run: `npm run test:unit`
Expected: PASS (4 neue Tests)

- [ ] **Step 5: Commit**

```bash
git add src/db/repositories/turnierTeilnehmerRepository.js tests/unit/db/repositories/turnierTeilnehmerRepository.test.js
git commit -m "feat: Teilnehmer-Repository nach dem Kampfflächen-Repository-Muster"
```

---

### Task 2: `poolsRepository.js` mit `findByTurnier`

**Files:**
- Create: `src/db/repositories/poolsRepository.js`
- Test: `tests/unit/db/repositories/poolsRepository.test.js`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: `createRepository({ db, typePrefix })` aus `src/db/baseRepository.js`, `connect`/`ensureDatabase` aus `src/db/couch.js`, `startTestCouchServer` aus `tests/unit/helpers/couchTestServer.js` (nur im Test).
- Produces: `createPoolsRepository(db): { create(data), findById(id), update(id, patch), remove(id), query(selector), findByTurnier(turnierId) }`.

- [ ] **Step 1: Failing Test schreiben**

`tests/unit/db/repositories/poolsRepository.test.js`:

```javascript
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startTestCouchServer } from '../../helpers/couchTestServer.js';
import { connect, ensureDatabase } from '../../../../src/db/couch.js';
import { createPoolsRepository } from '../../../../src/db/repositories/poolsRepository.js';

let server;
let nano;

before(async () => {
    server = await startTestCouchServer();
    nano = connect(server.url);
});

after(async () => {
    await server.close();
});

async function neuesRepository() {
    const db = await ensureDatabase(nano, `test-${randomUUID()}`);
    return createPoolsRepository(db);
}

test('create legt einen Pool mit Erstellungszeitpunkt an', async () => {
    const repo = await neuesRepository();
    const pool = await repo.create({
        turnier_id: 'turnier:1',
        bezeichnung: 'U18 Männlich -73kg',
        altersklasse: 'U18',
        geschlecht: 'm',
        gewichtsklasse: '-73kg'
    });

    assert.match(pool._id, /^pool:/);
    assert.equal(pool.bezeichnung, 'U18 Männlich -73kg');
    assert.ok(pool.created_at);
});

test('findByTurnier liefert nur Pools des angegebenen Turniers', async () => {
    const repo = await neuesRepository();
    await repo.create({ turnier_id: 'turnier:1', bezeichnung: 'Pool A' });
    await repo.create({ turnier_id: 'turnier:2', bezeichnung: 'Pool B' });
    await repo.create({ turnier_id: 'turnier:1', bezeichnung: 'Pool C' });

    const gefunden = await repo.findByTurnier('turnier:1');

    assert.equal(gefunden.length, 2);
    assert.ok(gefunden.every(p => p.turnier_id === 'turnier:1'));
});

test('findByTurnier liefert die Pools in Erstellungsreihenfolge', async () => {
    const repo = await neuesRepository();
    await repo.create({ turnier_id: 'turnier:1', bezeichnung: 'Pool 1' });
    await repo.create({ turnier_id: 'turnier:1', bezeichnung: 'Pool 2' });
    await repo.create({ turnier_id: 'turnier:1', bezeichnung: 'Pool 3' });

    const gefunden = await repo.findByTurnier('turnier:1');

    assert.deepEqual(gefunden.map(p => p.bezeichnung), ['Pool 1', 'Pool 2', 'Pool 3']);
});

test('findById, update und remove funktionieren wie im generischen Repository', async () => {
    const repo = await neuesRepository();
    const pool = await repo.create({ turnier_id: 'turnier:1', bezeichnung: 'Pool 1' });

    const gefunden = await repo.findById(pool._id);
    assert.equal(gefunden.bezeichnung, 'Pool 1');

    const aktualisiert = await repo.update(pool._id, { status: 'gestartet' });
    assert.equal(aktualisiert.status, 'gestartet');

    await repo.remove(pool._id);
    const nachDemLoeschen = await repo.findById(pool._id);
    assert.equal(nachDemLoeschen, null);
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag bestätigen**

Run: `npm run test:unit`
Expected: FAIL — `Cannot find module '.../src/db/repositories/poolsRepository.js'`

- [ ] **Step 3: Implementieren**

`src/db/repositories/poolsRepository.js`:

```javascript
import { createRepository } from '../baseRepository.js';

const TYPE_PREFIX = 'pool';

// Wie bei kampfflaechenRepository.js: CouchDB-Dokumente haben keine implizite
// Einfüge-Reihenfolge wie die bisherige SQL-Auto-Increment-ID -- ein expliziter Zeitstempel
// bei der Erstellung ersetzt sie für die Sortierung in findByTurnier.
export function createPoolsRepository(db) {
    const repo = createRepository({ db, typePrefix: TYPE_PREFIX });

    async function create(data) {
        return repo.create({ ...data, created_at: new Date().toISOString() });
    }

    async function findByTurnier(turnierId) {
        const gefunden = await repo.query({ turnier_id: turnierId });
        return gefunden.sort((a, b) => a.created_at.localeCompare(b.created_at));
    }

    return { ...repo, create, findByTurnier };
}
```

- [ ] **Step 4: Test ausführen, Erfolg bestätigen**

Run: `npm run test:unit`
Expected: PASS (4 neue Tests, insgesamt 25)

- [ ] **Step 5: Dokumentation ergänzen**

In `CLAUDE.md` im Abschnitt "Zentrale Architekturkonzepte", im Punkt zu `src/db/`, den Satz über `src/db/repositories/` aktualisieren — ersetze

```markdown
`src/db/repositories/` enthält bereits erste entitätsspezifische Repositories (aktuell `kampfflaechenRepository.js`) als dünne Wrapper um `baseRepository.js`, ebenfalls nur gegen die In-Memory-Testinfrastruktur getestet
```

durch

```markdown
`src/db/repositories/` enthält bereits erste entitätsspezifische Repositories (`kampfflaechenRepository.js`, `turnierTeilnehmerRepository.js`, `poolsRepository.js`) als dünne Wrapper um `baseRepository.js` (jeweils `create` mit `created_at`-Zeitstempel plus `findByTurnier`), ebenfalls nur gegen die In-Memory-Testinfrastruktur getestet
```

- [ ] **Step 6: Commit**

```bash
git add src/db/repositories/poolsRepository.js tests/unit/db/repositories/poolsRepository.test.js CLAUDE.md
git commit -m "feat: Pools-Repository nach dem Kampfflächen-Repository-Muster"
```

---

## Self-Review-Notizen

- **Spec-Abdeckung:** Deckt zwei weitere kleine Schritte von Phase 1 ab, exakt nach dem in der vorherigen Umsetzung etablierten und review-geprüften Muster. Die tatsächliche App-Verdrahtung bleibt weiterhin bewusst ausgeklammert (Fremdschlüssel-Kopplung, siehe vorherige Pläne).
- **Platzhalter-Scan:** Keine TBD/TODO-Stellen; jeder Schritt enthält vollständigen, lauffähigen Code.
- **Typ-Konsistenz:** `createTurnierTeilnehmerRepository(db)` und `createPoolsRepository(db)` folgen exakt derselben Signatur- und Rückgabestruktur wie `createKampfflaechenRepository(db)` (`create`, `findById`, `update`, `remove`, `query`, `findByTurnier`) — keine Task widerspricht der anderen oder der bestehenden `kampfflaechenRepository.js`.
