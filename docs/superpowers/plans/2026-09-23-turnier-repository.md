# Turnier-Repository (Singleton) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein Repository für das Turnier-Metadaten-Dokument selbst — architektonisch anders als alle bisherigen Entitäts-Repositories, da eine Turnier-Datenbank per Konstruktion genau EIN Turnier-Dokument enthält (die Datenbank identifiziert das Turnier bereits über ihren eigenen Namen `turnier_<id>`). Kein `createRepository`-Wrapper mit generierten IDs, sondern ein Singleton-Dokument mit fester, bekannter ID.

**Architecture:** `createTurnierRepository(db)` bietet nur `get()` (liefert das eine Turnier-Dokument oder `null`, falls noch keins gespeichert wurde) und `save(data)` (legt es beim ersten Aufruf an, ersetzt es bei jedem weiteren — vollständiger Replace, kein Merge, da `turnierController.js`s reale `updateTurnier`-Route ohnehin immer den kompletten Formular-Datensatz sendet). Die feste ID `turnier:meta` macht `baseRepository.js`s generierte `<typePrefix>:<uuid>`-IDs hier unpassend — dieses Modul nutzt `baseRepository.js` bewusst NICHT.

Explizit **außerhalb** dieses Plans (spätere, andere Phase): eine datenbankübergreifende Liste "alle Turniere eines Vereins" — das ist ein Katalog-Problem der Online-CouchDB (mehrere Turnier-Datenbanken gleichzeitig), nicht innerhalb einer einzelnen Turnier-Datenbank lösbar, und Gegenstand des in der Spec beschriebenen Online↔Lokal-Sync-Werkzeugs (Phase 4), nicht der aktuellen Repository-Schicht.

**Tech Stack:** Kein neuer Dependency-Bedarf.

**Spec:** [docs/superpowers/specs/2026-09-22-couchdb-pouchdb-migration-design.md](../specs/2026-09-22-couchdb-pouchdb-migration-design.md)

## Global Constraints

- ESM-Only — `import`/`export`, kein `require`.
- Feste Dokument-ID `turnier:meta` — kein `<typePrefix>:<uuid>`-Schema, da es nur ein Dokument pro Datenbank gibt.
- Keine Kommentare, die nur wiederholen, was der Code schon sagt.
- Genau EIN `startTestCouchServer()`-Aufruf pro Testdatei via `before()`/`after()`.
- Diese Schicht wird in diesem Plan **nicht** in `src/app.js`, `src/routes/` oder `src/controllers/` verdrahtet — `turnierController.js` bleibt vollständig unverändert und weiterhin auf Knex.
- Kein Merge-Verhalten in `save()` — vollständiger Replace, mit einer Begründung im Code-Kommentar.

---

### Task 1: `turnierRepository.js` als Singleton-Dokument

**Files:**
- Create: `src/db/repositories/turnierRepository.js`
- Test: `tests/unit/db/repositories/turnierRepository.test.js`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: nichts aus `baseRepository.js` — arbeitet direkt auf dem übergebenen `db`-Handle (dasselbe Objekt, das `ensureDatabase` aus `src/db/couch.js` liefert).
- Produces: `createTurnierRepository(db): { get(): Promise<object|null>, save(data): Promise<object> }`.

- [ ] **Step 1: Failing Test schreiben**

`tests/unit/db/repositories/turnierRepository.test.js`:

```javascript
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startTestCouchServer } from '../../helpers/couchTestServer.js';
import { connect, ensureDatabase } from '../../../../src/db/couch.js';
import { createTurnierRepository } from '../../../../src/db/repositories/turnierRepository.js';

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
    return createTurnierRepository(db);
}

test('get liefert null, solange kein Turnier gespeichert wurde', async () => {
    const repo = await neuesRepository();

    const turnier = await repo.get();

    assert.equal(turnier, null);
});

test('save legt das Turnier-Dokument mit fester ID beim ersten Aufruf an', async () => {
    const repo = await neuesRepository();

    const gespeichert = await repo.save({ bezeichnung: 'Landesmeisterschaft', ort: 'Musterstadt' });

    assert.equal(gespeichert._id, 'turnier:meta');
    assert.equal(gespeichert.bezeichnung, 'Landesmeisterschaft');
    assert.ok(gespeichert._rev);
});

test('save ersetzt dasselbe Dokument, statt ein zweites anzulegen', async () => {
    const repo = await neuesRepository();
    await repo.save({ bezeichnung: 'Landesmeisterschaft', status: 'entwurf' });

    const aktualisiert = await repo.save({ bezeichnung: 'Landesmeisterschaft', status: 'veroeffentlicht' });

    assert.equal(aktualisiert._id, 'turnier:meta');
    assert.equal(aktualisiert.status, 'veroeffentlicht');

    const geladen = await repo.get();
    assert.equal(geladen.status, 'veroeffentlicht');
});

test('save ersetzt Felder vollständig, statt sie mit dem alten Stand zu vermischen', async () => {
    const repo = await neuesRepository();
    await repo.save({ bezeichnung: 'Landesmeisterschaft', ort: 'Musterstadt', status: 'entwurf' });

    const aktualisiert = await repo.save({ bezeichnung: 'Landesmeisterschaft', status: 'veroeffentlicht' });

    assert.equal(aktualisiert.ort, undefined);
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag bestätigen**

Run: `npm run test:unit`
Expected: FAIL — `Cannot find module '.../src/db/repositories/turnierRepository.js'`

- [ ] **Step 3: Implementieren**

`src/db/repositories/turnierRepository.js`:

```javascript
const TURNIER_DOC_ID = 'turnier:meta';

// Anders als bei den übrigen Entitäten (kampfflaechen, pools, kaempfe, ...) enthält eine
// Turnier-Datenbank per Konstruktion genau EIN Turnier-Dokument -- die Datenbank identifiziert
// das Turnier bereits über ihren eigenen Namen (turnier_<id>). Deshalb kein
// createRepository-Wrapper mit generierten <typ>:<uuid>-IDs, sondern eine feste, bekannte ID.
//
// save() ersetzt das Dokument vollständig statt es zu mergen: turnierController.js's reale
// updateTurnier-Route sendet ohnehin immer den kompletten Formular-Datensatz, ein Merge-
// Verhalten würde hier nur unbeabsichtigt alte Feldwerte überleben lassen.
export function createTurnierRepository(db) {
    async function get() {
        try {
            return await db.get(TURNIER_DOC_ID);
        } catch (error) {
            if (error.statusCode === 404) return null;
            throw error;
        }
    }

    async function save(data) {
        const bestehend = await get();
        const doc = {
            ...data,
            _id: TURNIER_DOC_ID,
            typ: 'turnier',
            ...(bestehend ? { _rev: bestehend._rev } : {})
        };
        const result = await db.insert(doc);
        return { ...doc, _rev: result.rev };
    }

    return { get, save };
}
```

- [ ] **Step 4: Test ausführen, Erfolg bestätigen**

Run: `npm run test:unit`
Expected: PASS (4 neue Tests)

- [ ] **Step 5: Dokumentation ergänzen**

In `CLAUDE.md` im Abschnitt "Zentrale Architekturkonzepte", im Punkt zu `src/db/`, nach der Liste der `src/db/repositories/`-Dateien einen Satz ergänzen, der `turnierRepository.js` als bewussten Sonderfall erklärt: Singleton-Dokument mit fester ID `turnier:meta` statt generierten IDs, da eine Turnier-Datenbank per Konstruktion nur ein Turnier enthält — und dass eine datenbankübergreifende Turnierliste bewusst nicht Teil dieser Schicht ist (Katalog-Aufgabe der Online-CouchDB, spätere Phase).

- [ ] **Step 6: Commit**

```bash
git add src/db/repositories/turnierRepository.js tests/unit/db/repositories/turnierRepository.test.js CLAUDE.md
git commit -m "feat: Turnier-Repository als Singleton-Dokument"
```

---

## Self-Review-Notizen

- **Spec-Abdeckung:** Bildet das Turnier-Metadaten-Dokument gemäß der "eine CouchDB-Datenbank pro Turnier"-Entscheidung ab. Die datenbankübergreifende Katalog-Frage (Turnierliste) wird bewusst nicht mitgelöst — sie gehört zu einer späteren Phase (Online-CouchDB-Werkzeug) und würde hier nur eine falsche Abstraktion erzwingen.
- **Platzhalter-Scan:** Keine TBD/TODO-Stellen.
- **Typ-Konsistenz:** `createTurnierRepository(db)` hat eine bewusst andere Signatur (`get`/`save`) als alle bisherigen `create/findById/update/remove/query`-Repositories — das ist beabsichtigt und in Architecture/Global Constraints begründet, keine versehentliche Inkonsistenz.
