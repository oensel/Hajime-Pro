# Mannschaft-Jeder-gegen-Jeden Pool-Initialisierung Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CouchDB-Äquivalent der Begegnungs-ERZEUGUNG aus `src/services/MannschaftJederGegenJedenManager.js` — dem Team-Pendant zu `JederGegenJedenManager.js` (bereits migriert, siehe `docs/superpowers/plans/2026-09-23-jgj-pool-initialisierung.md`). Gleiche Paarungstabellen wie beim Einzel-Pendant, aber Mannschaften statt Teilnehmer (sortiert nach Anmeldereihenfolge statt Gewicht, da Mannschaften kein Gewicht haben) und `mannschaftskaempfe` statt `kaempfe` als Zieltabelle.

**Bewusste Scope-Grenze:** Das Original delegiert seine `aktualisiereTurnier`-Methode komplett an `aktualisiereMannschaftsPool` aus `src/services/mannschaftsBegegnungEngine.js` (lädt Pool+Begegnungen, wendet `mannschaftsProgression.js` an, erzeugt bei `status:'bereit'` gewordenen Begegnungen automatisch die zugehörigen Einzelkämpfe je Gewichtsklasse, wertet abgeschlossene Begegnungen aus inkl. automatischem Stichkampf bei vollständigem Gleichstand, schließt den Pool ab). Diese Engine ist selbst noch nicht CouchDB-migriert und deutlich umfangreicher als die reine Begegnungs-Erzeugung — ihre Migration ist bewusst NICHT Teil dieses Plans, sondern ein eigener, größerer künftiger Schritt (analog dazu, wie der `bracket-verknuepfung`-Plan die Kampf-Erzeugung selbst ausgeklammert hat). Dieser Plan deckt daher ausschließlich `initialisierePool`s Begegnungs-Erzeugung ab — ohne den abschließenden `aktualisiereTurnier`-Aufruf, der im Original direkt danach folgt.

Vollständig getestet, weiterhin **nicht** in `src/app.js`/`src/routes/`/`src/controllers/` verdrahtet.

**Architecture:** Eine neue Kaskaden-Datei `src/db/kaskaden/mannschaftJederGegenJedenPoolKaskade.js` mit einer Funktion (`initialisierePool`), die die Begegnungs-Erzeugungs-Logik des knex-Originals auf `mannschaftenRepository`/`mannschaftskaempfeRepository`/`poolsRepository` überträgt. Alle drei benötigten Repository-Methoden (`mannschaftenRepository.findByPool`, `mannschaftskaempfeRepository.findByPool`/`.create`, `poolsRepository.update`/`.findById`) existieren bereits — keine Repository-Erweiterung nötig.

**Tech Stack:** Kein neuer Dependency-Bedarf.

**Spec:** [docs/superpowers/specs/2026-09-22-couchdb-pouchdb-migration-design.md](../specs/2026-09-22-couchdb-pouchdb-migration-design.md)

## Global Constraints

- ESM-Only — `import`/`export`, kein `require`.
- Keine Kommentare, die nur wiederholen, was der Code schon sagt.
- Genau EIN `startTestCouchServer()`-Aufruf pro Testdatei via `before()`/`after()`.
- `src/services/MannschaftJederGegenJedenManager.js` und `src/services/mannschaftsBegegnungEngine.js` werden **nicht** verändert.
- `reihenfolge_nummer` wird hier als **String** gesetzt (`String(idx+1)`), exakt wie im knex-Original — anders als beim Einzel-Pendant, wo sie numerisch bleibt (bereits im vorherigen Plan als bestehende Inkonsistenz im Datenmodell dokumentiert, hier nur unverändert übernommen).
- `aktualisiereTurnier`/`aktualisiereMannschaftsPool` wird in diesem Plan **nicht** portiert (siehe „Bewusste Scope-Grenze" oben) — `initialisierePool` endet nach dem Begegnungs-Insert, ohne den entsprechenden Aufruf.
- Diese Schicht wird in diesem Plan **nicht** in `src/app.js`, `src/routes/` oder `src/controllers/` verdrahtet.

---

### Task 1: `mannschaftJederGegenJedenPoolKaskade.js`

**Files:**
- Create: `src/db/kaskaden/mannschaftJederGegenJedenPoolKaskade.js`
- Test: `tests/unit/db/kaskaden/mannschaftJederGegenJedenPoolKaskade.test.js`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: `findByPool(poolId)` aus `mannschaftenRepository`; `create(data)`/`findByPool(poolId)` aus `mannschaftskaempfeRepository`; `update(id, patch)`/`findById(id)` aus `poolsRepository`.
- Produces: `initialisierePool(mannschaftskaempfeRepository, mannschaftenRepository, poolsRepository, poolId): Promise<void>`.

- [ ] **Step 1: Failing Tests schreiben**

`tests/unit/db/kaskaden/mannschaftJederGegenJedenPoolKaskade.test.js`:

```javascript
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startTestCouchServer } from '../../helpers/couchTestServer.js';
import { connect, ensureDatabase } from '../../../../src/db/couch.js';
import { createMannschaftskaempfeRepository } from '../../../../src/db/repositories/mannschaftskaempfeRepository.js';
import { createMannschaftenRepository } from '../../../../src/db/repositories/mannschaftenRepository.js';
import { createPoolsRepository } from '../../../../src/db/repositories/poolsRepository.js';
import { initialisierePool } from '../../../../src/db/kaskaden/mannschaftJederGegenJedenPoolKaskade.js';

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
        mannschaftskaempfeRepository: createMannschaftskaempfeRepository(db),
        mannschaftenRepository: createMannschaftenRepository(db),
        poolsRepository: createPoolsRepository(db)
    };
}

test('initialisierePool erzeugt bei 2 Mannschaften genau eine Begegnung', async () => {
    const { mannschaftskaempfeRepository, mannschaftenRepository, poolsRepository } = await neueRepositories();
    const pool = await poolsRepository.create({});
    const m1 = await mannschaftenRepository.create({ pool_id: pool._id, verein: 'Team A' });
    const m2 = await mannschaftenRepository.create({ pool_id: pool._id, verein: 'Team B' });

    await initialisierePool(mannschaftskaempfeRepository, mannschaftenRepository, poolsRepository, pool._id);

    const begegnungen = await mannschaftskaempfeRepository.findByPool(pool._id);
    assert.equal(begegnungen.length, 1);
    assert.equal(begegnungen[0].reihenfolge_nummer, '1');
    assert.equal(begegnungen[0].mannschaft1_id, m1._id);
    assert.equal(begegnungen[0].mannschaft2_id, m2._id);
    assert.equal(begegnungen[0].status, 'bereit');
    assert.equal(begegnungen[0].sieger_mannschaft_id, null);
});

test('initialisierePool erzeugt bei 4 Mannschaften 6 Begegnungen gemäß der festen Paarungstabelle', async () => {
    const { mannschaftskaempfeRepository, mannschaftenRepository, poolsRepository } = await neueRepositories();
    const pool = await poolsRepository.create({});
    const mannschaften = {};
    for (const name of ['A', 'B', 'C', 'D']) {
        mannschaften[name] = await mannschaftenRepository.create({ pool_id: pool._id, verein: `Team ${name}` });
    }

    await initialisierePool(mannschaftskaempfeRepository, mannschaftenRepository, poolsRepository, pool._id);

    const begegnungen = await mannschaftskaempfeRepository.findByPool(pool._id);
    assert.equal(begegnungen.length, 6);
    assert.deepEqual(begegnungen.map(b => b.reihenfolge_nummer), ['1', '2', '3', '4', '5', '6']);

    // Feste Paarungstabelle für n=4 (0-indiziert nach Anmeldereihenfolge): [0,1],[2,3],[0,3],[1,2],[0,2],[1,3]
    const erwartetePaare = [['A', 'B'], ['C', 'D'], ['A', 'D'], ['B', 'C'], ['A', 'C'], ['B', 'D']];
    assert.deepEqual(
        begegnungen.map(b => [b.mannschaft1_id, b.mannschaft2_id]),
        erwartetePaare.map(([n1, n2]) => [mannschaften[n1]._id, mannschaften[n2]._id])
    );
});

test('initialisierePool schließt den Pool bei genau 1 Mannschaft direkt ab, ohne Begegnungen anzulegen', async () => {
    const { mannschaftskaempfeRepository, mannschaftenRepository, poolsRepository } = await neueRepositories();
    const pool = await poolsRepository.create({});
    await mannschaftenRepository.create({ pool_id: pool._id, verein: 'Team A' });

    await initialisierePool(mannschaftskaempfeRepository, mannschaftenRepository, poolsRepository, pool._id);

    const begegnungen = await mannschaftskaempfeRepository.findByPool(pool._id);
    assert.equal(begegnungen.length, 0);
    const aktualisierterPool = await poolsRepository.findById(pool._id);
    assert.equal(aktualisierterPool.status, 'abgeschlossen');
});

test('initialisierePool legt bei 0 Mannschaften keine Begegnungen an und lässt den Pool unverändert', async () => {
    const { mannschaftskaempfeRepository, mannschaftenRepository, poolsRepository } = await neueRepositories();
    const pool = await poolsRepository.create({ status: 'geplant' });

    await initialisierePool(mannschaftskaempfeRepository, mannschaftenRepository, poolsRepository, pool._id);

    const begegnungen = await mannschaftskaempfeRepository.findByPool(pool._id);
    assert.equal(begegnungen.length, 0);
    const unveraenderterPool = await poolsRepository.findById(pool._id);
    assert.equal(unveraenderterPool.status, 'geplant');
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag bestätigen**

Run: `npm run test:unit`
Expected: FAIL — `Cannot find module '.../src/db/kaskaden/mannschaftJederGegenJedenPoolKaskade.js'`

- [ ] **Step 3: Implementieren**

`src/db/kaskaden/mannschaftJederGegenJedenPoolKaskade.js`:

```javascript
// CouchDB-Pendant zur Begegnungs-ERZEUGUNG aus MannschaftJederGegenJedenManager.initialisierePool
// (src/services/MannschaftJederGegenJedenManager.js) -- dort direkt knex-gebunden, hier über die
// jeweiligen Repositories. Der anschließende aktualisiereTurnier-Aufruf des Originals delegiert an
// mannschaftsBegegnungEngine.js (Einzelkampf-Erzeugung je Gewichtsklasse, Stichkampf-Logik,
// Pool-Abschluss) -- diese Engine ist selbst noch nicht migriert und bewusst NICHT Teil dieser
// Kaskade; initialisierePool endet hier nach dem Begegnungs-Insert.
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

export async function initialisierePool(mannschaftskaempfeRepository, mannschaftenRepository, poolsRepository, poolId) {
    const mannschaften = await mannschaftenRepository.findByPool(poolId);

    if (mannschaften.length < 1) return;

    // Genau 1 Mannschaft -> Kampflos, Pool direkt abgeschlossen ohne Begegnung.
    if (mannschaften.length === 1) {
        await poolsRepository.update(poolId, { status: 'abgeschlossen' });
        return;
    }

    const paarungen = ermittlePaarungen(mannschaften.length);

    for (let idx = 0; idx < paarungen.length; idx++) {
        const [i, j] = paarungen[idx];
        await mannschaftskaempfeRepository.create({
            pool_id: poolId,
            status: 'bereit',
            reihenfolge_nummer: String(idx + 1),
            mannschaft1_id: mannschaften[i]._id,
            mannschaft2_id: mannschaften[j]._id,
            sieger_mannschaft_id: null
        });
    }
}
```

- [ ] **Step 4: Test ausführen, Erfolg bestätigen**

Run: `npm run test:unit`
Expected: PASS (4 neue Tests, insgesamt 86)

- [ ] **Step 5: Dokumentation ergänzen**

In `CLAUDE.md` im Abschnitt "Zentrale Architekturkonzepte", im Punkt zu `src/db/kaskaden/`, `mannschaftJederGegenJedenPoolKaskade.js` als fünftes Modul ergänzen — CouchDB-Pendant zur Begegnungs-Erzeugung aus `MannschaftJederGegenJedenManager.js`, zweites von acht `*Manager.js`-Pendants; explizit erwähnen, dass die anschließende Auswertungs-/Einzelkampf-Erzeugungs-Engine (`mannschaftsBegegnungEngine.js`) bewusst noch nicht Teil dieser Kaskade ist.

- [ ] **Step 6: Commit**

```bash
git add src/db/kaskaden/mannschaftJederGegenJedenPoolKaskade.js tests/unit/db/kaskaden/mannschaftJederGegenJedenPoolKaskade.test.js CLAUDE.md
git commit -m "feat: CouchDB-Pendant zur Begegnungs-Erzeugung aus MannschaftJederGegenJedenManager"
```

---

## Self-Review-Notizen

- **Spec-Abdeckung:** Deckt ausschließlich die Begegnungs-ERZEUGUNG ab (zweites von acht Pool-Anlage-Services). Die Auswertungs-Engine `mannschaftsBegegnungEngine.js` (Einzelkampf-Erzeugung je Gewichtsklasse, Stichkampf, Pool-Abschluss) ist bewusst NICHT Teil dieses Plans — eigener, deutlich größerer künftiger Schritt, da sie selbst noch nicht CouchDB-migriert ist und `mannschaftsProgression.js` (bereits migriert, siehe `mannschaftsKaskade.js`) nur einen Teil ihrer Logik abdeckt.
- **Platzhalter-Scan:** Keine TBD/TODO-Stellen.
- **Typ-Konsistenz:** `reihenfolge_nummer` bleibt String (`String(idx+1)`), exakt wie im knex-Original — siehe Global Constraints.
- **Randfall-Abdeckung:** Alle drei Verzweigungen des Originals (0/1/≥2 Mannschaften) sind durch je einen eigenen Test abgedeckt; der n=4-Fall prüft explizit die tatsächlichen Paarungs-Werte (nicht nur Anzahl/Reihenfolge), wie im Review des vorherigen Plans (`jgj-pool-initialisierung`) für die Einzel-Variante nachträglich ergänzt.
