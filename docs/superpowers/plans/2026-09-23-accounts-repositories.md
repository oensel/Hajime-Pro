# Accounts-Repositories Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drei entitätsspezifische CouchDB-Repositories für die Vereins-/Benutzer-Domäne (`vereineRepository.js`, `benutzerRepository.js`, `mitgliedschaftenRepository.js`), die — anders als alle bisherigen Entitäts-Repositories — für eine **separate `accounts`-Datenbank** gedacht sind, nicht für eine einzelne Turnier-Datenbank (siehe Spec: Vereine/Benutzer/Mitgliedschaften sind ausschließlich online relevant, laufen niemals auf dem Technik-Koffer). Vollständig getestet, weiterhin **nicht** in `src/app.js`/`src/routes/`/`src/controllers/` verdrahtet.

**Architecture:** Anders als bei den turnierbezogenen Repositories (kampfflaechen, pools, kaempfe, ...) ist `accounts` eine EINZIGE, dauerhaft geteilte Datenbank für ALLE Vereine/Benutzer/Mitgliedschaften — hier gibt es also keine "eine Datenbank pro X"-Vereinfachung wie bei Turnieren, sondern echten Bedarf für datenbankweite Abfragen:
- `vereineRepository`: `findByName(name)` (Vereinssuche beim Beitritt) und `findAll()` (Vereinsliste, `listVereine`-Endpunkt — hier legitim, da `accounts` alle Vereine gemeinsam enthält, anders als die turnierbezogene `findAll`-Korrektur).
- `benutzerRepository`: `findByEmail(email)` — der kritische Login-Zugriffspfad.
- `mitgliedschaftenRepository`: `findByBenutzer(benutzerId)` (eigene Vereinsmitgliedschaften) und `findByVerein(vereinId)` (Mitglieder-/Freigabe-Listen eines Vereins). Der schmalere Sonderfall "nur unbestätigte Mitgliedschaften eines Vereins" bekommt bewusst keine eigene Methode — `query({ verein_id: vereinId, freigegeben: 0 })` über das bereits vorhandene generische `query()` deckt das ab (YAGNI).

Diese drei Repositories werden (wie alle bisherigen) mit `ensureDatabase(nano, 'accounts')` verwendet — `couch.js` braucht dafür keine Änderung, da `ensureDatabase` bereits einen beliebigen Datenbanknamen entgegennimmt.

**Tech Stack:** Kein neuer Dependency-Bedarf.

**Spec:** [docs/superpowers/specs/2026-09-22-couchdb-pouchdb-migration-design.md](../specs/2026-09-22-couchdb-pouchdb-migration-design.md)

## Global Constraints

- ESM-Only — `import`/`export`, kein `require`.
- Dokument-IDs folgen dem Schema `<typePrefix>:<uuid>` (`verein:<uuid>`, `benutzer:<uuid>`, `mitgliedschaft:<uuid>`) — mit EINER Ausnahme: `benutzer` behält im echten System bereits String-IDs (nicht auto-increment); dieses Repository nutzt trotzdem `createRepository`s generierte IDs, da nichts in diesem Plan die reale Migration der ID-Vergabe entscheidet (das ist Sache eines künftigen Cutover-Plans).
- Keine Kommentare, die nur wiederholen, was der Code schon sagt.
- Genau EIN `startTestCouchServer()`-Aufruf pro Testdatei via `before()`/`after()`.
- Diese Schicht wird in diesem Plan **nicht** in `src/app.js`, `src/routes/` oder `src/controllers/` verdrahtet — `vereinController.js`, `authController.js`, `src/middleware/auth.js` bleiben vollständig unverändert und weiterhin auf Knex.
- Passwort-Hashes, JWT-Verifikation und Freigabe-Logik sind Anwendungslogik, keine Repository-Aufgabe — diese Repositories transportieren nur Daten, ohne sie zu interpretieren.
- Kein `findAll`/`findByPool`-Verwechslung: `vereineRepository.findAll()` ist hier bewusst richtig (geteilte `accounts`-Datenbank), anders als bei den turnierbezogenen Repositories.

---

### Task 1: `vereineRepository.js` mit `findByName` und `findAll`

**Files:**
- Create: `src/db/repositories/vereineRepository.js`
- Test: `tests/unit/db/repositories/vereineRepository.test.js`

**Interfaces:**
- Consumes: `createRepository({ db, typePrefix })` aus `src/db/baseRepository.js`.
- Produces: `createVereineRepository(db): { create(data), findById(id), update(id, patch), remove(id), query(selector), findByName(name), findAll() }`.

- [ ] **Step 1: Failing Test schreiben**

`tests/unit/db/repositories/vereineRepository.test.js`:

```javascript
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startTestCouchServer } from '../../helpers/couchTestServer.js';
import { connect, ensureDatabase } from '../../../../src/db/couch.js';
import { createVereineRepository } from '../../../../src/db/repositories/vereineRepository.js';

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
    return createVereineRepository(db);
}

test('create legt einen Verein mit Erstellungszeitpunkt an', async () => {
    const repo = await neuesRepository();
    const verein = await repo.create({ name: 'JC Beispiel' });

    assert.match(verein._id, /^verein:/);
    assert.equal(verein.name, 'JC Beispiel');
    assert.ok(verein.created_at);
});

test('findByName liefert den Verein mit dem angegebenen Namen', async () => {
    const repo = await neuesRepository();
    await repo.create({ name: 'JC Beispiel' });
    await repo.create({ name: 'JC Anders' });

    const gefunden = await repo.findByName('JC Beispiel');

    assert.equal(gefunden.length, 1);
    assert.equal(gefunden[0].name, 'JC Beispiel');
});

test('findAll liefert alle Vereine in Erstellungsreihenfolge', async () => {
    const repo = await neuesRepository();
    await repo.create({ name: 'JC Eins' });
    await repo.create({ name: 'JC Zwei' });
    await repo.create({ name: 'JC Drei' });

    const gefunden = await repo.findAll();

    assert.deepEqual(gefunden.map(v => v.name), ['JC Eins', 'JC Zwei', 'JC Drei']);
});

test('findById, update und remove funktionieren wie im generischen Repository', async () => {
    const repo = await neuesRepository();
    const verein = await repo.create({ name: 'JC Beispiel' });

    const gefunden = await repo.findById(verein._id);
    assert.equal(gefunden.name, 'JC Beispiel');

    const aktualisiert = await repo.update(verein._id, { name: 'JC Beispiel e.V.' });
    assert.equal(aktualisiert.name, 'JC Beispiel e.V.');

    await repo.remove(verein._id);
    const nachDemLoeschen = await repo.findById(verein._id);
    assert.equal(nachDemLoeschen, null);
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag bestätigen**

Run: `npm run test:unit`
Expected: FAIL — `Cannot find module '.../src/db/repositories/vereineRepository.js'`

- [ ] **Step 3: Implementieren**

`src/db/repositories/vereineRepository.js`:

```javascript
import { createRepository } from '../baseRepository.js';

const TYPE_PREFIX = 'verein';

// Anders als bei den turnierbezogenen Repositories ist die accounts-Datenbank eine einzige,
// dauerhaft geteilte Datenbank für ALLE Vereine -- findAll() ist hier deshalb bewusst korrekt
// und keine Wiederholung des in den turnierbezogenen Repositories korrigierten Fehlers.
export function createVereineRepository(db) {
    const repo = createRepository({ db, typePrefix: TYPE_PREFIX });

    async function create(data) {
        return repo.create({ ...data, created_at: new Date().toISOString() });
    }

    async function findByName(name) {
        return repo.query({ name });
    }

    async function findAll() {
        const gefunden = await repo.query({});
        return gefunden.sort((a, b) => a.created_at.localeCompare(b.created_at));
    }

    return { ...repo, create, findByName, findAll };
}
```

- [ ] **Step 4: Test ausführen, Erfolg bestätigen**

Run: `npm run test:unit`
Expected: PASS (4 neue Tests)

- [ ] **Step 5: Commit**

```bash
git add src/db/repositories/vereineRepository.js tests/unit/db/repositories/vereineRepository.test.js
git commit -m "feat: Vereine-Repository mit findByName und findAll für die accounts-Datenbank"
```

---

### Task 2: `benutzerRepository.js` mit `findByEmail`

**Files:**
- Create: `src/db/repositories/benutzerRepository.js`
- Test: `tests/unit/db/repositories/benutzerRepository.test.js`

**Interfaces:**
- Consumes: `createRepository({ db, typePrefix })` aus `src/db/baseRepository.js`.
- Produces: `createBenutzerRepository(db): { create(data), findById(id), update(id, patch), remove(id), query(selector), findByEmail(email) }`.

- [ ] **Step 1: Failing Test schreiben**

`tests/unit/db/repositories/benutzerRepository.test.js`:

```javascript
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startTestCouchServer } from '../../helpers/couchTestServer.js';
import { connect, ensureDatabase } from '../../../../src/db/couch.js';
import { createBenutzerRepository } from '../../../../src/db/repositories/benutzerRepository.js';

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
    return createBenutzerRepository(db);
}

test('create legt einen Benutzer mit Erstellungszeitpunkt an', async () => {
    const repo = await neuesRepository();
    const benutzer = await repo.create({ email: 'max@beispiel.de', vorname: 'Max', nachname: 'Mustermann' });

    assert.match(benutzer._id, /^benutzer:/);
    assert.equal(benutzer.email, 'max@beispiel.de');
    assert.ok(benutzer.created_at);
});

test('findByEmail liefert den Benutzer mit der angegebenen E-Mail-Adresse', async () => {
    const repo = await neuesRepository();
    await repo.create({ email: 'max@beispiel.de' });
    await repo.create({ email: 'erika@beispiel.de' });

    const gefunden = await repo.findByEmail('max@beispiel.de');

    assert.equal(gefunden.length, 1);
    assert.equal(gefunden[0].email, 'max@beispiel.de');
});

test('findById, update und remove funktionieren wie im generischen Repository', async () => {
    const repo = await neuesRepository();
    const benutzer = await repo.create({ email: 'max@beispiel.de' });

    const gefunden = await repo.findById(benutzer._id);
    assert.equal(gefunden.email, 'max@beispiel.de');

    const aktualisiert = await repo.update(benutzer._id, { nachname: 'Mustermann' });
    assert.equal(aktualisiert.nachname, 'Mustermann');

    await repo.remove(benutzer._id);
    const nachDemLoeschen = await repo.findById(benutzer._id);
    assert.equal(nachDemLoeschen, null);
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag bestätigen**

Run: `npm run test:unit`
Expected: FAIL — `Cannot find module '.../src/db/repositories/benutzerRepository.js'`

- [ ] **Step 3: Implementieren**

`src/db/repositories/benutzerRepository.js`:

```javascript
import { createRepository } from '../baseRepository.js';

const TYPE_PREFIX = 'benutzer';

// findByEmail ist der kritische Login-Zugriffspfad (siehe authController.js: Benutzer wird
// beim Login und bei der Registrierungs-Dublettenprüfung ausschließlich über die E-Mail-Adresse
// gesucht, nie über die ID).
export function createBenutzerRepository(db) {
    const repo = createRepository({ db, typePrefix: TYPE_PREFIX });

    async function create(data) {
        return repo.create({ ...data, created_at: new Date().toISOString() });
    }

    async function findByEmail(email) {
        return repo.query({ email });
    }

    return { ...repo, create, findByEmail };
}
```

- [ ] **Step 4: Test ausführen, Erfolg bestätigen**

Run: `npm run test:unit`
Expected: PASS (3 neue Tests)

- [ ] **Step 5: Commit**

```bash
git add src/db/repositories/benutzerRepository.js tests/unit/db/repositories/benutzerRepository.test.js
git commit -m "feat: Benutzer-Repository mit findByEmail für die accounts-Datenbank"
```

---

### Task 3: `mitgliedschaftenRepository.js` mit `findByBenutzer` und `findByVerein`

**Files:**
- Create: `src/db/repositories/mitgliedschaftenRepository.js`
- Test: `tests/unit/db/repositories/mitgliedschaftenRepository.test.js`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: `createRepository({ db, typePrefix })` aus `src/db/baseRepository.js`.
- Produces: `createMitgliedschaftenRepository(db): { create(data), findById(id), update(id, patch), remove(id), query(selector), findByBenutzer(benutzerId), findByVerein(vereinId) }`.

- [ ] **Step 1: Failing Test schreiben**

`tests/unit/db/repositories/mitgliedschaftenRepository.test.js`:

```javascript
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startTestCouchServer } from '../../helpers/couchTestServer.js';
import { connect, ensureDatabase } from '../../../../src/db/couch.js';
import { createMitgliedschaftenRepository } from '../../../../src/db/repositories/mitgliedschaftenRepository.js';

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
    return createMitgliedschaftenRepository(db);
}

test('create legt eine Mitgliedschaft mit Erstellungszeitpunkt an', async () => {
    const repo = await neuesRepository();
    const mitgliedschaft = await repo.create({ benutzer_id: 'benutzer:1', verein_id: 'verein:1', freigegeben: 0 });

    assert.match(mitgliedschaft._id, /^mitgliedschaft:/);
    assert.equal(mitgliedschaft.freigegeben, 0);
    assert.ok(mitgliedschaft.created_at);
});

test('findByBenutzer liefert nur Mitgliedschaften des angegebenen Benutzers', async () => {
    const repo = await neuesRepository();
    await repo.create({ benutzer_id: 'benutzer:1', verein_id: 'verein:1' });
    await repo.create({ benutzer_id: 'benutzer:2', verein_id: 'verein:1' });
    await repo.create({ benutzer_id: 'benutzer:1', verein_id: 'verein:2' });

    const gefunden = await repo.findByBenutzer('benutzer:1');

    assert.equal(gefunden.length, 2);
    assert.ok(gefunden.every(m => m.benutzer_id === 'benutzer:1'));
});

test('findByVerein liefert nur Mitgliedschaften des angegebenen Vereins', async () => {
    const repo = await neuesRepository();
    await repo.create({ benutzer_id: 'benutzer:1', verein_id: 'verein:1' });
    await repo.create({ benutzer_id: 'benutzer:2', verein_id: 'verein:1' });
    await repo.create({ benutzer_id: 'benutzer:1', verein_id: 'verein:2' });

    const gefunden = await repo.findByVerein('verein:1');

    assert.equal(gefunden.length, 2);
    assert.ok(gefunden.every(m => m.verein_id === 'verein:1'));
});

test('findById, update und remove funktionieren wie im generischen Repository', async () => {
    const repo = await neuesRepository();
    const mitgliedschaft = await repo.create({ benutzer_id: 'benutzer:1', verein_id: 'verein:1', freigegeben: 0 });

    const gefunden = await repo.findById(mitgliedschaft._id);
    assert.equal(gefunden.freigegeben, 0);

    const aktualisiert = await repo.update(mitgliedschaft._id, { freigegeben: 1 });
    assert.equal(aktualisiert.freigegeben, 1);

    await repo.remove(mitgliedschaft._id);
    const nachDemLoeschen = await repo.findById(mitgliedschaft._id);
    assert.equal(nachDemLoeschen, null);
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag bestätigen**

Run: `npm run test:unit`
Expected: FAIL — `Cannot find module '.../src/db/repositories/mitgliedschaftenRepository.js'`

- [ ] **Step 3: Implementieren**

`src/db/repositories/mitgliedschaftenRepository.js`:

```javascript
import { createRepository } from '../baseRepository.js';

const TYPE_PREFIX = 'mitgliedschaft';

// Bildet die heutige benutzer_vereine-Tabelle ab (echtes n:m zwischen Benutzern und Vereinen,
// je Mitgliedschaft mit eigenem freigegeben-Status). Der schmalere Sonderfall "nur unbestätigte
// Mitgliedschaften eines Vereins" bekommt bewusst keine eigene Methode -- query({ verein_id,
// freigegeben: 0 }) über das generische query() deckt das ab.
export function createMitgliedschaftenRepository(db) {
    const repo = createRepository({ db, typePrefix: TYPE_PREFIX });

    async function create(data) {
        return repo.create({ ...data, created_at: new Date().toISOString() });
    }

    async function findByBenutzer(benutzerId) {
        return repo.query({ benutzer_id: benutzerId });
    }

    async function findByVerein(vereinId) {
        return repo.query({ verein_id: vereinId });
    }

    return { ...repo, create, findByBenutzer, findByVerein };
}
```

- [ ] **Step 4: Test ausführen, Erfolg bestätigen**

Run: `npm run test:unit`
Expected: PASS (4 neue Tests, insgesamt 53)

- [ ] **Step 5: Dokumentation ergänzen**

In `CLAUDE.md` im Abschnitt "Zentrale Architekturkonzepte", im Punkt zu `src/db/`, nach der Liste der turnierbezogenen `src/db/repositories/`-Dateien einen neuen Satz ergänzen, der `vereineRepository.js`, `benutzerRepository.js` und `mitgliedschaftenRepository.js` als für eine separate, dauerhaft geteilte `accounts`-Datenbank gedachte Repositories erklärt (nicht für eine Turnier-Datenbank) — mit kurzer Nennung ihrer Abfragemethoden.

- [ ] **Step 6: Commit**

```bash
git add src/db/repositories/mitgliedschaftenRepository.js tests/unit/db/repositories/mitgliedschaftenRepository.test.js CLAUDE.md
git commit -m "feat: Mitgliedschaften-Repository mit findByBenutzer und findByVerein"
```

---

## Self-Review-Notizen

- **Spec-Abdeckung:** Deckt die Vereins-/Benutzer-Domäne für die separate `accounts`-Datenbank ab. Passwort-Hashing, JWT-Verifikation, Super-Admin-Bootstrap und die eigentliche Freigabe-Workflow-Logik bleiben bewusst außerhalb dieser Repositories (Anwendungslogik, kein Datenzugriff).
- **Platzhalter-Scan:** Keine TBD/TODO-Stellen.
- **Typ-Konsistenz:** Alle drei Module folgen der Grundstruktur `create/findById/update/remove/query` plus 1-2 domänenspezifische Methoden. `findAll()` in Task 1 ist hier — anders als bei den turnierbezogenen Repositories — bewusst korrekt, da `accounts` eine geteilte Datenbank ist; das wird in Architecture und im Code-Kommentar explizit begründet, um keine Verwechslung mit der früheren Korrektur zu erzeugen.
