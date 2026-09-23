# Mannschaft-Doppel-KO-16 Pool-Initialisierung Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CouchDB-Äquivalent der Begegnungs-ERZEUGUNG aus `src/services/MannschaftDoppelKo16Manager.js` — das ACHTE und letzte der acht `*Manager.js`-Pool-Anlage-Services. Strukturell identisch zum bereits migrierten `mannschaftDoppelKo8PoolKaskade.js` (siehe `docs/superpowers/plans/2026-09-24-mannschaft-doppelko8-pool-initialisierung.md`), nur mit doppelter Rastergröße (16), eigenen Freilos-Indices und der größeren `DOPPEL_KO_16_TOPOLOGIE` (19 statt 7 Hüllen-Begegnungen).

**Bewusste Scope-Grenze:** Wie bei allen bisherigen Mannschafts-Pendants delegiert `aktualisiereTurnier` im Original komplett an `aktualisiereMannschaftsPool` aus `src/services/mannschaftsBegegnungEngine.js` — diese Engine ist selbst noch nicht CouchDB-migriert. Ihre Migration ist bewusst NICHT Teil dieses Plans. Dieser Plan deckt daher ausschließlich `initialisierePool`s Begegnungs-Erzeugung ab — ohne den abschließenden `aktualisiereTurnier`-Aufruf.

Vollständig getestet, weiterhin **nicht** in `src/app.js`/`src/routes/`/`src/controllers/` verdrahtet.

**Architecture:** Eine neue Kaskaden-Datei `src/db/kaskaden/mannschaftDoppelKo16PoolKaskade.js`, strukturell analog zu `mannschaftDoppelKo8PoolKaskade.js`: gleiche Cursor-basierte Rasterbefüllung ohne Vereinstrennung, andere Rastergröße/Freilos-Indices/Hüllen-Liste.

**Tech Stack:** Kein neuer Dependency-Bedarf.

**Spec:** [docs/superpowers/specs/2026-09-22-couchdb-pouchdb-migration-design.md](../specs/2026-09-22-couchdb-pouchdb-migration-design.md)

## Global Constraints

- ESM-Only — `import`/`export`, kein `require`.
- Keine Kommentare, die nur wiederholen, was der Code schon sagt.
- Genau EIN `startTestCouchServer()`-Aufruf pro Testdatei via `before()`/`after()`.
- `src/services/MannschaftDoppelKo16Manager.js` und `src/services/mannschaftsBegegnungEngine.js` werden **nicht** verändert.
- Keine Vereinstrennung/Gewichtssortierung, keine `unterbewertung_kaempferN`-Felder — exakt wie beim 8er-Mannschafts-Pendant.
- `reihenfolge_nummer` bleibt String (`'H1'`, `'F1'`, …), exakt wie im Original.
- Freilos-Indices sind `[15, 0, 8, 7, 4, 11, 12, 3]` (identisch zum Einzelwettkampf-16er-Pendant, rein bracket-strukturell).
- `aktualisiereTurnier`/`aktualisiereMannschaftsPool` wird in diesem Plan **nicht** portiert.
- Diese Schicht wird in diesem Plan **nicht** in `src/app.js`, `src/routes/` oder `src/controllers/` verdrahtet.

---

### Task 1: `mannschaftDoppelKo16PoolKaskade.js`

**Files:**
- Create: `src/db/kaskaden/mannschaftDoppelKo16PoolKaskade.js`
- Test: `tests/unit/db/kaskaden/mannschaftDoppelKo16PoolKaskade.test.js`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: `findByPool(poolId)` aus `mannschaftenRepository`; `create(data)`/`findByPool(poolId)`/`update(id,patch)` aus `mannschaftskaempfeRepository`; `verknuepfeQuellenFuerMannschaftsPool` aus `./bracketVerknuepfung.js`; `DOPPEL_KO_16_TOPOLOGIE` aus `../../shared/bracketTopologie.js`.
- Produces: `initialisierePool(mannschaftskaempfeRepository, mannschaftenRepository, poolId): Promise<void>`.

- [ ] **Step 1: Failing Tests schreiben**

`tests/unit/db/kaskaden/mannschaftDoppelKo16PoolKaskade.test.js`:

```javascript
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startTestCouchServer } from '../../helpers/couchTestServer.js';
import { connect, ensureDatabase } from '../../../../src/db/couch.js';
import { createMannschaftskaempfeRepository } from '../../../../src/db/repositories/mannschaftskaempfeRepository.js';
import { createMannschaftenRepository } from '../../../../src/db/repositories/mannschaftenRepository.js';
import { initialisierePool } from '../../../../src/db/kaskaden/mannschaftDoppelKo16PoolKaskade.js';

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
        mannschaftenRepository: createMannschaftenRepository(db)
    };
}

test('initialisierePool füllt bei 16 Mannschaften das Raster in Anmeldereihenfolge ohne Freilose', async () => {
    const { mannschaftskaempfeRepository, mannschaftenRepository } = await neueRepositories();
    const m = [];
    for (let i = 0; i < 16; i++) {
        m.push(await mannschaftenRepository.create({ pool_id: 'pool:1', verein: `Team ${i + 1}` }));
    }

    await initialisierePool(mannschaftskaempfeRepository, mannschaftenRepository, 'pool:1');

    const begegnungen = await mannschaftskaempfeRepository.findByPool('pool:1');
    assert.equal(begegnungen.length, 27);
    const byReihenfolge = Object.fromEntries(begegnungen.map(b => [b.reihenfolge_nummer, b]));

    const erwartetePaare = [[0, 1], [2, 3], [4, 5], [6, 7], [8, 9], [10, 11], [12, 13], [14, 15]];
    erwartetePaare.forEach(([i, j], idx) => {
        const h = byReihenfolge[`H${idx + 1}`];
        assert.equal(h.mannschaft1_id, m[i]._id, `H${idx + 1} mannschaft1`);
        assert.equal(h.mannschaft2_id, m[j]._id, `H${idx + 1} mannschaft2`);
        assert.equal(h.status, 'bereit');
    });

    const huellenReihenfolgeNummern = [
        'H9', 'H10', 'H11', 'H12', 'T1', 'T2', 'T3', 'T4',
        'H13', 'H14', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10',
        'F1', 'T11', 'T12'
    ];
    assert.equal(huellenReihenfolgeNummern.length, 19);
    for (const nr of huellenReihenfolgeNummern) {
        assert.equal(byReihenfolge[nr].status, 'angelegt');
        assert.equal(byReihenfolge[nr].mannschaft1_id, null);
    }

    // verknuepfeQuellenFuerMannschaftsPool wurde aufgerufen.
    assert.equal(byReihenfolge.H9.mannschaft1_quelle_kampf_id, byReihenfolge.H1._id);
    assert.equal(byReihenfolge.H9.mannschaft1_quelle_typ, 'sieger');
    assert.equal(byReihenfolge.H9.mannschaft2_quelle_kampf_id, byReihenfolge.H2._id);
    assert.equal(byReihenfolge.F1.mannschaft1_quelle_kampf_id, byReihenfolge.H13._id);
});

test('initialisierePool weist Freilose an den korrekten 16er-Rasterpositionen zu, ohne unterbewertung-Felder', async () => {
    const { mannschaftskaempfeRepository, mannschaftenRepository } = await neueRepositories();
    const m1 = await mannschaftenRepository.create({ pool_id: 'pool:1', verein: 'Team A' });
    const m2 = await mannschaftenRepository.create({ pool_id: 'pool:1', verein: 'Team B' });

    await initialisierePool(mannschaftskaempfeRepository, mannschaftenRepository, 'pool:1');

    const begegnungen = await mannschaftskaempfeRepository.findByPool('pool:1');
    const byReihenfolge = Object.fromEntries(begegnungen.map(b => [b.reihenfolge_nummer, b]));

    // Freilos-Indices [15,0,8,7,4,11,12,3] klemmen bei F=14 auf alle 8 -> Raster: [null,m1,m2,null,...,null]
    assert.equal(byReihenfolge.H1.status, 'freilos');
    assert.equal(byReihenfolge.H1.mannschaft1_id, null);
    assert.equal(byReihenfolge.H1.mannschaft2_id, m1._id);
    assert.equal(byReihenfolge.H1.sieger_mannschaft_id, m1._id);
    assert.equal(byReihenfolge.H1.unterbewertung_kaempfer1, undefined);

    assert.equal(byReihenfolge.H2.status, 'freilos');
    assert.equal(byReihenfolge.H2.mannschaft1_id, m2._id);
    assert.equal(byReihenfolge.H2.mannschaft2_id, null);
    assert.equal(byReihenfolge.H2.sieger_mannschaft_id, m2._id);

    for (let i = 3; i <= 8; i++) {
        const h = byReihenfolge[`H${i}`];
        assert.equal(h.status, 'freilos', `H${i} status`);
        assert.equal(h.mannschaft1_id, null, `H${i} mannschaft1`);
        assert.equal(h.mannschaft2_id, null, `H${i} mannschaft2`);
        assert.equal(h.sieger_mannschaft_id, null, `H${i} sieger`);
    }
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag bestätigen**

Run: `npm run test:unit`
Expected: FAIL — `Cannot find module '.../src/db/kaskaden/mannschaftDoppelKo16PoolKaskade.js'`

- [ ] **Step 3: Implementieren**

`src/db/kaskaden/mannschaftDoppelKo16PoolKaskade.js`:

```javascript
import { DOPPEL_KO_16_TOPOLOGIE } from '../../shared/bracketTopologie.js';
import { verknuepfeQuellenFuerMannschaftsPool } from './bracketVerknuepfung.js';

// CouchDB-Pendant zur Begegnungs-ERZEUGUNG aus MannschaftDoppelKo16Manager.initialisierePool
// (src/services/MannschaftDoppelKo16Manager.js) -- strukturell identisch zu
// mannschaftDoppelKo8PoolKaskade.js, nur mit doppelter Rastergröße. Der anschließende
// aktualisiereTurnier-Aufruf des Originals delegiert an mannschaftsBegegnungEngine.js -- diese
// Engine ist selbst noch nicht migriert und bewusst NICHT Teil dieser Kaskade.
const RASTER_GROESSE = 16;
const FREILOS_INDICES = [15, 0, 8, 7, 4, 11, 12, 3];

export async function initialisierePool(mannschaftskaempfeRepository, mannschaftenRepository, poolId) {
    const mannschaften = await mannschaftenRepository.findByPool(poolId);
    const N = mannschaften.length;
    const F = Math.max(0, RASTER_GROESSE - N);
    const freilosSlots = new Set(FREILOS_INDICES.slice(0, F));

    const rasterListe = new Array(RASTER_GROESSE).fill(null);
    let cursor = 0;
    for (let slot = 0; slot < RASTER_GROESSE; slot++) {
        if (freilosSlots.has(slot)) continue;
        rasterListe[slot] = mannschaften[cursor++] || null;
    }

    for (let i = 0; i < rasterListe.length; i += 2) {
        const m1 = rasterListe[i];
        const m2 = rasterListe[i + 1];
        const begegnung = {
            pool_id: poolId,
            status: 'bereit',
            reihenfolge_nummer: `H${(i / 2) + 1}`,
            mannschaft1_id: m1 ? m1._id : null,
            mannschaft2_id: m2 ? m2._id : null,
            sieger_mannschaft_id: null
        };
        if (m1 === null && m2 === null) {
            begegnung.status = 'freilos';
        } else if (m1 === null || m2 === null) {
            const sieger = m1 || m2;
            begegnung.status = 'freilos';
            begegnung.sieger_mannschaft_id = sieger._id;
        }
        await mannschaftskaempfeRepository.create(begegnung);
    }

    const weitereRunden = [
        'H9', 'H10', 'H11', 'H12', 'T1', 'T2', 'T3', 'T4',
        'H13', 'H14', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10',
        'F1', 'T11', 'T12'
    ];
    for (const reihenfolgeNummer of weitereRunden) {
        await mannschaftskaempfeRepository.create({
            pool_id: poolId, status: 'angelegt', reihenfolge_nummer: reihenfolgeNummer,
            mannschaft1_id: null, mannschaft2_id: null, sieger_mannschaft_id: null
        });
    }

    await verknuepfeQuellenFuerMannschaftsPool(mannschaftskaempfeRepository, poolId, DOPPEL_KO_16_TOPOLOGIE);
}
```

- [ ] **Step 4: Test ausführen, Erfolg bestätigen**

Run: `npm run test:unit`
Expected: PASS (2 neue Tests, insgesamt 113)

- [ ] **Step 5: Dokumentation ergänzen**

In `CLAUDE.md` im Abschnitt "Zentrale Architekturkonzepte", im Punkt zu `src/db/kaskaden/`, `mannschaftDoppelKo16PoolKaskade.js` als zwölftes und LETZTES `*Manager.js`-Pendant-Modul ergänzen — CouchDB-Pendant zur Begegnungs-Erzeugung aus `MannschaftDoppelKo16Manager.js`, achtes und letztes von acht `*Manager.js`-Pendants. Explizit erwähnen, dass damit alle acht Pool-Anlage-Services ein CouchDB-Pendant haben (wenn auch bei den drei Mannschafts-Varianten ohne die noch nicht migrierte Auswertungs-Engine `mannschaftsBegegnungEngine.js`).

- [ ] **Step 6: Commit**

```bash
git add src/db/kaskaden/mannschaftDoppelKo16PoolKaskade.js tests/unit/db/kaskaden/mannschaftDoppelKo16PoolKaskade.test.js CLAUDE.md
git commit -m "feat: CouchDB-Pendant zur Begegnungs-Erzeugung aus MannschaftDoppelKo16Manager"
```

---

## Self-Review-Notizen

- **Spec-Abdeckung:** Deckt das achte und letzte von acht Pool-Anlage-Services ab. Damit ist die in `docs/superpowers/plans/2026-09-23-bracket-verknuepfung.md`s Self-Review-Notizen angekündigte „Pool-Anlage-Orchestrierung je Turniermodus" vollständig abgeschlossen — mit der einen wiederkehrenden, bewussten Ausnahme, dass die Mannschafts-Auswertungs-Engine (`mannschaftsBegegnungEngine.js`) bei allen drei Mannschafts-Pendants noch aussteht und einen eigenen, künftigen Migrations-Schritt braucht.
- **Platzhalter-Scan:** Keine TBD/TODO-Stellen.
- **Determinismus der Tests:** Beide Tests wurden von Hand exakt nach dem Original-Algorithmus nachvollzogen — insbesondere die Freilos-Klemmung (`FREILOS_INDICES.slice(0,14)` auf einem 8-elementigen Array) wurde Schritt für Schritt durchgerechnet, analog zur bereits im `doppelKo16PoolKaskade.js`-Plan bewährten Vorgehensweise.
- **Wiederverwendung:** `verknuepfeQuellenFuerMannschaftsPool` wird importiert statt neu implementiert, exakt wie beim 8er-Mannschafts-Pendant.
