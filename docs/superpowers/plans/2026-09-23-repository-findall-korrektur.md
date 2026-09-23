# findByTurnier-Korrektur Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die drei bestehenden Entitäts-Repositories (`kampfflaechenRepository.js`, `turnierTeilnehmerRepository.js`, `poolsRepository.js`) von `findByTurnier(turnierId)` auf `findAll()` umstellen — ein Architektur-Fehler wird korrigiert: die Spec sieht **eine CouchDB-Datenbank pro Turnier** vor, wodurch ein Filter "gehört zu Turnier X" innerhalb dieser Datenbank überflüssig ist (jedes Dokument darin gehört per Konstruktion zu genau diesem einen Turnier).

**Architecture:** Reine Umbenennung/Vereinfachung, keine neue Logik: `findByTurnier(turnierId)` (Aufruf von `repo.query({ turnier_id: turnierId })`) wird zu `findAll()` (Aufruf von `repo.query({})`), jeweils weiterhin nach `created_at` sortiert. Betrifft ausschließlich die drei genannten Repository-Dateien und ihre Tests — `baseRepository.js`, `couch.js`, `documentId.js` bleiben unverändert.

**Tech Stack:** Keine neuen Abhängigkeiten.

**Spec:** [docs/superpowers/specs/2026-09-22-couchdb-pouchdb-migration-design.md](../specs/2026-09-22-couchdb-pouchdb-migration-design.md) — Abschnitt "Datenmodell" ("Eine CouchDB-Datenbank pro Turnier")

## Global Constraints

- ESM-Only — keine Änderung an diesem Punkt nötig, aber weiterhin `import`/`export`.
- Genau EIN `startTestCouchServer()`-Aufruf pro Testdatei via `before()`/`after()`.
- Diese Korrektur wird **nicht** in `src/app.js`/`src/routes/`/`src/controllers/` verdrahtet — unverändert wie in den ursprünglichen Plänen.
- Alle drei Dateien erhalten exakt dieselbe Änderung (Batch-Task, keine Abweichung zwischen ihnen).

---

### Task 1: `findByTurnier` durch `findAll` ersetzen (alle drei Repositories)

**Files:**
- Modify: `src/db/repositories/kampfflaechenRepository.js`
- Modify: `src/db/repositories/turnierTeilnehmerRepository.js`
- Modify: `src/db/repositories/poolsRepository.js`
- Modify: `tests/unit/db/repositories/kampfflaechenRepository.test.js`
- Modify: `tests/unit/db/repositories/turnierTeilnehmerRepository.test.js`
- Modify: `tests/unit/db/repositories/poolsRepository.test.js`

**Interfaces:**
- Produces: In allen drei Modulen wird `findByTurnier(turnierId)` durch `findAll()` ersetzt (kein Parameter). Rückgabeform (sortiertes Array) bleibt unverändert.

Diese Änderung ist in allen drei Repository-Dateien identisch (nur der Funktionsname und der `query()`-Aufruf ändern sich, der Rest der Datei bleibt exakt wie zuvor):

- [ ] **Step 1: In jeder der drei Repository-Dateien `findByTurnier` durch `findAll` ersetzen**

In `src/db/repositories/kampfflaechenRepository.js`, `src/db/repositories/turnierTeilnehmerRepository.js` und `src/db/repositories/poolsRepository.js` jeweils:

Ersetze

```javascript
    async function findByTurnier(turnierId) {
        const gefunden = await repo.query({ turnier_id: turnierId });
        return gefunden.sort((a, b) => a.created_at.localeCompare(b.created_at));
    }

    return { ...repo, create, findByTurnier };
```

durch

```javascript
    // Jede Turnier-Datenbank enthält per Konstruktion ausschließlich Dokumente dieses einen
    // Turniers (siehe Spec: eine CouchDB-Datenbank pro Turnier) -- ein Filter nach turnier_id
    // ist hier anders als bei der bisherigen gemeinsamen SQL-Tabelle nicht nötig.
    async function findAll() {
        const gefunden = await repo.query({});
        return gefunden.sort((a, b) => a.created_at.localeCompare(b.created_at));
    }

    return { ...repo, create, findAll };
```

- [ ] **Step 2: In jeder der drei Testdateien die `findByTurnier`-Tests durch einen `findAll`-Test ersetzen**

In `tests/unit/db/repositories/kampfflaechenRepository.test.js` ersetze die beiden Tests

```javascript
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
```

durch einen einzigen Test

```javascript
test('findAll liefert alle Kampfflächen dieser Datenbank in Erstellungsreihenfolge', async () => {
    const repo = await neuesRepository();
    await repo.create({ bezeichnung: 'Matte 1' });
    await repo.create({ bezeichnung: 'Matte 2' });
    await repo.create({ bezeichnung: 'Matte 3' });

    const gefunden = await repo.findAll();

    assert.deepEqual(gefunden.map(kf => kf.bezeichnung), ['Matte 1', 'Matte 2', 'Matte 3']);
});
```

Analog in `tests/unit/db/repositories/turnierTeilnehmerRepository.test.js` (Feld `nachname` statt `bezeichnung`, Testname "... liefert alle Teilnehmer dieser Datenbank ...") und `tests/unit/db/repositories/poolsRepository.test.js` (Feld `bezeichnung`, Testname "... liefert alle Pools dieser Datenbank ...") — jeweils dieselbe Umbenennung: zwei `findByTurnier`-Tests werden zu einem `findAll`-Test, `turnier_id` fällt aus den Test-Fixtures weg (nicht mehr relevant für die Abfrage), die übrigen drei Tests (`create legt ... an`, `findById/update/remove ...`) bleiben unverändert.

- [ ] **Step 3: Test ausführen, Erfolg bestätigen**

Run: `npm run test:unit`
Expected: PASS — 3 Tests weniger als vorher (jeweils 2 durch 1 ersetzt = 3 Tests netto weniger), alle grün, kein `findByTurnier` mehr referenziert

- [ ] **Step 4: Commit**

```bash
git add src/db/repositories/kampfflaechenRepository.js src/db/repositories/turnierTeilnehmerRepository.js src/db/repositories/poolsRepository.js tests/unit/db/repositories/kampfflaechenRepository.test.js tests/unit/db/repositories/turnierTeilnehmerRepository.test.js tests/unit/db/repositories/poolsRepository.test.js
git commit -m "fix: findByTurnier durch findAll ersetzen (eine CouchDB-Datenbank pro Turnier macht Turnier-Filter überflüssig)"
```

---

## Self-Review-Notizen

- **Spec-Abdeckung:** Korrigiert eine Abweichung von der bereits genehmigten Spec-Entscheidung "eine CouchDB-Datenbank pro Turnier" — kein neuer Spec-Bedarf.
- **Platzhalter-Scan:** Keine TBD/TODO-Stellen.
- **Typ-Konsistenz:** Alle drei Module erhalten identisch `findAll(): Promise<Array>` statt `findByTurnier(turnierId): Promise<Array>` — keine Divergenz zwischen den drei Dateien.
