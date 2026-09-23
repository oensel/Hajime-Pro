# Kaskaden-Dienst Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die in der Spec beschriebene Kaskaden-Logik (Phase 3: "Ein persistenter `_changes`-Feed-Listener... berechnet dieselbe Kaskade und schreibt das Ergebnis autoritativ fest") als eigenständige, testbare Orchestrierung: `wendeKaempfeKaskadeAn(kaempfeRepository, poolId)` und `wendeMannschaftsKaskadeAn(mannschaftskaempfeRepository, poolId)` laden alle Kämpfe/Begegnungen eines Pools, wenden die bereits vorhandenen, reinen Engines (`src/shared/kampfProgression.js`/`mannschaftsProgression.js`) an, schreiben die Patches über das jeweilige Repository zurück und wiederholen das, bis keine Patches mehr entstehen (exakt das in `kampfProgression.js`s eigenem Docstring beschriebene Aufrufmuster). Vollständig getestet, weiterhin **nicht** in `src/app.js`/`src/routes/`/`src/controllers/` verdrahtet — der eigentliche `_changes`-Feed-Listener (der diese Funktionen bei jeder Kampf-Änderung automatisch aufruft) ist bewusst NICHT Teil dieses Plans, sondern eines späteren, eigenen Schritts.

**Architecture:** Zwei kleine Orchestrierungs-Module (`src/db/kaskaden/kaempfeKaskade.js`, `src/db/kaskaden/mannschaftsKaskade.js`), die die bereits vorhandenen, reinen, seiteneffektfreien Engines aus `src/shared/` mit den bereits vorhandenen Repositories (`kaempfeRepository.js`, `mannschaftskaempfeRepository.js`) verbinden — sie enthalten selbst keine Kaskaden-Logik, nur die "Lade alles, berechne Patches, wende sie an, wiederhole"-Schleife, die heute in `kampfController.js`/den `*Manager.js`-Services knex-spezifisch dupliziert ist.

**Tech Stack:** Kein neuer Dependency-Bedarf.

**Spec:** [docs/superpowers/specs/2026-09-22-couchdb-pouchdb-migration-design.md](../specs/2026-09-22-couchdb-pouchdb-migration-design.md) — Abschnitt "Kaskaden-Logik (Bracket-Progression)"

## Global Constraints

- ESM-Only — `import`/`export`, kein `require`.
- Keine Kommentare, die nur wiederholen, was der Code schon sagt.
- Genau EIN `startTestCouchServer()`-Aufruf pro Testdatei via `before()`/`after()`.
- Diese Module rufen `src/shared/kampfProgression.js`/`mannschaftsProgression.js` **unverändert** auf — keine Anpassung dieser bereits bestehenden, reinen Engines.
- Kein `_changes`-Feed-Listener, kein Timer, keine Endlosschleifen-Absicherung mit künstlichem Iterations-Limit — Zyklen sind durch die azyklische Bracket-Struktur (`bracketTopologie.js`) ausgeschlossen, ein zusätzliches Limit wäre unbegründete Vorsicht ohne echten Anwendungsfall.
- Diese Schicht wird in diesem Plan **nicht** in `src/app.js`, `src/routes/` oder `src/controllers/` verdrahtet.

---

### Task 1: `kaempfeKaskade.js`

**Files:**
- Create: `src/db/kaskaden/kaempfeKaskade.js`
- Test: `tests/unit/db/kaskaden/kaempfeKaskade.test.js`

**Interfaces:**
- Consumes: `berechneKaempferPatches(kaempfe)` aus `src/shared/kampfProgression.js` (unverändert); `findByPool(poolId)`/`update(id, patch)` aus einem `kaempfeRepository`-Objekt (siehe `src/db/repositories/kaempfeRepository.js`).
- Produces: `wendeKaempfeKaskadeAn(kaempfeRepository, poolId): Promise<Array>` — gibt die Kämpfe des Pools im finalen, stabilen Zustand zurück.

- [ ] **Step 1: Failing Test schreiben**

`tests/unit/db/kaskaden/kaempfeKaskade.test.js`:

```javascript
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startTestCouchServer } from '../../helpers/couchTestServer.js';
import { connect, ensureDatabase } from '../../../../src/db/couch.js';
import { createKaempfeRepository } from '../../../../src/db/repositories/kaempfeRepository.js';
import { wendeKaempfeKaskadeAn } from '../../../../src/db/kaskaden/kaempfeKaskade.js';

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

test('wendeKaempfeKaskadeAn befüllt einen wartenden Folgekampf, sobald beide Vorkämpfe beendet sind', async () => {
    const repo = await neuesRepository();
    const poolId = 'pool:1';

    const kampfA = await repo.create({ pool_id: poolId, kaempfer1_id: 'teilnehmer:1', kaempfer2_id: 'teilnehmer:2', status: 'beendet', sieger_id: 'teilnehmer:1' });
    const kampfB = await repo.create({ pool_id: poolId, kaempfer1_id: 'teilnehmer:3', kaempfer2_id: 'teilnehmer:4', status: 'beendet', sieger_id: 'teilnehmer:3' });
    const kampfC = await repo.create({
        pool_id: poolId,
        kaempfer1_id: null, kaempfer2_id: null, status: 'angelegt',
        kaempfer1_quelle_kampf_id: kampfA._id, kaempfer1_quelle_typ: 'sieger',
        kaempfer2_quelle_kampf_id: kampfB._id, kaempfer2_quelle_typ: 'sieger'
    });

    await wendeKaempfeKaskadeAn(repo, poolId);

    const aktualisiert = await repo.findById(kampfC._id);
    assert.equal(aktualisiert.status, 'bereit');
    assert.equal(aktualisiert.kaempfer1_id, 'teilnehmer:1');
    assert.equal(aktualisiert.kaempfer2_id, 'teilnehmer:3');
});

test('wendeKaempfeKaskadeAn kaskadiert über mehrere Runden hinweg, wenn Freilose entstehen', async () => {
    const repo = await neuesRepository();
    const poolId = 'pool:1';

    // Doppeltes Freilos: kein Sieger feststellbar.
    const kampfA = await repo.create({ pool_id: poolId, kaempfer1_id: null, kaempfer2_id: null, status: 'freilos', sieger_id: null });
    // Einfaches Freilos: automatischer Sieg von teilnehmer:1.
    const kampfB = await repo.create({ pool_id: poolId, kaempfer1_id: 'teilnehmer:1', kaempfer2_id: null, status: 'freilos', sieger_id: 'teilnehmer:1' });
    const kampfC = await repo.create({
        pool_id: poolId,
        kaempfer1_id: null, kaempfer2_id: null, status: 'angelegt',
        kaempfer1_quelle_kampf_id: kampfA._id, kaempfer1_quelle_typ: 'sieger',
        kaempfer2_quelle_kampf_id: kampfB._id, kaempfer2_quelle_typ: 'sieger'
    });
    const kampfD = await repo.create({
        pool_id: poolId,
        kaempfer1_id: null, kaempfer2_id: 'teilnehmer:5', status: 'angelegt',
        kaempfer1_quelle_kampf_id: kampfC._id, kaempfer1_quelle_typ: 'sieger'
    });

    await wendeKaempfeKaskadeAn(repo, poolId);

    // kampf C: doppeltes Freilos (A) + einfaches Freilos (B) -> C wird selbst zum einfachen
    // Freilos mit teilnehmer:1 als automatischem Sieger.
    const aktualisiertC = await repo.findById(kampfC._id);
    assert.equal(aktualisiertC.status, 'freilos');
    assert.equal(aktualisiertC.sieger_id, 'teilnehmer:1');

    // kampf D: kann erst befüllt werden, NACHDEM C aufgelöst wurde -- beweist, dass die
    // Kaskade mehrfach durchläuft, statt nur einmal Patches anzuwenden.
    const aktualisiertD = await repo.findById(kampfD._id);
    assert.equal(aktualisiertD.status, 'bereit');
    assert.equal(aktualisiertD.kaempfer1_id, 'teilnehmer:1');
    assert.equal(aktualisiertD.kaempfer2_id, 'teilnehmer:5');
});

test('wendeKaempfeKaskadeAn lässt bereits entschiedene Kämpfe unverändert', async () => {
    const repo = await neuesRepository();
    const poolId = 'pool:1';

    const kampf = await repo.create({ pool_id: poolId, kaempfer1_id: 'teilnehmer:1', kaempfer2_id: 'teilnehmer:2', status: 'beendet', sieger_id: 'teilnehmer:1' });

    const ergebnis = await wendeKaempfeKaskadeAn(repo, poolId);

    assert.equal(ergebnis.length, 1);
    assert.equal(ergebnis[0].status, 'beendet');
    assert.equal(ergebnis[0].sieger_id, 'teilnehmer:1');
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag bestätigen**

Run: `npm run test:unit`
Expected: FAIL — `Cannot find module '.../src/db/kaskaden/kaempfeKaskade.js'`

- [ ] **Step 3: Implementieren**

`src/db/kaskaden/kaempfeKaskade.js`:

```javascript
import { berechneKaempferPatches } from '../../shared/kampfProgression.js';

// Verbindet die reine, seiteneffektfreie Kaskaden-Engine (kampfProgression.js) mit dem
// kaempfeRepository: lädt alle Kämpfe des Pools, wendet berechnete Patches an und wiederholt
// das, bis keine mehr entstehen -- exakt das in kampfProgression.js selbst dokumentierte
// Aufrufmuster (siehe dortiger Docstring von berechneKaempferPatches).
export async function wendeKaempfeKaskadeAn(kaempfeRepository, poolId) {
    let kaempfe = await kaempfeRepository.findByPool(poolId);
    let patches = berechneKaempferPatches(kaempfe);

    while (patches.length > 0) {
        for (const patch of patches) {
            const { id, ...aenderungen } = patch;
            await kaempfeRepository.update(id, aenderungen);
        }
        kaempfe = await kaempfeRepository.findByPool(poolId);
        patches = berechneKaempferPatches(kaempfe);
    }

    return kaempfe;
}
```

- [ ] **Step 4: Test ausführen, Erfolg bestätigen**

Run: `npm run test:unit`
Expected: PASS (3 neue Tests)

- [ ] **Step 5: Commit**

```bash
git add src/db/kaskaden/kaempfeKaskade.js tests/unit/db/kaskaden/kaempfeKaskade.test.js
git commit -m "feat: Kämpfe-Kaskaden-Dienst verbindet kampfProgression.js mit kaempfeRepository"
```

---

### Task 2: `mannschaftsKaskade.js`

**Files:**
- Create: `src/db/kaskaden/mannschaftsKaskade.js`
- Test: `tests/unit/db/kaskaden/mannschaftsKaskade.test.js`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: `berechneMannschaftsPatches(begegnungen)` aus `src/shared/mannschaftsProgression.js` (unverändert); `findByPool(poolId)`/`update(id, patch)` aus einem `mannschaftskaempfeRepository`-Objekt.
- Produces: `wendeMannschaftsKaskadeAn(mannschaftskaempfeRepository, poolId): Promise<Array>`.

- [ ] **Step 1: Failing Test schreiben**

`tests/unit/db/kaskaden/mannschaftsKaskade.test.js`:

```javascript
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startTestCouchServer } from '../../helpers/couchTestServer.js';
import { connect, ensureDatabase } from '../../../../src/db/couch.js';
import { createMannschaftskaempfeRepository } from '../../../../src/db/repositories/mannschaftskaempfeRepository.js';
import { wendeMannschaftsKaskadeAn } from '../../../../src/db/kaskaden/mannschaftsKaskade.js';

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

test('wendeMannschaftsKaskadeAn befüllt eine wartende Folge-Begegnung, sobald beide Vorbegegnungen beendet sind', async () => {
    const repo = await neuesRepository();
    const poolId = 'pool:1';

    const begegnungA = await repo.create({ pool_id: poolId, mannschaft1_id: 'mannschaft:1', mannschaft2_id: 'mannschaft:2', status: 'beendet', sieger_mannschaft_id: 'mannschaft:1' });
    const begegnungB = await repo.create({ pool_id: poolId, mannschaft1_id: 'mannschaft:3', mannschaft2_id: 'mannschaft:4', status: 'beendet', sieger_mannschaft_id: 'mannschaft:3' });
    const begegnungC = await repo.create({
        pool_id: poolId,
        mannschaft1_id: null, mannschaft2_id: null, status: 'angelegt',
        mannschaft1_quelle_kampf_id: begegnungA._id, mannschaft1_quelle_typ: 'sieger',
        mannschaft2_quelle_kampf_id: begegnungB._id, mannschaft2_quelle_typ: 'sieger'
    });

    await wendeMannschaftsKaskadeAn(repo, poolId);

    const aktualisiert = await repo.findById(begegnungC._id);
    assert.equal(aktualisiert.status, 'bereit');
    assert.equal(aktualisiert.mannschaft1_id, 'mannschaft:1');
    assert.equal(aktualisiert.mannschaft2_id, 'mannschaft:3');
});

test('wendeMannschaftsKaskadeAn kaskadiert über mehrere Runden hinweg, wenn Freilose entstehen', async () => {
    const repo = await neuesRepository();
    const poolId = 'pool:1';

    const begegnungA = await repo.create({ pool_id: poolId, mannschaft1_id: null, mannschaft2_id: null, status: 'freilos', sieger_mannschaft_id: null });
    const begegnungB = await repo.create({ pool_id: poolId, mannschaft1_id: 'mannschaft:1', mannschaft2_id: null, status: 'freilos', sieger_mannschaft_id: 'mannschaft:1' });
    const begegnungC = await repo.create({
        pool_id: poolId,
        mannschaft1_id: null, mannschaft2_id: null, status: 'angelegt',
        mannschaft1_quelle_kampf_id: begegnungA._id, mannschaft1_quelle_typ: 'sieger',
        mannschaft2_quelle_kampf_id: begegnungB._id, mannschaft2_quelle_typ: 'sieger'
    });
    const begegnungD = await repo.create({
        pool_id: poolId,
        mannschaft1_id: null, mannschaft2_id: 'mannschaft:5', status: 'angelegt',
        mannschaft1_quelle_kampf_id: begegnungC._id, mannschaft1_quelle_typ: 'sieger'
    });

    await wendeMannschaftsKaskadeAn(repo, poolId);

    const aktualisiertC = await repo.findById(begegnungC._id);
    assert.equal(aktualisiertC.status, 'freilos');
    assert.equal(aktualisiertC.sieger_mannschaft_id, 'mannschaft:1');

    const aktualisiertD = await repo.findById(begegnungD._id);
    assert.equal(aktualisiertD.status, 'bereit');
    assert.equal(aktualisiertD.mannschaft1_id, 'mannschaft:1');
    assert.equal(aktualisiertD.mannschaft2_id, 'mannschaft:5');
});

test('wendeMannschaftsKaskadeAn lässt bereits entschiedene Begegnungen unverändert', async () => {
    const repo = await neuesRepository();
    const poolId = 'pool:1';

    const begegnung = await repo.create({ pool_id: poolId, mannschaft1_id: 'mannschaft:1', mannschaft2_id: 'mannschaft:2', status: 'beendet', sieger_mannschaft_id: 'mannschaft:1' });

    const ergebnis = await wendeMannschaftsKaskadeAn(repo, poolId);

    assert.equal(ergebnis.length, 1);
    assert.equal(ergebnis[0].status, 'beendet');
    assert.equal(ergebnis[0].sieger_mannschaft_id, 'mannschaft:1');
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag bestätigen**

Run: `npm run test:unit`
Expected: FAIL — `Cannot find module '.../src/db/kaskaden/mannschaftsKaskade.js'`

- [ ] **Step 3: Implementieren**

`src/db/kaskaden/mannschaftsKaskade.js`:

```javascript
import { berechneMannschaftsPatches } from '../../shared/mannschaftsProgression.js';

// Pendant zu kaempfeKaskade.js auf Ebene der Mannschafts-Begegnungen statt der Einzelkämpfe --
// verbindet die reine mannschaftsProgression.js-Engine mit dem mannschaftskaempfeRepository.
export async function wendeMannschaftsKaskadeAn(mannschaftskaempfeRepository, poolId) {
    let begegnungen = await mannschaftskaempfeRepository.findByPool(poolId);
    let patches = berechneMannschaftsPatches(begegnungen);

    while (patches.length > 0) {
        for (const patch of patches) {
            const { id, ...aenderungen } = patch;
            await mannschaftskaempfeRepository.update(id, aenderungen);
        }
        begegnungen = await mannschaftskaempfeRepository.findByPool(poolId);
        patches = berechneMannschaftsPatches(begegnungen);
    }

    return begegnungen;
}
```

- [ ] **Step 4: Test ausführen, Erfolg bestätigen**

Run: `npm run test:unit`
Expected: PASS (3 neue Tests, insgesamt 64)

- [ ] **Step 5: Dokumentation ergänzen**

In `CLAUDE.md` im Abschnitt "Zentrale Architekturkonzepte", nach dem Punkt zu `src/db/` einen neuen Punkt ergänzen, der `src/db/kaskaden/` erklärt: verbindet die bereits dokumentierten, reinen `src/shared/`-Engines (`kampfProgression.js`, `mannschaftsProgression.js`) mit den jeweiligen CouchDB-Repositories nach demselben "Lade alles, berechne Patches, wende an, wiederhole"-Muster, das die Spec für den künftigen `_changes`-Feed-Listener vorsieht — der eigentliche Feed-Listener selbst ist noch nicht Teil dieser Schicht.

- [ ] **Step 6: Commit**

```bash
git add src/db/kaskaden/mannschaftsKaskade.js tests/unit/db/kaskaden/mannschaftsKaskade.test.js CLAUDE.md
git commit -m "feat: Mannschafts-Kaskaden-Dienst verbindet mannschaftsProgression.js mit mannschaftskaempfeRepository"
```

---

## Self-Review-Notizen

- **Spec-Abdeckung:** Deckt den Berechnungs-/Anwendungs-Teil der in der Spec beschriebenen Kaskaden-Logik ab. Der eigentliche `_changes`-Feed-Listener (der diese Funktionen automatisch bei jeder Dokumentänderung aufruft) ist bewusst ausgeklammert — er braucht eine echte oder simulierte laufende Änderungs-Feed-Infrastruktur und gehört in einen eigenen, späteren Plan.
- **Platzhalter-Scan:** Keine TBD/TODO-Stellen. Beide Test-Szenarien (einfache Kaskade, Mehrrunden-Freilos-Kaskade) sind aus der tatsächlichen Logik von `kampfProgression.js`/`mannschaftsProgression.js` hergeleitet, nicht geraten.
- **Typ-Konsistenz:** `wendeKaempfeKaskadeAn(kaempfeRepository, poolId)` und `wendeMannschaftsKaskadeAn(mannschaftskaempfeRepository, poolId)` folgen identischer Signatur- und Implementierungsstruktur; beide geben das finale Array zurück.
