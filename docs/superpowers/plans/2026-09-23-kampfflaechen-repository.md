# Kampfflächen-Repository Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein erstes entitätsspezifisches Repository (`kampfflaechenRepository.js`) auf Basis des generischen CouchDB-Fundaments (`src/db/baseRepository.js`), das den Verzeichnisort und das Grundmuster für alle künftigen Entitäts-Repositories (pools, kaempfe, turnier_teilnehmer, ...) etabliert. Vollständig getestet, weiterhin **nicht** in `src/app.js`/`src/routes/`/`src/controllers/` verdrahtet.

**Architecture:** Ein dünner Wrapper um `createRepository({ db, typePrefix })` (aus dem CouchDB-Fundament-Plan), der nur das ergänzt, was die generische Basis nicht abdeckt: eine domänenspezifische Abfrage `findByTurnier(turnierId)` sowie einen expliziten `created_at`-Zeitstempel bei der Erstellung, der die bisherige implizite SQL-Auto-Increment-Reihenfolge (`ORDER BY id`) ersetzt — CouchDB-Dokumente haben keine solche eingebaute Reihenfolge.

**Tech Stack:** Kein neuer Dependency-Bedarf — nutzt ausschließlich bereits vorhandene Module aus dem CouchDB-Fundament (`src/db/baseRepository.js`, `src/db/couch.js`, `tests/unit/helpers/couchTestServer.js`).

**Spec:** [docs/superpowers/specs/2026-09-22-couchdb-pouchdb-migration-design.md](../specs/2026-09-22-couchdb-pouchdb-migration-design.md)

## Global Constraints

- ESM-Only (`"type": "module"` in `package.json`) — alle neuen Dateien nutzen `import`/`export`, kein `require`.
- Dokument-IDs folgen dem Schema `<typePrefix>:<uuid>` (hier `kampffl:<uuid>`, via `createRepository`).
- Keine Kommentare, die nur wiederholen, was der Code schon sagt — nur wo eine nicht offensichtliche Entscheidung erklärt werden muss.
- Genau EIN `startTestCouchServer()`-Aufruf pro Testdatei via `before()`/`after()` (technisch erzwungen seit dem CouchDB-Fundament-Plan — ein zweiter Aufruf wirft einen Fehler); jeder einzelne Test bekommt eine eigene, zufällig benannte Datenbank innerhalb dieses einen Servers.
- Diese Schicht wird in diesem Plan **nicht** in `src/app.js`, `src/routes/` oder `src/controllers/` verdrahtet — das bestehende `kampfflaechenController.js` bleibt vollständig unverändert und weiterhin auf Knex.

---

### Task 1: `kampfflaechenRepository.js` mit `findByTurnier`

**Files:**
- Create: `src/db/repositories/kampfflaechenRepository.js`
- Test: `tests/unit/db/repositories/kampfflaechenRepository.test.js`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: `createRepository({ db, typePrefix })` aus `src/db/baseRepository.js`, `connect`/`ensureDatabase` aus `src/db/couch.js`, `startTestCouchServer` aus `tests/unit/helpers/couchTestServer.js` (nur im Test).
- Produces: `createKampfflaechenRepository(db): { create(data), findById(id), update(id, patch), remove(id), query(selector), findByTurnier(turnierId) }`. `findById`, `update`, `remove` und `query` sind die unveränderten Methoden aus `createRepository`; `create` und `findByTurnier` sind neu/überschrieben.

- [ ] **Step 1: Failing Test schreiben**

`tests/unit/db/repositories/kampfflaechenRepository.test.js`:

```javascript
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startTestCouchServer } from '../../helpers/couchTestServer.js';
import { connect, ensureDatabase } from '../../../../src/db/couch.js';
import { createKampfflaechenRepository } from '../../../../src/db/repositories/kampfflaechenRepository.js';

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
    return createKampfflaechenRepository(db);
}

test('create legt eine Kampffläche mit Erstellungszeitpunkt an', async () => {
    const repo = await neuesRepository();
    const kf = await repo.create({ turnier_id: 'turnier:1', bezeichnung: 'Matte 1' });

    assert.match(kf._id, /^kampffl:/);
    assert.equal(kf.bezeichnung, 'Matte 1');
    assert.ok(kf.created_at);
});

test('findByTurnier liefert nur Kampfflächen des angegebenen Turniers', async () => {
    const repo = await neuesRepository();
    await repo.create({ turnier_id: 'turnier:1', bezeichnung: 'Matte 1' });
    await repo.create({ turnier_id: 'turnier:2', bezeichnung: 'Matte A' });
    await repo.create({ turnier_id: 'turnier:1', bezeichnung: 'Matte 2' });

    const gefunden = await repo.findByTurnier('turnier:1');

    assert.equal(gefunden.length, 2);
    assert.ok(gefunden.every(kf => kf.turnier_id === 'turnier:1'));
});

test('findByTurnier liefert die Kampfflächen in Erstellungsreihenfolge', async () => {
    const repo = await neuesRepository();
    await repo.create({ turnier_id: 'turnier:1', bezeichnung: 'Matte 1' });
    await repo.create({ turnier_id: 'turnier:1', bezeichnung: 'Matte 2' });
    await repo.create({ turnier_id: 'turnier:1', bezeichnung: 'Matte 3' });

    const gefunden = await repo.findByTurnier('turnier:1');

    assert.deepEqual(gefunden.map(kf => kf.bezeichnung), ['Matte 1', 'Matte 2', 'Matte 3']);
});

test('findById, update und remove funktionieren wie im generischen Repository', async () => {
    const repo = await neuesRepository();
    const kf = await repo.create({ turnier_id: 'turnier:1', bezeichnung: 'Matte 1' });

    const gefunden = await repo.findById(kf._id);
    assert.equal(gefunden.bezeichnung, 'Matte 1');

    const aktualisiert = await repo.update(kf._id, { status: 'pausiert' });
    assert.equal(aktualisiert.status, 'pausiert');

    await repo.remove(kf._id);
    const nachDemLoeschen = await repo.findById(kf._id);
    assert.equal(nachDemLoeschen, null);
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag bestätigen**

Run: `npm run test:unit`
Expected: FAIL — `Cannot find module '.../src/db/repositories/kampfflaechenRepository.js'`

- [ ] **Step 3: Implementieren**

`src/db/repositories/kampfflaechenRepository.js`:

```javascript
import { createRepository } from '../baseRepository.js';

const TYPE_PREFIX = 'kampffl';

// Kampfflächen haben in CouchDB keine automatische Einfüge-Reihenfolge wie die bisherige
// SQL-Auto-Increment-ID -- ein expliziter Zeitstempel bei der Erstellung ersetzt sie für die
// Sortierung in findByTurnier.
export function createKampfflaechenRepository(db) {
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
Expected: PASS (4 neue Tests, insgesamt 17)

- [ ] **Step 5: Dokumentation ergänzen**

In `CLAUDE.md` im Abschnitt "Zentrale Architekturkonzepte", im bestehenden Punkt zu `src/db/` (Zeile beginnend mit `` - **`src/db/`** — CouchDB-Datenzugriffsschicht ``), den Satz über künftige Entitäts-Repositories konkretisieren — ersetze

```markdown
Noch nicht in `app.js`/Controller verdrahtet — das ist Gegenstand der Folgepläne, die die einzelnen Entitäten (kampfflaechen, pools, kaempfe, ...) migrieren
```

durch

```markdown
Noch nicht in `app.js`/Controller verdrahtet — das ist Gegenstand eines künftigen Cutover-Plans (siehe Spec: Fremdschlüssel-Kopplung verhindert eine schrittweise Migration einzelner Tabellen). `src/db/repositories/` enthält bereits erste entitätsspezifische Repositories (aktuell `kampfflaechenRepository.js`) als dünne Wrapper um `baseRepository.js`, ebenfalls nur gegen die In-Memory-Testinfrastruktur getestet
```

- [ ] **Step 6: Commit**

```bash
git add src/db/repositories/kampfflaechenRepository.js tests/unit/db/repositories/kampfflaechenRepository.test.js CLAUDE.md
git commit -m "feat: Kampfflächen-Repository als erstes entitätsspezifisches CouchDB-Repository"
```

---

## Self-Review-Notizen

- **Spec-Abdeckung:** Deckt den nächsten kleinen Schritt von Phase 1 ab (ein entitätsspezifisches Repository). Die tatsächliche App-Verdrahtung bleibt bewusst ausgeklammert — siehe die im Rahmen der Brainstorming-Diskussion erkannte Fremdschlüssel-Kopplung (kampfflaechen wird von `pools.kampfflaeche_id` referenziert, das bei einer schrittweisen Migration nicht auf CouchDB-String-IDs verweisen könnte). Ein künftiger "Cutover"-Plan muss mehrere zusammenhängende Entitäten gemeinsam umstellen, nicht einzeln.
- **Platzhalter-Scan:** Keine TBD/TODO-Stellen; jeder Schritt enthält vollständigen, lauffähigen Code.
- **Typ-Konsistenz:** `createKampfflaechenRepository(db)` und seine Rückgabewerte (`create`, `findById`, `update`, `remove`, `query`, `findByTurnier`) sind in sich konsistent; `findById`/`update`/`remove`/`query` werden unverändert von `createRepository` durchgereicht.
