# Doppel-KO-8 Pool-Initialisierung Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CouchDB-Äquivalent von `src/services/DoppelKo8Manager.js` (`initialisierePool`, `aktualisiereTurnier`) — drittes von acht `*Manager.js`-Pool-Anlage-Services. Anders als `JederGegenJedenManager.js` (bereits migriert) hat dieser Manager eine Freilos-Verteilung nach DJB-Verteilungsschlüssel, eine Vereinstrennungs-/Gewichtssortierungs-Logik für die Rasterbefüllung, und ruft nach dem Kämpfe-Insert die bereits migrierte Bracket-Verknüpfung (`verknuepfeQuellenFuerPool`, siehe `docs/superpowers/plans/2026-09-23-bracket-verknuepfung.md`) auf.

**Wiederverwendung bereits migrierter Bausteine:** `aktualisiereTurnier` im Original berechnet die Kaskade exakt nach demselben "lade alles, berechne Patches, wende an, wiederhole"-Muster, das bereits in `src/db/kaskaden/kaempfeKaskade.js` (`wendeKaempfeKaskadeAn`) implementiert und getestet ist — diese Funktion wird hier direkt wiederverwendet statt erneut implementiert. Ebenso wird `verknuepfeQuellenFuerPool` aus `src/db/kaskaden/bracketVerknuepfung.js` direkt wiederverwendet (mit der reinen `DOPPEL_KO_8_TOPOLOGIE`-Konstante aus `src/shared/bracketTopologie.js` als Parameter, exakt wie im knex-Original `DoppelKo8Manager.js` selbst).

Vollständig getestet, weiterhin **nicht** in `src/app.js`/`src/routes/`/`src/controllers/` verdrahtet.

**Architecture:** Eine neue Kaskaden-Datei `src/db/kaskaden/doppelKo8PoolKaskade.js` mit einer privaten Hilfsfunktion `ermittleRasterListe(teilnehmer)` (reine Portierung der Freilos-/Vereinstrennungs-/Rasterbefüllungs-Logik, `id`→`_id` angepasst) und zwei exportierten Funktionen (`initialisierePool`, `aktualisiereTurnier`), die `kaempfeRepository`/`turnierTeilnehmerRepository`/`poolsRepository` statt `knex` verwenden.

**Tech Stack:** Kein neuer Dependency-Bedarf.

**Spec:** [docs/superpowers/specs/2026-09-22-couchdb-pouchdb-migration-design.md](../specs/2026-09-22-couchdb-pouchdb-migration-design.md)

## Global Constraints

- ESM-Only — `import`/`export`, kein `require`.
- Keine Kommentare, die nur wiederholen, was der Code schon sagt.
- Genau EIN `startTestCouchServer()`-Aufruf pro Testdatei via `before()`/`after()`.
- `src/services/DoppelKo8Manager.js` wird **nicht** verändert.
- Das im Original ungenutzte Feld `this.djbSchluessel` (Konstruktor, nirgends in `initialisierePool` referenziert) wird **nicht** übernommen — analog zum bereits bei `JederGegenJedenManager.js` unbenutzten `pool`-Read, der ebenfalls nicht mitübertragen wurde.
- Die Freilos-Sonderregel bleibt exakt erhalten: bei einem Freilos-Kampf erhält die **besetzte** Seite `unterbewertung_kaempferN = 10` (nicht die leere Seite) — keine intuitive "Bonus für Freilos"-Umkehrung vornehmen.
- `reihenfolge_nummer` bleibt String (`'H1'`, `'F'`, …), exakt wie im Original.
- Diese Schicht wird in diesem Plan **nicht** in `src/app.js`, `src/routes/` oder `src/controllers/` verdrahtet.

---

### Task 1: `doppelKo8PoolKaskade.js`

**Files:**
- Create: `src/db/kaskaden/doppelKo8PoolKaskade.js`
- Test: `tests/unit/db/kaskaden/doppelKo8PoolKaskade.test.js`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: `findByPool(poolId)` aus `turnierTeilnehmerRepository`; `create(data)`/`findByPool(poolId)`/`update(id,patch)` aus `kaempfeRepository`; `update(id,patch)`/`findById(id)` aus `poolsRepository`; `verknuepfeQuellenFuerPool` aus `./bracketVerknuepfung.js`; `wendeKaempfeKaskadeAn` aus `./kaempfeKaskade.js`; `DOPPEL_KO_8_TOPOLOGIE` aus `../../shared/bracketTopologie.js`.
- Produces: `initialisierePool(kaempfeRepository, turnierTeilnehmerRepository, poolsRepository, poolId): Promise<void>`, `aktualisiereTurnier(kaempfeRepository, poolsRepository, poolId): Promise<void>`.

- [ ] **Step 1: Failing Tests schreiben**

`tests/unit/db/kaskaden/doppelKo8PoolKaskade.test.js`:

```javascript
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startTestCouchServer } from '../../helpers/couchTestServer.js';
import { connect, ensureDatabase } from '../../../../src/db/couch.js';
import { createKaempfeRepository } from '../../../../src/db/repositories/kaempfeRepository.js';
import { createTurnierTeilnehmerRepository } from '../../../../src/db/repositories/turnierTeilnehmerRepository.js';
import { createPoolsRepository } from '../../../../src/db/repositories/poolsRepository.js';
import { initialisierePool, aktualisiereTurnier } from '../../../../src/db/kaskaden/doppelKo8PoolKaskade.js';

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

test('initialisierePool füllt bei 8 Teilnehmern verschiedener Vereine das Raster ohne Freilose und trennt Vereine', async () => {
    const { kaempfeRepository, turnierTeilnehmerRepository, poolsRepository } = await neueRepositories();
    const pool = await poolsRepository.create({});
    const angaben = [
        [50, 'ClubX'], [90, 'ClubX'], [55, 'ClubB'], [60, 'ClubC'],
        [65, 'ClubD'], [70, 'ClubE'], [75, 'ClubF'], [80, 'ClubG']
    ];
    const t = {};
    for (const [gewicht, verein] of angaben) {
        t[gewicht] = await turnierTeilnehmerRepository.create({ pool_id: pool._id, gewicht, verein });
    }

    await initialisierePool(kaempfeRepository, turnierTeilnehmerRepository, poolsRepository, pool._id);

    const kaempfe = await kaempfeRepository.findByPool(pool._id);
    assert.equal(kaempfe.length, 11);

    const byReihenfolge = Object.fromEntries(kaempfe.map(k => [k.reihenfolge_nummer, k]));

    // Rasterbefüllung gemäß Vereinstrennungs-Algorithmus (von Hand nachvollzogen):
    // H1: 50(ClubX)-65(ClubD), H2: 70(ClubE)-90(ClubX), H3: 55(ClubB)-75(ClubF), H4: 60(ClubC)-80(ClubG)
    assert.equal(byReihenfolge.H1.kaempfer1_id, t[50]._id);
    assert.equal(byReihenfolge.H1.kaempfer2_id, t[65]._id);
    assert.equal(byReihenfolge.H1.status, 'bereit');
    assert.equal(byReihenfolge.H2.kaempfer1_id, t[70]._id);
    assert.equal(byReihenfolge.H2.kaempfer2_id, t[90]._id);
    assert.equal(byReihenfolge.H3.kaempfer1_id, t[55]._id);
    assert.equal(byReihenfolge.H3.kaempfer2_id, t[75]._id);
    assert.equal(byReihenfolge.H4.kaempfer1_id, t[60]._id);
    assert.equal(byReihenfolge.H4.kaempfer2_id, t[80]._id);

    for (const nr of ['H5', 'H6', 'T1', 'T2', 'T3', 'T4', 'F']) {
        assert.equal(byReihenfolge[nr].status, 'angelegt');
        assert.equal(byReihenfolge[nr].kaempfer1_id, null);
    }

    // verknuepfeQuellenFuerPool wurde aufgerufen: H5 bezieht seine Kämpfer aus H1/H2-Siegern.
    assert.equal(byReihenfolge.H5.kaempfer1_quelle_kampf_id, byReihenfolge.H1._id);
    assert.equal(byReihenfolge.H5.kaempfer1_quelle_typ, 'sieger');
    assert.equal(byReihenfolge.H5.kaempfer2_quelle_kampf_id, byReihenfolge.H2._id);
    assert.equal(byReihenfolge.F.kaempfer1_quelle_kampf_id, byReihenfolge.H5._id);
});

test('initialisierePool weist Freilose an den korrekten Rasterpositionen zu, inkl. Sonderregel für die besetzte Seite', async () => {
    const { kaempfeRepository, turnierTeilnehmerRepository, poolsRepository } = await neueRepositories();
    const pool = await poolsRepository.create({});
    const t1 = await turnierTeilnehmerRepository.create({ pool_id: pool._id, gewicht: 50, verein: 'Club1' });
    const t2 = await turnierTeilnehmerRepository.create({ pool_id: pool._id, gewicht: 55, verein: 'Club2' });

    await initialisierePool(kaempfeRepository, turnierTeilnehmerRepository, poolsRepository, pool._id);

    const kaempfe = await kaempfeRepository.findByPool(pool._id);
    const byReihenfolge = Object.fromEntries(kaempfe.map(k => [k.reihenfolge_nummer, k]));

    // Freilos-Positionen [7,0,4,3] -> Raster: [null, t1, t2, null, null, null, null, null]
    assert.equal(byReihenfolge.H1.status, 'freilos');
    assert.equal(byReihenfolge.H1.kaempfer1_id, null);
    assert.equal(byReihenfolge.H1.kaempfer2_id, t1._id);
    assert.equal(byReihenfolge.H1.sieger_id, t1._id);
    assert.equal(byReihenfolge.H1.unterbewertung_kaempfer1, 0);
    assert.equal(byReihenfolge.H1.unterbewertung_kaempfer2, 10);

    assert.equal(byReihenfolge.H2.status, 'freilos');
    assert.equal(byReihenfolge.H2.kaempfer1_id, t2._id);
    assert.equal(byReihenfolge.H2.kaempfer2_id, null);
    assert.equal(byReihenfolge.H2.sieger_id, t2._id);
    assert.equal(byReihenfolge.H2.unterbewertung_kaempfer1, 10);
    assert.equal(byReihenfolge.H2.unterbewertung_kaempfer2, 0);

    assert.equal(byReihenfolge.H3.status, 'freilos');
    assert.equal(byReihenfolge.H3.kaempfer1_id, null);
    assert.equal(byReihenfolge.H3.kaempfer2_id, null);
    assert.equal(byReihenfolge.H3.sieger_id, null);

    assert.equal(byReihenfolge.H4.status, 'freilos');
    assert.equal(byReihenfolge.H4.kaempfer1_id, null);
    assert.equal(byReihenfolge.H4.kaempfer2_id, null);
    assert.equal(byReihenfolge.H4.sieger_id, null);
});

test('aktualisiereTurnier wendet die Kaskade an und befüllt einen Folgekampf, sobald beide Quellkämpfe beendet sind', async () => {
    const { kaempfeRepository, poolsRepository } = await neueRepositories();
    const pool = await poolsRepository.create({});
    const h1 = await kaempfeRepository.create({ pool_id: pool._id, reihenfolge_nummer: 'H1', status: 'beendet', kaempfer1_id: 'teilnehmer:x', kaempfer2_id: 'teilnehmer:y', sieger_id: 'teilnehmer:x' });
    const h2 = await kaempfeRepository.create({ pool_id: pool._id, reihenfolge_nummer: 'H2', status: 'beendet', kaempfer1_id: 'teilnehmer:z', kaempfer2_id: 'teilnehmer:w', sieger_id: 'teilnehmer:w' });
    await kaempfeRepository.create({
        pool_id: pool._id, reihenfolge_nummer: 'H5', status: 'angelegt', kaempfer1_id: null, kaempfer2_id: null,
        kaempfer1_quelle_kampf_id: h1._id, kaempfer1_quelle_typ: 'sieger',
        kaempfer2_quelle_kampf_id: h2._id, kaempfer2_quelle_typ: 'sieger'
    });

    await aktualisiereTurnier(kaempfeRepository, poolsRepository, pool._id);

    const kaempfe = await kaempfeRepository.findByPool(pool._id);
    const h5 = kaempfe.find(k => k.reihenfolge_nummer === 'H5');
    assert.equal(h5.status, 'bereit');
    assert.equal(h5.kaempfer1_id, 'teilnehmer:x');
    assert.equal(h5.kaempfer2_id, 'teilnehmer:w');
});

test('aktualisiereTurnier schließt den Pool ab, wenn F, T3 und T4 beendet oder freilos sind', async () => {
    const { kaempfeRepository, poolsRepository } = await neueRepositories();
    const pool = await poolsRepository.create({});
    await kaempfeRepository.create({ pool_id: pool._id, reihenfolge_nummer: 'F', status: 'beendet' });
    await kaempfeRepository.create({ pool_id: pool._id, reihenfolge_nummer: 'T3', status: 'freilos' });
    await kaempfeRepository.create({ pool_id: pool._id, reihenfolge_nummer: 'T4', status: 'beendet' });

    await aktualisiereTurnier(kaempfeRepository, poolsRepository, pool._id);

    const aktualisierterPool = await poolsRepository.findById(pool._id);
    assert.equal(aktualisierterPool.status, 'kaempfe_beendet');
});

test('aktualisiereTurnier lässt den Pool unverändert, solange nicht alle drei Abschlusskämpfe fertig sind', async () => {
    const { kaempfeRepository, poolsRepository } = await neueRepositories();
    const pool = await poolsRepository.create({});
    await kaempfeRepository.create({ pool_id: pool._id, reihenfolge_nummer: 'F', status: 'beendet' });
    await kaempfeRepository.create({ pool_id: pool._id, reihenfolge_nummer: 'T3', status: 'freilos' });
    await kaempfeRepository.create({ pool_id: pool._id, reihenfolge_nummer: 'T4', status: 'bereit' });

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
Expected: FAIL — `Cannot find module '.../src/db/kaskaden/doppelKo8PoolKaskade.js'`

- [ ] **Step 3: Implementieren**

`src/db/kaskaden/doppelKo8PoolKaskade.js`:

```javascript
import { DOPPEL_KO_8_TOPOLOGIE } from '../../shared/bracketTopologie.js';
import { verknuepfeQuellenFuerPool } from './bracketVerknuepfung.js';
import { wendeKaempfeKaskadeAn } from './kaempfeKaskade.js';

// CouchDB-Pendant zu DoppelKo8Manager.initialisierePool/aktualisiereTurnier
// (src/services/DoppelKo8Manager.js) -- dort direkt knex-gebunden, hier über die jeweiligen
// Repositories. Wiederverwendet die bereits migrierten Bausteine verknuepfeQuellenFuerPool
// (Bracket-Verknüpfung) und wendeKaempfeKaskadeAn (Kaskaden-Engine) statt sie zu duplizieren.
const RASTER_GROESSE = 8;
const FREILOS_INDICES = [7, 0, 4, 3];

function ermittleRasterListe(teilnehmer) {
    const N = teilnehmer.length;
    const F = RASTER_GROESSE - N;
    const freilosSlots = new Set(FREILOS_INDICES.slice(0, F));

    const poolSlots = {
        A: [0, 1].filter(s => !freilosSlots.has(s)),
        B: [2, 3].filter(s => !freilosSlots.has(s)),
        C: [4, 5].filter(s => !freilosSlots.has(s)),
        D: [6, 7].filter(s => !freilosSlots.has(s))
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

    for (const reihenfolgeNummer of ['H5', 'H6', 'T1', 'T2', 'T3', 'T4', 'F']) {
        await kaempfeRepository.create({
            pool_id: poolId, status: 'angelegt', reihenfolge_nummer: reihenfolgeNummer,
            kaempfer1_id: null, kaempfer2_id: null, sieger_id: null,
            kampfzeit_in_sekunden: 0, unterbewertung_kaempfer1: 0, unterbewertung_kaempfer2: 0
        });
    }

    await verknuepfeQuellenFuerPool(kaempfeRepository, poolId, DOPPEL_KO_8_TOPOLOGIE);
    await aktualisiereTurnier(kaempfeRepository, poolsRepository, poolId);
}

export async function aktualisiereTurnier(kaempfeRepository, poolsRepository, poolId) {
    const kaempfe = await wendeKaempfeKaskadeAn(kaempfeRepository, poolId);
    if (kaempfe.length === 0) return;

    const istBeendetOderFreilos = (k) => k?.status === 'beendet' || k?.status === 'freilos';
    const f = kaempfe.find(k => k.reihenfolge_nummer === 'F');
    const t3 = kaempfe.find(k => k.reihenfolge_nummer === 'T3');
    const t4 = kaempfe.find(k => k.reihenfolge_nummer === 'T4');
    if (istBeendetOderFreilos(f) && istBeendetOderFreilos(t3) && istBeendetOderFreilos(t4)) {
        await poolsRepository.update(poolId, { status: 'kaempfe_beendet' });
    }
}
```

- [ ] **Step 4: Test ausführen, Erfolg bestätigen**

Run: `npm run test:unit`
Expected: PASS (6 neue Tests, insgesamt 92)

- [ ] **Step 5: Dokumentation ergänzen**

In `CLAUDE.md` im Abschnitt "Zentrale Architekturkonzepte", im Punkt zu `src/db/kaskaden/`, `doppelKo8PoolKaskade.js` als sechstes Modul ergänzen — CouchDB-Pendant zu `DoppelKo8Manager.js`, drittes von acht `*Manager.js`-Pendants, explizit erwähnen, dass es die bereits migrierten `verknuepfeQuellenFuerPool` und `wendeKaempfeKaskadeAn` wiederverwendet statt sie zu duplizieren.

- [ ] **Step 6: Commit**

```bash
git add src/db/kaskaden/doppelKo8PoolKaskade.js tests/unit/db/kaskaden/doppelKo8PoolKaskade.test.js CLAUDE.md
git commit -m "feat: CouchDB-Pendant zu DoppelKo8Manager (Pool-Initialisierung)"
```

---

## Self-Review-Notizen

- **Spec-Abdeckung:** Deckt das dritte von acht Pool-Anlage-Services ab, inklusive der komplexesten bisher migrierten Einzel-Logik (Freilos-Verteilung, Vereinstrennung). Die verbleibenden fünf (DoppelKo16/32, GruppenÜberkreuz, MannschaftDoppelKo8/16) sind bewusst NICHT Teil dieses Plans.
- **Platzhalter-Scan:** Keine TBD/TODO-Stellen. Das ungenutzte `djbSchluessel`-Feld aus dem Original wird bewusst nicht übernommen (siehe Global Constraints).
- **Determinismus der Tests:** Die Vereinstrennungs-/Rasterbefüllungs-Reihenfolge im ersten Test wurde von Hand exakt nach dem Original-Algorithmus (Schritt für Schritt: Vereinsgruppierung, Greedy-Zuweisung mit Tie-Break, Rasterbefüllung) nachvollzogen, nicht geraten — die erwarteten Paarungen (H1: 50-65, H2: 70-90, H3: 55-75, H4: 60-80) sind das tatsächliche Ergebnis dieser Nachrechnung, keine Wunschwerte.
- **Wiederverwendung:** `verknuepfeQuellenFuerPool` und `wendeKaempfeKaskadeAn` werden importiert statt neu implementiert — reduziert das Risiko einer Verhaltensabweichung gegenüber den bereits approved Bausteinen auf null.
