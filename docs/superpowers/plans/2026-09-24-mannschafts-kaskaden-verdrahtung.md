# Mannschafts-Kaskaden-Verdrahtung Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die drei bereits migrierten Mannschafts-Pool-Kaskaden (`mannschaftJederGegenJedenPoolKaskade.js`, `mannschaftDoppelKo8PoolKaskade.js`, `mannschaftDoppelKo16PoolKaskade.js`) riefen bisher bewusst NICHT `aktualisiereMannschaftsPool` auf, da diese Funktion erst mit `docs/superpowers/plans/2026-09-24-mannschaftsbegegnung-kaskade.md` (jetzt approved und committed) verfügbar wurde. Dieser Plan schließt genau diese Lücke: alle drei `initialisierePool`-Funktionen rufen jetzt am Ende `aktualisiereMannschaftsPool` auf, exakt wie ihre knex-Originale `this.aktualisiereTurnier(knex, poolId)` aufrufen.

**Wichtige Erkenntnis für die bestehenden Tests:** Die existierenden Tests für die drei Kaskaden nutzen teils gar keine echten Pool-Dokumente (`mannschaftDoppelKo8/16PoolKaskade.test.js` verwenden bisher die literale ID `'pool:1'` ohne zugehöriges Dokument) — für diese läuft `aktualisiereMannschaftsPool` nach der Verdrahtung einfach ins Leere (`poolsRepository.findById('pool:1')` liefert `null`, Guard greift, keine Änderung). `mannschaftJederGegenJedenPoolKaskade.test.js` verwendet dagegen echte Pool-Dokumente (`poolsRepository.create({})`) ohne `mannschafts_gewichtsklassen` — hier bewirkt die Verdrahtung eine reale, korrekte Verhaltensänderung (eine Begegnung ohne konfigurierte Gewichtsklassen wird jetzt sofort auf `status:'beendet'`/`sieger_mannschaft_id:null` gesetzt, exakt wie das knex-Original das täte), die EINE bestehende Testerwartung entsprechend anpasst (siehe Task 1).

Vollständig getestet, weiterhin **nicht** in `src/app.js`/`src/routes/`/`src/controllers/` verdrahtet.

**Tech Stack:** Kein neuer Dependency-Bedarf.

**Spec:** [docs/superpowers/specs/2026-09-22-couchdb-pouchdb-migration-design.md](../specs/2026-09-22-couchdb-pouchdb-migration-design.md)

## Global Constraints

- ESM-Only — `import`/`export`, kein `require`.
- Keine Kommentare, die nur wiederholen, was der Code schon sagt.
- Genau EIN `startTestCouchServer()`-Aufruf pro Testdatei via `before()`/`after()` (bereits etabliert, unverändert).
- Keine der drei knex-Originale (`MannschaftJederGegenJedenManager.js`, `MannschaftDoppelKo8Manager.js`, `MannschaftDoppelKo16Manager.js`) und nicht `mannschaftsBegegnungEngine.js` werden verändert.
- Neue Parameter-Reihenfolge für alle drei `initialisierePool`-Signaturen: `kaempfeRepository` und `mannschaftMitgliederRepository` werden VOR `poolsRepository` eingefügt (Konsistenz mit `aktualisiereMannschaftsPool`s eigener Parameter-Reihenfolge aus `mannschaftsBegegnungKaskade.js`).
- Bei `mannschaftJederGegenJedenPoolKaskade.js` wird `aktualisiereMannschaftsPool` NUR im ≥2-Mannschaften-Pfad aufgerufen (nach dem Begegnungs-Insert) — nicht in den beiden Früh-Rückgabe-Zweigen (0 bzw. 1 Mannschaft), exakt wie im knex-Original.
- Bei den beiden Doppel-KO-Mannschafts-Kaskaden wird `aktualisiereMannschaftsPool` unconditional am Ende aufgerufen — auch hier exakt wie im jeweiligen knex-Original (keine Früh-Rückgabe-Zweige dort).

---

### Task 1: `mannschaftJederGegenJedenPoolKaskade.js` verdrahten

**Files:**
- Modify: `src/db/kaskaden/mannschaftJederGegenJedenPoolKaskade.js`
- Modify: `tests/unit/db/kaskaden/mannschaftJederGegenJedenPoolKaskade.test.js`

**Interfaces:**
- Produces (neue Signatur): `initialisierePool(kaempfeRepository, mannschaftskaempfeRepository, mannschaftenRepository, mannschaftMitgliederRepository, poolsRepository, poolId): Promise<void>`.

- [ ] **Step 1: Test anpassen/ergänzen**

In `tests/unit/db/kaskaden/mannschaftJederGegenJedenPoolKaskade.test.js`:

1. Imports ergänzen:
```javascript
import { createKaempfeRepository } from '../../../../src/db/repositories/kaempfeRepository.js';
import { createMannschaftMitgliederRepository } from '../../../../src/db/repositories/mannschaftMitgliederRepository.js';
```

2. `neueRepositories()` erweitern:
```javascript
async function neueRepositories() {
    const db = await ensureDatabase(nano, `test-${randomUUID()}`);
    return {
        kaempfeRepository: createKaempfeRepository(db),
        mannschaftskaempfeRepository: createMannschaftskaempfeRepository(db),
        mannschaftenRepository: createMannschaftenRepository(db),
        mannschaftMitgliederRepository: createMannschaftMitgliederRepository(db),
        poolsRepository: createPoolsRepository(db)
    };
}
```

3. In ALLEN VIER bestehenden Tests die Destrukturierung um `kaempfeRepository, mannschaftMitgliederRepository` erweitern und JEDEN `initialisierePool(...)`-Aufruf auf die neue 6-Parameter-Signatur umstellen:
```javascript
await initialisierePool(kaempfeRepository, mannschaftskaempfeRepository, mannschaftenRepository, mannschaftMitgliederRepository, poolsRepository, pool._id);
```
(bzw. mit dem jeweiligen `pool._id` aus dem Test).

4. Im ERSTEN Test ("initialisierePool erzeugt bei 2 Mannschaften genau eine Begegnung") die Statuserwartung anpassen — der Pool hat keine `mannschafts_gewichtsklassen` konfiguriert, daher markiert `aktualisiereMannschaftsPool` die Begegnung jetzt sofort als abgeschlossen ohne Sieger (keine gemeinsame Gewichtsklasse):
```javascript
    assert.equal(begegnungen[0].status, 'beendet');
```
(ersetzt die bisherige Zeile `assert.equal(begegnungen[0].status, 'bereit');`; die Zeile `assert.equal(begegnungen[0].sieger_mannschaft_id, null);` bleibt unverändert korrekt).

5. Der ZWEITE Test ("4 Mannschaften... feste Paarungstabelle") prüft `status` nicht — hier ist außer der Signatur-Anpassung (Schritt 3) keine weitere Änderung nötig.

6. Nach dem letzten bestehenden Test einen neuen Test ergänzen:

```javascript
test('initialisierePool ruft aktualisiereMannschaftsPool auf und erzeugt bei konfigurierten Gewichtsklassen Einzelkämpfe', async () => {
    const { kaempfeRepository, mannschaftskaempfeRepository, mannschaftenRepository, mannschaftMitgliederRepository, poolsRepository } = await neueRepositories();
    const pool = await poolsRepository.create({ mannschafts_gewichtsklassen: JSON.stringify(['-60kg']) });
    const m1 = await mannschaftenRepository.create({ pool_id: pool._id, verein: 'Team A' });
    const m2 = await mannschaftenRepository.create({ pool_id: pool._id, verein: 'Team B' });
    await mannschaftMitgliederRepository.create({ mannschaft_id: m1._id, turnier_teilnehmer_id: 'teilnehmer:a', gewichtsklasse: '-60kg' });
    await mannschaftMitgliederRepository.create({ mannschaft_id: m2._id, turnier_teilnehmer_id: 'teilnehmer:b', gewichtsklasse: '-60kg' });

    await initialisierePool(kaempfeRepository, mannschaftskaempfeRepository, mannschaftenRepository, mannschaftMitgliederRepository, poolsRepository, pool._id);

    const begegnungen = await mannschaftskaempfeRepository.findByPool(pool._id);
    assert.equal(begegnungen.length, 1);
    assert.equal(begegnungen[0].status, 'bereit');
    const kaempfe = await kaempfeRepository.query({ mannschaftskampf_id: begegnungen[0]._id });
    assert.equal(kaempfe.length, 1);
    assert.equal(kaempfe[0].kaempfer1_id, 'teilnehmer:a');
    assert.equal(kaempfe[0].kaempfer2_id, 'teilnehmer:b');
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag bestätigen**

Run: `npm run test:unit`
Expected: FAIL — Signatur-Mismatch (`poolsRepository.update is not a function` o.ä., da `poolId` durch die alte Aufruf-Reihenfolge an der falschen Stelle landet) bzw. `aktualisiereMannschaftsPool is not defined`, je nachdem was zuerst implementiert wird. Wichtig ist nur: es schlägt VOR Step 3 fehl.

- [ ] **Step 3: Implementieren**

In `src/db/kaskaden/mannschaftJederGegenJedenPoolKaskade.js`:

1. Import ergänzen (nach dem bestehenden Dateikopf-Kommentar):
```javascript
import { aktualisiereMannschaftsPool } from './mannschaftsBegegnungKaskade.js';
```

2. Die Funktionssignatur und den Aufruf am Ende ändern:
```javascript
export async function initialisierePool(kaempfeRepository, mannschaftskaempfeRepository, mannschaftenRepository, mannschaftMitgliederRepository, poolsRepository, poolId) {
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

    await aktualisiereMannschaftsPool(kaempfeRepository, mannschaftskaempfeRepository, mannschaftMitgliederRepository, poolsRepository, poolId);
}
```

(Der übrige Code — `ermittlePaarungen`, der Dateikopf-Kommentar — bleibt unverändert; der Kommentar-Absatz, der bisher erklärte, warum `aktualisiereTurnier` NICHT aufgerufen wird, sollte jetzt entfernt oder auf die neue Realität angepasst werden, siehe Step 5 nicht nötig hier da kein CLAUDE.md-Task — Kommentar im Quellcode selbst kurz anpassen: die Zeile „Der anschließende aktualisiereTurnier-Aufruf des Originals delegiert an mannschaftsBegegnungEngine.js ... bewusst NICHT Teil dieser Kaskade" durch einen kurzen Hinweis ersetzen, dass `aktualisiereMannschaftsPool` jetzt aufgerufen wird.)

- [ ] **Step 4: Test ausführen, Erfolg bestätigen**

Run: `npm run test:unit`
Expected: PASS (1 neuer Test, insgesamt 127)

- [ ] **Step 5: Commit**

```bash
git add src/db/kaskaden/mannschaftJederGegenJedenPoolKaskade.js tests/unit/db/kaskaden/mannschaftJederGegenJedenPoolKaskade.test.js
git commit -m "feat: mannschaftJederGegenJedenPoolKaskade ruft aktualisiereMannschaftsPool auf"
```

---

### Task 2: `mannschaftDoppelKo8PoolKaskade.js` verdrahten

**Files:**
- Modify: `src/db/kaskaden/mannschaftDoppelKo8PoolKaskade.js`
- Modify: `tests/unit/db/kaskaden/mannschaftDoppelKo8PoolKaskade.test.js`

**Interfaces:**
- Produces (neue Signatur): `initialisierePool(kaempfeRepository, mannschaftskaempfeRepository, mannschaftenRepository, mannschaftMitgliederRepository, poolsRepository, poolId): Promise<void>`.

- [ ] **Step 1: Test anpassen/ergänzen**

In `tests/unit/db/kaskaden/mannschaftDoppelKo8PoolKaskade.test.js`:

1. Imports ergänzen:
```javascript
import { createKaempfeRepository } from '../../../../src/db/repositories/kaempfeRepository.js';
import { createMannschaftMitgliederRepository } from '../../../../src/db/repositories/mannschaftMitgliederRepository.js';
import { createPoolsRepository } from '../../../../src/db/repositories/poolsRepository.js';
```

2. `neueRepositories()` erweitern:
```javascript
async function neueRepositories() {
    const db = await ensureDatabase(nano, `test-${randomUUID()}`);
    return {
        kaempfeRepository: createKaempfeRepository(db),
        mannschaftskaempfeRepository: createMannschaftskaempfeRepository(db),
        mannschaftenRepository: createMannschaftenRepository(db),
        mannschaftMitgliederRepository: createMannschaftMitgliederRepository(db),
        poolsRepository: createPoolsRepository(db)
    };
}
```

3. In BEIDEN bestehenden Tests die Destrukturierung erweitern und die `initialisierePool(...)`-Aufrufe auf die neue Signatur umstellen — `poolId` bleibt die literale `'pool:1'` (kein echtes Pool-Dokument, `aktualisiereMannschaftsPool` findet dafür keinen Pool und bricht über den `if (!pool) return;`-Guard folgenlos ab — KEINE Änderung an den bestehenden Assertions nötig):
```javascript
await initialisierePool(kaempfeRepository, mannschaftskaempfeRepository, mannschaftenRepository, mannschaftMitgliederRepository, poolsRepository, 'pool:1');
```

4. Nach dem letzten bestehenden Test einen neuen Test ergänzen:

```javascript
test('initialisierePool ruft aktualisiereMannschaftsPool auf und erzeugt bei konfigurierten Gewichtsklassen einen Einzelkampf für H1', async () => {
    const { kaempfeRepository, mannschaftskaempfeRepository, mannschaftenRepository, mannschaftMitgliederRepository, poolsRepository } = await neueRepositories();
    const pool = await poolsRepository.create({ mannschafts_gewichtsklassen: JSON.stringify(['-60kg']) });
    const m = [];
    for (let i = 0; i < 8; i++) {
        m.push(await mannschaftenRepository.create({ pool_id: pool._id, verein: `Team ${i + 1}` }));
        await mannschaftMitgliederRepository.create({ mannschaft_id: m[i]._id, turnier_teilnehmer_id: `teilnehmer:${i}`, gewichtsklasse: '-60kg' });
    }

    await initialisierePool(kaempfeRepository, mannschaftskaempfeRepository, mannschaftenRepository, mannschaftMitgliederRepository, poolsRepository, pool._id);

    const begegnungen = await mannschaftskaempfeRepository.findByPool(pool._id);
    const h1 = begegnungen.find(b => b.reihenfolge_nummer === 'H1');
    assert.equal(h1.status, 'bereit');
    const kaempfe = await kaempfeRepository.query({ mannschaftskampf_id: h1._id });
    assert.equal(kaempfe.length, 1);
    assert.equal(kaempfe[0].kaempfer1_id, 'teilnehmer:0');
    assert.equal(kaempfe[0].kaempfer2_id, 'teilnehmer:1');
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag bestätigen**

Run: `npm run test:unit`
Expected: FAIL — Signatur-Mismatch bzw. `aktualisiereMannschaftsPool is not defined`.

- [ ] **Step 3: Implementieren**

In `src/db/kaskaden/mannschaftDoppelKo8PoolKaskade.js`:

1. Import ergänzen:
```javascript
import { aktualisiereMannschaftsPool } from './mannschaftsBegegnungKaskade.js';
```

2. Signatur ändern und Aufruf am Ende ergänzen:
```javascript
export async function initialisierePool(kaempfeRepository, mannschaftskaempfeRepository, mannschaftenRepository, mannschaftMitgliederRepository, poolsRepository, poolId) {
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
    await aktualisiereMannschaftsPool(kaempfeRepository, mannschaftskaempfeRepository, mannschaftMitgliederRepository, poolsRepository, poolId);
}
```

Den Dateikopf-Kommentar entsprechend anpassen (Hinweis auf die jetzt aufgerufene `aktualisiereMannschaftsPool` statt der bisherigen "bewusst NICHT Teil dieser Kaskade"-Formulierung).

- [ ] **Step 4: Test ausführen, Erfolg bestätigen**

Run: `npm run test:unit`
Expected: PASS (1 neuer Test, insgesamt 128)

- [ ] **Step 5: Commit**

```bash
git add src/db/kaskaden/mannschaftDoppelKo8PoolKaskade.js tests/unit/db/kaskaden/mannschaftDoppelKo8PoolKaskade.test.js
git commit -m "feat: mannschaftDoppelKo8PoolKaskade ruft aktualisiereMannschaftsPool auf"
```

---

### Task 3: `mannschaftDoppelKo16PoolKaskade.js` verdrahten + CLAUDE.md

**Files:**
- Modify: `src/db/kaskaden/mannschaftDoppelKo16PoolKaskade.js`
- Modify: `tests/unit/db/kaskaden/mannschaftDoppelKo16PoolKaskade.test.js`
- Modify: `CLAUDE.md`

**Interfaces:**
- Produces (neue Signatur): `initialisierePool(kaempfeRepository, mannschaftskaempfeRepository, mannschaftenRepository, mannschaftMitgliederRepository, poolsRepository, poolId): Promise<void>`.

- [ ] **Step 1: Test anpassen/ergänzen**

Analog zu Task 2, aber für 16 Mannschaften:

1. Imports ergänzen (wie in Task 2, Schritt 1).
2. `neueRepositories()` erweitern (wie in Task 2, Schritt 2).
3. Beide bestehenden Tests: Signatur-Aufruf umstellen, `poolId` bleibt `'pool:1'` (kein echtes Dokument) — keine Assertion-Änderung nötig.
4. Neuer Test:

```javascript
test('initialisierePool ruft aktualisiereMannschaftsPool auf und erzeugt bei konfigurierten Gewichtsklassen einen Einzelkampf für H1', async () => {
    const { kaempfeRepository, mannschaftskaempfeRepository, mannschaftenRepository, mannschaftMitgliederRepository, poolsRepository } = await neueRepositories();
    const pool = await poolsRepository.create({ mannschafts_gewichtsklassen: JSON.stringify(['-60kg']) });
    const m = [];
    for (let i = 0; i < 16; i++) {
        m.push(await mannschaftenRepository.create({ pool_id: pool._id, verein: `Team ${i + 1}` }));
        await mannschaftMitgliederRepository.create({ mannschaft_id: m[i]._id, turnier_teilnehmer_id: `teilnehmer:${i}`, gewichtsklasse: '-60kg' });
    }

    await initialisierePool(kaempfeRepository, mannschaftskaempfeRepository, mannschaftenRepository, mannschaftMitgliederRepository, poolsRepository, pool._id);

    const begegnungen = await mannschaftskaempfeRepository.findByPool(pool._id);
    const h1 = begegnungen.find(b => b.reihenfolge_nummer === 'H1');
    assert.equal(h1.status, 'bereit');
    const kaempfe = await kaempfeRepository.query({ mannschaftskampf_id: h1._id });
    assert.equal(kaempfe.length, 1);
    assert.equal(kaempfe[0].kaempfer1_id, 'teilnehmer:0');
    assert.equal(kaempfe[0].kaempfer2_id, 'teilnehmer:1');
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag bestätigen**

Run: `npm run test:unit`
Expected: FAIL — Signatur-Mismatch bzw. `aktualisiereMannschaftsPool is not defined`.

- [ ] **Step 3: Implementieren**

In `src/db/kaskaden/mannschaftDoppelKo16PoolKaskade.js` analog zu Task 2: Import ergänzen, Signatur ändern, `await aktualisiereMannschaftsPool(kaempfeRepository, mannschaftskaempfeRepository, mannschaftMitgliederRepository, poolsRepository, poolId);` als letzte Zeile der Funktion (nach dem bestehenden `verknuepfeQuellenFuerMannschaftsPool`-Aufruf) ergänzen. Dateikopf-Kommentar entsprechend anpassen.

- [ ] **Step 4: Test ausführen, Erfolg bestätigen**

Run: `npm run test:unit`
Expected: PASS (1 neuer Test, insgesamt 129)

- [ ] **Step 5: CLAUDE.md aktualisieren**

Im Abschnitt "Zentrale Architekturkonzepte", Punkt zu `src/db/kaskaden/`: die drei Sätze zu `mannschaftJederGegenJedenPoolKaskade.js`, `mannschaftDoppelKo8PoolKaskade.js`, `mannschaftDoppelKo16PoolKaskade.js` anpassen — statt "der anschließende aktualisiereTurnier-Aufruf ... ist bewusst NICHT Teil dieser Kaskade" jetzt jeweils festhalten, dass sie nach der Begegnungs-Erzeugung `aktualisiereMannschaftsPool` (aus `mannschaftsBegegnungKaskade.js`) aufrufen — die drei Mannschafts-Pool-Kaskaden sind damit vollständig, analog zu ihren knex-Originalen.

- [ ] **Step 6: Commit**

```bash
git add src/db/kaskaden/mannschaftDoppelKo16PoolKaskade.js tests/unit/db/kaskaden/mannschaftDoppelKo16PoolKaskade.test.js CLAUDE.md
git commit -m "feat: mannschaftDoppelKo16PoolKaskade ruft aktualisiereMannschaftsPool auf"
```

---

## Self-Review-Notizen

- **Spec-Abdeckung:** Schließt die zuletzt in drei separaten Plänen (JgJ, DoppelKo8, DoppelKo16 für Mannschaften) bewusst offen gelassene Lücke — alle drei Mannschafts-Pool-Kaskaden sind jetzt vollständig äquivalent zu ihren knex-Originalen, inklusive der automatischen Einzelkampf-Erzeugung/Auswertung.
- **Platzhalter-Scan:** Keine TBD/TODO-Stellen. `ermittleErsatzKandidaten`/`wechsleKaempfer` bleiben weiterhin bewusst außerhalb des Scopes (unverändert seit dem vorherigen Plan).
- **Bestehende Tests:** Nur EINE Assertion in einer bereits approved Testdatei ändert sich (`mannschaftJederGegenJedenPoolKaskade.test.js`, Status-Erwartung bei fehlenden Gewichtsklassen) — begründet durch eine echte, korrekte Verhaltensänderung, kein Kollateralschaden. Alle anderen Änderungen an bestehenden Tests sind reine Signatur-Anpassungen ohne Assertion-Änderungen.
- **Reihenfolge:** Die drei Tasks sind unabhängig voneinander (verschiedene Dateien), könnten parallel bearbeitet werden — werden hier aus Konsistenzgründen sequentiell abgearbeitet, wie in dieser Session durchgehend üblich.
