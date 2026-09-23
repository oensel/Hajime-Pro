# Jeder-gegen-Jeden Pool-Initialisierung Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CouchDB-Äquivalent von `src/services/JederGegenJedenManager.js` (`initialisierePool`, `aktualisiereTurnier`) — dem einfachsten der acht `*Manager.js`-Pool-Anlage-Services, da er (anders als die Doppel-KO-Systeme und Gruppen-Überkreuz) keine Bracket-Verknüpfung braucht: alle Paarungen stehen von Anfang an fest, es gibt keine Freilos-Sonderregel (ab 2 Teilnehmern kämpft niemand aus) und keinen Aufruf von `bracketTopologie.js`. Das ist der erste von acht Pool-Anlage-Services, die CouchDB-Pendants brauchen (siehe Self-Review-Notizen im vorherigen Plan `2026-09-23-bracket-verknuepfung.md`); die übrigen sieben (DoppelKo8/16/32, GruppenÜberkreuz, drei Mannschafts-Varianten) sind bewusst NICHT Teil dieses Plans, da jeder eine eigene Freilos-/Topologie-/Randfall-Logik hat, die einzeln recherchiert und übertragen werden muss. Vollständig getestet, weiterhin **nicht** in `src/app.js`/`src/routes/`/`src/controllers/` verdrahtet.

**Architecture:** Eine neue Kaskaden-Datei `src/db/kaskaden/jederGegenJedenPoolKaskade.js` mit zwei Funktionen (`initialisierePool`, `aktualisiereTurnier`), die exakt die Insert-/Update-Logik des knex-Originals auf `kaempfeRepository`/`turnierTeilnehmerRepository`/`poolsRepository` übertragen (`id` → `_id`, `knex('tabelle').insert(...)` → `repository.create(...)` pro Zeile, `knex('tabelle').where({pool_id}).update(...)` → `repository.update(id, patch)`). Da `turnierTeilnehmerRepository.js` bisher nur `findAll()` anbietet (kein Konsument brauchte bisher eine Pool-Filterung), braucht es zuerst eine `findByPool(poolId)`-Erweiterung (Task 1), analog zur bereits bestehenden `findByPool`-Methode in `kaempfeRepository.js`/`mannschaftenRepository.js`.

**Tech Stack:** Kein neuer Dependency-Bedarf.

**Spec:** [docs/superpowers/specs/2026-09-22-couchdb-pouchdb-migration-design.md](../specs/2026-09-22-couchdb-pouchdb-migration-design.md)

## Global Constraints

- ESM-Only — `import`/`export`, kein `require`.
- Keine Kommentare, die nur wiederholen, was der Code schon sagt.
- Genau EIN `startTestCouchServer()`-Aufruf pro Testdatei via `before()`/`after()`.
- `src/services/JederGegenJedenManager.js` wird **nicht** verändert — er bleibt für den bestehenden Knex-Pfad bestehen, bis ein künftiger Cutover-Plan ihn ablöst.
- `reihenfolge_nummer` bleibt hier bewusst **numerisch** (`idx + 1`, kein String-Cast) — anders als bei den Doppel-KO-Systemen (`'H1'`, `'F'`, …) und anders als beim Mannschafts-Pendant (`String(idx+1)`), exakt wie im knex-Original. Das ist eine bewusste Inkonsistenz im bestehenden Datenmodell, kein Fehler dieses Plans — sie wird hier nur unverändert übernommen, nicht bereinigt.
- Diese Schicht wird in diesem Plan **nicht** in `src/app.js`, `src/routes/` oder `src/controllers/` verdrahtet.

---

### Task 1: `turnierTeilnehmerRepository` um `findByPool` erweitern

**Files:**
- Modify: `src/db/repositories/turnierTeilnehmerRepository.js`
- Modify: `tests/unit/db/repositories/turnierTeilnehmerRepository.test.js`

**Interfaces:**
- Produces: `findByPool(poolId): Promise<Array<Object>>` — zusätzlich zur bestehenden `findAll()`.

- [ ] **Step 1: Failing Test schreiben**

In `tests/unit/db/repositories/turnierTeilnehmerRepository.test.js` nach dem bestehenden `findAll`-Test ergänzen:

```javascript
test('findByPool liefert nur Teilnehmer des angegebenen Pools', async () => {
    const repo = await neuesRepository();
    await repo.create({ pool_id: 'pool:1', nachname: 'ImPool' });
    await repo.create({ pool_id: 'pool:2', nachname: 'AndererPool' });
    await repo.create({ nachname: 'NochNichtZugeordnet' });

    const gefunden = await repo.findByPool('pool:1');

    assert.deepEqual(gefunden.map(t => t.nachname), ['ImPool']);
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag bestätigen**

Run: `npm run test:unit`
Expected: FAIL — `repo.findByPool is not a function`

- [ ] **Step 3: Implementieren**

In `src/db/repositories/turnierTeilnehmerRepository.js` ergänzen (nach `findAll`):

```javascript
    // Pool-Zuordnung erfolgt über turnier_teilnehmer.pool_id -- gebraucht von den
    // Pool-Anlage-Kaskaden (z.B. jederGegenJedenPoolKaskade.js), die nur die Teilnehmer
    // EINES Pools für die Paarungsbildung brauchen, nicht alle Teilnehmer des Turniers.
    async function findByPool(poolId) {
        const gefunden = await repo.query({ pool_id: poolId });
        return gefunden.sort((a, b) => a.created_at.localeCompare(b.created_at));
    }
```

Und in der Rückgabe ergänzen: `return { ...repo, create, findAll, findByPool };`

- [ ] **Step 4: Test ausführen, Erfolg bestätigen**

Run: `npm run test:unit`
Expected: PASS (1 neuer Test)

- [ ] **Step 5: Commit**

```bash
git add src/db/repositories/turnierTeilnehmerRepository.js tests/unit/db/repositories/turnierTeilnehmerRepository.test.js
git commit -m "feat: turnierTeilnehmerRepository um findByPool erweitern"
```

---

### Task 2: `jederGegenJedenPoolKaskade.js`

**Files:**
- Create: `src/db/kaskaden/jederGegenJedenPoolKaskade.js`
- Test: `tests/unit/db/kaskaden/jederGegenJedenPoolKaskade.test.js`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: `findByPool(poolId)` aus `turnierTeilnehmerRepository`; `create(data)`/`findByPool(poolId)` aus `kaempfeRepository`; `update(id, patch)` aus `poolsRepository`.
- Produces: `initialisierePool(kaempfeRepository, turnierTeilnehmerRepository, poolsRepository, poolId): Promise<void>`, `aktualisiereTurnier(kaempfeRepository, poolsRepository, poolId): Promise<void>`.

- [ ] **Step 1: Failing Tests schreiben**

`tests/unit/db/kaskaden/jederGegenJedenPoolKaskade.test.js`:

```javascript
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startTestCouchServer } from '../../helpers/couchTestServer.js';
import { connect, ensureDatabase } from '../../../../src/db/couch.js';
import { createKaempfeRepository } from '../../../../src/db/repositories/kaempfeRepository.js';
import { createTurnierTeilnehmerRepository } from '../../../../src/db/repositories/turnierTeilnehmerRepository.js';
import { createPoolsRepository } from '../../../../src/db/repositories/poolsRepository.js';
import { initialisierePool, aktualisiereTurnier } from '../../../../src/db/kaskaden/jederGegenJedenPoolKaskade.js';

let server;
let nano;

before(async () => {
    server = await startTestCouchServer();
    nano = connect(server.url);
});

after(async () => {
    await server.close();
});

async function neueRepositories() {
    const db = await ensureDatabase(nano, `test-${randomUUID()}`);
    return {
        kaempfeRepository: createKaempfeRepository(db),
        turnierTeilnehmerRepository: createTurnierTeilnehmerRepository(db),
        poolsRepository: createPoolsRepository(db)
    };
}

test('initialisierePool erzeugt bei 2 Teilnehmern genau einen Kampf', async () => {
    const { kaempfeRepository, turnierTeilnehmerRepository, poolsRepository } = await neueRepositories();
    const pool = await poolsRepository.create({});
    const t1 = await turnierTeilnehmerRepository.create({ pool_id: pool._id, gewicht: 70 });
    const t2 = await turnierTeilnehmerRepository.create({ pool_id: pool._id, gewicht: 80 });

    await initialisierePool(kaempfeRepository, turnierTeilnehmerRepository, poolsRepository, pool._id);

    const kaempfe = await kaempfeRepository.findByPool(pool._id);
    assert.equal(kaempfe.length, 1);
    assert.equal(kaempfe[0].reihenfolge_nummer, 1);
    assert.equal(kaempfe[0].kaempfer1_id, t1._id);
    assert.equal(kaempfe[0].kaempfer2_id, t2._id);
    assert.equal(kaempfe[0].status, 'bereit');
});

test('initialisierePool erzeugt bei 4 Teilnehmern 6 Kämpfe gemäß der festen Paarungstabelle', async () => {
    const { kaempfeRepository, turnierTeilnehmerRepository, poolsRepository } = await neueRepositories();
    const pool = await poolsRepository.create({});
    for (const gewicht of [60, 65, 70, 75]) {
        await turnierTeilnehmerRepository.create({ pool_id: pool._id, gewicht });
    }

    await initialisierePool(kaempfeRepository, turnierTeilnehmerRepository, poolsRepository, pool._id);

    const kaempfe = await kaempfeRepository.findByPool(pool._id);
    assert.equal(kaempfe.length, 6);
    assert.deepEqual(kaempfe.map(k => k.reihenfolge_nummer), [1, 2, 3, 4, 5, 6]);
});

test('initialisierePool schließt den Pool bei genau 1 Teilnehmer direkt ab, ohne Kämpfe anzulegen', async () => {
    const { kaempfeRepository, turnierTeilnehmerRepository, poolsRepository } = await neueRepositories();
    const pool = await poolsRepository.create({});
    await turnierTeilnehmerRepository.create({ pool_id: pool._id, gewicht: 70 });

    await initialisierePool(kaempfeRepository, turnierTeilnehmerRepository, poolsRepository, pool._id);

    const kaempfe = await kaempfeRepository.findByPool(pool._id);
    assert.equal(kaempfe.length, 0);
    const aktualisierterPool = await poolsRepository.findById(pool._id);
    assert.equal(aktualisierterPool.status, 'abgeschlossen');
});

test('initialisierePool legt bei 0 Teilnehmern keine Kämpfe an und lässt den Pool unverändert', async () => {
    const { kaempfeRepository, turnierTeilnehmerRepository, poolsRepository } = await neueRepositories();
    const pool = await poolsRepository.create({ status: 'geplant' });

    await initialisierePool(kaempfeRepository, turnierTeilnehmerRepository, poolsRepository, pool._id);

    const kaempfe = await kaempfeRepository.findByPool(pool._id);
    assert.equal(kaempfe.length, 0);
    const unveraenderterPool = await poolsRepository.findById(pool._id);
    assert.equal(unveraenderterPool.status, 'geplant');
});

test('aktualisiereTurnier setzt den Pool-Status auf kaempfe_beendet, wenn alle Kämpfe beendet sind', async () => {
    const { kaempfeRepository, poolsRepository } = await neueRepositories();
    const pool = await poolsRepository.create({});
    const kampf = await kaempfeRepository.create({ pool_id: pool._id, reihenfolge_nummer: 1, status: 'bereit' });
    await kaempfeRepository.update(kampf._id, { status: 'beendet' });

    await aktualisiereTurnier(kaempfeRepository, poolsRepository, pool._id);

    const aktualisierterPool = await poolsRepository.findById(pool._id);
    assert.equal(aktualisierterPool.status, 'kaempfe_beendet');
});

test('aktualisiereTurnier lässt den Pool unverändert, solange nicht alle Kämpfe beendet sind', async () => {
    const { kaempfeRepository, poolsRepository } = await neueRepositories();
    const pool = await poolsRepository.create({});
    await kaempfeRepository.create({ pool_id: pool._id, reihenfolge_nummer: 1, status: 'bereit' });

    await aktualisiereTurnier(kaempfeRepository, poolsRepository, pool._id);

    const unveraenderterPool = await poolsRepository.findById(pool._id);
    assert.equal(unveraenderterPool.status, undefined);
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag bestätigen**

Run: `npm run test:unit`
Expected: FAIL — `Cannot find module '.../src/db/kaskaden/jederGegenJedenPoolKaskade.js'`

- [ ] **Step 3: Implementieren**

`src/db/kaskaden/jederGegenJedenPoolKaskade.js`:

```javascript
// CouchDB-Pendant zu JederGegenJedenManager.initialisierePool/aktualisiereTurnier aus
// src/services/JederGegenJedenManager.js -- dort direkt knex-gebunden, hier über die
// jeweiligen Repositories. Anders als bei den Doppel-KO-Systemen gibt es hier keine
// Bracket-Verknüpfung: alle Paarungen stehen von Anfang an fest.
function ermittlePaarungen(n) {
    if (n === 2) return [[0, 1]];
    if (n === 3) return [[0, 1], [0, 2], [1, 2]];
    if (n === 4) return [[0, 1], [2, 3], [0, 3], [1, 2], [0, 2], [1, 3]];
    if (n === 5) {
        return [
            [0, 1], [2, 3], [1, 2], [3, 4], [0, 2],
            [1, 4], [0, 3], [2, 4], [0, 4], [1, 3]
        ];
    }
    const paarungen = [];
    for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
            paarungen.push([i, j]);
        }
    }
    return paarungen;
}

export async function initialisierePool(kaempfeRepository, turnierTeilnehmerRepository, poolsRepository, poolId) {
    const teilnehmer = await turnierTeilnehmerRepository.findByPool(poolId);
    teilnehmer.sort((a, b) => Number(a.gewicht) - Number(b.gewicht));

    if (teilnehmer.length < 1) return;

    // Genau 1 Teilnehmer -> Kampflos, Pool direkt abgeschlossen ohne Zwischenschritt.
    if (teilnehmer.length === 1) {
        await poolsRepository.update(poolId, { status: 'abgeschlossen' });
        return;
    }

    const paarungen = ermittlePaarungen(teilnehmer.length);

    for (let idx = 0; idx < paarungen.length; idx++) {
        const [i, j] = paarungen[idx];
        await kaempfeRepository.create({
            pool_id: poolId,
            status: 'bereit',
            reihenfolge_nummer: idx + 1,
            kaempfer1_id: teilnehmer[i]._id,
            kaempfer2_id: teilnehmer[j]._id,
            sieger_id: null,
            kampfzeit_in_sekunden: 0,
            unterbewertung_kaempfer1: 0,
            unterbewertung_kaempfer2: 0
        });
    }

    await aktualisiereTurnier(kaempfeRepository, poolsRepository, poolId);
}

export async function aktualisiereTurnier(kaempfeRepository, poolsRepository, poolId) {
    const kaempfe = await kaempfeRepository.findByPool(poolId);
    if (kaempfe.length === 0) return;

    const alleBeendet = kaempfe.every(kampf => kampf.status === 'beendet');
    if (alleBeendet) {
        await poolsRepository.update(poolId, { status: 'kaempfe_beendet' });
    }
}
```

- [ ] **Step 4: Test ausführen, Erfolg bestätigen**

Run: `npm run test:unit`
Expected: PASS (6 neue Tests seit Task 1, insgesamt 82)

- [ ] **Step 5: Dokumentation ergänzen**

In `CLAUDE.md` im Abschnitt "Zentrale Architekturkonzepte", im Punkt zu `src/db/kaskaden/`, `jederGegenJedenPoolKaskade.js` als viertes Modul ergänzen — CouchDB-Pendant zu `JederGegenJedenManager.js` (Pool-Anlage: Paarungsbildung + initialer Kämpfe-Insert + Abschlussprüfung), erstes von acht `*Manager.js`-Pendants, die übrigen sieben (Doppel-KO-8/16/32, Gruppen-Überkreuz, drei Mannschafts-Varianten) folgen in künftigen Plänen.

- [ ] **Step 6: Commit**

```bash
git add src/db/kaskaden/jederGegenJedenPoolKaskade.js tests/unit/db/kaskaden/jederGegenJedenPoolKaskade.test.js CLAUDE.md
git commit -m "feat: CouchDB-Pendant zu JederGegenJedenManager (Pool-Initialisierung)"
```

---

## Self-Review-Notizen

- **Spec-Abdeckung:** Deckt genau eines von acht Pool-Anlage-Services ab (das einfachste: keine Bracket-Verknüpfung, keine Freilos-Sonderregel). Die übrigen sieben (Doppel-KO-8/16/32, Gruppen-Überkreuz mit ihrer eigenen `gruppenUeberkreuzProgression.js`-Engine, drei Mannschafts-Varianten mit Abhängigkeit auf die noch nicht migrierte `mannschaftsBegegnungEngine.js`) sind bewusst NICHT Teil dieses Plans — jeder verdient einen eigenen, einzeln recherchierten Plan wegen unterschiedlicher Freilos-/Topologie-/Randfall-Logik.
- **Platzhalter-Scan:** Keine TBD/TODO-Stellen. `pool`-Read aus dem Original (Zeile 14 in `JederGegenJedenManager.js`, ungenutzt) wird bewusst nicht übernommen, da sein Rückgabewert im Original nirgends verwendet wird.
- **Typ-Konsistenz:** `reihenfolge_nummer` bleibt numerisch (`idx+1`), exakt wie im knex-Original — siehe Global Constraints.
- **Randfall-Abdeckung:** Alle drei Verzweigungen des Originals (0 Teilnehmer, 1 Teilnehmer, ≥2 Teilnehmer) sind durch je einen eigenen Test abgedeckt, plus zwei Tests für `aktualisiereTurnier`s Abschlussprüfung.
