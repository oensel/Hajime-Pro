# Mannschaftsbegegnung-Kaskade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CouchDB-Äquivalent des Kernteils von `src/services/mannschaftsBegegnungEngine.js` — der gemeinsamen Logik aller drei Mannschafts-Pool-Manager, die bisher in jedem einzelnen `mannschaft*PoolKaskade.js`-Pendant bewusst ausgeklammert wurde (siehe Self-Review-Notizen in `docs/superpowers/plans/2026-09-23-mannschaft-jgj-pool-initialisierung.md`, `docs/superpowers/plans/2026-09-24-mannschaft-doppelko8-pool-initialisierung.md` und dem 16er-Pendant): Einzelkampf-Erzeugung je gemeinsam besetzter Gewichtsklasse (`erzeugeEinzelkaempfeFuerBegegnung`), Siegpunkte-/Wertungspunkte-Auswertung inklusive automatischem Stichkampf bei vollständigem Gleichstand (`werteBegegnungAus`), und der generische Fortschritts-Treiber, den jeder `Mannschaft*Manager.aktualisiereTurnier()` aufruft (`aktualisiereMannschaftsPool`).

**Bewusste Scope-Grenze:** Die manuelle Nachnominierungs-Funktionalität (`ermittleErsatzKandidaten`, `wechsleKaempfer` im Original) ist NICHT Teil dieses Plans — das ist ein separates, manuelles Override-Feature für die Turnierleitung (Kämpfer-Austausch vor Kampfstart), nicht Teil der automatischen Fortschritts-Kaskade, und verdient eine eigene, spätere Migration mit eigener Recherche zu den Gewichtsklassen-Rangfolge-Regeln.

**Wiederverwendung bereits migrierter Bausteine:** `wendeMannschaftsKaskadeAn` (`src/db/kaskaden/mannschaftsKaskade.js`, bereits approved) wird direkt für die Begegnungs-Bracket-Kaskade wiederverwendet (Phase 1 des Originals) — anstatt `berechneMannschaftsPatches` erneut inline aufzurufen und die Lade-/Wiederhole-Schleife zu duplizieren.

Vollständig getestet, weiterhin **nicht** in `src/app.js`/`src/routes/`/`src/controllers/` verdrahtet.

**Architecture:** Eine neue Kaskaden-Datei `src/db/kaskaden/mannschaftsBegegnungKaskade.js` mit den privaten Hilfsfunktionen `parseGewichtsklassen`/`gruppiereByGewichtsklasse`/`waehleStarter` (reine Portierung, `id`→`_id`) und drei exportierten Funktionen (`erzeugeEinzelkaempfeFuerBegegnung`, `werteBegegnungAus`, `aktualisiereMannschaftsPool`).

**Tech Stack:** Kein neuer Dependency-Bedarf.

**Spec:** [docs/superpowers/specs/2026-09-22-couchdb-pouchdb-migration-design.md](../specs/2026-09-22-couchdb-pouchdb-migration-design.md)

## Global Constraints

- ESM-Only — `import`/`export`, kein `require`.
- Keine Kommentare, die nur wiederholen, was der Code schon sagt.
- Genau EIN `startTestCouchServer()`-Aufruf pro Testdatei via `before()`/`after()`.
- `src/services/mannschaftsBegegnungEngine.js` wird **nicht** verändert.
- `ermittleErsatzKandidaten`/`wechsleKaempfer` sind **nicht** Teil dieses Plans (siehe „Bewusste Scope-Grenze" oben).
- `werteBegegnungAus`s Stichkampf-Auslosung bleibt bei `Math.random()` (exakt wie im Original) — keine deterministische Ersatzlogik einführen. Tests, die diesen Zweig prüfen, konstruieren Szenarien mit genau EINER kontestierten Gewichtsklasse, damit die Auswahl trotz `Math.random()` deterministisch ist (Array-Länge 1).
- `aktualisiereMannschaftsPool` ruft `wendeMannschaftsKaskadeAn` für die Begegnungs-Bracket-Kaskade auf (Phase 1) statt `berechneMannschaftsPatches` erneut inline zu laden/anzuwenden — eine harmlose Vereinfachung (ein Fetch statt zwei), keine Verhaltensänderung, da beide Wege dieselbe Engine mit derselben Lade-/Wiederhole-Semantik nutzen.
- Diese Schicht wird in diesem Plan **nicht** in `src/app.js`, `src/routes/` oder `src/controllers/` verdrahtet.

---

### Task 1: `erzeugeEinzelkaempfeFuerBegegnung`

**Files:**
- Create: `src/db/kaskaden/mannschaftsBegegnungKaskade.js`
- Test: `tests/unit/db/kaskaden/mannschaftsBegegnungKaskade.test.js`

**Interfaces:**
- Consumes: `query(selector)`/`create(data)` aus `kaempfeRepository`; `update(id,patch)` aus `mannschaftskaempfeRepository`; `findByMannschaft(mannschaftId)` aus `mannschaftMitgliederRepository`.
- Produces: `erzeugeEinzelkaempfeFuerBegegnung(kaempfeRepository, mannschaftskaempfeRepository, mannschaftMitgliederRepository, begegnung, pool): Promise<void>`.

- [ ] **Step 1: Failing Tests schreiben**

`tests/unit/db/kaskaden/mannschaftsBegegnungKaskade.test.js`:

```javascript
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startTestCouchServer } from '../../helpers/couchTestServer.js';
import { connect, ensureDatabase } from '../../../../src/db/couch.js';
import { createKaempfeRepository } from '../../../../src/db/repositories/kaempfeRepository.js';
import { createMannschaftskaempfeRepository } from '../../../../src/db/repositories/mannschaftskaempfeRepository.js';
import { createMannschaftMitgliederRepository } from '../../../../src/db/repositories/mannschaftMitgliederRepository.js';
import { erzeugeEinzelkaempfeFuerBegegnung } from '../../../../src/db/kaskaden/mannschaftsBegegnungKaskade.js';

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
        mannschaftskaempfeRepository: createMannschaftskaempfeRepository(db),
        mannschaftMitgliederRepository: createMannschaftMitgliederRepository(db)
    };
}

test('erzeugeEinzelkaempfeFuerBegegnung erzeugt einen Einzelkampf pro gemeinsam besetzter Gewichtsklasse', async () => {
    const { kaempfeRepository, mannschaftskaempfeRepository, mannschaftMitgliederRepository } = await neueRepositories();
    const pool = { _id: 'pool:1', mannschafts_gewichtsklassen: JSON.stringify(['-60kg', '-73kg']) };
    const begegnung = await mannschaftskaempfeRepository.create({ pool_id: pool._id, status: 'bereit', mannschaft1_id: 'mannschaft:1', mannschaft2_id: 'mannschaft:2' });
    await mannschaftMitgliederRepository.create({ mannschaft_id: 'mannschaft:1', turnier_teilnehmer_id: 'teilnehmer:a60', gewichtsklasse: '-60kg' });
    await mannschaftMitgliederRepository.create({ mannschaft_id: 'mannschaft:1', turnier_teilnehmer_id: 'teilnehmer:a73', gewichtsklasse: '-73kg' });
    await mannschaftMitgliederRepository.create({ mannschaft_id: 'mannschaft:2', turnier_teilnehmer_id: 'teilnehmer:b60', gewichtsklasse: '-60kg' });
    await mannschaftMitgliederRepository.create({ mannschaft_id: 'mannschaft:2', turnier_teilnehmer_id: 'teilnehmer:b73', gewichtsklasse: '-73kg' });

    await erzeugeEinzelkaempfeFuerBegegnung(kaempfeRepository, mannschaftskaempfeRepository, mannschaftMitgliederRepository, begegnung, pool);

    const kaempfe = await kaempfeRepository.query({ mannschaftskampf_id: begegnung._id });
    assert.equal(kaempfe.length, 2);
    const byKlasse = Object.fromEntries(kaempfe.map(k => [k.mannschaft_gewichtsklasse, k]));
    assert.equal(byKlasse['-60kg'].kaempfer1_id, 'teilnehmer:a60');
    assert.equal(byKlasse['-60kg'].kaempfer2_id, 'teilnehmer:b60');
    assert.equal(byKlasse['-60kg'].status, 'bereit');
    assert.equal(byKlasse['-73kg'].kaempfer1_id, 'teilnehmer:a73');
    assert.equal(byKlasse['-73kg'].kaempfer2_id, 'teilnehmer:b73');
});

test('erzeugeEinzelkaempfeFuerBegegnung überspringt Gewichtsklassen, die nicht von beiden Mannschaften besetzt sind', async () => {
    const { kaempfeRepository, mannschaftskaempfeRepository, mannschaftMitgliederRepository } = await neueRepositories();
    const pool = { _id: 'pool:1', mannschafts_gewichtsklassen: JSON.stringify(['-60kg', '-73kg', '-90kg']) };
    const begegnung = await mannschaftskaempfeRepository.create({ pool_id: pool._id, status: 'bereit', mannschaft1_id: 'mannschaft:1', mannschaft2_id: 'mannschaft:2' });
    await mannschaftMitgliederRepository.create({ mannschaft_id: 'mannschaft:1', turnier_teilnehmer_id: 'teilnehmer:a60', gewichtsklasse: '-60kg' });
    await mannschaftMitgliederRepository.create({ mannschaft_id: 'mannschaft:1', turnier_teilnehmer_id: 'teilnehmer:a73', gewichtsklasse: '-73kg' });
    await mannschaftMitgliederRepository.create({ mannschaft_id: 'mannschaft:2', turnier_teilnehmer_id: 'teilnehmer:b60', gewichtsklasse: '-60kg' });

    await erzeugeEinzelkaempfeFuerBegegnung(kaempfeRepository, mannschaftskaempfeRepository, mannschaftMitgliederRepository, begegnung, pool);

    const kaempfe = await kaempfeRepository.query({ mannschaftskampf_id: begegnung._id });
    assert.equal(kaempfe.length, 1);
    assert.equal(kaempfe[0].mannschaft_gewichtsklasse, '-60kg');
});

test('erzeugeEinzelkaempfeFuerBegegnung markiert die Begegnung als beendet ohne Sieger, wenn keine gemeinsame Gewichtsklasse besetzt ist', async () => {
    const { kaempfeRepository, mannschaftskaempfeRepository, mannschaftMitgliederRepository } = await neueRepositories();
    const pool = { _id: 'pool:1', mannschafts_gewichtsklassen: JSON.stringify(['-60kg', '-90kg']) };
    const begegnung = await mannschaftskaempfeRepository.create({ pool_id: pool._id, status: 'bereit', mannschaft1_id: 'mannschaft:1', mannschaft2_id: 'mannschaft:2' });
    await mannschaftMitgliederRepository.create({ mannschaft_id: 'mannschaft:1', turnier_teilnehmer_id: 'teilnehmer:a60', gewichtsklasse: '-60kg' });
    await mannschaftMitgliederRepository.create({ mannschaft_id: 'mannschaft:2', turnier_teilnehmer_id: 'teilnehmer:b90', gewichtsklasse: '-90kg' });

    await erzeugeEinzelkaempfeFuerBegegnung(kaempfeRepository, mannschaftskaempfeRepository, mannschaftMitgliederRepository, begegnung, pool);

    const kaempfe = await kaempfeRepository.query({ mannschaftskampf_id: begegnung._id });
    assert.equal(kaempfe.length, 0);
    const aktualisiert = await mannschaftskaempfeRepository.findById(begegnung._id);
    assert.equal(aktualisiert.status, 'beendet');
    assert.equal(aktualisiert.sieger_mannschaft_id, null);
});

test('erzeugeEinzelkaempfeFuerBegegnung ist idempotent, wenn bereits Einzelkämpfe existieren', async () => {
    const { kaempfeRepository, mannschaftskaempfeRepository, mannschaftMitgliederRepository } = await neueRepositories();
    const pool = { _id: 'pool:1', mannschafts_gewichtsklassen: JSON.stringify(['-60kg']) };
    const begegnung = await mannschaftskaempfeRepository.create({ pool_id: pool._id, status: 'bereit', mannschaft1_id: 'mannschaft:1', mannschaft2_id: 'mannschaft:2' });
    await mannschaftMitgliederRepository.create({ mannschaft_id: 'mannschaft:1', turnier_teilnehmer_id: 'teilnehmer:a60', gewichtsklasse: '-60kg' });
    await mannschaftMitgliederRepository.create({ mannschaft_id: 'mannschaft:2', turnier_teilnehmer_id: 'teilnehmer:b60', gewichtsklasse: '-60kg' });
    await kaempfeRepository.create({ pool_id: pool._id, mannschaftskampf_id: begegnung._id, mannschaft_gewichtsklasse: '-60kg', status: 'bereit', kaempfer1_id: 'teilnehmer:a60', kaempfer2_id: 'teilnehmer:b60' });

    await erzeugeEinzelkaempfeFuerBegegnung(kaempfeRepository, mannschaftskaempfeRepository, mannschaftMitgliederRepository, begegnung, pool);

    const kaempfe = await kaempfeRepository.query({ mannschaftskampf_id: begegnung._id });
    assert.equal(kaempfe.length, 1);
});

test('erzeugeEinzelkaempfeFuerBegegnung tut nichts, wenn eine der beiden Mannschaften noch nicht feststeht', async () => {
    const { kaempfeRepository, mannschaftskaempfeRepository, mannschaftMitgliederRepository } = await neueRepositories();
    const pool = { _id: 'pool:1', mannschafts_gewichtsklassen: JSON.stringify(['-60kg']) };
    const begegnung = await mannschaftskaempfeRepository.create({ pool_id: pool._id, status: 'angelegt', mannschaft1_id: null, mannschaft2_id: null });

    await erzeugeEinzelkaempfeFuerBegegnung(kaempfeRepository, mannschaftskaempfeRepository, mannschaftMitgliederRepository, begegnung, pool);

    const kaempfe = await kaempfeRepository.query({ mannschaftskampf_id: begegnung._id });
    assert.equal(kaempfe.length, 0);
    const unveraendert = await mannschaftskaempfeRepository.findById(begegnung._id);
    assert.equal(unveraendert.status, 'angelegt');
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag bestätigen**

Run: `npm run test:unit`
Expected: FAIL — `Cannot find module '.../src/db/kaskaden/mannschaftsBegegnungKaskade.js'`

- [ ] **Step 3: Implementieren**

`src/db/kaskaden/mannschaftsBegegnungKaskade.js`:

```javascript
// CouchDB-Pendant zum Kernteil von src/services/mannschaftsBegegnungEngine.js -- dort direkt
// knex-gebunden, hier über die jeweiligen Repositories. ermittleErsatzKandidaten/wechsleKaempfer
// (manuelle Nachnominierung) sind bewusst NICHT Teil dieser Kaskade -- eigenständiges,
// manuelles Override-Feature, keine automatische Fortschritts-Logik.

function parseGewichtsklassen(pool) {
    if (!pool.mannschafts_gewichtsklassen) return [];
    try {
        const parsed = JSON.parse(pool.mannschafts_gewichtsklassen);
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        return [];
    }
}

function gruppiereByGewichtsklasse(mitglieder) {
    const map = new Map();
    for (const m of mitglieder) {
        if (!map.has(m.gewichtsklasse)) map.set(m.gewichtsklasse, []);
        map.get(m.gewichtsklasse).push(m);
    }
    return map;
}

function waehleStarter(mitgliederByGewichtsklasse, gewichtsklasse) {
    const kandidaten = mitgliederByGewichtsklasse.get(gewichtsklasse);
    return kandidaten && kandidaten.length > 0 ? kandidaten[0] : null;
}

export async function erzeugeEinzelkaempfeFuerBegegnung(kaempfeRepository, mannschaftskaempfeRepository, mannschaftMitgliederRepository, begegnung, pool) {
    if (!begegnung.mannschaft1_id || !begegnung.mannschaft2_id) return;

    const bestehende = await kaempfeRepository.query({ mannschaftskampf_id: begegnung._id });
    if (bestehende.length > 0) return;

    const gewichtsklassen = parseGewichtsklassen(pool);
    const [mitglieder1, mitglieder2] = await Promise.all([
        mannschaftMitgliederRepository.findByMannschaft(begegnung.mannschaft1_id),
        mannschaftMitgliederRepository.findByMannschaft(begegnung.mannschaft2_id)
    ]);
    const byGewichtsklasse1 = gruppiereByGewichtsklasse(mitglieder1);
    const byGewichtsklasse2 = gruppiereByGewichtsklasse(mitglieder2);

    let erzeugt = 0;
    for (const klasse of gewichtsklassen) {
        const starter1 = waehleStarter(byGewichtsklasse1, klasse);
        const starter2 = waehleStarter(byGewichtsklasse2, klasse);
        if (!starter1 || !starter2) continue;

        await kaempfeRepository.create({
            pool_id: pool._id,
            mannschaftskampf_id: begegnung._id,
            mannschaft_gewichtsklasse: klasse,
            status: 'bereit',
            kaempfer1_id: starter1.turnier_teilnehmer_id,
            kaempfer2_id: starter2.turnier_teilnehmer_id,
            sieger_id: null,
            kampfzeit_in_sekunden: 0,
            unterbewertung_kaempfer1: 0,
            unterbewertung_kaempfer2: 0
        });
        erzeugt++;
    }

    if (erzeugt === 0) {
        await mannschaftskaempfeRepository.update(begegnung._id, { status: 'beendet', sieger_mannschaft_id: null });
    }
}
```

- [ ] **Step 4: Test ausführen, Erfolg bestätigen**

Run: `npm run test:unit`
Expected: PASS (5 neue Tests, insgesamt 118)

- [ ] **Step 5: Commit**

```bash
git add src/db/kaskaden/mannschaftsBegegnungKaskade.js tests/unit/db/kaskaden/mannschaftsBegegnungKaskade.test.js
git commit -m "feat: CouchDB-Pendant zu erzeugeEinzelkaempfeFuerBegegnung aus mannschaftsBegegnungEngine"
```

---

### Task 2: `werteBegegnungAus` und `aktualisiereMannschaftsPool`

**Files:**
- Modify: `src/db/kaskaden/mannschaftsBegegnungKaskade.js`
- Modify: `tests/unit/db/kaskaden/mannschaftsBegegnungKaskade.test.js`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: zusätzlich `findById(id)` aus `mannschaftskaempfeRepository`; `findById(id)` aus `poolsRepository`, `update(id,patch)` aus `poolsRepository`; `wendeMannschaftsKaskadeAn` aus `./mannschaftsKaskade.js`.
- Produces: `werteBegegnungAus(kaempfeRepository, mannschaftskaempfeRepository, mannschaftMitgliederRepository, begegnungId): Promise<void>`, `aktualisiereMannschaftsPool(kaempfeRepository, mannschaftskaempfeRepository, mannschaftMitgliederRepository, poolsRepository, poolId): Promise<void>`.

- [ ] **Step 1: Failing Tests schreiben**

In `tests/unit/db/kaskaden/mannschaftsBegegnungKaskade.test.js` den Import um `createPoolsRepository` sowie `werteBegegnungAus`/`aktualisiereMannschaftsPool` ergänzen:

```javascript
import { createPoolsRepository } from '../../../../src/db/repositories/poolsRepository.js';
import { erzeugeEinzelkaempfeFuerBegegnung, werteBegegnungAus, aktualisiereMannschaftsPool } from '../../../../src/db/kaskaden/mannschaftsBegegnungKaskade.js';
```

`neueRepositories()` um `poolsRepository` ergänzen:

```javascript
async function neueRepositories() {
    const db = await ensureDatabase(nano, `test-${randomUUID()}`);
    return {
        kaempfeRepository: createKaempfeRepository(db),
        mannschaftskaempfeRepository: createMannschaftskaempfeRepository(db),
        mannschaftMitgliederRepository: createMannschaftMitgliederRepository(db),
        poolsRepository: createPoolsRepository(db)
    };
}
```

Nach den bestehenden fünf Tests ergänzen:

```javascript
test('werteBegegnungAus entscheidet nach Siegen, wenn diese nicht ausgeglichen sind', async () => {
    const { kaempfeRepository, mannschaftskaempfeRepository } = await neueRepositories();
    const begegnung = await mannschaftskaempfeRepository.create({ pool_id: 'pool:1', status: 'bereit', mannschaft1_id: 'mannschaft:1', mannschaft2_id: 'mannschaft:2' });
    await kaempfeRepository.create({ pool_id: 'pool:1', mannschaftskampf_id: begegnung._id, mannschaft_gewichtsklasse: '-60kg', status: 'beendet', kaempfer1_id: 'a1', kaempfer2_id: 'b1', sieger_id: 'a1', unterbewertung_kaempfer1: 0, unterbewertung_kaempfer2: 0 });
    await kaempfeRepository.create({ pool_id: 'pool:1', mannschaftskampf_id: begegnung._id, mannschaft_gewichtsklasse: '-73kg', status: 'beendet', kaempfer1_id: 'a2', kaempfer2_id: 'b2', sieger_id: 'a2', unterbewertung_kaempfer1: 0, unterbewertung_kaempfer2: 0 });

    await werteBegegnungAus(kaempfeRepository, mannschaftskaempfeRepository, null, begegnung._id);

    const aktualisiert = await mannschaftskaempfeRepository.findById(begegnung._id);
    assert.equal(aktualisiert.siegpunkte_mannschaft1, 2);
    assert.equal(aktualisiert.siegpunkte_mannschaft2, 0);
    assert.equal(aktualisiert.status, 'beendet');
    assert.equal(aktualisiert.sieger_mannschaft_id, 'mannschaft:1');
});

test('werteBegegnungAus entscheidet nach Wertungspunkten, wenn die Siege gleich sind', async () => {
    const { kaempfeRepository, mannschaftskaempfeRepository } = await neueRepositories();
    const begegnung = await mannschaftskaempfeRepository.create({ pool_id: 'pool:1', status: 'bereit', mannschaft1_id: 'mannschaft:1', mannschaft2_id: 'mannschaft:2' });
    await kaempfeRepository.create({ pool_id: 'pool:1', mannschaftskampf_id: begegnung._id, mannschaft_gewichtsklasse: '-60kg', status: 'beendet', kaempfer1_id: 'a1', kaempfer2_id: 'b1', sieger_id: 'a1', unterbewertung_kaempfer1: 7, unterbewertung_kaempfer2: 0 });
    await kaempfeRepository.create({ pool_id: 'pool:1', mannschaftskampf_id: begegnung._id, mannschaft_gewichtsklasse: '-73kg', status: 'beendet', kaempfer1_id: 'a2', kaempfer2_id: 'b2', sieger_id: 'b2', unterbewertung_kaempfer1: 0, unterbewertung_kaempfer2: 10 });

    await werteBegegnungAus(kaempfeRepository, mannschaftskaempfeRepository, null, begegnung._id);

    const aktualisiert = await mannschaftskaempfeRepository.findById(begegnung._id);
    assert.equal(aktualisiert.siegpunkte_mannschaft1, 1);
    assert.equal(aktualisiert.siegpunkte_mannschaft2, 1);
    assert.equal(aktualisiert.wertungspunkte_mannschaft1, 7);
    assert.equal(aktualisiert.wertungspunkte_mannschaft2, 10);
    assert.equal(aktualisiert.status, 'beendet');
    assert.equal(aktualisiert.sieger_mannschaft_id, 'mannschaft:2');
});

test('werteBegegnungAus lost bei vollständigem Gleichstand einen Stichkampf in der einzigen kontestierten Gewichtsklasse aus', async () => {
    const { kaempfeRepository, mannschaftskaempfeRepository, mannschaftMitgliederRepository } = await neueRepositories();
    const begegnung = await mannschaftskaempfeRepository.create({ pool_id: 'pool:1', status: 'bereit', mannschaft1_id: 'mannschaft:1', mannschaft2_id: 'mannschaft:2' });
    await kaempfeRepository.create({ pool_id: 'pool:1', mannschaftskampf_id: begegnung._id, mannschaft_gewichtsklasse: '-60kg', status: 'beendet', kaempfer1_id: 'a1', kaempfer2_id: 'b1', sieger_id: 'a1', unterbewertung_kaempfer1: 0, unterbewertung_kaempfer2: 0 });
    await kaempfeRepository.create({ pool_id: 'pool:1', mannschaftskampf_id: begegnung._id, mannschaft_gewichtsklasse: '-60kg', status: 'beendet', kaempfer1_id: 'a2', kaempfer2_id: 'b2', sieger_id: 'b2', unterbewertung_kaempfer1: 0, unterbewertung_kaempfer2: 0 });
    await mannschaftMitgliederRepository.create({ mannschaft_id: 'mannschaft:1', turnier_teilnehmer_id: 'teilnehmer:stich1', gewichtsklasse: '-60kg' });
    await mannschaftMitgliederRepository.create({ mannschaft_id: 'mannschaft:2', turnier_teilnehmer_id: 'teilnehmer:stich2', gewichtsklasse: '-60kg' });

    await werteBegegnungAus(kaempfeRepository, mannschaftskaempfeRepository, mannschaftMitgliederRepository, begegnung._id);

    const aktualisiert = await mannschaftskaempfeRepository.findById(begegnung._id);
    assert.equal(aktualisiert.stichkampf_gewichtsklasse, '-60kg');
    assert.notEqual(aktualisiert.status, 'beendet');

    const kaempfe = await kaempfeRepository.query({ mannschaftskampf_id: begegnung._id });
    assert.equal(kaempfe.length, 3);
    const stichkampf = kaempfe.find(k => k.status === 'bereit');
    assert.equal(stichkampf.mannschaft_gewichtsklasse, '-60kg');
    assert.equal(stichkampf.kaempfer1_id, 'teilnehmer:stich1');
    assert.equal(stichkampf.kaempfer2_id, 'teilnehmer:stich2');
});

test('werteBegegnungAus greift nicht ein, solange nicht alle Einzelkämpfe beendet sind', async () => {
    const { kaempfeRepository, mannschaftskaempfeRepository } = await neueRepositories();
    const begegnung = await mannschaftskaempfeRepository.create({ pool_id: 'pool:1', status: 'bereit', mannschaft1_id: 'mannschaft:1', mannschaft2_id: 'mannschaft:2' });
    await kaempfeRepository.create({ pool_id: 'pool:1', mannschaftskampf_id: begegnung._id, mannschaft_gewichtsklasse: '-60kg', status: 'bereit', kaempfer1_id: 'a1', kaempfer2_id: 'b1' });

    await werteBegegnungAus(kaempfeRepository, mannschaftskaempfeRepository, null, begegnung._id);

    const unveraendert = await mannschaftskaempfeRepository.findById(begegnung._id);
    assert.equal(unveraendert.siegpunkte_mannschaft1, undefined);
    assert.equal(unveraendert.status, 'bereit');
});

test('aktualisiereMannschaftsPool erzeugt Einzelkämpfe für eine bereite Begegnung', async () => {
    const { kaempfeRepository, mannschaftskaempfeRepository, mannschaftMitgliederRepository, poolsRepository } = await neueRepositories();
    const pool = await poolsRepository.create({ mannschafts_gewichtsklassen: JSON.stringify(['-60kg']) });
    await mannschaftMitgliederRepository.create({ mannschaft_id: 'mannschaft:1', turnier_teilnehmer_id: 'teilnehmer:a60', gewichtsklasse: '-60kg' });
    await mannschaftMitgliederRepository.create({ mannschaft_id: 'mannschaft:2', turnier_teilnehmer_id: 'teilnehmer:b60', gewichtsklasse: '-60kg' });
    const begegnung = await mannschaftskaempfeRepository.create({ pool_id: pool._id, status: 'bereit', mannschaft1_id: 'mannschaft:1', mannschaft2_id: 'mannschaft:2' });

    await aktualisiereMannschaftsPool(kaempfeRepository, mannschaftskaempfeRepository, mannschaftMitgliederRepository, poolsRepository, pool._id);

    const kaempfe = await kaempfeRepository.query({ mannschaftskampf_id: begegnung._id });
    assert.equal(kaempfe.length, 1);
    assert.equal(kaempfe[0].kaempfer1_id, 'teilnehmer:a60');
    assert.equal(kaempfe[0].kaempfer2_id, 'teilnehmer:b60');
    const unveraendertePool = await poolsRepository.findById(pool._id);
    assert.equal(unveraendertePool.status, undefined);
});

test('aktualisiereMannschaftsPool schließt den Pool ab, sobald alle Begegnungen entschieden sind', async () => {
    const { kaempfeRepository, mannschaftskaempfeRepository, mannschaftMitgliederRepository, poolsRepository } = await neueRepositories();
    const pool = await poolsRepository.create({});
    await mannschaftskaempfeRepository.create({ pool_id: pool._id, status: 'beendet', mannschaft1_id: 'mannschaft:1', mannschaft2_id: 'mannschaft:2', sieger_mannschaft_id: 'mannschaft:1' });

    await aktualisiereMannschaftsPool(kaempfeRepository, mannschaftskaempfeRepository, mannschaftMitgliederRepository, poolsRepository, pool._id);

    const aktualisiert = await poolsRepository.findById(pool._id);
    assert.equal(aktualisiert.status, 'kaempfe_beendet');
});

test('aktualisiereMannschaftsPool tut nichts, wenn der Pool nicht existiert', async () => {
    const { kaempfeRepository, mannschaftskaempfeRepository, mannschaftMitgliederRepository, poolsRepository } = await neueRepositories();

    await aktualisiereMannschaftsPool(kaempfeRepository, mannschaftskaempfeRepository, mannschaftMitgliederRepository, poolsRepository, 'pool:nicht-vorhanden');
    // Kein Fehlerwurf -> Test besteht bereits durch das Erreichen dieser Zeile.
});

test('aktualisiereMannschaftsPool tut nichts, wenn der Pool keine Begegnungen hat', async () => {
    const { kaempfeRepository, mannschaftskaempfeRepository, mannschaftMitgliederRepository, poolsRepository } = await neueRepositories();
    const pool = await poolsRepository.create({ status: 'geplant' });

    await aktualisiereMannschaftsPool(kaempfeRepository, mannschaftskaempfeRepository, mannschaftMitgliederRepository, poolsRepository, pool._id);

    const unveraendert = await poolsRepository.findById(pool._id);
    assert.equal(unveraendert.status, 'geplant');
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag bestätigen**

Run: `npm run test:unit`
Expected: FAIL — `werteBegegnungAus is not a function` (oder Import-Fehler)

- [ ] **Step 3: Implementieren**

In `src/db/kaskaden/mannschaftsBegegnungKaskade.js` den Import und die zwei Funktionen ergänzen:

```javascript
import { wendeMannschaftsKaskadeAn } from './mannschaftsKaskade.js';
```

```javascript
export async function werteBegegnungAus(kaempfeRepository, mannschaftskaempfeRepository, mannschaftMitgliederRepository, begegnungId) {
    const begegnung = await mannschaftskaempfeRepository.findById(begegnungId);
    if (!begegnung || begegnung.status === 'beendet' || begegnung.status === 'freilos') return;
    if (!begegnung.mannschaft1_id || !begegnung.mannschaft2_id) return;

    const kaempfe = await kaempfeRepository.query({ mannschaftskampf_id: begegnungId });
    if (kaempfe.length === 0) return;
    if (!kaempfe.every(k => k.status === 'beendet' || k.status === 'freilos')) return;

    let siege1 = 0, siege2 = 0, wert1 = 0, wert2 = 0;
    for (const k of kaempfe) {
        if (k.sieger_id && k.sieger_id === k.kaempfer1_id) siege1++;
        else if (k.sieger_id && k.sieger_id === k.kaempfer2_id) siege2++;
        wert1 += k.unterbewertung_kaempfer1 || 0;
        wert2 += k.unterbewertung_kaempfer2 || 0;
    }

    await mannschaftskaempfeRepository.update(begegnungId, {
        siegpunkte_mannschaft1: siege1,
        siegpunkte_mannschaft2: siege2,
        wertungspunkte_mannschaft1: wert1,
        wertungspunkte_mannschaft2: wert2
    });

    if (siege1 !== siege2) {
        await mannschaftskaempfeRepository.update(begegnungId, {
            status: 'beendet',
            sieger_mannschaft_id: siege1 > siege2 ? begegnung.mannschaft1_id : begegnung.mannschaft2_id
        });
        return;
    }
    if (wert1 !== wert2) {
        await mannschaftskaempfeRepository.update(begegnungId, {
            status: 'beendet',
            sieger_mannschaft_id: wert1 > wert2 ? begegnung.mannschaft1_id : begegnung.mannschaft2_id
        });
        return;
    }

    const kontestierteKlassen = [...new Set(kaempfe.map(k => k.mannschaft_gewichtsklasse).filter(Boolean))];
    if (kontestierteKlassen.length === 0) {
        await mannschaftskaempfeRepository.update(begegnungId, { status: 'beendet', sieger_mannschaft_id: null });
        return;
    }
    const gewaehlteKlasse = kontestierteKlassen[Math.floor(Math.random() * kontestierteKlassen.length)];

    const [mitglieder1, mitglieder2] = await Promise.all([
        mannschaftMitgliederRepository.findByMannschaft(begegnung.mannschaft1_id),
        mannschaftMitgliederRepository.findByMannschaft(begegnung.mannschaft2_id)
    ]);
    const starter1 = waehleStarter(gruppiereByGewichtsklasse(mitglieder1), gewaehlteKlasse);
    const starter2 = waehleStarter(gruppiereByGewichtsklasse(mitglieder2), gewaehlteKlasse);

    await mannschaftskaempfeRepository.update(begegnungId, { stichkampf_gewichtsklasse: gewaehlteKlasse });
    await kaempfeRepository.create({
        pool_id: begegnung.pool_id,
        mannschaftskampf_id: begegnungId,
        mannschaft_gewichtsklasse: gewaehlteKlasse,
        status: 'bereit',
        kaempfer1_id: starter1 ? starter1.turnier_teilnehmer_id : null,
        kaempfer2_id: starter2 ? starter2.turnier_teilnehmer_id : null,
        sieger_id: null,
        kampfzeit_in_sekunden: 0,
        unterbewertung_kaempfer1: 0,
        unterbewertung_kaempfer2: 0
    });
}

export async function aktualisiereMannschaftsPool(kaempfeRepository, mannschaftskaempfeRepository, mannschaftMitgliederRepository, poolsRepository, poolId) {
    const pool = await poolsRepository.findById(poolId);
    if (!pool) return;

    let begegnungen = await wendeMannschaftsKaskadeAn(mannschaftskaempfeRepository, poolId);
    if (begegnungen.length === 0) return;

    const bereiteBegegnungen = begegnungen.filter(b => b.status === 'bereit');
    for (const begegnung of bereiteBegegnungen) {
        await erzeugeEinzelkaempfeFuerBegegnung(kaempfeRepository, mannschaftskaempfeRepository, mannschaftMitgliederRepository, begegnung, pool);
    }

    const nachEinzelkaempfen = await mannschaftskaempfeRepository.findByPool(poolId);
    const offeneBegegnungen = nachEinzelkaempfen.filter(b => b.status === 'bereit' || b.status === 'gestartet');
    let hatAenderung = false;
    for (const begegnung of offeneBegegnungen) {
        await werteBegegnungAus(kaempfeRepository, mannschaftskaempfeRepository, mannschaftMitgliederRepository, begegnung._id);
        const nachher = await mannschaftskaempfeRepository.findById(begegnung._id);
        if (nachher.status !== begegnung.status) hatAenderung = true;
    }
    if (hatAenderung) {
        return aktualisiereMannschaftsPool(kaempfeRepository, mannschaftskaempfeRepository, mannschaftMitgliederRepository, poolsRepository, poolId);
    }

    const alleBegegnungen = await mannschaftskaempfeRepository.findByPool(poolId);
    const alleBeendet = alleBegegnungen.every(b => b.status === 'beendet' || b.status === 'freilos');
    if (alleBeendet) {
        await poolsRepository.update(poolId, { status: 'kaempfe_beendet' });
    }
}
```

- [ ] **Step 4: Test ausführen, Erfolg bestätigen**

Run: `npm run test:unit`
Expected: PASS (8 neue Tests seit Task 1, insgesamt 126)

- [ ] **Step 5: Dokumentation ergänzen**

In `CLAUDE.md` im Abschnitt "Zentrale Architekturkonzepte", im Punkt zu `src/db/kaskaden/`, `mannschaftsBegegnungKaskade.js` als weiteres Modul ergänzen — CouchDB-Pendant zum Kernteil von `src/services/mannschaftsBegegnungEngine.js` (Einzelkampf-Erzeugung je Gewichtsklasse, Siegpunkte-/Wertungspunkte-Auswertung inkl. Stichkampf, generischer Fortschritts-Treiber `aktualisiereMannschaftsPool`); explizit erwähnen, dass die manuelle Nachnominierung (`ermittleErsatzKandidaten`/`wechsleKaempfer`) bewusst NICHT Teil dieser Kaskade ist, und dass damit alle drei Mannschafts-`*PoolKaskade.js`-Pendants (deren `initialisierePool` bisher ohne den abschließenden `aktualisiereTurnier`-Aufruf endete) diese fehlende Funktionalität jetzt über `aktualisiereMannschaftsPool` bekommen könnten (Verdrahtung selbst bleibt außerhalb des Scopes dieses Plans).

- [ ] **Step 6: Commit**

```bash
git add src/db/kaskaden/mannschaftsBegegnungKaskade.js tests/unit/db/kaskaden/mannschaftsBegegnungKaskade.test.js CLAUDE.md
git commit -m "feat: CouchDB-Pendant zu werteBegegnungAus/aktualisiereMannschaftsPool aus mannschaftsBegegnungEngine"
```

---

## Self-Review-Notizen

- **Spec-Abdeckung:** Deckt den Kernteil (automatische Fortschritts-Kaskade) von `mannschaftsBegegnungEngine.js` ab — damit haben alle drei Mannschafts-Pool-Manager Zugriff auf ein vollständiges CouchDB-Äquivalent ihrer `aktualisiereTurnier`-Logik, auch wenn die eigentliche Verdrahtung (Aufruf von `aktualisiereMannschaftsPool` aus den drei `mannschaft*PoolKaskade.js`-Dateien) bewusst nicht Teil dieses Plans ist.
- **Platzhalter-Scan:** Keine TBD/TODO-Stellen. `ermittleErsatzKandidaten`/`wechsleKaempfer` bewusst ausgeklammert (siehe Bewusste Scope-Grenze).
- **Determinismus der Tests:** Der Stichkampf-Test konstruiert bewusst genau EINE kontestierte Gewichtsklasse (zwei Kämpfe derselben Klasse, künstlich für den Testzweck — in der Praxis fochte jede Klasse nur einmal, aber die Funktion selbst validiert das nicht), damit `Math.random()` trotz echter Zufallsauswahl nur ein mögliches Ergebnis hat.
- **Wiederverwendung:** `wendeMannschaftsKaskadeAn` wird für die Begegnungs-Bracket-Kaskade importiert statt `berechneMannschaftsPatches` erneut inline zu laden/anzuwenden.
