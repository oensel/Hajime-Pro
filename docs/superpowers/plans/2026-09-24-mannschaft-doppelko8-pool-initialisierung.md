# Mannschaft-Doppel-KO-8 Pool-Initialisierung Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CouchDB-Äquivalent der Begegnungs-ERZEUGUNG aus `src/services/MannschaftDoppelKo8Manager.js` — siebtes von acht `*Manager.js`-Pool-Anlage-Services. Team-Pendant zum bereits migrierten `DoppelKo8Manager.js` (siehe `docs/superpowers/plans/2026-09-23-doppelko8-pool-initialisierung.md`): gleiches 8er-Raster samt DJB-Freilos-Positionen, aber OHNE Vereinstrennung/Gewichtssortierung (Mannschaften werden schlicht in Anmeldereihenfolge ins Raster gesetzt) und OHNE die `unterbewertung_kaempferN`-Sonderregel (existiert auf `mannschaftskaempfe` gar nicht als Spalte).

**Bewusste Scope-Grenze:** Wie bereits bei `mannschaftJederGegenJedenPoolKaskade.js` (siehe `docs/superpowers/plans/2026-09-23-mannschaft-jgj-pool-initialisierung.md`) delegiert `aktualisiereTurnier` im Original komplett an `aktualisiereMannschaftsPool` aus `src/services/mannschaftsBegegnungEngine.js` — diese Engine ist selbst noch nicht CouchDB-migriert und deutlich umfangreicher (Einzelkampf-Erzeugung je Gewichtsklasse, Stichkampf-Logik, Pool-Abschluss). Ihre Migration ist bewusst NICHT Teil dieses Plans. Dieser Plan deckt daher ausschließlich `initialisierePool`s Begegnungs-Erzeugung ab (inklusive der bereits migrierten `verknuepfeQuellenFuerMannschaftsPool`) — ohne den abschließenden `aktualisiereTurnier`-Aufruf.

Vollständig getestet, weiterhin **nicht** in `src/app.js`/`src/routes/`/`src/controllers/` verdrahtet.

**Architecture:** Eine neue Kaskaden-Datei `src/db/kaskaden/mannschaftDoppelKo8PoolKaskade.js` mit einer Funktion (`initialisierePool`), die die Raster-/Freilos-Logik des knex-Originals auf `mannschaftenRepository`/`mannschaftskaempfeRepository` überträgt und die bereits migrierte `verknuepfeQuellenFuerMannschaftsPool` (`src/db/kaskaden/bracketVerknuepfung.js`) mit der bereits bestehenden `DOPPEL_KO_8_TOPOLOGIE`-Konstante wiederverwendet.

**Tech Stack:** Kein neuer Dependency-Bedarf.

**Spec:** [docs/superpowers/specs/2026-09-22-couchdb-pouchdb-migration-design.md](../specs/2026-09-22-couchdb-pouchdb-migration-design.md)

## Global Constraints

- ESM-Only — `import`/`export`, kein `require`.
- Keine Kommentare, die nur wiederholen, was der Code schon sagt.
- Genau EIN `startTestCouchServer()`-Aufruf pro Testdatei via `before()`/`after()`.
- `src/services/MannschaftDoppelKo8Manager.js` und `src/services/mannschaftsBegegnungEngine.js` werden **nicht** verändert.
- Keine Vereinstrennung/Gewichtssortierung — Mannschaften werden in der von `mannschaftenRepository.findByPool` gelieferten Anmeldereihenfolge (`created_at` aufsteigend) ins Raster gesetzt, exakt wie im Original (`orderBy('id','asc')`).
- Keine `unterbewertung_kaempferN`-Felder — existieren auf `mannschaftskaempfe` nicht.
- `reihenfolge_nummer` bleibt String (`'H1'`, `'F'`, …), exakt wie im Original.
- Die `console.warn`-Warnung bei ungültiger Mannschaftszahl (N&lt;2 oder N&gt;8) wird NICHT übernommen (reiner Log-Seiteneffekt, keine Verhaltensänderung) — anders als beim `GruppenUeberKreuzManager`-Pendant gibt es hier keinen harten Fehlerwurf, nur eine Warnung.
- `aktualisiereTurnier`/`aktualisiereMannschaftsPool` wird in diesem Plan **nicht** portiert (siehe „Bewusste Scope-Grenze" oben) — `initialisierePool` endet nach `verknuepfeQuellenFuerMannschaftsPool`, ohne den entsprechenden Aufruf.
- Diese Schicht wird in diesem Plan **nicht** in `src/app.js`, `src/routes/` oder `src/controllers/` verdrahtet.

---

### Task 1: `mannschaftDoppelKo8PoolKaskade.js`

**Files:**
- Create: `src/db/kaskaden/mannschaftDoppelKo8PoolKaskade.js`
- Test: `tests/unit/db/kaskaden/mannschaftDoppelKo8PoolKaskade.test.js`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: `findByPool(poolId)` aus `mannschaftenRepository`; `create(data)`/`findByPool(poolId)`/`update(id,patch)` aus `mannschaftskaempfeRepository`; `verknuepfeQuellenFuerMannschaftsPool` aus `./bracketVerknuepfung.js`; `DOPPEL_KO_8_TOPOLOGIE` aus `../../shared/bracketTopologie.js`.
- Produces: `initialisierePool(mannschaftskaempfeRepository, mannschaftenRepository, poolId): Promise<void>`.

- [ ] **Step 1: Failing Tests schreiben**

`tests/unit/db/kaskaden/mannschaftDoppelKo8PoolKaskade.test.js`:

```javascript
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startTestCouchServer } from '../../helpers/couchTestServer.js';
import { connect, ensureDatabase } from '../../../../src/db/couch.js';
import { createMannschaftskaempfeRepository } from '../../../../src/db/repositories/mannschaftskaempfeRepository.js';
import { createMannschaftenRepository } from '../../../../src/db/repositories/mannschaftenRepository.js';
import { initialisierePool } from '../../../../src/db/kaskaden/mannschaftDoppelKo8PoolKaskade.js';

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

test('initialisierePool füllt bei 8 Mannschaften das Raster in Anmeldereihenfolge ohne Freilose', async () => {
    const { mannschaftskaempfeRepository, mannschaftenRepository } = await neueRepositories();
    const m = [];
    for (let i = 0; i < 8; i++) {
        m.push(await mannschaftenRepository.create({ pool_id: 'pool:1', verein: `Team ${i + 1}` }));
    }

    await initialisierePool(mannschaftskaempfeRepository, mannschaftenRepository, 'pool:1');

    const begegnungen = await mannschaftskaempfeRepository.findByPool('pool:1');
    assert.equal(begegnungen.length, 11);
    const byReihenfolge = Object.fromEntries(begegnungen.map(b => [b.reihenfolge_nummer, b]));

    assert.equal(byReihenfolge.H1.mannschaft1_id, m[0]._id);
    assert.equal(byReihenfolge.H1.mannschaft2_id, m[1]._id);
    assert.equal(byReihenfolge.H1.status, 'bereit');
    assert.equal(byReihenfolge.H2.mannschaft1_id, m[2]._id);
    assert.equal(byReihenfolge.H2.mannschaft2_id, m[3]._id);
    assert.equal(byReihenfolge.H3.mannschaft1_id, m[4]._id);
    assert.equal(byReihenfolge.H3.mannschaft2_id, m[5]._id);
    assert.equal(byReihenfolge.H4.mannschaft1_id, m[6]._id);
    assert.equal(byReihenfolge.H4.mannschaft2_id, m[7]._id);

    for (const nr of ['H5', 'H6', 'T1', 'T2', 'T3', 'T4', 'F']) {
        assert.equal(byReihenfolge[nr].status, 'angelegt');
        assert.equal(byReihenfolge[nr].mannschaft1_id, null);
    }

    // verknuepfeQuellenFuerMannschaftsPool wurde aufgerufen.
    assert.equal(byReihenfolge.H5.mannschaft1_quelle_kampf_id, byReihenfolge.H1._id);
    assert.equal(byReihenfolge.H5.mannschaft1_quelle_typ, 'sieger');
    assert.equal(byReihenfolge.H5.mannschaft2_quelle_kampf_id, byReihenfolge.H2._id);
    assert.equal(byReihenfolge.F.mannschaft1_quelle_kampf_id, byReihenfolge.H5._id);
});

test('initialisierePool weist Freilose an den korrekten Rasterpositionen zu, ohne unterbewertung-Felder', async () => {
    const { mannschaftskaempfeRepository, mannschaftenRepository } = await neueRepositories();
    const m1 = await mannschaftenRepository.create({ pool_id: 'pool:1', verein: 'Team A' });
    const m2 = await mannschaftenRepository.create({ pool_id: 'pool:1', verein: 'Team B' });

    await initialisierePool(mannschaftskaempfeRepository, mannschaftenRepository, 'pool:1');

    const begegnungen = await mannschaftskaempfeRepository.findByPool('pool:1');
    const byReihenfolge = Object.fromEntries(begegnungen.map(b => [b.reihenfolge_nummer, b]));

    // Freilos-Indices [7,0,4,3] -> Raster: [null, m1, m2, null, null, null, null, null]
    assert.equal(byReihenfolge.H1.status, 'freilos');
    assert.equal(byReihenfolge.H1.mannschaft1_id, null);
    assert.equal(byReihenfolge.H1.mannschaft2_id, m1._id);
    assert.equal(byReihenfolge.H1.sieger_mannschaft_id, m1._id);
    assert.equal(byReihenfolge.H1.unterbewertung_kaempfer1, undefined);

    assert.equal(byReihenfolge.H2.status, 'freilos');
    assert.equal(byReihenfolge.H2.mannschaft1_id, m2._id);
    assert.equal(byReihenfolge.H2.mannschaft2_id, null);
    assert.equal(byReihenfolge.H2.sieger_mannschaft_id, m2._id);

    for (const nr of ['H3', 'H4']) {
        assert.equal(byReihenfolge[nr].status, 'freilos');
        assert.equal(byReihenfolge[nr].mannschaft1_id, null);
        assert.equal(byReihenfolge[nr].mannschaft2_id, null);
        assert.equal(byReihenfolge[nr].sieger_mannschaft_id, null);
    }
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag bestätigen**

Run: `npm run test:unit`
Expected: FAIL — `Cannot find module '.../src/db/kaskaden/mannschaftDoppelKo8PoolKaskade.js'`

- [ ] **Step 3: Implementieren**

`src/db/kaskaden/mannschaftDoppelKo8PoolKaskade.js`:

```javascript
import { DOPPEL_KO_8_TOPOLOGIE } from '../../shared/bracketTopologie.js';
import { verknuepfeQuellenFuerMannschaftsPool } from './bracketVerknuepfung.js';

// CouchDB-Pendant zur Begegnungs-ERZEUGUNG aus MannschaftDoppelKo8Manager.initialisierePool
// (src/services/MannschaftDoppelKo8Manager.js) -- dort direkt knex-gebunden, hier über die
// jeweiligen Repositories. Der anschließende aktualisiereTurnier-Aufruf des Originals delegiert an
// mannschaftsBegegnungEngine.js (Einzelkampf-Erzeugung je Gewichtsklasse, Stichkampf-Logik,
// Pool-Abschluss) -- diese Engine ist selbst noch nicht migriert und bewusst NICHT Teil dieser
// Kaskade; initialisierePool endet hier nach der Bracket-Verknüpfung.
const RASTER_GROESSE = 8;
const FREILOS_INDICES = [7, 0, 4, 3];

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

    for (const reihenfolgeNummer of ['H5', 'H6', 'T1', 'T2', 'T3', 'T4', 'F']) {
        await mannschaftskaempfeRepository.create({
            pool_id: poolId, status: 'angelegt', reihenfolge_nummer: reihenfolgeNummer,
            mannschaft1_id: null, mannschaft2_id: null, sieger_mannschaft_id: null
        });
    }

    await verknuepfeQuellenFuerMannschaftsPool(mannschaftskaempfeRepository, poolId, DOPPEL_KO_8_TOPOLOGIE);
}
```

- [ ] **Step 4: Test ausführen, Erfolg bestätigen**

Run: `npm run test:unit`
Expected: PASS (2 neue Tests, insgesamt 111)

- [ ] **Step 5: Dokumentation ergänzen**

In `CLAUDE.md` im Abschnitt "Zentrale Architekturkonzepte", im Punkt zu `src/db/kaskaden/`, `mannschaftDoppelKo8PoolKaskade.js` als elftes Modul ergänzen — CouchDB-Pendant zur Begegnungs-Erzeugung aus `MannschaftDoppelKo8Manager.js`, siebtes von acht `*Manager.js`-Pendants, wiederverwendet `verknuepfeQuellenFuerMannschaftsPool`; die anschließende Auswertungs-Engine (`mannschaftsBegegnungEngine.js`) bleibt bewusst außen vor (wie schon bei `mannschaftJederGegenJedenPoolKaskade.js`).

- [ ] **Step 6: Commit**

```bash
git add src/db/kaskaden/mannschaftDoppelKo8PoolKaskade.js tests/unit/db/kaskaden/mannschaftDoppelKo8PoolKaskade.test.js CLAUDE.md
git commit -m "feat: CouchDB-Pendant zur Begegnungs-Erzeugung aus MannschaftDoppelKo8Manager"
```

---

## Self-Review-Notizen

- **Spec-Abdeckung:** Deckt das siebte von acht Pool-Anlage-Services ab (Begegnungs-Erzeugung ohne die noch nicht migrierte Auswertungs-Engine). Nur `MannschaftDoppelKo16Manager` bleibt danach noch offen.
- **Platzhalter-Scan:** Keine TBD/TODO-Stellen. `console.warn` bei ungültiger Mannschaftszahl bewusst nicht übernommen (reiner Log-Seiteneffekt).
- **Determinismus der Tests:** Beide Tests (8 Mannschaften ohne Freilos, 2 Mannschaften mit Freilos) wurden von Hand exakt nach dem Original-Algorithmus nachvollzogen — bei fehlender Vereinstrennung ist die Rasterbefüllung hier deutlich einfacher als beim Einzelwettkampf-Pendant (reine Cursor-Iteration über nicht-Freilos-Slots in Anmeldereihenfolge).
- **Wiederverwendung:** `verknuepfeQuellenFuerMannschaftsPool` wird importiert statt neu implementiert, exakt wie bei `mannschaftJederGegenJedenPoolKaskade.js` (dort ohne Topologie-Aufruf) und den Einzelwettkampf-Doppel-KO-Pendants (dort mit `verknuepfeQuellenFuerPool`).
