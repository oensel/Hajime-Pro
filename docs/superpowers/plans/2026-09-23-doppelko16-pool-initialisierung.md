# Doppel-KO-16 Pool-Initialisierung Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CouchDB-Äquivalent von `src/services/DoppelKo16Manager.js` (`initialisierePool`, `aktualisiereTurnier`) — viertes von acht `*Manager.js`-Pool-Anlage-Services. Strukturell identisch zum bereits migrierten `DoppelKo8Manager.js` (siehe `docs/superpowers/plans/2026-09-23-doppelko8-pool-initialisierung.md`), nur mit doppelter Rastergröße (16 statt 8), eigenen Freilos-Positionen und der größeren `DOPPEL_KO_16_TOPOLOGIE` (27 statt 11 Kämpfe: Achtelfinale H1-H8, Viertelfinale H9-H12, Halbfinale H13-H14, Trostrunden T1-T12, Finale F1).

**Wiederverwendung bereits migrierter Bausteine:** Exakt wie beim 8er-Pendant werden `verknuepfeQuellenFuerPool` (`src/db/kaskaden/bracketVerknuepfung.js`) und `wendeKaempfeKaskadeAn` (`src/db/kaskaden/kaempfeKaskade.js`) direkt wiederverwendet statt neu implementiert — nur die Rastergröße, die Freilos-Indices, die Anzahl der Hüllen-Kämpfe und die Abschluss-Reihenfolge-Nummern (`F1`/`T11`/`T12` statt `F`/`T3`/`T4`) unterscheiden sich vom 8er-Pendant.

Vollständig getestet, weiterhin **nicht** in `src/app.js`/`src/routes/`/`src/controllers/` verdrahtet.

**Architecture:** Eine neue Kaskaden-Datei `src/db/kaskaden/doppelKo16PoolKaskade.js`, strukturell analog zu `doppelKo8PoolKaskade.js`: private Hilfsfunktion `ermittleRasterListe(teilnehmer)` (identischer Algorithmus, andere Konstanten) und zwei exportierte Funktionen (`initialisierePool`, `aktualisiereTurnier`).

**Tech Stack:** Kein neuer Dependency-Bedarf.

**Spec:** [docs/superpowers/specs/2026-09-22-couchdb-pouchdb-migration-design.md](../specs/2026-09-22-couchdb-pouchdb-migration-design.md)

## Global Constraints

- ESM-Only — `import`/`export`, kein `require`.
- Keine Kommentare, die nur wiederholen, was der Code schon sagt.
- Genau EIN `startTestCouchServer()`-Aufruf pro Testdatei via `before()`/`after()`.
- `src/services/DoppelKo16Manager.js` wird **nicht** verändert.
- Das im Original ungenutzte Feld `this.djbSchluessel` wird **nicht** übernommen (wie bereits bei `DoppelKo8Manager.js`).
- Die Freilos-Sonderregel bleibt exakt erhalten: die **besetzte** Seite erhält `unterbewertung_kaempferN = 10`.
- `reihenfolge_nummer` bleibt String (`'H1'`, `'F1'`, …), exakt wie im Original.
- Freilos-Indices sind `[15, 0, 8, 7, 4, 11, 12, 3]` (8 Werte, für ein 16er-Raster) — NICHT mit den 8er-Indices `[7,0,4,3]` verwechseln.
- Diese Schicht wird in diesem Plan **nicht** in `src/app.js`, `src/routes/` oder `src/controllers/` verdrahtet.

---

### Task 1: `doppelKo16PoolKaskade.js`

**Files:**
- Create: `src/db/kaskaden/doppelKo16PoolKaskade.js`
- Test: `tests/unit/db/kaskaden/doppelKo16PoolKaskade.test.js`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: `findByPool(poolId)` aus `turnierTeilnehmerRepository`; `create(data)`/`findByPool(poolId)`/`update(id,patch)` aus `kaempfeRepository`; `update(id,patch)`/`findById(id)` aus `poolsRepository`; `verknuepfeQuellenFuerPool` aus `./bracketVerknuepfung.js`; `wendeKaempfeKaskadeAn` aus `./kaempfeKaskade.js`; `DOPPEL_KO_16_TOPOLOGIE` aus `../../shared/bracketTopologie.js`.
- Produces: `initialisierePool(kaempfeRepository, turnierTeilnehmerRepository, poolsRepository, poolId): Promise<void>`, `aktualisiereTurnier(kaempfeRepository, poolsRepository, poolId): Promise<void>`.

- [ ] **Step 1: Failing Tests schreiben**

`tests/unit/db/kaskaden/doppelKo16PoolKaskade.test.js`:

```javascript
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startTestCouchServer } from '../../helpers/couchTestServer.js';
import { connect, ensureDatabase } from '../../../../src/db/couch.js';
import { createKaempfeRepository } from '../../../../src/db/repositories/kaempfeRepository.js';
import { createTurnierTeilnehmerRepository } from '../../../../src/db/repositories/turnierTeilnehmerRepository.js';
import { createPoolsRepository } from '../../../../src/db/repositories/poolsRepository.js';
import { initialisierePool, aktualisiereTurnier } from '../../../../src/db/kaskaden/doppelKo16PoolKaskade.js';

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

test('initialisierePool füllt bei 16 Teilnehmern verschiedener Vereine das Raster ohne Freilose', async () => {
    const { kaempfeRepository, turnierTeilnehmerRepository, poolsRepository } = await neueRepositories();
    const pool = await poolsRepository.create({});
    const gewichte = [50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100, 105, 110, 115, 120, 125];
    const t = {};
    for (let i = 0; i < gewichte.length; i++) {
        t[gewichte[i]] = await turnierTeilnehmerRepository.create({ pool_id: pool._id, gewicht: gewichte[i], verein: `Club${i + 1}` });
    }

    await initialisierePool(kaempfeRepository, turnierTeilnehmerRepository, poolsRepository, pool._id);

    const kaempfe = await kaempfeRepository.findByPool(pool._id);
    assert.equal(kaempfe.length, 27);

    const byReihenfolge = Object.fromEntries(kaempfe.map(k => [k.reihenfolge_nummer, k]));

    // Rasterbefüllung bei 16 Teilnehmern mit ausschließlich unterschiedlichen Vereinen (von Hand
    // gegen den Vereinstrennungs-Algorithmus nachgerechnet): raster = [50,70,90,110,55,75,95,115,
    // 60,80,100,120,65,85,105,125]
    assert.equal(byReihenfolge.H1.kaempfer1_id, t[50]._id);
    assert.equal(byReihenfolge.H1.kaempfer2_id, t[70]._id);
    assert.equal(byReihenfolge.H2.kaempfer1_id, t[90]._id);
    assert.equal(byReihenfolge.H2.kaempfer2_id, t[110]._id);
    assert.equal(byReihenfolge.H3.kaempfer1_id, t[55]._id);
    assert.equal(byReihenfolge.H3.kaempfer2_id, t[75]._id);
    assert.equal(byReihenfolge.H4.kaempfer1_id, t[95]._id);
    assert.equal(byReihenfolge.H4.kaempfer2_id, t[115]._id);
    assert.equal(byReihenfolge.H5.kaempfer1_id, t[60]._id);
    assert.equal(byReihenfolge.H5.kaempfer2_id, t[80]._id);
    assert.equal(byReihenfolge.H6.kaempfer1_id, t[100]._id);
    assert.equal(byReihenfolge.H6.kaempfer2_id, t[120]._id);
    assert.equal(byReihenfolge.H7.kaempfer1_id, t[65]._id);
    assert.equal(byReihenfolge.H7.kaempfer2_id, t[85]._id);
    assert.equal(byReihenfolge.H8.kaempfer1_id, t[105]._id);
    assert.equal(byReihenfolge.H8.kaempfer2_id, t[125]._id);

    for (const nr of ['H9', 'H10', 'H11', 'H12', 'H13', 'H14', 'T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10', 'T11', 'T12', 'F1']) {
        assert.equal(byReihenfolge[nr].status, 'angelegt');
        assert.equal(byReihenfolge[nr].kaempfer1_id, null);
    }

    // verknuepfeQuellenFuerPool wurde aufgerufen.
    assert.equal(byReihenfolge.H9.kaempfer1_quelle_kampf_id, byReihenfolge.H1._id);
    assert.equal(byReihenfolge.H9.kaempfer1_quelle_typ, 'sieger');
    assert.equal(byReihenfolge.H9.kaempfer2_quelle_kampf_id, byReihenfolge.H2._id);
    assert.equal(byReihenfolge.F1.kaempfer1_quelle_kampf_id, byReihenfolge.H13._id);
});

test('initialisierePool weist Freilose an den korrekten 16er-Rasterpositionen zu', async () => {
    const { kaempfeRepository, turnierTeilnehmerRepository, poolsRepository } = await neueRepositories();
    const pool = await poolsRepository.create({});
    const t1 = await turnierTeilnehmerRepository.create({ pool_id: pool._id, gewicht: 50, verein: 'Club1' });
    const t2 = await turnierTeilnehmerRepository.create({ pool_id: pool._id, gewicht: 55, verein: 'Club2' });

    await initialisierePool(kaempfeRepository, turnierTeilnehmerRepository, poolsRepository, pool._id);

    const kaempfe = await kaempfeRepository.findByPool(pool._id);
    const byReihenfolge = Object.fromEntries(kaempfe.map(k => [k.reihenfolge_nummer, k]));

    // Freilos-Indices [15,0,8,7,4,11,12,3] -> Raster: [null,t1,null,null,null,t2,null,null,...,null]
    assert.equal(byReihenfolge.H1.status, 'freilos');
    assert.equal(byReihenfolge.H1.kaempfer1_id, null);
    assert.equal(byReihenfolge.H1.kaempfer2_id, t1._id);
    assert.equal(byReihenfolge.H1.sieger_id, t1._id);
    assert.equal(byReihenfolge.H1.unterbewertung_kaempfer1, 0);
    assert.equal(byReihenfolge.H1.unterbewertung_kaempfer2, 10);

    assert.equal(byReihenfolge.H2.status, 'freilos');
    assert.equal(byReihenfolge.H2.kaempfer1_id, null);
    assert.equal(byReihenfolge.H2.kaempfer2_id, null);
    assert.equal(byReihenfolge.H2.sieger_id, null);

    assert.equal(byReihenfolge.H3.status, 'freilos');
    assert.equal(byReihenfolge.H3.kaempfer1_id, null);
    assert.equal(byReihenfolge.H3.kaempfer2_id, t2._id);
    assert.equal(byReihenfolge.H3.sieger_id, t2._id);
    assert.equal(byReihenfolge.H3.unterbewertung_kaempfer1, 0);
    assert.equal(byReihenfolge.H3.unterbewertung_kaempfer2, 10);

    for (const nr of ['H4', 'H5', 'H6', 'H7', 'H8']) {
        assert.equal(byReihenfolge[nr].status, 'freilos');
        assert.equal(byReihenfolge[nr].kaempfer1_id, null);
        assert.equal(byReihenfolge[nr].kaempfer2_id, null);
        assert.equal(byReihenfolge[nr].sieger_id, null);
    }
});

test('aktualisiereTurnier wendet die Kaskade an und befüllt einen Folgekampf, sobald beide Quellkämpfe beendet sind', async () => {
    const { kaempfeRepository, poolsRepository } = await neueRepositories();
    const pool = await poolsRepository.create({});
    const h1 = await kaempfeRepository.create({ pool_id: pool._id, reihenfolge_nummer: 'H1', status: 'beendet', kaempfer1_id: 'teilnehmer:x', kaempfer2_id: 'teilnehmer:y', sieger_id: 'teilnehmer:x' });
    const h2 = await kaempfeRepository.create({ pool_id: pool._id, reihenfolge_nummer: 'H2', status: 'beendet', kaempfer1_id: 'teilnehmer:z', kaempfer2_id: 'teilnehmer:w', sieger_id: 'teilnehmer:w' });
    await kaempfeRepository.create({
        pool_id: pool._id, reihenfolge_nummer: 'H9', status: 'angelegt', kaempfer1_id: null, kaempfer2_id: null,
        kaempfer1_quelle_kampf_id: h1._id, kaempfer1_quelle_typ: 'sieger',
        kaempfer2_quelle_kampf_id: h2._id, kaempfer2_quelle_typ: 'sieger'
    });

    await aktualisiereTurnier(kaempfeRepository, poolsRepository, pool._id);

    const kaempfe = await kaempfeRepository.findByPool(pool._id);
    const h9 = kaempfe.find(k => k.reihenfolge_nummer === 'H9');
    assert.equal(h9.status, 'bereit');
    assert.equal(h9.kaempfer1_id, 'teilnehmer:x');
    assert.equal(h9.kaempfer2_id, 'teilnehmer:w');
});

test('aktualisiereTurnier schließt den Pool ab, wenn F1, T11 und T12 beendet oder freilos sind', async () => {
    const { kaempfeRepository, poolsRepository } = await neueRepositories();
    const pool = await poolsRepository.create({});
    await kaempfeRepository.create({ pool_id: pool._id, reihenfolge_nummer: 'F1', status: 'beendet' });
    await kaempfeRepository.create({ pool_id: pool._id, reihenfolge_nummer: 'T11', status: 'freilos' });
    await kaempfeRepository.create({ pool_id: pool._id, reihenfolge_nummer: 'T12', status: 'beendet' });

    await aktualisiereTurnier(kaempfeRepository, poolsRepository, pool._id);

    const aktualisierterPool = await poolsRepository.findById(pool._id);
    assert.equal(aktualisierterPool.status, 'kaempfe_beendet');
});

test('aktualisiereTurnier lässt den Pool unverändert, solange nicht alle drei Abschlusskämpfe fertig sind', async () => {
    const { kaempfeRepository, poolsRepository } = await neueRepositories();
    const pool = await poolsRepository.create({});
    await kaempfeRepository.create({ pool_id: pool._id, reihenfolge_nummer: 'F1', status: 'beendet' });
    await kaempfeRepository.create({ pool_id: pool._id, reihenfolge_nummer: 'T11', status: 'freilos' });
    await kaempfeRepository.create({ pool_id: pool._id, reihenfolge_nummer: 'T12', status: 'bereit' });

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
Expected: FAIL — `Cannot find module '.../src/db/kaskaden/doppelKo16PoolKaskade.js'`

- [ ] **Step 3: Implementieren**

`src/db/kaskaden/doppelKo16PoolKaskade.js`:

```javascript
import { DOPPEL_KO_16_TOPOLOGIE } from '../../shared/bracketTopologie.js';
import { verknuepfeQuellenFuerPool } from './bracketVerknuepfung.js';
import { wendeKaempfeKaskadeAn } from './kaempfeKaskade.js';

// CouchDB-Pendant zu DoppelKo16Manager.initialisierePool/aktualisiereTurnier
// (src/services/DoppelKo16Manager.js) -- strukturell identisch zu doppelKo8PoolKaskade.js, nur
// mit doppelter Rastergröße und eigenen Freilos-Positionen. Wiederverwendet dieselben bereits
// migrierten Bausteine (verknuepfeQuellenFuerPool, wendeKaempfeKaskadeAn).
const RASTER_GROESSE = 16;
const FREILOS_INDICES = [15, 0, 8, 7, 4, 11, 12, 3];

function ermittleRasterListe(teilnehmer) {
    const N = teilnehmer.length;
    const F = RASTER_GROESSE - N;
    const freilosSlots = new Set(FREILOS_INDICES.slice(0, F));

    const poolSlots = {
        A: [0, 1, 2, 3].filter(s => !freilosSlots.has(s)),
        B: [4, 5, 6, 7].filter(s => !freilosSlots.has(s)),
        C: [8, 9, 10, 11].filter(s => !freilosSlots.has(s)),
        D: [12, 13, 14, 15].filter(s => !freilosSlots.has(s))
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
        'H9', 'H10', 'H11', 'H12', 'H13', 'H14',
        'T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10', 'T11', 'T12',
        'F1'
    ];
    for (const reihenfolgeNummer of huellenReihenfolgeNummern) {
        await kaempfeRepository.create({
            pool_id: poolId, status: 'angelegt', reihenfolge_nummer: reihenfolgeNummer,
            kaempfer1_id: null, kaempfer2_id: null, sieger_id: null,
            kampfzeit_in_sekunden: 0, unterbewertung_kaempfer1: 0, unterbewertung_kaempfer2: 0
        });
    }

    await verknuepfeQuellenFuerPool(kaempfeRepository, poolId, DOPPEL_KO_16_TOPOLOGIE);
    await aktualisiereTurnier(kaempfeRepository, poolsRepository, poolId);
}

export async function aktualisiereTurnier(kaempfeRepository, poolsRepository, poolId) {
    const kaempfe = await wendeKaempfeKaskadeAn(kaempfeRepository, poolId);
    if (kaempfe.length === 0) return;

    const istBeendetOderFreilos = (k) => k?.status === 'beendet' || k?.status === 'freilos';
    const f1 = kaempfe.find(k => k.reihenfolge_nummer === 'F1');
    const t11 = kaempfe.find(k => k.reihenfolge_nummer === 'T11');
    const t12 = kaempfe.find(k => k.reihenfolge_nummer === 'T12');
    if (istBeendetOderFreilos(f1) && istBeendetOderFreilos(t11) && istBeendetOderFreilos(t12)) {
        await poolsRepository.update(poolId, { status: 'kaempfe_beendet' });
    }
}
```

- [ ] **Step 4: Test ausführen, Erfolg bestätigen**

Run: `npm run test:unit`
Expected: PASS (6 neue Tests, insgesamt 98)

- [ ] **Step 5: Dokumentation ergänzen**

In `CLAUDE.md` im Abschnitt "Zentrale Architekturkonzepte", im Punkt zu `src/db/kaskaden/`, `doppelKo16PoolKaskade.js` als siebtes Modul ergänzen — CouchDB-Pendant zu `DoppelKo16Manager.js`, viertes von acht `*Manager.js`-Pendants, strukturell identisch zu `doppelKo8PoolKaskade.js` mit größerem Raster.

- [ ] **Step 6: Commit**

```bash
git add src/db/kaskaden/doppelKo16PoolKaskade.js tests/unit/db/kaskaden/doppelKo16PoolKaskade.test.js CLAUDE.md
git commit -m "feat: CouchDB-Pendant zu DoppelKo16Manager (Pool-Initialisierung)"
```

---

## Self-Review-Notizen

- **Spec-Abdeckung:** Deckt das vierte von acht Pool-Anlage-Services ab. Die verbleibenden vier (DoppelKo32, GruppenÜberkreuz, MannschaftDoppelKo8/16) sind bewusst NICHT Teil dieses Plans.
- **Platzhalter-Scan:** Keine TBD/TODO-Stellen. Das ungenutzte `djbSchluessel`-Feld wird bewusst nicht übernommen.
- **Determinismus der Tests:** Die Rasterbefüllung im ersten Test (16 Teilnehmer, ausschließlich unterschiedliche Vereine) wurde von Hand exakt nach dem Vereinstrennungs-Algorithmus nachvollzogen — die Greedy-Zuweisung mit Tie-Break ergibt bei 16 Teilnehmern mit je einzigartigem Verein die Zuordnung A=[1.,5.,9.,13. Teilnehmer], B=[2.,6.,10.,14.], C=[3.,7.,11.,15.], D=[4.,8.,12.,16.] (nach Anlage-Reihenfolge, vor der finalen Gewichtssortierung innerhalb jedes Pools) — bei streng aufsteigenden Gewichten ergibt das die im Test genannten Paarungen.
- **Wiederverwendung:** `verknuepfeQuellenFuerPool` und `wendeKaempfeKaskadeAn` werden importiert statt neu implementiert, exakt wie beim 8er-Pendant.
