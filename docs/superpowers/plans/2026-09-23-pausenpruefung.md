# Pausenprüfung Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die bereits vorhandene, reine `src/shared/pausenRegel.js`-Engine (DJB-WKO-Mindestpausenzeiten zwischen zwei Kämpfen desselben Athleten) mit dem `kaempfeRepository` verbinden — nach demselben Muster wie der Kaskaden-Dienst. Dafür braucht `kaempfeRepository.js` zwei kleine Ergänzungen: `findAll()` (Pausenprüfung braucht ALLE Kämpfe eines Turniers über alle Pools hinweg, da ein Athlet in unterschiedlichen Pools kämpfen kann — anders als `findByPool`, das für die Bracket-Kaskade genügt) und automatisches `updated_at`-Zeitstempeln bei `update()` (die Engine ermittelt das Ende des letzten Kampfes über genau dieses Feld). Vollständig getestet, weiterhin **nicht** in `src/app.js`/`src/routes/`/`src/controllers/` verdrahtet.

**Architecture:** `kaempfeRepository.js` bekommt `findAll()` (identisches Sortiermuster wie die bereits vorhandenen `findAll()`-Implementierungen der accounts-Repositories) und einen `update()`-Override, der `updated_at` bei jedem Aufruf auf den aktuellen Zeitpunkt setzt (analog zum bereits bestehenden `created_at`-Muster bei `create()`). Ein neues Orchestrierungs-Modul `src/db/kaskaden/pausenPruefung.js` lädt darauf aufbauend alle Kämpfe, baut die Zuordnung "Teilnehmer -> Ende des letzten echten Kampfes" und prüft einen anstehenden Kampf dagegen — unverändert unter Verwendung von `src/shared/pausenRegel.js`.

**Tech Stack:** Kein neuer Dependency-Bedarf.

**Spec:** [docs/superpowers/specs/2026-09-22-couchdb-pouchdb-migration-design.md](../specs/2026-09-22-couchdb-pouchdb-migration-design.md)

## Global Constraints

- ESM-Only — `import`/`export`, kein `require`.
- Keine Kommentare, die nur wiederholen, was der Code schon sagt.
- Genau EIN `startTestCouchServer()`-Aufruf pro Testdatei via `before()`/`after()`.
- `src/shared/pausenRegel.js` wird **unverändert** aufgerufen — keine Anpassung dieser bereits bestehenden, reinen Engine.
- Kein automatisches `updated_at`-Zeitstempeln wird in `baseRepository.js` selbst eingeführt — das bleibt (wie bei `created_at`) eine bewusste Pro-Entität-Ergänzung, hier zunächst nur für `kaempfeRepository.js`, da nur diese Engine das Feld tatsächlich braucht (YAGNI: die anderen zehn bereits bestehenden Repositories bekommen keinen unbenutzten `update()`-Override).
- Diese Schicht wird in diesem Plan **nicht** in `src/app.js`, `src/routes/` oder `src/controllers/` verdrahtet.

---

### Task 1: `kaempfeRepository.js` um `findAll` und `updated_at`-Zeitstempel erweitern

**Files:**
- Modify: `src/db/repositories/kaempfeRepository.js`
- Modify: `tests/unit/db/repositories/kaempfeRepository.test.js`

**Interfaces:**
- Produces: `createKaempfeRepository(db)` erweitert um `findAll(): Promise<Array>` und einen `update(id, patch)`-Override, der `updated_at` automatisch setzt. `findById`/`remove`/`query`/`findByPool` bleiben unverändert.

- [ ] **Step 1: Failing Tests schreiben**

In `tests/unit/db/repositories/kaempfeRepository.test.js` nach dem letzten bestehenden Test zwei neue Tests ergänzen:

```javascript
test('findAll liefert Kämpfe über mehrere Pools hinweg', async () => {
    const repo = await neuesRepository();
    await repo.create({ pool_id: 'pool:1', status: 'angelegt' });
    await repo.create({ pool_id: 'pool:2', status: 'angelegt' });

    const gefunden = await repo.findAll();

    assert.equal(gefunden.length, 2);
});

test('update aktualisiert updated_at bei jedem Aufruf', async () => {
    const repo = await neuesRepository();
    const kampf = await repo.create({ pool_id: 'pool:1', status: 'angelegt' });

    const vorher = Date.now();
    const aktualisiert = await repo.update(kampf._id, { status: 'bereit' });
    const nachher = Date.now();

    assert.ok(aktualisiert.updated_at);
    const zeitstempelMs = new Date(aktualisiert.updated_at).getTime();
    assert.ok(zeitstempelMs >= vorher && zeitstempelMs <= nachher);
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag bestätigen**

Run: `npm run test:unit`
Expected: FAIL — `repo.findAll is not a function`, und der zweite neue Test schlägt fehl, da `aktualisiert.updated_at` noch `undefined` ist

- [ ] **Step 3: `kaempfeRepository.js` erweitern**

In `src/db/repositories/kaempfeRepository.js` ersetze

```javascript
    async function findByPool(poolId) {
        const gefunden = await repo.query({ pool_id: poolId });
        return gefunden.sort((a, b) => a.created_at.localeCompare(b.created_at));
    }

    return { ...repo, create, findByPool };
```

durch

```javascript
    async function findByPool(poolId) {
        const gefunden = await repo.query({ pool_id: poolId });
        return gefunden.sort((a, b) => a.created_at.localeCompare(b.created_at));
    }

    // findAll (statt nur findByPool) wird für die Pausenprüfung gebraucht: ein Athlet kann in
    // unterschiedlichen Pools desselben Turniers kämpfen, die Mindestpause gilt aber
    // poolübergreifend.
    async function findAll() {
        const gefunden = await repo.query({});
        return gefunden.sort((a, b) => a.created_at.localeCompare(b.created_at));
    }

    // pausenRegel.js ermittelt das Ende des letzten Kampfes über updated_at -- anders als
    // created_at (einmalig bei der Erstellung) muss dieses Feld bei JEDEM Update aktualisiert
    // werden, nicht nur beim Setzen von status: 'beendet', damit es dem tatsächlichen
    // Bearbeitungszeitpunkt entspricht.
    async function update(id, patch) {
        return repo.update(id, { ...patch, updated_at: new Date().toISOString() });
    }

    return { ...repo, create, update, findByPool, findAll };
```

- [ ] **Step 4: Test ausführen, Erfolg bestätigen**

Run: `npm run test:unit`
Expected: PASS (2 neue Tests)

- [ ] **Step 5: Commit**

```bash
git add src/db/repositories/kaempfeRepository.js tests/unit/db/repositories/kaempfeRepository.test.js
git commit -m "feat: kaempfeRepository um findAll und automatisches updated_at erweitern"
```

---

### Task 2: `pausenPruefung.js`

**Files:**
- Create: `src/db/kaskaden/pausenPruefung.js`
- Test: `tests/unit/db/kaskaden/pausenPruefung.test.js`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: `letztesKampfEndeProTeilnehmer(kaempfe)`, `pruefeKampfPause(kampf, altersklasse, letztesEndeMap, jetztMs)` aus `src/shared/pausenRegel.js` (unverändert); `findAll()` aus `kaempfeRepository` (Task 1).
- Produces: `pruefePauseFuerKampf(kaempfeRepository, kampf, altersklasse, jetztMs = Date.now()): Promise<{ok: boolean, kaempfer: Array}>`.

- [ ] **Step 1: Failing Test schreiben**

`tests/unit/db/kaskaden/pausenPruefung.test.js`:

```javascript
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startTestCouchServer } from '../../helpers/couchTestServer.js';
import { connect, ensureDatabase } from '../../../../src/db/couch.js';
import { createKaempfeRepository } from '../../../../src/db/repositories/kaempfeRepository.js';
import { pruefePauseFuerKampf } from '../../../../src/db/kaskaden/pausenPruefung.js';

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

test('pruefePauseFuerKampf meldet zu kurze Pause seit dem letzten Kampf desselben Athleten', async () => {
    const repo = await neuesRepository();
    const beendeterKampf = await repo.create({
        pool_id: 'pool:1', kaempfer1_id: 'teilnehmer:1', kaempfer2_id: 'teilnehmer:2', status: 'beendet'
    });
    // update() stempelt updated_at auf JETZT -- die Prüfung tut so, als wäre seitdem nur eine
    // Minute vergangen (deutlich weniger als die 6 Minuten Mindestpause für U15).
    const jetztMs = new Date(beendeterKampf.updated_at ?? beendeterKampf.created_at).getTime() + 60 * 1000;

    const anstehenderKampf = { kaempfer1_id: 'teilnehmer:1', kaempfer2_id: 'teilnehmer:3' };
    const ergebnis = await pruefePauseFuerKampf(repo, anstehenderKampf, 'U15', jetztMs);

    assert.equal(ergebnis.ok, false);
    assert.equal(ergebnis.kaempfer.length, 1);
    assert.equal(ergebnis.kaempfer[0].id, 'teilnehmer:1');
    assert.equal(ergebnis.kaempfer[0].benoetigteSekunden, 360);
});

test('pruefePauseFuerKampf meldet ausreichende Pause nach genug verstrichener Zeit', async () => {
    const repo = await neuesRepository();
    const beendeterKampf = await repo.create({
        pool_id: 'pool:1', kaempfer1_id: 'teilnehmer:1', kaempfer2_id: 'teilnehmer:2', status: 'beendet'
    });
    // 400 Sekunden seit Kampfende -- mehr als die 360 Sekunden Mindestpause für U15.
    const jetztMs = new Date(beendeterKampf.updated_at ?? beendeterKampf.created_at).getTime() + 400 * 1000;

    const anstehenderKampf = { kaempfer1_id: 'teilnehmer:1', kaempfer2_id: 'teilnehmer:3' };
    const ergebnis = await pruefePauseFuerKampf(repo, anstehenderKampf, 'U15', jetztMs);

    assert.equal(ergebnis.ok, true);
    assert.equal(ergebnis.kaempfer.length, 0);
});

test('pruefePauseFuerKampf erlaubt Athleten ohne vorherigen Kampf sofort', async () => {
    const repo = await neuesRepository();

    const anstehenderKampf = { kaempfer1_id: 'teilnehmer:1', kaempfer2_id: 'teilnehmer:2' };
    const ergebnis = await pruefePauseFuerKampf(repo, anstehenderKampf, 'U18', Date.now());

    assert.equal(ergebnis.ok, true);
});

test('pruefePauseFuerKampf berücksichtigt Kämpfe aus anderen Pools desselben Turniers', async () => {
    const repo = await neuesRepository();
    const beendeterKampf = await repo.create({
        pool_id: 'pool:andere-gewichtsklasse', kaempfer1_id: 'teilnehmer:1', kaempfer2_id: 'teilnehmer:9', status: 'beendet'
    });
    const jetztMs = new Date(beendeterKampf.updated_at ?? beendeterKampf.created_at).getTime() + 60 * 1000;

    const anstehenderKampf = { kaempfer1_id: 'teilnehmer:1', kaempfer2_id: 'teilnehmer:3' };
    const ergebnis = await pruefePauseFuerKampf(repo, anstehenderKampf, 'U18', jetztMs);

    assert.equal(ergebnis.ok, false);
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag bestätigen**

Run: `npm run test:unit`
Expected: FAIL — `Cannot find module '.../src/db/kaskaden/pausenPruefung.js'`

- [ ] **Step 3: Implementieren**

`src/db/kaskaden/pausenPruefung.js`:

```javascript
import { letztesKampfEndeProTeilnehmer, pruefeKampfPause } from '../../shared/pausenRegel.js';

// Verbindet die reine, seiteneffektfreie pausenRegel.js-Engine mit dem kaempfeRepository:
// lädt ALLE Kämpfe des Turniers (nicht nur eines Pools, siehe findAll() in kaempfeRepository.js)
// und prüft einen anstehenden Kampf gegen die DJB-WKO-Mindestpause.
export async function pruefePauseFuerKampf(kaempfeRepository, kampf, altersklasse, jetztMs = Date.now()) {
    const alleKaempfe = await kaempfeRepository.findAll();
    const letztesEndeMap = letztesKampfEndeProTeilnehmer(alleKaempfe);
    return pruefeKampfPause(kampf, altersklasse, letztesEndeMap, jetztMs);
}
```

- [ ] **Step 4: Test ausführen, Erfolg bestätigen**

Run: `npm run test:unit`
Expected: PASS (4 neue Tests, insgesamt 70)

- [ ] **Step 5: Dokumentation ergänzen**

In `CLAUDE.md` im Abschnitt "Zentrale Architekturkonzepte", im Punkt zu `src/db/kaskaden/` (aus dem vorherigen Plan), einen Halbsatz ergänzen, der `pausenPruefung.js` als drittes Modul nennt — verbindet `pausenRegel.js` mit `kaempfeRepository.findAll()`.

- [ ] **Step 6: Commit**

```bash
git add src/db/kaskaden/pausenPruefung.js tests/unit/db/kaskaden/pausenPruefung.test.js CLAUDE.md
git commit -m "feat: Pausenprüfung verbindet pausenRegel.js mit kaempfeRepository"
```

---

## Self-Review-Notizen

- **Spec-Abdeckung:** Verbindet eine weitere bereits bestehende, reine `src/shared/`-Engine mit der Repository-Schicht, nach demselben bereits etablierten und review-geprüften Muster wie der Kaskaden-Dienst.
- **Platzhalter-Scan:** Keine TBD/TODO-Stellen. Test-Zeitstempel werden relativ zum tatsächlich von `update()`/`create()` gesetzten `updated_at`/`created_at` berechnet (nicht mit festen Datumswerten), damit die Tests unabhängig von der tatsächlichen Ausführungsgeschwindigkeit deterministisch bleiben.
- **Typ-Konsistenz:** `pruefePauseFuerKampf(kaempfeRepository, kampf, altersklasse, jetztMs)` reicht `jetztMs` unverändert an `pruefeKampfPause` durch — keine eigene Zeitlogik, nur Verkabelung.
