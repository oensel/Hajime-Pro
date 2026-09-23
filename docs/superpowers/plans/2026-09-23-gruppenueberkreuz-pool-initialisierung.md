# Gruppen-Überkreuz Pool-Initialisierung Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CouchDB-Äquivalent von `src/services/GruppenUeberKreuzManager.js` (`initialisierePool`, `aktualisiereTurnier`) — sechstes von acht `*Manager.js`-Pool-Anlage-Services. Anders als die drei Doppel-KO-Systeme (bereits migriert) gibt es hier keine Freilos-/Vereinstrennungs-Logik (exakt 6 Teilnehmer, harter Fehlerwurf sonst) und keine Rasterbefüllung, aber eine ZUSÄTZLICHE, bereits reine/DB-freie Engine (`src/shared/gruppenUeberkreuzProgression.js`, `berechneGruppenUeberkreuzHalbfinalPatches`) für den einen Übergang, der sich nicht auf einen einzelnen Quellkampf reduzieren lässt (Halbfinale HF1/HF2 aus einer N-zu-2-Ranglistenberechnung über je 3 Vorrundenkämpfe pro Gruppe).

**Wiederverwendung bereits migrierter Bausteine:** `verknuepfeQuellenFuerPool` (`src/db/kaskaden/bracketVerknuepfung.js`) wird direkt wiederverwendet, mit der bereits bestehenden `GRUPPEN_UEBERKREUZ_TOPOLOGIE`-Konstante (die nur F1/F2 verknüpft — HF1/HF2 bleiben bewusst unverknüpft, siehe Kommentar in `bracketTopologie.js`). `berechneKaempferPatches` (`src/shared/kampfProgression.js`) und `berechneGruppenUeberkreuzHalbfinalPatches` (`src/shared/gruppenUeberkreuzProgression.js`) sind beide bereits reine, DB-freie Funktionen und werden direkt importiert — keine neue Kaskaden-Engine nötig, nur eine neue Orchestrierung (`aktualisiereTurnier`) mit zwei Phasen statt der einfachen `wendeKaempfeKaskadeAn`-Schleife, weil hier zwei unterschiedliche Patch-Quellen kombiniert werden müssen (identisch zur Zwei-Phasen-Struktur des knex-Originals).

Vollständig getestet, weiterhin **nicht** in `src/app.js`/`src/routes/`/`src/controllers/` verdrahtet.

**Architecture:** Eine neue Kaskaden-Datei `src/db/kaskaden/gruppenUeberKreuzPoolKaskade.js` mit einer privaten `teileTeilnehmerAuf(teilnehmer)`-Hilfsfunktion (reine Portierung, `id`→`_id`) und zwei exportierten Funktionen (`initialisierePool`, `aktualisiereTurnier`). `aktualisiereTurnier` nutzt denselben lokalen `mitId()`-Bridging-Trick wie `kaempfeKaskade.js`, da sowohl `berechneKaempferPatches` als auch `berechneGruppenUeberkreuzHalbfinalPatches` ein Feld `id` statt `_id` erwarten/zurückgeben.

**Tech Stack:** Kein neuer Dependency-Bedarf.

**Spec:** [docs/superpowers/specs/2026-09-22-couchdb-pouchdb-migration-design.md](../specs/2026-09-22-couchdb-pouchdb-migration-design.md)

## Global Constraints

- ESM-Only — `import`/`export`, kein `require`.
- Keine Kommentare, die nur wiederholen, was der Code schon sagt.
- Genau EIN `startTestCouchServer()`-Aufruf pro Testdatei via `before()`/`after()`.
- `src/services/GruppenUeberKreuzManager.js` und `src/shared/gruppenUeberkreuzProgression.js` werden **nicht** verändert.
- Der harte Fehlerwurf bei falscher Teilnehmerzahl (`throw new Error(...)`, exakt 6 gefordert) bleibt erhalten — anders als bei den Doppel-KO-Systemen, die keine solche Validierung haben.
- `reihenfolge_nummer` bleibt String (`'V_A_1'`, `'HF1'`, `'F1'`, `'F2'`), exakt wie im Original. Das zusätzliche Feld `gruppe` (`'A'`/`'B'`) wird nur bei den 6 Vorrundenkämpfen gesetzt, nicht bei den Hüllen.
- `HF1`/`HF2` bleiben nach `verknuepfeQuellenFuerPool` OHNE `kaempferN_quelle_kampf_id`-Felder (die Topologie enthält sie bewusst nicht) — nicht versehentlich eine Verknüpfung dafür erfinden.
- Diese Schicht wird in diesem Plan **nicht** in `src/app.js`, `src/routes/` oder `src/controllers/` verdrahtet.

---

### Task 1: `gruppenUeberKreuzPoolKaskade.js`

**Files:**
- Create: `src/db/kaskaden/gruppenUeberKreuzPoolKaskade.js`
- Test: `tests/unit/db/kaskaden/gruppenUeberKreuzPoolKaskade.test.js`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: `findByPool(poolId)` aus `turnierTeilnehmerRepository`; `create(data)`/`findByPool(poolId)`/`update(id,patch)` aus `kaempfeRepository`; `update(id,patch)`/`findById(id)` aus `poolsRepository`; `verknuepfeQuellenFuerPool` aus `./bracketVerknuepfung.js`; `berechneKaempferPatches` aus `../../shared/kampfProgression.js`; `berechneGruppenUeberkreuzHalbfinalPatches` aus `../../shared/gruppenUeberkreuzProgression.js`; `GRUPPEN_UEBERKREUZ_TOPOLOGIE` aus `../../shared/bracketTopologie.js`.
- Produces: `initialisierePool(kaempfeRepository, turnierTeilnehmerRepository, poolsRepository, poolId): Promise<void>` (wirft bei falscher Teilnehmerzahl), `aktualisiereTurnier(kaempfeRepository, poolsRepository, poolId): Promise<void>`.

- [ ] **Step 1: Failing Tests schreiben**

`tests/unit/db/kaskaden/gruppenUeberKreuzPoolKaskade.test.js`:

```javascript
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startTestCouchServer } from '../../helpers/couchTestServer.js';
import { connect, ensureDatabase } from '../../../../src/db/couch.js';
import { createKaempfeRepository } from '../../../../src/db/repositories/kaempfeRepository.js';
import { createTurnierTeilnehmerRepository } from '../../../../src/db/repositories/turnierTeilnehmerRepository.js';
import { createPoolsRepository } from '../../../../src/db/repositories/poolsRepository.js';
import { initialisierePool, aktualisiereTurnier } from '../../../../src/db/kaskaden/gruppenUeberKreuzPoolKaskade.js';

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

test('initialisierePool wirft einen Fehler, wenn nicht exakt 6 Teilnehmer registriert sind', async () => {
    const { kaempfeRepository, turnierTeilnehmerRepository, poolsRepository } = await neueRepositories();
    const pool = await poolsRepository.create({});
    for (let i = 0; i < 5; i++) {
        await turnierTeilnehmerRepository.create({ pool_id: pool._id, gewicht: 50 + i });
    }

    await assert.rejects(
        () => initialisierePool(kaempfeRepository, turnierTeilnehmerRepository, poolsRepository, pool._id),
        { message: 'Das Gruppensystem über Kreuz benötigt exakt 6 Teilnehmer.' }
    );

    const kaempfe = await kaempfeRepository.findByPool(pool._id);
    assert.equal(kaempfe.length, 0);
});

test('initialisierePool teilt 6 Teilnehmer nach Gewicht auf zwei Gruppen auf und erzeugt Vorrunde plus Hüllen', async () => {
    const { kaempfeRepository, turnierTeilnehmerRepository, poolsRepository } = await neueRepositories();
    const pool = await poolsRepository.create({});
    const t = {};
    for (const gewicht of [50, 55, 60, 65, 70, 75]) {
        t[gewicht] = await turnierTeilnehmerRepository.create({ pool_id: pool._id, gewicht });
    }

    await initialisierePool(kaempfeRepository, turnierTeilnehmerRepository, poolsRepository, pool._id);

    const kaempfe = await kaempfeRepository.findByPool(pool._id);
    assert.equal(kaempfe.length, 10);
    const byReihenfolge = Object.fromEntries(kaempfe.map(k => [k.reihenfolge_nummer, k]));

    // Sortiert nach Gewicht: [50,55,60,65,70,75] -> poolA=[50,60,70] (Index 0,2,4), poolB=[55,65,75] (Index 1,3,5)
    assert.equal(byReihenfolge.V_A_1.kaempfer1_id, t[50]._id);
    assert.equal(byReihenfolge.V_A_1.kaempfer2_id, t[60]._id);
    assert.equal(byReihenfolge.V_A_1.gruppe, 'A');
    assert.equal(byReihenfolge.V_A_2.kaempfer1_id, t[50]._id);
    assert.equal(byReihenfolge.V_A_2.kaempfer2_id, t[70]._id);
    assert.equal(byReihenfolge.V_A_3.kaempfer1_id, t[60]._id);
    assert.equal(byReihenfolge.V_A_3.kaempfer2_id, t[70]._id);
    assert.equal(byReihenfolge.V_B_1.kaempfer1_id, t[55]._id);
    assert.equal(byReihenfolge.V_B_1.kaempfer2_id, t[65]._id);
    assert.equal(byReihenfolge.V_B_1.gruppe, 'B');
    assert.equal(byReihenfolge.V_B_2.kaempfer1_id, t[55]._id);
    assert.equal(byReihenfolge.V_B_2.kaempfer2_id, t[75]._id);
    assert.equal(byReihenfolge.V_B_3.kaempfer1_id, t[65]._id);
    assert.equal(byReihenfolge.V_B_3.kaempfer2_id, t[75]._id);

    for (const nr of ['HF1', 'HF2', 'F1', 'F2']) {
        assert.equal(byReihenfolge[nr].status, 'angelegt');
        assert.equal(byReihenfolge[nr].kaempfer1_id, null);
    }

    // verknuepfeQuellenFuerPool wurde aufgerufen (nur für F1/F2, HF1/HF2 bleiben unverknüpft).
    assert.equal(byReihenfolge.F1.kaempfer1_quelle_kampf_id, byReihenfolge.HF1._id);
    assert.equal(byReihenfolge.F1.kaempfer1_quelle_typ, 'sieger');
    assert.equal(byReihenfolge.F2.kaempfer1_quelle_kampf_id, byReihenfolge.HF1._id);
    assert.equal(byReihenfolge.F2.kaempfer1_quelle_typ, 'verlierer');
    assert.equal(byReihenfolge.HF1.kaempfer1_quelle_kampf_id, undefined);
});

test('aktualisiereTurnier berechnet die Halbfinal-Paarung aus der Vorrunden-Rangliste, sobald alle 6 Vorrundenkämpfe beendet sind', async () => {
    const { kaempfeRepository, poolsRepository } = await neueRepositories();
    const pool = await poolsRepository.create({});

    // Gruppe A: pA1 gewinnt beide (2 Siege) -> Erster; pA2 gewinnt gegen pA3 (1 Sieg) -> Zweiter.
    await kaempfeRepository.create({ pool_id: pool._id, reihenfolge_nummer: 'V_A_1', status: 'beendet', kaempfer1_id: 'pA1', kaempfer2_id: 'pA2', sieger_id: 'pA1', unterbewertung_kaempfer1: 0, unterbewertung_kaempfer2: 0 });
    await kaempfeRepository.create({ pool_id: pool._id, reihenfolge_nummer: 'V_A_2', status: 'beendet', kaempfer1_id: 'pA1', kaempfer2_id: 'pA3', sieger_id: 'pA1', unterbewertung_kaempfer1: 0, unterbewertung_kaempfer2: 0 });
    await kaempfeRepository.create({ pool_id: pool._id, reihenfolge_nummer: 'V_A_3', status: 'beendet', kaempfer1_id: 'pA2', kaempfer2_id: 'pA3', sieger_id: 'pA2', unterbewertung_kaempfer1: 0, unterbewertung_kaempfer2: 0 });
    // Gruppe B: pB3 gewinnt beide seine Kämpfe (2 Siege) -> Erster; pB1 gewinnt gegen pB2 (1 Sieg) -> Zweiter.
    await kaempfeRepository.create({ pool_id: pool._id, reihenfolge_nummer: 'V_B_1', status: 'beendet', kaempfer1_id: 'pB1', kaempfer2_id: 'pB2', sieger_id: 'pB1', unterbewertung_kaempfer1: 0, unterbewertung_kaempfer2: 0 });
    await kaempfeRepository.create({ pool_id: pool._id, reihenfolge_nummer: 'V_B_2', status: 'beendet', kaempfer1_id: 'pB1', kaempfer2_id: 'pB3', sieger_id: 'pB3', unterbewertung_kaempfer1: 0, unterbewertung_kaempfer2: 0 });
    await kaempfeRepository.create({ pool_id: pool._id, reihenfolge_nummer: 'V_B_3', status: 'beendet', kaempfer1_id: 'pB2', kaempfer2_id: 'pB3', sieger_id: 'pB3', unterbewertung_kaempfer1: 0, unterbewertung_kaempfer2: 0 });
    await kaempfeRepository.create({ pool_id: pool._id, reihenfolge_nummer: 'HF1', status: 'angelegt', kaempfer1_id: null, kaempfer2_id: null });
    await kaempfeRepository.create({ pool_id: pool._id, reihenfolge_nummer: 'HF2', status: 'angelegt', kaempfer1_id: null, kaempfer2_id: null });

    await aktualisiereTurnier(kaempfeRepository, poolsRepository, pool._id);

    const kaempfe = await kaempfeRepository.findByPool(pool._id);
    const byReihenfolge = Object.fromEntries(kaempfe.map(k => [k.reihenfolge_nummer, k]));
    assert.equal(byReihenfolge.HF1.status, 'bereit');
    assert.equal(byReihenfolge.HF1.kaempfer1_id, 'pA1');
    assert.equal(byReihenfolge.HF1.kaempfer2_id, 'pB3');
    assert.equal(byReihenfolge.HF2.status, 'bereit');
    assert.equal(byReihenfolge.HF2.kaempfer1_id, 'pB3');
    assert.equal(byReihenfolge.HF2.kaempfer2_id, 'pA2');
});

test('aktualisiereTurnier schließt den Pool ab, wenn F1 und F2 beendet oder freilos sind', async () => {
    const { kaempfeRepository, poolsRepository } = await neueRepositories();
    const pool = await poolsRepository.create({});
    await kaempfeRepository.create({ pool_id: pool._id, reihenfolge_nummer: 'F1', status: 'beendet' });
    await kaempfeRepository.create({ pool_id: pool._id, reihenfolge_nummer: 'F2', status: 'freilos' });

    await aktualisiereTurnier(kaempfeRepository, poolsRepository, pool._id);

    const aktualisierterPool = await poolsRepository.findById(pool._id);
    assert.equal(aktualisierterPool.status, 'kaempfe_beendet');
});

test('aktualisiereTurnier lässt den Pool unverändert, solange F1 und F2 nicht beide fertig sind', async () => {
    const { kaempfeRepository, poolsRepository } = await neueRepositories();
    const pool = await poolsRepository.create({});
    await kaempfeRepository.create({ pool_id: pool._id, reihenfolge_nummer: 'F1', status: 'beendet' });
    await kaempfeRepository.create({ pool_id: pool._id, reihenfolge_nummer: 'F2', status: 'bereit' });

    await aktualisiereTurnier(kaempfeRepository, poolsRepository, pool._id);

    const unveraenderterPool = await poolsRepository.findById(pool._id);
    assert.equal(unveraenderterPool.status, undefined);
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag bestätigen**

Run: `npm run test:unit`
Expected: FAIL — `Cannot find module '.../src/db/kaskaden/gruppenUeberKreuzPoolKaskade.js'`

- [ ] **Step 3: Implementieren**

`src/db/kaskaden/gruppenUeberKreuzPoolKaskade.js`:

```javascript
import { GRUPPEN_UEBERKREUZ_TOPOLOGIE } from '../../shared/bracketTopologie.js';
import { berechneKaempferPatches } from '../../shared/kampfProgression.js';
import { berechneGruppenUeberkreuzHalbfinalPatches } from '../../shared/gruppenUeberkreuzProgression.js';
import { verknuepfeQuellenFuerPool } from './bracketVerknuepfung.js';

// CouchDB-Pendant zu GruppenUeberKreuzManager.initialisierePool/aktualisiereTurnier
// (src/services/GruppenUeberKreuzManager.js) -- dort direkt knex-gebunden, hier über die
// jeweiligen Repositories. Anders als bei den Doppel-KO-Systemen kombiniert aktualisiereTurnier
// zwei Patch-Quellen (Halbfinal-Ranglistenberechnung + generische Kaskade), analog zur
// Zwei-Phasen-Struktur des Originals.
const ANZAHL_TEILNEHMER = 6;

function mitId(kaempfe) {
    return kaempfe.map(kampf => ({ ...kampf, id: kampf._id }));
}

function teileTeilnehmerAuf(teilnehmer) {
    const poolA = [];
    const poolB = [];
    teilnehmer.forEach((athlet, index) => {
        (index % 2 === 0 ? poolA : poolB).push(athlet);
    });
    return { poolA, poolB };
}

export async function initialisierePool(kaempfeRepository, turnierTeilnehmerRepository, poolsRepository, poolId) {
    const teilnehmer = await turnierTeilnehmerRepository.findByPool(poolId);
    teilnehmer.sort((a, b) => Number(a.gewicht) - Number(b.gewicht));

    if (teilnehmer.length !== ANZAHL_TEILNEHMER) {
        throw new Error(`Das Gruppensystem über Kreuz benötigt exakt ${ANZAHL_TEILNEHMER} Teilnehmer.`);
    }

    const { poolA, poolB } = teileTeilnehmerAuf(teilnehmer);

    const paarungen = [
        { idKey: 'V_A_1', gruppe: 'A', k1: poolA[0]._id, k2: poolA[1]._id },
        { idKey: 'V_B_1', gruppe: 'B', k1: poolB[0]._id, k2: poolB[1]._id },
        { idKey: 'V_A_2', gruppe: 'A', k1: poolA[0]._id, k2: poolA[2]._id },
        { idKey: 'V_B_2', gruppe: 'B', k1: poolB[0]._id, k2: poolB[2]._id },
        { idKey: 'V_A_3', gruppe: 'A', k1: poolA[1]._id, k2: poolA[2]._id },
        { idKey: 'V_B_3', gruppe: 'B', k1: poolB[1]._id, k2: poolB[2]._id }
    ];

    for (const p of paarungen) {
        await kaempfeRepository.create({
            pool_id: poolId, status: 'bereit', reihenfolge_nummer: p.idKey, gruppe: p.gruppe,
            kaempfer1_id: p.k1, kaempfer2_id: p.k2, sieger_id: null,
            kampfzeit_in_sekunden: 0, unterbewertung_kaempfer1: 0, unterbewertung_kaempfer2: 0
        });
    }

    for (const reihenfolgeNummer of ['HF1', 'HF2', 'F1', 'F2']) {
        await kaempfeRepository.create({
            pool_id: poolId, status: 'angelegt', reihenfolge_nummer: reihenfolgeNummer,
            kaempfer1_id: null, kaempfer2_id: null, sieger_id: null,
            kampfzeit_in_sekunden: 0, unterbewertung_kaempfer1: 0, unterbewertung_kaempfer2: 0
        });
    }

    await verknuepfeQuellenFuerPool(kaempfeRepository, poolId, GRUPPEN_UEBERKREUZ_TOPOLOGIE);
    await aktualisiereTurnier(kaempfeRepository, poolsRepository, poolId);
}

export async function aktualisiereTurnier(kaempfeRepository, poolsRepository, poolId) {
    let kaempfe = await kaempfeRepository.findByPool(poolId);
    let changed = false;

    const halbfinalPatches = berechneGruppenUeberkreuzHalbfinalPatches(mitId(kaempfe));
    for (const patch of halbfinalPatches) {
        const { id, ...aenderungen } = patch;
        await kaempfeRepository.update(id, aenderungen);
        changed = true;
    }

    if (changed) {
        kaempfe = await kaempfeRepository.findByPool(poolId);
    }
    const patches = berechneKaempferPatches(mitId(kaempfe));
    for (const patch of patches) {
        const { id, ...aenderungen } = patch;
        await kaempfeRepository.update(id, aenderungen);
        changed = true;
    }

    if (changed) {
        return aktualisiereTurnier(kaempfeRepository, poolsRepository, poolId);
    }

    const istBeendetOderFreilos = (k) => k?.status === 'beendet' || k?.status === 'freilos';
    const findeKampf = (idKey) => kaempfe.find(k => k.reihenfolge_nummer === idKey);
    const finale = findeKampf('F1');
    const platz3 = findeKampf('F2');
    if (istBeendetOderFreilos(finale) && istBeendetOderFreilos(platz3)) {
        await poolsRepository.update(poolId, { status: 'kaempfe_beendet' });
    }
}
```

- [ ] **Step 4: Test ausführen, Erfolg bestätigen**

Run: `npm run test:unit`
Expected: PASS (5 neue Tests, insgesamt 109)

- [ ] **Step 5: Dokumentation ergänzen**

In `CLAUDE.md` im Abschnitt "Zentrale Architekturkonzepte", im Punkt zu `src/db/kaskaden/`, `gruppenUeberKreuzPoolKaskade.js` als neuntes Modul ergänzen — CouchDB-Pendant zu `GruppenUeberKreuzManager.js`, sechstes von acht `*Manager.js`-Pendants, explizit erwähnen, dass es die bereits reine `berechneGruppenUeberkreuzHalbfinalPatches`-Engine direkt importiert (analog zu `berechneKaempferPatches` in den anderen Kaskaden) statt sie zu duplizieren, und dass der harte Fehlerwurf bei falscher Teilnehmerzahl erhalten bleibt.

- [ ] **Step 6: Commit**

```bash
git add src/db/kaskaden/gruppenUeberKreuzPoolKaskade.js tests/unit/db/kaskaden/gruppenUeberKreuzPoolKaskade.test.js CLAUDE.md
git commit -m "feat: CouchDB-Pendant zu GruppenUeberKreuzManager (Pool-Initialisierung)"
```

---

## Self-Review-Notizen

- **Spec-Abdeckung:** Deckt das sechste von acht Pool-Anlage-Services ab — alle vier Einzelwettkampf-Systeme (JederGegenJeden, DoppelKo8/16/32, GruppenÜberkreuz) sind damit migriert. Die verbleibenden zwei (MannschaftDoppelKo8/16) sind bewusst NICHT Teil dieses Plans.
- **Platzhalter-Scan:** Keine TBD/TODO-Stellen.
- **Determinismus der Tests:** Die Rangliste im dritten Test wurde bewusst mit einem "Außenseiter gewinnt"-Szenario in Gruppe B konstruiert (pB3 schlägt sowohl pB1 als auch pB2), um zu verifizieren, dass die Rangliste tatsächlich nach Siegen berechnet wird und nicht zufällig mit der Eingabe-Reihenfolge übereinstimmt.
- **Wiederverwendung:** `verknuepfeQuellenFuerPool`, `berechneKaempferPatches` und `berechneGruppenUeberkreuzHalbfinalPatches` werden importiert statt neu implementiert; `mitId()` folgt exakt dem in `kaempfeKaskade.js` etablierten Bridging-Muster.
