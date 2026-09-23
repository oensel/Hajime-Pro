# Reservierte-Felder-Härtung Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein automatisierter Sicherheits-Review deckte Mass-Assignment in `src/db/repositories/turnierRepository.js` auf: `save(data)` übernimmt `data` per Objekt-Spread ungefiltert in das zu speichernde Dokument, sodass ein Aufrufer CouchDB-reservierte Felder wie `_deleted`, `_attachments`, `_conflicts` einschleusen könnte (z.B. `_deleted: true` würde das Dokument beim nächsten Insert löschen). Bei genauerer Prüfung besteht dieselbe Schwachstelle systemisch in `src/db/baseRepository.js`s `create()` und `update()` — und damit in JEDEM der acht bisher gebauten Entitäts-Repositories, die darauf aufbauen. Dieser Plan härtet beide Stellen.

**Architecture:** Eine neue, kleine geteilte Hilfsfunktion `stripReservedFields(data)` (neues Modul `src/db/reservedFields.js`) entfernt alle Schlüssel, die mit `_` beginnen, bevor Nutzerdaten in ein zu speicherndes Dokument einfließen. `baseRepository.js`s `create()`/`update()` wenden sie auf `data`/`patch` an — das schützt automatisch alle acht bereits gebauten Entitäts-Repositories (kampfflaechen, turnierTeilnehmer, pools, kaempfe, mannschaften, mannschaftMitglieder, mannschaftskaempfe, plus alle künftigen), da sie ausnahmslos über `createRepository()` laufen. `turnierRepository.js` nutzt `baseRepository.js` bewusst nicht (Singleton-Sonderfall, siehe eigener Plan) und braucht daher denselben Schutz separat in seiner eigenen `save()`-Funktion.

**Tech Stack:** Kein neuer Dependency-Bedarf.

**Spec:** [docs/superpowers/specs/2026-09-22-couchdb-pouchdb-migration-design.md](../specs/2026-09-22-couchdb-pouchdb-migration-design.md)

## Global Constraints

- ESM-Only — `import`/`export`, kein `require`.
- Keine Kommentare, die nur wiederholen, was der Code schon sagt.
- Genau EIN `startTestCouchServer()`-Aufruf pro Testdatei via `before()`/`after()`.
- Diese Härtung wird **nicht** in `src/app.js`/`src/routes/`/`src/controllers/` verdrahtet — reine Absicherung der bestehenden Datenzugriffsschicht.
- `stripReservedFields` entfernt genau die Schlüssel, die mit `_` beginnen (CouchDBs eigene Konvention für reservierte/System-Felder: `_id`, `_rev`, `_deleted`, `_attachments`, `_conflicts`, `_revisions`, `_local_seq`, ...) — keine Positivliste einzelner Feldnamen, da CouchDB jederzeit neue `_`-Felder einführen könnte.

---

### Task 1: `stripReservedFields` einführen und in `baseRepository.js` anwenden

**Files:**
- Create: `src/db/reservedFields.js`
- Test: `tests/unit/db/reservedFields.test.js`
- Modify: `src/db/baseRepository.js`
- Modify: `tests/unit/db/baseRepository.test.js`

**Interfaces:**
- Produces: `stripReservedFields(data: object): object` — neues Objekt ohne `_`-präfigierte Schlüssel. Wird von `baseRepository.js`s `create()`/`update()` und (in Task 2) von `turnierRepository.js`s `save()` verwendet.

- [ ] **Step 1: Failing Test für `stripReservedFields` schreiben**

`tests/unit/db/reservedFields.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripReservedFields } from '../../../src/db/reservedFields.js';

test('stripReservedFields entfernt alle mit _ beginnenden Schlüssel', () => {
    const bereinigt = stripReservedFields({
        bezeichnung: 'Matte 1',
        _deleted: true,
        _rev: '1-abc',
        _attachments: { foo: 'bar' }
    });

    assert.deepEqual(bereinigt, { bezeichnung: 'Matte 1' });
});

test('stripReservedFields lässt normale Felder unverändert, wenn keine reservierten vorhanden sind', () => {
    const bereinigt = stripReservedFields({ bezeichnung: 'Matte 1', status: 'frei' });

    assert.deepEqual(bereinigt, { bezeichnung: 'Matte 1', status: 'frei' });
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag bestätigen**

Run: `npm run test:unit`
Expected: FAIL — `Cannot find module '.../src/db/reservedFields.js'`

- [ ] **Step 3: `stripReservedFields` implementieren**

`src/db/reservedFields.js`:

```javascript
// CouchDB reserviert alle mit _ beginnenden Feldnamen für sich selbst (_id, _rev, _deleted,
// _attachments, _conflicts, _revisions, _local_seq, ...) -- ungefiltert übernommene Nutzerdaten
// könnten sonst z.B. per _deleted: true das Dokument beim nächsten Insert löschen
// (Mass-Assignment). Eine Blacklist auf das _-Präfix statt einzelner Feldnamen, da CouchDB
// jederzeit neue reservierte Felder einführen kann.
export function stripReservedFields(data) {
    return Object.fromEntries(
        Object.entries(data).filter(([key]) => !key.startsWith('_'))
    );
}
```

- [ ] **Step 4: Test ausführen, Erfolg bestätigen**

Run: `npm run test:unit`
Expected: PASS (2 neue Tests)

- [ ] **Step 5: Failing Test für die Absicherung in `baseRepository.js` schreiben**

In `tests/unit/db/baseRepository.test.js` nach dem bestehenden Test `'create legt ein Dokument mit Typ-Präfix-ID an und liefert es vollständig zurück'` zwei neue Tests ergänzen:

```javascript
test('create ignoriert eingeschleuste reservierte Felder wie _deleted', async () => {
    const { db, close } = await setUp();
    try {
        const repo = createRepository({ db, typePrefix: 'kampffl' });
        const doc = await repo.create({ bezeichnung: 'Matte 1', _deleted: true, _rev: 'geraten' });

        const gefunden = await repo.findById(doc._id);
        assert.ok(gefunden, 'Dokument muss trotz eingeschleustem _deleted weiterhin existieren');
        assert.equal(gefunden.bezeichnung, 'Matte 1');
    } finally {
        await close();
    }
});

test('update ignoriert eingeschleuste reservierte Felder wie _deleted', async () => {
    const { db, close } = await setUp();
    try {
        const repo = createRepository({ db, typePrefix: 'kampffl' });
        const created = await repo.create({ bezeichnung: 'Matte 1', status: 'frei' });

        await repo.update(created._id, { status: 'pausiert', _deleted: true });

        const gefunden = await repo.findById(created._id);
        assert.ok(gefunden, 'Dokument muss trotz eingeschleustem _deleted weiterhin existieren');
        assert.equal(gefunden.status, 'pausiert');
    } finally {
        await close();
    }
});
```

- [ ] **Step 6: Test ausführen, Fehlschlag bestätigen**

Run: `npm run test:unit`
Expected: FAIL — beide neuen Tests schlagen fehl, da `create`/`update` `_deleted` noch nicht herausfiltern (CouchDB löscht das Dokument, `findById` liefert `null` statt des erwarteten Dokuments)

- [ ] **Step 7: `baseRepository.js` absichern**

In `src/db/baseRepository.js`:

Ergänze den Import:

```javascript
import { createId } from './documentId.js';
import { stripReservedFields } from './reservedFields.js';
```

Ersetze in `create()`:

```javascript
        const doc = { ...data, _id, typ: typePrefix };
```

durch

```javascript
        const doc = { ...stripReservedFields(data), _id, typ: typePrefix };
```

Ersetze in `update()`:

```javascript
        const merged = { ...current, ...patch, _id: current._id, _rev: current._rev, typ: current.typ };
```

durch

```javascript
        const merged = { ...current, ...stripReservedFields(patch), _id: current._id, _rev: current._rev, typ: current.typ };
```

- [ ] **Step 8: Test ausführen, Erfolg bestätigen**

Run: `npm run test:unit`
Expected: PASS (alle Tests grün, inkl. der beiden neuen)

- [ ] **Step 9: Commit**

```bash
git add src/db/reservedFields.js tests/unit/db/reservedFields.test.js src/db/baseRepository.js tests/unit/db/baseRepository.test.js
git commit -m "fix: Mass-Assignment reservierter CouchDB-Felder in baseRepository verhindern"
```

---

### Task 2: `turnierRepository.js` absichern

**Files:**
- Modify: `src/db/repositories/turnierRepository.js`
- Modify: `tests/unit/db/repositories/turnierRepository.test.js`

**Interfaces:**
- Consumes: `stripReservedFields` aus `src/db/reservedFields.js` (Task 1).

- [ ] **Step 1: Failing Test schreiben**

In `tests/unit/db/repositories/turnierRepository.test.js` einen neuen Test ergänzen:

```javascript
test('save ignoriert eingeschleuste reservierte Felder wie _deleted', async () => {
    const repo = await neuesRepository();

    await repo.save({ bezeichnung: 'Landesmeisterschaft', _deleted: true });

    const geladen = await repo.get();
    assert.ok(geladen, 'Dokument muss trotz eingeschleustem _deleted weiterhin existieren');
    assert.equal(geladen.bezeichnung, 'Landesmeisterschaft');
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag bestätigen**

Run: `npm run test:unit`
Expected: FAIL — `save` übernimmt `_deleted: true` ungefiltert, CouchDB löscht das Dokument, `get()` liefert `null`

- [ ] **Step 3: `turnierRepository.js` absichern**

In `src/db/repositories/turnierRepository.js`:

Ergänze den Import:

```javascript
import { stripReservedFields } from '../reservedFields.js';
```

Ersetze in `save()`:

```javascript
        const doc = {
            ...data,
```

durch

```javascript
        const doc = {
            ...stripReservedFields(data),
```

- [ ] **Step 4: Test ausführen, Erfolg bestätigen**

Run: `npm run test:unit`
Expected: PASS (alle Tests grün, inkl. des neuen)

- [ ] **Step 5: Commit**

```bash
git add src/db/repositories/turnierRepository.js tests/unit/db/repositories/turnierRepository.test.js
git commit -m "fix: Mass-Assignment reservierter CouchDB-Felder in turnierRepository verhindern"
```

---

## Self-Review-Notizen

- **Spec-Abdeckung:** Reine Sicherheitshärtung eines bereits gebauten Fundaments, kein neuer Spec-Bedarf. Schließt eine von einer automatisierten Sicherheits-Review gefundene, valide Lücke.
- **Platzhalter-Scan:** Keine TBD/TODO-Stellen.
- **Typ-Konsistenz:** `stripReservedFields(data): object` hat eine einzige, konsistente Signatur, die an beiden Verwendungsstellen (Task 1, Task 2) identisch aufgerufen wird.
