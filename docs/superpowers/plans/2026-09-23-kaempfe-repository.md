# Kämpfe-Repository Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein entitätsspezifisches Repository für `kaempfe` (Einzelkämpfe) mit der einen Abfragemethode, die tatsächlich durchgängig gebraucht wird — `findByPool(poolId)` — statt der inzwischen korrigierten `findByTurnier`-Annahme aus den früheren Repositories. Vollständig getestet, weiterhin **nicht** in `src/app.js`/`src/routes/`/`src/controllers/` verdrahtet.

**Architecture:** Dünner Wrapper um `createRepository({ db, typePrefix: 'kampf' })`, exakt nach dem Muster von `kampfflaechenRepository.js` (nach der `findAll`-Korrektur), aber mit `findByPool(poolId)` statt `findAll()` — begründet durch tatsächliche Code-Recherche: `src/shared/kampfProgression.js`s einzige Funktion `berechneKaempferPatches(kaempfe)` nimmt immer alle Kämpfe **eines Pools** als Array entgegen (nicht aller Kämpfe eines Turniers), und praktisch jede Knex-Abfrage in `kampfController.js`/den `*Manager.js`-Services filtert nach `pool_id`. Andere, seltenere Abfragemuster (z.B. "Kämpfe, deren Quelle-Kampf X ist", nur für eine einzelne Swap-Funktion gebraucht) werden bewusst NICHT als eigene Repository-Methode abgebildet — der Aufrufer hat nach `findByPool` bereits alle Kämpfe des Pools im Speicher und kann so etwas trivial per JS-`filter` erledigen, genau wie `kampfProgression.js` es selbst mit einer `Map` tut (YAGNI).

**Tech Stack:** Kein neuer Dependency-Bedarf.

**Spec:** [docs/superpowers/specs/2026-09-22-couchdb-pouchdb-migration-design.md](../specs/2026-09-22-couchdb-pouchdb-migration-design.md)

## Global Constraints

- ESM-Only — alle neuen Dateien nutzen `import`/`export`, kein `require`.
- Dokument-IDs folgen dem Schema `<typePrefix>:<uuid>` (hier `kampf:<uuid>`, via `createRepository`).
- Keine Kommentare, die nur wiederholen, was der Code schon sagt.
- Genau EIN `startTestCouchServer()`-Aufruf pro Testdatei via `before()`/`after()` (technisch erzwungen); jeder einzelne Test bekommt eine eigene, zufällig benannte Datenbank.
- Diese Schicht wird in diesem Plan **nicht** in `src/app.js`, `src/routes/` oder `src/controllers/` verdrahtet — `kampfController.js` und die `*Manager.js`-Services bleiben vollständig unverändert und weiterhin auf Knex.
- Kein `findByTurnier`/`findAll` in diesem Repository — nach der Korrektur in `docs/superpowers/plans/2026-09-23-repository-findall-korrektur.md` gilt: eine CouchDB-Datenbank pro Turnier macht turnierweite Abfragen überflüssig, aber `findByPool` bleibt nötig, da EINE Turnier-Datenbank mehrere Pools enthält.

---

### Task 1: `kaempfeRepository.js` mit `findByPool`

**Files:**
- Create: `src/db/repositories/kaempfeRepository.js`
- Test: `tests/unit/db/repositories/kaempfeRepository.test.js`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: `createRepository({ db, typePrefix })` aus `src/db/baseRepository.js`, `connect`/`ensureDatabase` aus `src/db/couch.js`, `startTestCouchServer` aus `tests/unit/helpers/couchTestServer.js` (nur im Test).
- Produces: `createKaempfeRepository(db): { create(data), findById(id), update(id, patch), remove(id), query(selector), findByPool(poolId) }`.

- [ ] **Step 1: Failing Test schreiben**

`tests/unit/db/repositories/kaempfeRepository.test.js`:

```javascript
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startTestCouchServer } from '../../helpers/couchTestServer.js';
import { connect, ensureDatabase } from '../../../../src/db/couch.js';
import { createKaempfeRepository } from '../../../../src/db/repositories/kaempfeRepository.js';

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
    return createKaempfeRepository(db);
}

test('create legt einen Kampf mit Erstellungszeitpunkt an', async () => {
    const repo = await neuesRepository();
    const kampf = await repo.create({
        pool_id: 'pool:1',
        kaempfer1_id: 'teilnehmer:1',
        kaempfer2_id: 'teilnehmer:2',
        status: 'angelegt'
    });

    assert.match(kampf._id, /^kampf:/);
    assert.equal(kampf.status, 'angelegt');
    assert.ok(kampf.created_at);
});

test('findByPool liefert nur Kämpfe des angegebenen Pools', async () => {
    const repo = await neuesRepository();
    await repo.create({ pool_id: 'pool:1', status: 'angelegt' });
    await repo.create({ pool_id: 'pool:2', status: 'angelegt' });
    await repo.create({ pool_id: 'pool:1', status: 'bereit' });

    const gefunden = await repo.findByPool('pool:1');

    assert.equal(gefunden.length, 2);
    assert.ok(gefunden.every(k => k.pool_id === 'pool:1'));
});

test('findByPool liefert die Kämpfe in Erstellungsreihenfolge', async () => {
    const repo = await neuesRepository();
    await repo.create({ pool_id: 'pool:1', reihenfolge_nummer: 'V1' });
    await repo.create({ pool_id: 'pool:1', reihenfolge_nummer: 'V2' });
    await repo.create({ pool_id: 'pool:1', reihenfolge_nummer: 'HF1' });

    const gefunden = await repo.findByPool('pool:1');

    assert.deepEqual(gefunden.map(k => k.reihenfolge_nummer), ['V1', 'V2', 'HF1']);
});

test('findById, update und remove funktionieren wie im generischen Repository', async () => {
    const repo = await neuesRepository();
    const kampf = await repo.create({ pool_id: 'pool:1', status: 'angelegt' });

    const gefunden = await repo.findById(kampf._id);
    assert.equal(gefunden.status, 'angelegt');

    const aktualisiert = await repo.update(kampf._id, { status: 'bereit' });
    assert.equal(aktualisiert.status, 'bereit');

    await repo.remove(kampf._id);
    const nachDemLoeschen = await repo.findById(kampf._id);
    assert.equal(nachDemLoeschen, null);
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag bestätigen**

Run: `npm run test:unit`
Expected: FAIL — `Cannot find module '.../src/db/repositories/kaempfeRepository.js'`

- [ ] **Step 3: Implementieren**

`src/db/repositories/kaempfeRepository.js`:

```javascript
import { createRepository } from '../baseRepository.js';

const TYPE_PREFIX = 'kampf';

// Wie bei den übrigen Entitäts-Repositories: CouchDB-Dokumente haben keine implizite
// Einfüge-Reihenfolge wie die bisherige SQL-Auto-Increment-ID -- ein expliziter Zeitstempel
// bei der Erstellung ersetzt sie für die Sortierung in findByPool.
//
// Anders als bei kampfflaechen/teilnehmer/pools bleibt hier eine echte Abfragemethode nötig:
// findByPool statt findAll, da eine Turnier-Datenbank mehrere Pools enthält und
// kampfProgression.js sowie praktisch jede bestehende Kämpfe-Abfrage nach pool_id filtern.
export function createKaempfeRepository(db) {
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
Expected: PASS (4 neue Tests, insgesamt 26)

- [ ] **Step 5: Dokumentation ergänzen**

In `CLAUDE.md` im Abschnitt "Zentrale Architekturkonzepte", im Punkt zu `src/db/`, den Satz über `src/db/repositories/` aktualisieren — ersetze die Liste der genannten Repositories, sodass `kaempfeRepository.js` ergänzt wird, und erwähne, dass dieses Repository `findByPool` statt `findAll` anbietet (eine Turnier-Datenbank enthält mehrere Pools).

- [ ] **Step 6: Commit**

```bash
git add src/db/repositories/kaempfeRepository.js tests/unit/db/repositories/kaempfeRepository.test.js CLAUDE.md
git commit -m "feat: Kämpfe-Repository mit findByPool"
```

---

## Self-Review-Notizen

- **Spec-Abdeckung:** Deckt den nächsten Schritt von Phase 1 ab. `findByPool` statt `findAll`/`findByTurnier` ist bewusst durch tatsächliche Code-Recherche (kampfProgression.js, kampfController.js, *Manager.js-Services) begründet, nicht geraten.
- **Platzhalter-Scan:** Keine TBD/TODO-Stellen.
- **Typ-Konsistenz:** `createKaempfeRepository(db)` folgt derselben Grundstruktur wie die übrigen Repositories (`create`, `findById`, `update`, `remove`, `query`, plus eine domänenspezifische Methode) — hier bewusst `findByPool` statt `findAll`, mit nachvollziehbarer Begründung in Architecture oben.
