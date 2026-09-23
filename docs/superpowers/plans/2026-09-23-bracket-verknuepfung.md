# Bracket-Verknüpfung Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CouchDB-Äquivalente der beiden knex-spezifischen Funktionen aus `src/shared/bracketTopologie.js` (`verknuepfeQuellenFuerPool`, `verknuepfeQuellenFuerMannschaftsPool`) — anders als `kampfProgression.js`/`mannschaftsProgression.js`/`pausenRegel.js` sind diese beiden Funktionen NICHT rein/DB-frei, sondern rufen direkt `knex(...)` auf (eine bestehende Ausnahme von der sonst in `src/shared/` durchgehaltenen Trennung). Die reinen `*_TOPOLOGIE`-Konstanten selbst bleiben unverändert und werden unverändert wiederverwendet — nur die Verknüpfungs-Logik bekommt ein CouchDB-Pendant. Vollständig getestet, weiterhin **nicht** in `src/app.js`/`src/routes/`/`src/controllers/` verdrahtet.

**Architecture:** Zwei Funktionen in `src/db/kaskaden/bracketVerknuepfung.js`, die exakt dasselbe Signatur-Muster wie die knex-Originale übernehmen (`topologie` bleibt ein reiner Parameter, keine der `*_TOPOLOGIE`-Konstanten wird hier importiert oder dupliziert), aber `kaempfeRepository`/`mannschaftskaempfeRepository` statt `knex` verwenden: laden alle Kämpfe/Begegnungen eines Pools, gleichen ihre `reihenfolge_nummer` gegen die übergebene Topologie-Tabelle ab und setzen die `quelle_kampf_id`/`quelle_typ`-Felder entsprechend — identische Logik zum Original, nur über das Repository statt direktem Tabellenzugriff.

**Tech Stack:** Kein neuer Dependency-Bedarf.

**Spec:** [docs/superpowers/specs/2026-09-22-couchdb-pouchdb-migration-design.md](../specs/2026-09-22-couchdb-pouchdb-migration-design.md)

## Global Constraints

- ESM-Only — `import`/`export`, kein `require`.
- Keine Kommentare, die nur wiederholen, was der Code schon sagt.
- Genau EIN `startTestCouchServer()`-Aufruf pro Testdatei via `before()`/`after()`.
- `src/shared/bracketTopologie.js` wird **nicht** verändert — auch nicht die beiden knex-Funktionen darin (sie bleiben für den bestehenden Knex-Pfad bestehen, bis ein künftiger Cutover-Plan sie ablöst).
- `topologie` bleibt ein reiner Funktionsparameter — keine der `*_TOPOLOGIE`-Konstanten wird in `bracketVerknuepfung.js` importiert; Tests nutzen eigene, kleine Topologie-Objekte, um die Verknüpfungs-Mechanik unabhängig von der Korrektheit der echten, bereits bestehenden Bracket-Daten zu prüfen.
- Diese Schicht wird in diesem Plan **nicht** in `src/app.js`, `src/routes/` oder `src/controllers/` verdrahtet.

---

### Task 1: `verknuepfeQuellenFuerPool`

**Files:**
- Create: `src/db/kaskaden/bracketVerknuepfung.js`
- Test: `tests/unit/db/kaskaden/bracketVerknuepfung.test.js`

**Interfaces:**
- Consumes: `findByPool(poolId)`/`findById(id)`/`update(id, patch)` aus einem `kaempfeRepository`-Objekt.
- Produces: `verknuepfeQuellenFuerPool(kaempfeRepository, poolId, topologie): Promise<void>`.

- [ ] **Step 1: Failing Test schreiben**

`tests/unit/db/kaskaden/bracketVerknuepfung.test.js`:

```javascript
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startTestCouchServer } from '../../helpers/couchTestServer.js';
import { connect, ensureDatabase } from '../../../../src/db/couch.js';
import { createKaempfeRepository } from '../../../../src/db/repositories/kaempfeRepository.js';
import { verknuepfeQuellenFuerPool } from '../../../../src/db/kaskaden/bracketVerknuepfung.js';

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

test('verknuepfeQuellenFuerPool setzt die quelle_kampf_id/_typ-Felder gemäß der Topologie', async () => {
    const repo = await neuesRepository();
    const kampfH1 = await repo.create({ pool_id: 'pool:1', reihenfolge_nummer: 'H1' });
    const kampfH2 = await repo.create({ pool_id: 'pool:1', reihenfolge_nummer: 'H2' });
    const kampfF = await repo.create({ pool_id: 'pool:1', reihenfolge_nummer: 'F' });

    const topologie = { F: { k1: ['H1', 'sieger'], k2: ['H2', 'sieger'] } };
    await verknuepfeQuellenFuerPool(repo, 'pool:1', topologie);

    const aktualisiert = await repo.findById(kampfF._id);
    assert.equal(aktualisiert.kaempfer1_quelle_kampf_id, kampfH1._id);
    assert.equal(aktualisiert.kaempfer1_quelle_typ, 'sieger');
    assert.equal(aktualisiert.kaempfer2_quelle_kampf_id, kampfH2._id);
    assert.equal(aktualisiert.kaempfer2_quelle_typ, 'sieger');
});

test('verknuepfeQuellenFuerPool lässt Kämpfe ohne passenden Topologie-Eintrag unverändert', async () => {
    const repo = await neuesRepository();
    const kampf = await repo.create({ pool_id: 'pool:1', reihenfolge_nummer: 'unbekannt' });

    await verknuepfeQuellenFuerPool(repo, 'pool:1', { F: { k1: ['H1', 'sieger'], k2: ['H2', 'sieger'] } });

    const unveraendert = await repo.findById(kampf._id);
    assert.equal(unveraendert.kaempfer1_quelle_kampf_id, undefined);
});

test('verknuepfeQuellenFuerPool überspringt einen Eintrag, wenn eine referenzierte Quelle im Pool fehlt', async () => {
    const repo = await neuesRepository();
    // H1 fehlt absichtlich -- unvollständige Altdaten simulieren, siehe Kommentar im Original.
    const kampfH2 = await repo.create({ pool_id: 'pool:1', reihenfolge_nummer: 'H2' });
    const kampfF = await repo.create({ pool_id: 'pool:1', reihenfolge_nummer: 'F' });

    await verknuepfeQuellenFuerPool(repo, 'pool:1', { F: { k1: ['H1', 'sieger'], k2: ['H2', 'sieger'] } });

    const unveraendert = await repo.findById(kampfF._id);
    assert.equal(unveraendert.kaempfer1_quelle_kampf_id, undefined);
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag bestätigen**

Run: `npm run test:unit`
Expected: FAIL — `Cannot find module '.../src/db/kaskaden/bracketVerknuepfung.js'`

- [ ] **Step 3: Implementieren**

`src/db/kaskaden/bracketVerknuepfung.js`:

```javascript
// CouchDB-Pendant zu verknuepfeQuellenFuerPool aus src/shared/bracketTopologie.js -- dort direkt
// knex-gebunden (eine bestehende Ausnahme von der sonst in src/shared/ durchgehaltenen
// DB-Freiheit), hier über kaempfeRepository. topologie bleibt bewusst ein reiner Parameter --
// die *_TOPOLOGIE-Konstanten selbst sind unverändert wiederverwendbare, reine Daten und werden
// hier nicht importiert.
export async function verknuepfeQuellenFuerPool(kaempfeRepository, poolId, topologie) {
    const kaempfe = await kaempfeRepository.findByPool(poolId);
    const idByReihenfolge = new Map(kaempfe.map(k => [k.reihenfolge_nummer, k._id]));

    for (const kampf of kaempfe) {
        const eintrag = topologie[kampf.reihenfolge_nummer];
        if (!eintrag) continue;

        const [k1QuelleNr, k1Typ] = eintrag.k1;
        const [k2QuelleNr, k2Typ] = eintrag.k2;
        const k1QuelleId = idByReihenfolge.get(k1QuelleNr);
        const k2QuelleId = idByReihenfolge.get(k2QuelleNr);

        // Quelle im selben Pool nicht gefunden (z.B. unvollständige/kaputte Altdaten) ->
        // überspringen statt eine falsche Referenz zu setzen.
        if (!k1QuelleId || !k2QuelleId) continue;

        await kaempfeRepository.update(kampf._id, {
            kaempfer1_quelle_kampf_id: k1QuelleId,
            kaempfer1_quelle_typ: k1Typ,
            kaempfer2_quelle_kampf_id: k2QuelleId,
            kaempfer2_quelle_typ: k2Typ
        });
    }
}
```

- [ ] **Step 4: Test ausführen, Erfolg bestätigen**

Run: `npm run test:unit`
Expected: PASS (3 neue Tests)

- [ ] **Step 5: Commit**

```bash
git add src/db/kaskaden/bracketVerknuepfung.js tests/unit/db/kaskaden/bracketVerknuepfung.test.js
git commit -m "feat: CouchDB-Pendant zu verknuepfeQuellenFuerPool aus bracketTopologie.js"
```

---

### Task 2: `verknuepfeQuellenFuerMannschaftsPool`

**Files:**
- Modify: `src/db/kaskaden/bracketVerknuepfung.js`
- Modify: `tests/unit/db/kaskaden/bracketVerknuepfung.test.js`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: `findByPool(poolId)`/`findById(id)`/`update(id, patch)` aus einem `mannschaftskaempfeRepository`-Objekt.
- Produces: `verknuepfeQuellenFuerMannschaftsPool(mannschaftskaempfeRepository, poolId, topologie): Promise<void>`.

- [ ] **Step 1: Failing Tests schreiben**

In `tests/unit/db/kaskaden/bracketVerknuepfung.test.js` den Import um `createMannschaftskaempfeRepository` und `verknuepfeQuellenFuerMannschaftsPool` ergänzen, sowie eine zweite `neuesRepository`-artige Hilfsfunktion:

```javascript
import { createMannschaftskaempfeRepository } from '../../../../src/db/repositories/mannschaftskaempfeRepository.js';
import { verknuepfeQuellenFuerPool, verknuepfeQuellenFuerMannschaftsPool } from '../../../../src/db/kaskaden/bracketVerknuepfung.js';
```

Nach den drei bestehenden Tests ergänzen:

```javascript
async function neuesMannschaftsRepository() {
    const db = await ensureDatabase(nano, `test-${randomUUID()}`);
    return createMannschaftskaempfeRepository(db);
}

test('verknuepfeQuellenFuerMannschaftsPool setzt die mannschaft_quelle-Felder gemäß der Topologie', async () => {
    const repo = await neuesMannschaftsRepository();
    const begegnungH1 = await repo.create({ pool_id: 'pool:1', reihenfolge_nummer: 'H1' });
    const begegnungH2 = await repo.create({ pool_id: 'pool:1', reihenfolge_nummer: 'H2' });
    const begegnungF = await repo.create({ pool_id: 'pool:1', reihenfolge_nummer: 'F' });

    const topologie = { F: { k1: ['H1', 'sieger'], k2: ['H2', 'sieger'] } };
    await verknuepfeQuellenFuerMannschaftsPool(repo, 'pool:1', topologie);

    const aktualisiert = await repo.findById(begegnungF._id);
    assert.equal(aktualisiert.mannschaft1_quelle_kampf_id, begegnungH1._id);
    assert.equal(aktualisiert.mannschaft1_quelle_typ, 'sieger');
    assert.equal(aktualisiert.mannschaft2_quelle_kampf_id, begegnungH2._id);
    assert.equal(aktualisiert.mannschaft2_quelle_typ, 'sieger');
});

test('verknuepfeQuellenFuerMannschaftsPool überspringt einen Eintrag, wenn eine referenzierte Quelle fehlt', async () => {
    const repo = await neuesMannschaftsRepository();
    const begegnungH2 = await repo.create({ pool_id: 'pool:1', reihenfolge_nummer: 'H2' });
    const begegnungF = await repo.create({ pool_id: 'pool:1', reihenfolge_nummer: 'F' });

    await verknuepfeQuellenFuerMannschaftsPool(repo, 'pool:1', { F: { k1: ['H1', 'sieger'], k2: ['H2', 'sieger'] } });

    const unveraendert = await repo.findById(begegnungF._id);
    assert.equal(unveraendert.mannschaft1_quelle_kampf_id, undefined);
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag bestätigen**

Run: `npm run test:unit`
Expected: FAIL — `verknuepfeQuellenFuerMannschaftsPool is not a function` (oder Import-Fehler, da noch nicht exportiert)

- [ ] **Step 3: Implementieren**

In `src/db/kaskaden/bracketVerknuepfung.js` ergänzen:

```javascript
// Pendant zu verknuepfeQuellenFuerPool auf Ebene der Mannschafts-Begegnungen statt der
// Einzelkämpfe -- identische Mechanik, andere Feldnamen (mannschaftN_quelle_... statt
// kaempferN_quelle_...), analog zum Verhältnis von mannschaftsProgression.js zu
// kampfProgression.js.
export async function verknuepfeQuellenFuerMannschaftsPool(mannschaftskaempfeRepository, poolId, topologie) {
    const begegnungen = await mannschaftskaempfeRepository.findByPool(poolId);
    const idByReihenfolge = new Map(begegnungen.map(b => [b.reihenfolge_nummer, b._id]));

    for (const begegnung of begegnungen) {
        const eintrag = topologie[begegnung.reihenfolge_nummer];
        if (!eintrag) continue;

        const [m1QuelleNr, m1Typ] = eintrag.k1;
        const [m2QuelleNr, m2Typ] = eintrag.k2;
        const m1QuelleId = idByReihenfolge.get(m1QuelleNr);
        const m2QuelleId = idByReihenfolge.get(m2QuelleNr);

        if (!m1QuelleId || !m2QuelleId) continue;

        await mannschaftskaempfeRepository.update(begegnung._id, {
            mannschaft1_quelle_kampf_id: m1QuelleId,
            mannschaft1_quelle_typ: m1Typ,
            mannschaft2_quelle_kampf_id: m2QuelleId,
            mannschaft2_quelle_typ: m2Typ
        });
    }
}
```

- [ ] **Step 4: Test ausführen, Erfolg bestätigen**

Run: `npm run test:unit`
Expected: PASS (5 neue Tests seit Task 1, insgesamt 75)

- [ ] **Step 5: Dokumentation ergänzen**

In `CLAUDE.md` im Abschnitt "Zentrale Architekturkonzepte", im Punkt zu `src/db/kaskaden/`, `bracketVerknuepfung.js` als drittes Modul ergänzen — CouchDB-Pendant zu den beiden knex-gebundenen Verknüpfungsfunktionen aus `src/shared/bracketTopologie.js` (die reinen `*_TOPOLOGIE`-Konstanten bleiben unverändert wiederverwendbar).

- [ ] **Step 6: Commit**

```bash
git add src/db/kaskaden/bracketVerknuepfung.js tests/unit/db/kaskaden/bracketVerknuepfung.test.js CLAUDE.md
git commit -m "feat: CouchDB-Pendant zu verknuepfeQuellenFuerMannschaftsPool aus bracketTopologie.js"
```

---

## Self-Review-Notizen

- **Spec-Abdeckung:** Deckt die beiden knex-gebundenen Funktionen aus `bracketTopologie.js` ab. Die eigentliche Kampf-/Begegnungs-ERZEUGUNG (die `*Manager.js`-Services, die diese Verknüpfungsfunktionen nach dem Anlegen eines Pools aufrufen) ist bewusst NICHT Teil dieses Plans — das wäre der nächste, deutlich größere Schritt (Pool-Anlage-Orchestrierung je Turniermodus) und verdient einen eigenen Plan.
- **Platzhalter-Scan:** Keine TBD/TODO-Stellen. Testfälle nutzen eigene, minimale Topologie-Objekte statt der echten `*_TOPOLOGIE`-Konstanten, um die Verknüpfungs-Mechanik unabhängig zu prüfen.
- **Typ-Konsistenz:** `verknuepfeQuellenFuerPool` und `verknuepfeQuellenFuerMannschaftsPool` folgen identischer Struktur; beide nehmen `topologie` unverändert als Parameter entgegen, keine der beiden importiert eine `*_TOPOLOGIE`-Konstante.
