# Mannschafts-Repositories Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drei entitätsspezifische CouchDB-Repositories für die Mannschafts-Domäne (`mannschaftenRepository.js`, `mannschaftMitgliederRepository.js`, `mannschaftskaempfeRepository.js`), jeweils mit den Abfragemethoden, die tatsächlicher Code-Recherche zufolge gebraucht werden. Vollständig getestet, weiterhin **nicht** in `src/app.js`/`src/routes/`/`src/controllers/` verdrahtet.

**Architecture:** Alle drei sind dünne Wrapper um `createRepository({ db, typePrefix })`, exakt nach dem etablierten Muster. Die Abfragemethoden sind durch tatsächliche Recherche begründet, nicht geraten:
- `mannschaftenRepository`: `findByPool(poolId)` (Mannschaften eines Pools) UND `findUnassigned()` (Mannschaften eines Turniers ohne zugewiesenen Pool — `pool_id: null`) — beide Muster kommen in `mannschaftController.js` real vor.
- `mannschaftMitgliederRepository`: `findByMannschaft(mannschaftId)` (Roster-Positionen einer Mannschaft) — der mit Abstand häufigste Zugriffspfad. Der seltenere Bulk-Fall (Mitglieder mehrerer Mannschaften gleichzeitig) bekommt bewusst keine eigene Methode — das generische `query({ mannschaft_id: { $in: [...] } })` aus `baseRepository.js` deckt das bereits ab (YAGNI).
- `mannschaftskaempfeRepository`: `findByPool(poolId)` — exakt dasselbe Muster wie `kaempfeRepository.findByPool`, begründet durch `src/shared/mannschaftsProgression.js`, dessen einzige Funktion `berechneMannschaftsPatches(begegnungen)` immer alle Begegnungen **eines Pools** als Array entgegennimmt.

**Tech Stack:** Kein neuer Dependency-Bedarf.

**Spec:** [docs/superpowers/specs/2026-09-22-couchdb-pouchdb-migration-design.md](../specs/2026-09-22-couchdb-pouchdb-migration-design.md)

## Global Constraints

- ESM-Only — alle neuen Dateien nutzen `import`/`export`, kein `require`.
- Dokument-IDs folgen dem Schema `<typePrefix>:<uuid>` (`mannschaft:<uuid>`, `mitglied:<uuid>`, `mannschaftskampf:<uuid>`).
- Keine Kommentare, die nur wiederholen, was der Code schon sagt.
- Genau EIN `startTestCouchServer()`-Aufruf pro Testdatei via `before()`/`after()` (technisch erzwungen); jeder einzelne Test bekommt eine eigene, zufällig benannte Datenbank.
- Diese Schicht wird in diesem Plan **nicht** in `src/app.js`, `src/routes/` oder `src/controllers/` verdrahtet — `mannschaftController.js`, `mannschaftsBegegnungEngine.js` bleiben vollständig unverändert und weiterhin auf Knex.
- Kein `findByTurnier`/`findAll` für pool-bezogene Abfragen — eine CouchDB-Datenbank pro Turnier macht turnierweite Filter überflüssig, aber pool-bezogene Filter bleiben nötig, da eine Turnier-Datenbank mehrere Pools enthält (siehe `docs/superpowers/plans/2026-09-23-repository-findall-korrektur.md` und `docs/superpowers/plans/2026-09-23-kaempfe-repository.md`).
- Keine spekulativen Zusatzmethoden über das oben begründete Set hinaus (z.B. kein `findByMannschaften`-Bulk-Wrapper — der generische `query()` deckt das ab).

---

### Task 1: `mannschaftenRepository.js` mit `findByPool` und `findUnassigned`

**Files:**
- Create: `src/db/repositories/mannschaftenRepository.js`
- Test: `tests/unit/db/repositories/mannschaftenRepository.test.js`

**Interfaces:**
- Consumes: `createRepository({ db, typePrefix })` aus `src/db/baseRepository.js`.
- Produces: `createMannschaftenRepository(db): { create(data), findById(id), update(id, patch), remove(id), query(selector), findByPool(poolId), findUnassigned() }`.

- [ ] **Step 1: Failing Test schreiben**

`tests/unit/db/repositories/mannschaftenRepository.test.js`:

```javascript
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startTestCouchServer } from '../../helpers/couchTestServer.js';
import { connect, ensureDatabase } from '../../../../src/db/couch.js';
import { createMannschaftenRepository } from '../../../../src/db/repositories/mannschaftenRepository.js';

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
    return createMannschaftenRepository(db);
}

test('create legt eine Mannschaft mit Erstellungszeitpunkt an', async () => {
    const repo = await neuesRepository();
    const mannschaft = await repo.create({ verein: 'JC Beispiel', bezeichnung: 'JC Beispiel I', status: 'angemeldet' });

    assert.match(mannschaft._id, /^mannschaft:/);
    assert.equal(mannschaft.bezeichnung, 'JC Beispiel I');
    assert.ok(mannschaft.created_at);
});

test('findByPool liefert nur Mannschaften des angegebenen Pools', async () => {
    const repo = await neuesRepository();
    await repo.create({ pool_id: 'pool:1', bezeichnung: 'Team A' });
    await repo.create({ pool_id: 'pool:2', bezeichnung: 'Team B' });
    await repo.create({ pool_id: 'pool:1', bezeichnung: 'Team C' });

    const gefunden = await repo.findByPool('pool:1');

    assert.equal(gefunden.length, 2);
    assert.ok(gefunden.every(m => m.pool_id === 'pool:1'));
});

test('findUnassigned liefert nur Mannschaften ohne zugewiesenen Pool', async () => {
    const repo = await neuesRepository();
    await repo.create({ pool_id: null, bezeichnung: 'Team A' });
    await repo.create({ pool_id: 'pool:1', bezeichnung: 'Team B' });
    await repo.create({ pool_id: null, bezeichnung: 'Team C' });

    const gefunden = await repo.findUnassigned();

    assert.equal(gefunden.length, 2);
    assert.ok(gefunden.every(m => m.pool_id === null));
});

test('findById, update und remove funktionieren wie im generischen Repository', async () => {
    const repo = await neuesRepository();
    const mannschaft = await repo.create({ bezeichnung: 'Team A' });

    const gefunden = await repo.findById(mannschaft._id);
    assert.equal(gefunden.bezeichnung, 'Team A');

    const aktualisiert = await repo.update(mannschaft._id, { status: 'zugewiesen' });
    assert.equal(aktualisiert.status, 'zugewiesen');

    await repo.remove(mannschaft._id);
    const nachDemLoeschen = await repo.findById(mannschaft._id);
    assert.equal(nachDemLoeschen, null);
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag bestätigen**

Run: `npm run test:unit`
Expected: FAIL — `Cannot find module '.../src/db/repositories/mannschaftenRepository.js'`

- [ ] **Step 3: Implementieren**

`src/db/repositories/mannschaftenRepository.js`:

```javascript
import { createRepository } from '../baseRepository.js';

const TYPE_PREFIX = 'mannschaft';

// Wie bei den übrigen Entitäts-Repositories: expliziter Zeitstempel ersetzt die fehlende
// CouchDB-Einfüge-Reihenfolge. findByPool und findUnassigned bilden die beiden real in
// mannschaftController.js vorkommenden Zugriffsmuster ab (Mannschaften eines Pools bzw. noch
// nicht zugewiesene Mannschaften eines Turniers).
export function createMannschaftenRepository(db) {
    const repo = createRepository({ db, typePrefix: TYPE_PREFIX });

    async function create(data) {
        return repo.create({ ...data, created_at: new Date().toISOString() });
    }

    async function findByPool(poolId) {
        const gefunden = await repo.query({ pool_id: poolId });
        return gefunden.sort((a, b) => a.created_at.localeCompare(b.created_at));
    }

    async function findUnassigned() {
        const gefunden = await repo.query({ pool_id: null });
        return gefunden.sort((a, b) => a.created_at.localeCompare(b.created_at));
    }

    return { ...repo, create, findByPool, findUnassigned };
}
```

- [ ] **Step 4: Test ausführen, Erfolg bestätigen**

Run: `npm run test:unit`
Expected: PASS (5 neue Tests)

- [ ] **Step 5: Commit**

```bash
git add src/db/repositories/mannschaftenRepository.js tests/unit/db/repositories/mannschaftenRepository.test.js
git commit -m "feat: Mannschaften-Repository mit findByPool und findUnassigned"
```

---

### Task 2: `mannschaftMitgliederRepository.js` mit `findByMannschaft`

**Files:**
- Create: `src/db/repositories/mannschaftMitgliederRepository.js`
- Test: `tests/unit/db/repositories/mannschaftMitgliederRepository.test.js`

**Interfaces:**
- Consumes: `createRepository({ db, typePrefix })` aus `src/db/baseRepository.js`.
- Produces: `createMannschaftMitgliederRepository(db): { create(data), findById(id), update(id, patch), remove(id), query(selector), findByMannschaft(mannschaftId) }`.

- [ ] **Step 1: Failing Test schreiben**

`tests/unit/db/repositories/mannschaftMitgliederRepository.test.js`:

```javascript
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startTestCouchServer } from '../../helpers/couchTestServer.js';
import { connect, ensureDatabase } from '../../../../src/db/couch.js';
import { createMannschaftMitgliederRepository } from '../../../../src/db/repositories/mannschaftMitgliederRepository.js';

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
    return createMannschaftMitgliederRepository(db);
}

test('create legt ein Roster-Mitglied mit Erstellungszeitpunkt an', async () => {
    const repo = await neuesRepository();
    const mitglied = await repo.create({
        mannschaft_id: 'mannschaft:1',
        turnier_teilnehmer_id: 'teilnehmer:1',
        gewichtsklasse: '-73kg'
    });

    assert.match(mitglied._id, /^mitglied:/);
    assert.equal(mitglied.gewichtsklasse, '-73kg');
    assert.ok(mitglied.created_at);
});

test('findByMannschaft liefert nur Mitglieder der angegebenen Mannschaft', async () => {
    const repo = await neuesRepository();
    await repo.create({ mannschaft_id: 'mannschaft:1', turnier_teilnehmer_id: 'teilnehmer:1', gewichtsklasse: '-60kg' });
    await repo.create({ mannschaft_id: 'mannschaft:2', turnier_teilnehmer_id: 'teilnehmer:2', gewichtsklasse: '-60kg' });
    await repo.create({ mannschaft_id: 'mannschaft:1', turnier_teilnehmer_id: 'teilnehmer:3', gewichtsklasse: '-73kg' });

    const gefunden = await repo.findByMannschaft('mannschaft:1');

    assert.equal(gefunden.length, 2);
    assert.ok(gefunden.every(m => m.mannschaft_id === 'mannschaft:1'));
});

test('findByMannschaft liefert die Mitglieder in Erstellungsreihenfolge', async () => {
    const repo = await neuesRepository();
    await repo.create({ mannschaft_id: 'mannschaft:1', gewichtsklasse: '-60kg' });
    await repo.create({ mannschaft_id: 'mannschaft:1', gewichtsklasse: '-73kg' });
    await repo.create({ mannschaft_id: 'mannschaft:1', gewichtsklasse: '-90kg' });

    const gefunden = await repo.findByMannschaft('mannschaft:1');

    assert.deepEqual(gefunden.map(m => m.gewichtsklasse), ['-60kg', '-73kg', '-90kg']);
});

test('findById, update und remove funktionieren wie im generischen Repository', async () => {
    const repo = await neuesRepository();
    const mitglied = await repo.create({ mannschaft_id: 'mannschaft:1', gewichtsklasse: '-60kg' });

    const gefunden = await repo.findById(mitglied._id);
    assert.equal(gefunden.gewichtsklasse, '-60kg');

    const aktualisiert = await repo.update(mitglied._id, { gewichtsklasse: '-66kg' });
    assert.equal(aktualisiert.gewichtsklasse, '-66kg');

    await repo.remove(mitglied._id);
    const nachDemLoeschen = await repo.findById(mitglied._id);
    assert.equal(nachDemLoeschen, null);
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag bestätigen**

Run: `npm run test:unit`
Expected: FAIL — `Cannot find module '.../src/db/repositories/mannschaftMitgliederRepository.js'`

- [ ] **Step 3: Implementieren**

`src/db/repositories/mannschaftMitgliederRepository.js`:

```javascript
import { createRepository } from '../baseRepository.js';

const TYPE_PREFIX = 'mitglied';

// Wie bei den übrigen Entitäts-Repositories: expliziter Zeitstempel ersetzt die fehlende
// CouchDB-Einfüge-Reihenfolge. findByMannschaft ist der mit Abstand häufigste Zugriffspfad
// (Roster-Positionen einer Mannschaft laden); der seltenere Bulk-Fall über mehrere
// Mannschaften hinweg läuft über das generische query() mit einem Mango-$in-Selector, ohne
// eigene Methode (YAGNI).
export function createMannschaftMitgliederRepository(db) {
    const repo = createRepository({ db, typePrefix: TYPE_PREFIX });

    async function create(data) {
        return repo.create({ ...data, created_at: new Date().toISOString() });
    }

    async function findByMannschaft(mannschaftId) {
        const gefunden = await repo.query({ mannschaft_id: mannschaftId });
        return gefunden.sort((a, b) => a.created_at.localeCompare(b.created_at));
    }

    return { ...repo, create, findByMannschaft };
}
```

- [ ] **Step 4: Test ausführen, Erfolg bestätigen**

Run: `npm run test:unit`
Expected: PASS (4 neue Tests)

- [ ] **Step 5: Commit**

```bash
git add src/db/repositories/mannschaftMitgliederRepository.js tests/unit/db/repositories/mannschaftMitgliederRepository.test.js
git commit -m "feat: Mannschaft-Mitglieder-Repository mit findByMannschaft"
```

---

### Task 3: `mannschaftskaempfeRepository.js` mit `findByPool`

**Files:**
- Create: `src/db/repositories/mannschaftskaempfeRepository.js`
- Test: `tests/unit/db/repositories/mannschaftskaempfeRepository.test.js`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: `createRepository({ db, typePrefix })` aus `src/db/baseRepository.js`.
- Produces: `createMannschaftskaempfeRepository(db): { create(data), findById(id), update(id, patch), remove(id), query(selector), findByPool(poolId) }`.

- [ ] **Step 1: Failing Test schreiben**

`tests/unit/db/repositories/mannschaftskaempfeRepository.test.js`:

```javascript
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startTestCouchServer } from '../../helpers/couchTestServer.js';
import { connect, ensureDatabase } from '../../../../src/db/couch.js';
import { createMannschaftskaempfeRepository } from '../../../../src/db/repositories/mannschaftskaempfeRepository.js';

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
    return createMannschaftskaempfeRepository(db);
}

test('create legt eine Begegnung mit Erstellungszeitpunkt an', async () => {
    const repo = await neuesRepository();
    const begegnung = await repo.create({
        pool_id: 'pool:1',
        mannschaft1_id: 'mannschaft:1',
        mannschaft2_id: 'mannschaft:2',
        status: 'angelegt'
    });

    assert.match(begegnung._id, /^mannschaftskampf:/);
    assert.equal(begegnung.status, 'angelegt');
    assert.ok(begegnung.created_at);
});

test('findByPool liefert nur Begegnungen des angegebenen Pools', async () => {
    const repo = await neuesRepository();
    await repo.create({ pool_id: 'pool:1', status: 'angelegt' });
    await repo.create({ pool_id: 'pool:2', status: 'angelegt' });
    await repo.create({ pool_id: 'pool:1', status: 'bereit' });

    const gefunden = await repo.findByPool('pool:1');

    assert.equal(gefunden.length, 2);
    assert.ok(gefunden.every(b => b.pool_id === 'pool:1'));
});

test('findByPool liefert die Begegnungen in Erstellungsreihenfolge', async () => {
    const repo = await neuesRepository();
    await repo.create({ pool_id: 'pool:1', reihenfolge_nummer: 'B1' });
    await repo.create({ pool_id: 'pool:1', reihenfolge_nummer: 'B2' });
    await repo.create({ pool_id: 'pool:1', reihenfolge_nummer: 'B3' });

    const gefunden = await repo.findByPool('pool:1');

    assert.deepEqual(gefunden.map(b => b.reihenfolge_nummer), ['B1', 'B2', 'B3']);
});

test('findById, update und remove funktionieren wie im generischen Repository', async () => {
    const repo = await neuesRepository();
    const begegnung = await repo.create({ pool_id: 'pool:1', status: 'angelegt' });

    const gefunden = await repo.findById(begegnung._id);
    assert.equal(gefunden.status, 'angelegt');

    const aktualisiert = await repo.update(begegnung._id, { status: 'bereit' });
    assert.equal(aktualisiert.status, 'bereit');

    await repo.remove(begegnung._id);
    const nachDemLoeschen = await repo.findById(begegnung._id);
    assert.equal(nachDemLoeschen, null);
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag bestätigen**

Run: `npm run test:unit`
Expected: FAIL — `Cannot find module '.../src/db/repositories/mannschaftskaempfeRepository.js'`

- [ ] **Step 3: Implementieren**

`src/db/repositories/mannschaftskaempfeRepository.js`:

```javascript
import { createRepository } from '../baseRepository.js';

const TYPE_PREFIX = 'mannschaftskampf';

// Exakt dasselbe Muster wie kaempfeRepository.js: findByPool statt findAll, begründet durch
// mannschaftsProgression.js, dessen einzige Funktion berechneMannschaftsPatches immer alle
// Begegnungen eines Pools als Array entgegennimmt.
export function createMannschaftskaempfeRepository(db) {
    const repo = createRepository({ db, typePrefix: TYPE_PREFIX });

    async function create(data) {
        return repo.create({ ...data, created_at: new Date().toISOString() });
    }

    async function findByPool(poolId) {
        const gefunden = await repo.query({ pool_id: poolId });
        return gefunden.sort((a, b) => a.created_at.localeCompare(b.created_at));
    }

    return { ...repo, create, findByPool };
}
```

- [ ] **Step 4: Test ausführen, Erfolg bestätigen**

Run: `npm run test:unit`
Expected: PASS (4 neue Tests, insgesamt 39)

- [ ] **Step 5: Dokumentation ergänzen**

In `CLAUDE.md` im Abschnitt "Zentrale Architekturkonzepte", im Punkt zu `src/db/`, die Liste der `src/db/repositories/`-Dateien um `mannschaftenRepository.js`, `mannschaftMitgliederRepository.js` und `mannschaftskaempfeRepository.js` ergänzen, mit einer kurzen Erwähnung ihrer jeweiligen Zugriffsmethoden analog zum bestehenden Satz.

- [ ] **Step 6: Commit**

```bash
git add src/db/repositories/mannschaftskaempfeRepository.js tests/unit/db/repositories/mannschaftskaempfeRepository.test.js CLAUDE.md
git commit -m "feat: Mannschaftskämpfe-Repository mit findByPool"
```

---

## Self-Review-Notizen

- **Spec-Abdeckung:** Deckt die komplette Mannschafts-Domäne (Phase 1) ab, mit Abfragemethoden, die durch tatsächliche Recherche in `mannschaftController.js`, `mannschaftsBegegnungEngine.js` und `mannschaftsProgression.js` begründet sind.
- **Platzhalter-Scan:** Keine TBD/TODO-Stellen.
- **Typ-Konsistenz:** Alle drei Module folgen derselben Grundstruktur (`create`, `findById`, `update`, `remove`, `query`, plus 1-2 domänenspezifische Methoden). `findUnassigned()` in Task 1 ist die einzige Methode ohne Parameter außer den bereits etablierten `findAll()`-artigen Mustern — konsistent benannt und dokumentiert.
