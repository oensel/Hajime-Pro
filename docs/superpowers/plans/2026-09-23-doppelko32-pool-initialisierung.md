# Doppel-KO-32 Pool-Initialisierung Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CouchDB-Äquivalent von `src/services/DoppelKo32Manager.js` (`initialisierePool`, `aktualisiereTurnier`) — fünftes von acht `*Manager.js`-Pool-Anlage-Services. Strukturell identisch zu den bereits migrierten `DoppelKo8Manager.js`/`DoppelKo16Manager.js`-Pendants, nur mit nochmals doppelter Rastergröße (32) und der größeren `DOPPEL_KO_32_TOPOLOGIE` (59 statt 27 Kämpfe: H1-H16, H17-H24, H25-H28, H29-H30, Trostrunden T1-T28, Finale F1).

**Wiederverwendung bereits migrierter Bausteine:** Exakt wie bei den 8er-/16er-Pendants werden `verknuepfeQuellenFuerPool` (`src/db/kaskaden/bracketVerknuepfung.js`) und `wendeKaempfeKaskadeAn` (`src/db/kaskaden/kaempfeKaskade.js`) direkt wiederverwendet. Nur Rastergröße, Freilos-Indices, Anzahl/Namen der Hüllen-Kämpfe und die Abschluss-Reihenfolge-Nummern (`F1`/`T27`/`T28`) unterscheiden sich.

Vollständig getestet, weiterhin **nicht** in `src/app.js`/`src/routes/`/`src/controllers/` verdrahtet.

**Architecture:** Eine neue Kaskaden-Datei `src/db/kaskaden/doppelKo32PoolKaskade.js`, strukturell analog zu `doppelKo16PoolKaskade.js`: private Hilfsfunktion `ermittleRasterListe(teilnehmer)` (identischer Algorithmus, andere Konstanten) und zwei exportierte Funktionen (`initialisierePool`, `aktualisiereTurnier`).

**Tech Stack:** Kein neuer Dependency-Bedarf.

**Spec:** [docs/superpowers/specs/2026-09-22-couchdb-pouchdb-migration-design.md](../specs/2026-09-22-couchdb-pouchdb-migration-design.md)

## Global Constraints

- ESM-Only — `import`/`export`, kein `require`.
- Keine Kommentare, die nur wiederholen, was der Code schon sagt.
- Genau EIN `startTestCouchServer()`-Aufruf pro Testdatei via `before()`/`after()`.
- `src/services/DoppelKo32Manager.js` wird **nicht** verändert.
- Die Freilos-Sonderregel bleibt exakt erhalten: die **besetzte** Seite erhält `unterbewertung_kaempferN = 10`.
- `reihenfolge_nummer` bleibt String (`'H1'`, `'F1'`, …), exakt wie im Original.
- Freilos-Indices sind `[1, 31, 17, 15, 9, 23, 25, 7, 5, 27, 21, 11, 13, 19, 29, 3]` (16 Werte, für ein 32er-Raster) — NICHT mit den 8er-/16er-Indices verwechseln.
- Anders als bei `DoppelKo8Manager.js`/`DoppelKo16Manager.js` gibt es hier kein ungenutztes `djbSchluessel`-Feld im Konstruktor (nur `rasterGroesse`) — nichts zusätzlich wegzulassen.
- Diese Schicht wird in diesem Plan **nicht** in `src/app.js`, `src/routes/` oder `src/controllers/` verdrahtet.

---

### Task 1: `doppelKo32PoolKaskade.js`

**Files:**
- Create: `src/db/kaskaden/doppelKo32PoolKaskade.js`
- Test: `tests/unit/db/kaskaden/doppelKo32PoolKaskade.test.js`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: `findByPool(poolId)` aus `turnierTeilnehmerRepository`; `create(data)`/`findByPool(poolId)`/`update(id,patch)` aus `kaempfeRepository`; `update(id,patch)`/`findById(id)` aus `poolsRepository`; `verknuepfeQuellenFuerPool` aus `./bracketVerknuepfung.js`; `wendeKaempfeKaskadeAn` aus `./kaempfeKaskade.js`; `DOPPEL_KO_32_TOPOLOGIE` aus `../../shared/bracketTopologie.js`.
- Produces: `initialisierePool(kaempfeRepository, turnierTeilnehmerRepository, poolsRepository, poolId): Promise<void>`, `aktualisiereTurnier(kaempfeRepository, poolsRepository, poolId): Promise<void>`.

- [ ] **Step 1: Failing Tests schreiben**

`tests/unit/db/kaskaden/doppelKo32PoolKaskade.test.js`:

```javascript
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startTestCouchServer } from '../../helpers/couchTestServer.js';
import { connect, ensureDatabase } from '../../../../src/db/couch.js';
import { createKaempfeRepository } from '../../../../src/db/repositories/kaempfeRepository.js';
import { createTurnierTeilnehmerRepository } from '../../../../src/db/repositories/turnierTeilnehmerRepository.js';
import { createPoolsRepository } from '../../../../src/db/repositories/poolsRepository.js';
import { initialisierePool, aktualisiereTurnier } from '../../../../src/db/kaskaden/doppelKo32PoolKaskade.js';

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

test('initialisierePool füllt bei 32 Teilnehmern verschiedener Vereine das Raster ohne Freilose', async () => {
    const { kaempfeRepository, turnierTeilnehmerRepository, poolsRepository } = await neueRepositories();
    const pool = await poolsRepository.create({});
    const t = {};
    for (let i = 0; i < 32; i++) {
        const gewicht = 50 + 5 * i;
        t[gewicht] = await turnierTeilnehmerRepository.create({ pool_id: pool._id, gewicht, verein: `Club${i + 1}` });
    }

    await initialisierePool(kaempfeRepository, turnierTeilnehmerRepository, poolsRepository, pool._id);

    const kaempfe = await kaempfeRepository.findByPool(pool._id);
    assert.equal(kaempfe.length, 59);

    const byReihenfolge = Object.fromEntries(kaempfe.map(k => [k.reihenfolge_nummer, k]));

    // Rasterbefüllung bei 32 Teilnehmern mit ausschließlich unterschiedlichen Vereinen (von Hand
    // gegen den Vereinstrennungs-Algorithmus nachgerechnet, Gewichte 50..205 in 5er-Schritten):
    const erwarteteHPaare = [
        [50, 70], [90, 110], [130, 150], [170, 190],
        [55, 75], [95, 115], [135, 155], [175, 195],
        [60, 80], [100, 120], [140, 160], [180, 200],
        [65, 85], [105, 125], [145, 165], [185, 205]
    ];
    erwarteteHPaare.forEach(([g1, g2], idx) => {
        const h = byReihenfolge[`H${idx + 1}`];
        assert.equal(h.kaempfer1_id, t[g1]._id, `H${idx + 1} kaempfer1`);
        assert.equal(h.kaempfer2_id, t[g2]._id, `H${idx + 1} kaempfer2`);
        assert.equal(h.status, 'bereit');
    });

    const huellenReihenfolgeNummern = [
        ...[17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30].map(i => `H${i}`),
        ...Array.from({ length: 28 }, (_, i) => `T${i + 1}`),
        'F1'
    ];
    assert.equal(huellenReihenfolgeNummern.length, 43);
    for (const nr of huellenReihenfolgeNummern) {
        assert.equal(byReihenfolge[nr].status, 'angelegt');
        assert.equal(byReihenfolge[nr].kaempfer1_id, null);
    }

    // verknuepfeQuellenFuerPool wurde aufgerufen.
    assert.equal(byReihenfolge.H17.kaempfer1_quelle_kampf_id, byReihenfolge.H1._id);
    assert.equal(byReihenfolge.H17.kaempfer1_quelle_typ, 'sieger');
    assert.equal(byReihenfolge.H17.kaempfer2_quelle_kampf_id, byReihenfolge.H2._id);
    assert.equal(byReihenfolge.F1.kaempfer1_quelle_kampf_id, byReihenfolge.H29._id);
    assert.equal(byReihenfolge.F1.kaempfer2_quelle_kampf_id, byReihenfolge.H30._id);
});

test('initialisierePool weist Freilose an den korrekten 32er-Rasterpositionen zu', async () => {
    const { kaempfeRepository, turnierTeilnehmerRepository, poolsRepository } = await neueRepositories();
    const pool = await poolsRepository.create({});
    const t1 = await turnierTeilnehmerRepository.create({ pool_id: pool._id, gewicht: 50, verein: 'Club1' });
    const t2 = await turnierTeilnehmerRepository.create({ pool_id: pool._id, gewicht: 55, verein: 'Club2' });

    await initialisierePool(kaempfeRepository, turnierTeilnehmerRepository, poolsRepository, pool._id);

    const kaempfe = await kaempfeRepository.findByPool(pool._id);
    const byReihenfolge = Object.fromEntries(kaempfe.map(k => [k.reihenfolge_nummer, k]));

    // Freilos-Indices klemmen bei F=30 auf alle 16 Werte -> Raster: nur Index 0 = t1, Index 8 = t2.
    assert.equal(byReihenfolge.H1.status, 'freilos');
    assert.equal(byReihenfolge.H1.kaempfer1_id, t1._id);
    assert.equal(byReihenfolge.H1.kaempfer2_id, null);
    assert.equal(byReihenfolge.H1.sieger_id, t1._id);
    assert.equal(byReihenfolge.H1.unterbewertung_kaempfer1, 10);
    assert.equal(byReihenfolge.H1.unterbewertung_kaempfer2, 0);

    assert.equal(byReihenfolge.H5.status, 'freilos');
    assert.equal(byReihenfolge.H5.kaempfer1_id, t2._id);
    assert.equal(byReihenfolge.H5.kaempfer2_id, null);
    assert.equal(byReihenfolge.H5.sieger_id, t2._id);
    assert.equal(byReihenfolge.H5.unterbewertung_kaempfer1, 10);
    assert.equal(byReihenfolge.H5.unterbewertung_kaempfer2, 0);

    for (let i = 1; i <= 16; i++) {
        if (i === 1 || i === 5) continue;
        const h = byReihenfolge[`H${i}`];
        assert.equal(h.status, 'freilos', `H${i} status`);
        assert.equal(h.kaempfer1_id, null, `H${i} kaempfer1`);
        assert.equal(h.kaempfer2_id, null, `H${i} kaempfer2`);
        assert.equal(h.sieger_id, null, `H${i} sieger`);
    }
});

test('aktualisiereTurnier wendet die Kaskade an und befüllt einen Folgekampf, sobald beide Quellkämpfe beendet sind', async () => {
    const { kaempfeRepository, poolsRepository } = await neueRepositories();
    const pool = await poolsRepository.create({});
    const h1 = await kaempfeRepository.create({ pool_id: pool._id, reihenfolge_nummer: 'H1', status: 'beendet', kaempfer1_id: 'teilnehmer:x', kaempfer2_id: 'teilnehmer:y', sieger_id: 'teilnehmer:x' });
    const h2 = await kaempfeRepository.create({ pool_id: pool._id, reihenfolge_nummer: 'H2', status: 'beendet', kaempfer1_id: 'teilnehmer:z', kaempfer2_id: 'teilnehmer:w', sieger_id: 'teilnehmer:w' });
    await kaempfeRepository.create({
        pool_id: pool._id, reihenfolge_nummer: 'H17', status: 'angelegt', kaempfer1_id: null, kaempfer2_id: null,
        kaempfer1_quelle_kampf_id: h1._id, kaempfer1_quelle_typ: 'sieger',
        kaempfer2_quelle_kampf_id: h2._id, kaempfer2_quelle_typ: 'sieger'
    });

    await aktualisiereTurnier(kaempfeRepository, poolsRepository, pool._id);

    const kaempfe = await kaempfeRepository.findByPool(pool._id);
    const h17 = kaempfe.find(k => k.reihenfolge_nummer === 'H17');
    assert.equal(h17.status, 'bereit');
    assert.equal(h17.kaempfer1_id, 'teilnehmer:x');
    assert.equal(h17.kaempfer2_id, 'teilnehmer:w');
});

test('aktualisiereTurnier schließt den Pool ab, wenn F1, T27 und T28 beendet oder freilos sind', async () => {
    const { kaempfeRepository, poolsRepository } = await neueRepositories();
    const pool = await poolsRepository.create({});
    await kaempfeRepository.create({ pool_id: pool._id, reihenfolge_nummer: 'F1', status: 'beendet' });
    await kaempfeRepository.create({ pool_id: pool._id, reihenfolge_nummer: 'T27', status: 'freilos' });
    await kaempfeRepository.create({ pool_id: pool._id, reihenfolge_nummer: 'T28', status: 'beendet' });

    await aktualisiereTurnier(kaempfeRepository, poolsRepository, pool._id);

    const aktualisierterPool = await poolsRepository.findById(pool._id);
    assert.equal(aktualisierterPool.status, 'kaempfe_beendet');
});

test('aktualisiereTurnier lässt den Pool unverändert, solange nicht alle drei Abschlusskämpfe fertig sind', async () => {
    const { kaempfeRepository, poolsRepository } = await neueRepositories();
    const pool = await poolsRepository.create({});
    await kaempfeRepository.create({ pool_id: pool._id, reihenfolge_nummer: 'F1', status: 'beendet' });
    await kaempfeRepository.create({ pool_id: pool._id, reihenfolge_nummer: 'T27', status: 'freilos' });
    await kaempfeRepository.create({ pool_id: pool._id, reihenfolge_nummer: 'T28', status: 'bereit' });

    await aktualisiereTurnier(kaempfeRepository, poolsRepository, pool._id);

    const unveraenderterPool = await poolsRepository.findById(pool._id);
    assert.equal(unveraenderterPool.status, undefined);
});

test('aktualisiereTurnier ist ein No-Op, wenn der Pool noch keine Kämpfe hat', async () => {
    const { kaempfeRepository, poolsRepository } = await neueRepositories();
    const pool = await poolsRepository.create({ status: 'geplant' });

    await aktualisiereTurnier(kaempfeRepository, poolsRepository, pool._id);

    const unveraenderterPool = await poolsRepository.findById(pool._id);
    assert.equal(unveraenderterPool.status, 'geplant');
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag bestätigen**

Run: `npm run test:unit`
Expected: FAIL — `Cannot find module '.../src/db/kaskaden/doppelKo32PoolKaskade.js'`

- [ ] **Step 3: Implementieren**

`src/db/kaskaden/doppelKo32PoolKaskade.js`:

```javascript
import { DOPPEL_KO_32_TOPOLOGIE } from '../../shared/bracketTopologie.js';
import { verknuepfeQuellenFuerPool } from './bracketVerknuepfung.js';
import { wendeKaempfeKaskadeAn } from './kaempfeKaskade.js';

// CouchDB-Pendant zu DoppelKo32Manager.initialisierePool/aktualisiereTurnier
// (src/services/DoppelKo32Manager.js) -- strukturell identisch zu doppelKo16PoolKaskade.js, nur
// mit nochmals doppelter Rastergröße und eigenen Freilos-Positionen. Wiederverwendet dieselben
// bereits migrierten Bausteine (verknuepfeQuellenFuerPool, wendeKaempfeKaskadeAn).
const RASTER_GROESSE = 32;
const FREILOS_INDICES = [1, 31, 17, 15, 9, 23, 25, 7, 5, 27, 21, 11, 13, 19, 29, 3];

function ermittleRasterListe(teilnehmer) {
    const N = teilnehmer.length;
    const F = RASTER_GROESSE - N;
    const freilosSlots = new Set(FREILOS_INDICES.slice(0, F));

    const poolSlots = {
        A: [0, 1, 2, 3, 4, 5, 6, 7].filter(s => !freilosSlots.has(s)),
        B: [8, 9, 10, 11, 12, 13, 14, 15].filter(s => !freilosSlots.has(s)),
        C: [16, 17, 18, 19, 20, 21, 22, 23].filter(s => !freilosSlots.has(s)),
        D: [24, 25, 26, 27, 28, 29, 30, 31].filter(s => !freilosSlots.has(s))
    };

    const vereine = {};
    teilnehmer.forEach(t => {
        const vName = t.verein || 'Kein Verein';
        if (!vereine[vName]) vereine[vName] = [];
        vereine[vName].push(t);
    });

    const sortierteVereinsNamen = Object.keys(vereine).sort((a, b) => vereine[b].length - vereine[a].length);
    const poolAssignments = { A: [], B: [], C: [], D: [] };

    for (const vName of sortierteVereinsNamen) {
        const athleten = vereine[vName];
        athleten.sort((a, b) => Number(a.gewicht) - Number(b.gewicht));

        for (const athlet of athleten) {
            let besterPool = null;
            let minVereinCount = Number.POSITIVE_INFINITY;
            let maxFreieSlots = -1;

            for (const p of ['A', 'B', 'C', 'D']) {
                const freieSlots = poolSlots[p].length - poolAssignments[p].length;
                if (freieSlots <= 0) continue;

                const vereinCountInPool = poolAssignments[p].filter(a => a.verein === vName).length;

                if (vereinCountInPool < minVereinCount) {
                    minVereinCount = vereinCountInPool;
                    maxFreieSlots = freieSlots;
                    besterPool = p;
                } else if (vereinCountInPool === minVereinCount) {
                    if (freieSlots > maxFreieSlots) {
                        maxFreieSlots = freieSlots;
                        besterPool = p;
                    }
                }
            }

            if (besterPool) {
                poolAssignments[besterPool].push(athlet);
            }
        }
    }

    const rasterListe = new Array(RASTER_GROESSE).fill(null);
    for (const p of ['A', 'B', 'C', 'D']) {
        poolAssignments[p].sort((a, b) => Number(a.gewicht) - Number(b.gewicht));
        poolAssignments[p].forEach((athlet, idx) => {
            rasterListe[poolSlots[p][idx]] = athlet;
        });
    }

    return rasterListe;
}

export async function initialisierePool(kaempfeRepository, turnierTeilnehmerRepository, poolsRepository, poolId) {
    const teilnehmer = await turnierTeilnehmerRepository.findByPool(poolId);
    const rasterListe = ermittleRasterListe(teilnehmer);

    for (let i = 0; i < rasterListe.length; i += 2) {
        const k1 = rasterListe[i];
        const k2 = rasterListe[i + 1];
        const neuerKampf = {
            pool_id: poolId,
            status: 'bereit',
            reihenfolge_nummer: `H${(i / 2) + 1}`,
            kaempfer1_id: k1 ? k1._id : null,
            kaempfer2_id: k2 ? k2._id : null,
            sieger_id: null,
            kampfzeit_in_sekunden: 0,
            unterbewertung_kaempfer1: 0,
            unterbewertung_kaempfer2: 0
        };
        if (k1 === null && k2 === null) {
            neuerKampf.status = 'freilos';
            neuerKampf.sieger_id = null;
        } else if (k1 === null || k2 === null) {
            const sieger = k1 || k2;
            neuerKampf.status = 'freilos';
            neuerKampf.sieger_id = sieger._id;
            neuerKampf.unterbewertung_kaempfer1 = k1 ? 10 : 0;
            neuerKampf.unterbewertung_kaempfer2 = k2 ? 10 : 0;
        }
        await kaempfeRepository.create(neuerKampf);
    }

    const huellenReihenfolgeNummern = [
        ...[17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30].map(i => `H${i}`),
        ...Array.from({ length: 28 }, (_, i) => `T${i + 1}`),
        'F1'
    ];
    for (const reihenfolgeNummer of huellenReihenfolgeNummern) {
        await kaempfeRepository.create({
            pool_id: poolId, status: 'angelegt', reihenfolge_nummer: reihenfolgeNummer,
            kaempfer1_id: null, kaempfer2_id: null, sieger_id: null,
            kampfzeit_in_sekunden: 0, unterbewertung_kaempfer1: 0, unterbewertung_kaempfer2: 0
        });
    }

    await verknuepfeQuellenFuerPool(kaempfeRepository, poolId, DOPPEL_KO_32_TOPOLOGIE);
    await aktualisiereTurnier(kaempfeRepository, poolsRepository, poolId);
}

export async function aktualisiereTurnier(kaempfeRepository, poolsRepository, poolId) {
    const kaempfe = await wendeKaempfeKaskadeAn(kaempfeRepository, poolId);
    if (kaempfe.length === 0) return;

    const istBeendetOderFreilos = (k) => k?.status === 'beendet' || k?.status === 'freilos';
    const f1 = kaempfe.find(k => k.reihenfolge_nummer === 'F1');
    const t27 = kaempfe.find(k => k.reihenfolge_nummer === 'T27');
    const t28 = kaempfe.find(k => k.reihenfolge_nummer === 'T28');
    if (istBeendetOderFreilos(f1) && istBeendetOderFreilos(t27) && istBeendetOderFreilos(t28)) {
        await poolsRepository.update(poolId, { status: 'kaempfe_beendet' });
    }
}
```

- [ ] **Step 4: Test ausführen, Erfolg bestätigen**

Run: `npm run test:unit`
Expected: PASS (6 neue Tests, insgesamt 104)

- [ ] **Step 5: Dokumentation ergänzen**

In `CLAUDE.md` im Abschnitt "Zentrale Architekturkonzepte", im Punkt zu `src/db/kaskaden/`, `doppelKo32PoolKaskade.js` als achtes Modul ergänzen — CouchDB-Pendant zu `DoppelKo32Manager.js`, fünftes von acht `*Manager.js`-Pendants, strukturell identisch zu `doppelKo16PoolKaskade.js` mit größerem Raster.

- [ ] **Step 6: Commit**

```bash
git add src/db/kaskaden/doppelKo32PoolKaskade.js tests/unit/db/kaskaden/doppelKo32PoolKaskade.test.js CLAUDE.md
git commit -m "feat: CouchDB-Pendant zu DoppelKo32Manager (Pool-Initialisierung)"
```

---

## Self-Review-Notizen

- **Spec-Abdeckung:** Deckt das fünfte von acht Pool-Anlage-Services ab — alle drei Einzel-Doppel-KO-Systeme (8/16/32) sind damit migriert. Die verbleibenden drei (GruppenÜberkreuz, MannschaftDoppelKo8/16) sind bewusst NICHT Teil dieses Plans.
- **Platzhalter-Scan:** Keine TBD/TODO-Stellen.
- **Determinismus der Tests:** Die Rasterbefüllung im ersten Test (32 Teilnehmer, ausschließlich unterschiedliche Vereine, streng aufsteigende Gewichte) wurde von Hand exakt nach dem Vereinstrennungs-Algorithmus nachvollzogen: bei durchweg einzigartigen Vereinen reduziert sich die Greedy-Zuweisung auf ein reines Round-Robin A→B→C→D→A→... nach freien Plätzen, was bei N=32 die Zuordnung A={1.,5.,9.,...,29.}, B={2.,6.,...,30.}, C={3.,7.,...,31.}, D={4.,8.,...,32.} Teilnehmer (nach Anlage-Reihenfolge) ergibt.
- **Wiederverwendung:** `verknuepfeQuellenFuerPool` und `wendeKaempfeKaskadeAn` werden importiert statt neu implementiert, exakt wie bei den 8er-/16er-Pendants.
