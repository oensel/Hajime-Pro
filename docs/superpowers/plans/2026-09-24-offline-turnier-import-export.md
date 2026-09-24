# Offline-Turnier-Import-Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Additive CouchDB-Varianten von `importTurnier` (der eigentliche Offline-"Neues
Turnier"-Weg — eine zuvor exportierte JSON-Datei wird als komplett neues Turnier mit
frischen IDs eingelesen) und `exportTurnier` bauen, inklusive der ID-Umschreibung über
sechs Entitätstypen hinweg. Fertig getestet, aber weiterhin **nicht** in `app.js`
eingehängt — Fortsetzung des additiv/ruhenden Musters aus den vorigen zwei Plänen.

**Architecture:** Ein neues, reines Modul `src/db/offline/turnierWettkampfdaten.js`
kapselt die ID-Umschreibung (Export-Datei-IDs → neue CouchDB-Dokument-IDs) für beide
Richtungen — es ist das CouchDB-Äquivalent zu `importWettkampfdaten` in
`src/controllers/turnierController.js`, aber deutlich einfacher: da eine Turnier-Datenbank
per Konstruktion nur ein Turnier enthält, entfällt die gesamte `turnier_id`-Filterung, und
da `importTurnier` immer ein brandneues, leeres Turnier anlegt, entfällt auch der
Abgleich-mit-bestehender-Mannschaft-Zweig (der nur für den online-only,
nicht-offline-relevanten `importTurnierErgebnisse`-Reimport gebraucht wird). Die beiden
neuen Controller-Funktionen erweitern die bestehende, bereits additive Datei
`src/controllers/offline/turnierController.js` (Task 3 des vorigen Plans) statt eine
neue Datei anzulegen, da sie sich denselben lokalen `ladeStatusEffektiv`-Helfer und
dieselben Repository-Importe teilen.

**Tech Stack:** Node.js/Express, CouchDB-Repositories, `node --test` gegen die bestehende
In-Memory-Test-Infrastruktur.

**Spec:** [docs/superpowers/specs/2026-09-24-offline-couchdb-cutover.md](../specs/2026-09-24-offline-couchdb-cutover.md)
(Umsetzungsreihenfolge, Schritt 3).

## Global Constraints

- Additiv/ruhend: nichts in diesem Plan hängt etwas in `app.js` ein oder ändert das
  bestehende, weiterhin live laufende `src/controllers/turnierController.js`-Verhalten
  (Task 1 extrahiert verlustfrei, ändert kein Verhalten).
- Turnier-IDs sind UUID-Strings (kein `parseInt`).
- Der Offline-Kiosk-Betrieb geht von genau einem aktiven Turnier aus: `importTurnier`
  entfernt vor dem Import alle lokal vorhandenen Turnier-Datenbanken (Analogie zur
  bisherigen Knex-Logik, die alle bestehenden `turniere`-Zeilen löscht).
- Ausschreibungs-PDF wird als Base64-String-Feld auf dem `turnier:meta`-Dokument
  transportiert (kein CouchDB-Attachment) — deckt nur das Import/Export-Roundtrip ab; das
  separate PDF-Upload-Formularfeld in `createTurnier`/`updateTurnier` und der eigenständige
  Download-Endpunkt (`ladeAusschreibung`) sind bewusst nicht Teil dieses Plans.
- Tests folgen der bestehenden Konvention: ein `startTestCouchServer()`-Aufruf pro
  Testdatei.

---

### Task 1: `GUELTIGE_STATUS_WERTE` + `normalisiereKampfStatus` nach `src/shared/turnierRegeln.js` extrahieren

**Files:**
- Modify: `src/shared/turnierRegeln.js` (zwei Exporte ergänzen)
- Modify: `src/controllers/turnierController.js` (Definitionen entfernen, Import ergänzen)
- Modify: `tests/unit/shared/turnierRegeln.test.js` (Tests ergänzen)

**Interfaces:**
- Produces: `GUELTIGE_STATUS_WERTE` (Array-Konstante), `normalisiereKampfStatus(status, kaempfer1Id, kaempfer2Id)` — exakt dieselbe Logik wie heute in `src/controllers/turnierController.js`, nur verschoben.

- [ ] **Step 1: Fehlschlagende Tests ergänzen**

An `tests/unit/shared/turnierRegeln.test.js` anfügen:

```javascript
import { GUELTIGE_STATUS_WERTE, normalisiereKampfStatus } from '../../../src/shared/turnierRegeln.js';

test('GUELTIGE_STATUS_WERTE enthält genau die vier physisch gespeicherten Status-Werte', () => {
    assert.deepEqual(GUELTIGE_STATUS_WERTE, ['entwurf', 'veroeffentlicht', 'abgeschlossen', 'abgesagt']);
});

test('normalisiereKampfStatus übersetzt das alte 3-Werte-Vokabular', () => {
    assert.equal(normalisiereKampfStatus('laufend', 'a', 'b'), 'gestartet');
    assert.equal(normalisiereKampfStatus('wartet', 'a', 'b'), 'bereit');
    assert.equal(normalisiereKampfStatus('wartet', 'a', null), 'angelegt');
    assert.equal(normalisiereKampfStatus('beendet', 'a', null), 'freilos');
    assert.equal(normalisiereKampfStatus('beendet', 'a', 'b'), 'beendet');
    assert.equal(normalisiereKampfStatus(undefined, 'a', 'b'), 'angelegt');
});
```

- [ ] **Step 2: Test ausführen, um das Fehlschlagen zu bestätigen**

Run: `node --test tests/unit/shared/turnierRegeln.test.js`
Expected: FAIL — `GUELTIGE_STATUS_WERTE`/`normalisiereKampfStatus` sind nicht exportiert.

- [ ] **Step 3: In `src/shared/turnierRegeln.js` ergänzen**

Am Dateiende anfügen:

```javascript
// Nur diese vier Werte werden physisch gespeichert; 'anmeldung_geschlossen' und
// 'in_durchfuehrung' sind reine Ableitungen von ermittleEffektivenStatus.
export const GUELTIGE_STATUS_WERTE = ['entwurf', 'veroeffentlicht', 'abgeschlossen', 'abgesagt'];

// Übersetzt den alten 3-Werte-Kampf-Status (wartet/laufend/beendet) aus vor der
// 6-Werte-Migration exportierten Dateien in das neue Vokabular; bereits neue Werte
// bleiben unverändert.
export function normalisiereKampfStatus(status, kaempfer1Id, kaempfer2Id) {
    if (status === 'laufend') return 'gestartet';
    if (status === 'wartet') return (kaempfer1Id != null && kaempfer2Id != null) ? 'bereit' : 'angelegt';
    if (status === 'beendet' && (kaempfer1Id == null || kaempfer2Id == null)) return 'freilos';
    return status || 'angelegt';
}
```

- [ ] **Step 4: `src/controllers/turnierController.js` anpassen**

Die lokale Definition von `GUELTIGE_STATUS_WERTE` (Zeile mit
`const GUELTIGE_STATUS_WERTE = [...]`) und die Funktion `normalisiereKampfStatus`
entfernen. Import-Zeile erweitern von:

```javascript
import { ermittleEffektivenStatus, validiereZahlungsdaten } from '../shared/turnierRegeln.js';
```

zu:

```javascript
import { ermittleEffektivenStatus, validiereZahlungsdaten, GUELTIGE_STATUS_WERTE, normalisiereKampfStatus } from '../shared/turnierRegeln.js';
```

- [ ] **Step 5: Tests ausführen, um das Bestehen zu bestätigen**

Run: `node --test tests/unit/shared/turnierRegeln.test.js`
Expected: PASS

- [ ] **Step 6: Vollständige Unit-Test-Suite ausführen**

Run: `npm run test:unit`
Expected: alle Tests grün.

- [ ] **Step 7: Committen**

```bash
git add src/shared/turnierRegeln.js src/controllers/turnierController.js tests/unit/shared/turnierRegeln.test.js
git commit -m "refactor: GUELTIGE_STATUS_WERTE + normalisiereKampfStatus nach turnierRegeln.js extrahiert"
```

---

### Task 2: Wettkampfdaten-Import/Export-Modul (ID-Umschreibung)

**Files:**
- Create: `src/db/offline/turnierWettkampfdaten.js`
- Test: `tests/unit/db/offline/turnierWettkampfdaten.test.js`

**Interfaces:**
- Consumes: `normalisiereKampfStatus` aus `../../shared/turnierRegeln.js`; die `create`-
  Methoden von `kampfflaechenRepository`, `poolsRepository`, `turnierTeilnehmerRepository`,
  `kaempfeRepository`, `mannschaftenRepository`, `mannschaftMitgliederRepository`; die
  `update`-Methode von `kaempfeRepository`; die `findAll`-Methoden von
  `kampfflaechenRepository`/`poolsRepository`/`turnierTeilnehmerRepository`/
  `kaempfeRepository`; die generische `query({})`-Methode (aus `baseRepository.js`, an
  jedes Repository durchgereicht) für `mannschaftenRepository`/
  `mannschaftMitgliederRepository`, die kein eigenes `findAll` haben.
- Produces: `importiereWettkampfdaten(repos, daten)` → `{ kampfflaechen, pools, teilnehmer, kaempfe }`
  (Anzahlen). `exportiereWettkampfdaten(repos)` → `{ kampfflaechen, pools, teilnehmer, kaempfe, mannschaften, mannschaft_mitglieder }`
  (Arrays der rohen Dokumente). `repos` ist beide Male ein Objekt mit den Schlüsseln
  `kampfflaechenRepository`, `poolsRepository`, `turnierTeilnehmerRepository`,
  `kaempfeRepository`, `mannschaftenRepository`, `mannschaftMitgliederRepository`.

- [ ] **Step 1: Fehlschlagenden Test schreiben**

`tests/unit/db/offline/turnierWettkampfdaten.test.js`:

```javascript
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startTestCouchServer } from '../../helpers/couchTestServer.js';
import { connect, ensureDatabase } from '../../../../src/db/couch.js';
import { createKampfflaechenRepository } from '../../../../src/db/repositories/kampfflaechenRepository.js';
import { createPoolsRepository } from '../../../../src/db/repositories/poolsRepository.js';
import { createTurnierTeilnehmerRepository } from '../../../../src/db/repositories/turnierTeilnehmerRepository.js';
import { createKaempfeRepository } from '../../../../src/db/repositories/kaempfeRepository.js';
import { createMannschaftenRepository } from '../../../../src/db/repositories/mannschaftenRepository.js';
import { createMannschaftMitgliederRepository } from '../../../../src/db/repositories/mannschaftMitgliederRepository.js';
import { importiereWettkampfdaten, exportiereWettkampfdaten } from '../../../../src/db/offline/turnierWettkampfdaten.js';

let server;
let nano;

before(async () => {
    server = await startTestCouchServer();
    nano = connect(server.url);
});

after(async () => {
    await server.close();
});

async function neueRepos() {
    const db = await ensureDatabase(nano, `test-${randomUUID()}`);
    return {
        kampfflaechenRepository: createKampfflaechenRepository(db),
        poolsRepository: createPoolsRepository(db),
        turnierTeilnehmerRepository: createTurnierTeilnehmerRepository(db),
        kaempfeRepository: createKaempfeRepository(db),
        mannschaftenRepository: createMannschaftenRepository(db),
        mannschaftMitgliederRepository: createMannschaftMitgliederRepository(db)
    };
}

test('importiereWettkampfdaten schreibt Fremdschlüssel über alle sechs Entitätstypen korrekt um', async () => {
    const repos = await neueRepos();

    const daten = {
        kampfflaechen: [{ id: 1, bezeichnung: 'Matte 1', status: 'frei' }],
        pools: [{ id: 10, kampfflaeche_id: 1, bezeichnung: 'Pool A', modus: 'Jeder-gegen-Jeden' }],
        teilnehmer: [
            { id: 100, pool_id: 10, judopass_id: 'J1', vorname: 'Max', nachname: 'Mustermann', geburtsjahr: 2000, geschlecht: 'm', verein: 'TV Muster', gewicht: 70 },
            { id: 101, pool_id: 10, judopass_id: 'J2', vorname: 'Erika', nachname: 'Musterfrau', geburtsjahr: 2001, geschlecht: 'w', verein: 'TV Muster', gewicht: 65 }
        ],
        kaempfe: [
            { id: 1000, pool_id: 10, kaempfer1_id: 100, kaempfer2_id: 101, status: 'wartet', reihenfolge_nummer: 'H1' },
            { id: 1001, pool_id: 10, status: 'angelegt', reihenfolge_nummer: 'F', kaempfer1_quelle_kampf_id: 1000, kaempfer1_quelle_typ: 'sieger' }
        ],
        mannschaften: [{ id: 5000, pool_id: 10, verein: 'TV Muster', bezeichnung: 'Team 1' }],
        mannschaft_mitglieder: [{ mannschaft_id: 5000, turnier_teilnehmer_id: 100, gewichtsklasse: '-60kg' }]
    };

    const ergebnis = await importiereWettkampfdaten(repos, daten);
    assert.deepEqual(ergebnis, { kampfflaechen: 1, pools: 1, teilnehmer: 2, kaempfe: 2 });

    const pools = await repos.poolsRepository.findAll();
    const kampfflaechen = await repos.kampfflaechenRepository.findAll();
    assert.equal(pools[0].kampfflaeche_id, kampfflaechen[0]._id);

    const teilnehmer = await repos.turnierTeilnehmerRepository.findAll();
    const teilnehmerVonPool = teilnehmer.filter((t) => t.pool_id === pools[0]._id);
    assert.equal(teilnehmerVonPool.length, 2);

    const kaempfe = await repos.kaempfeRepository.findByPool(pools[0]._id);
    const h1 = kaempfe.find((k) => k.reihenfolge_nummer === 'H1');
    const finale = kaempfe.find((k) => k.reihenfolge_nummer === 'F');
    assert.equal(h1.status, 'bereit');
    assert.equal(finale.kaempfer1_quelle_kampf_id, h1._id);

    const mannschaften = await repos.mannschaftenRepository.query({});
    assert.equal(mannschaften[0].pool_id, pools[0]._id);

    const mitglieder = await repos.mannschaftMitgliederRepository.findByMannschaft(mannschaften[0]._id);
    assert.equal(mitglieder.length, 1);
    assert.equal(mitglieder[0].turnier_teilnehmer_id, teilnehmerVonPool.find((t) => t.judopass_id === 'J1')._id);
});

test('exportiereWettkampfdaten liest alle sechs Entitätstypen einer Turnier-Datenbank zurück', async () => {
    const repos = await neueRepos();
    await importiereWettkampfdaten(repos, {
        kampfflaechen: [{ id: 1, bezeichnung: 'Matte 1' }],
        pools: [{ id: 10, kampfflaeche_id: 1, bezeichnung: 'Pool A' }],
        teilnehmer: [{ id: 100, pool_id: 10, vorname: 'Max', nachname: 'Mustermann' }],
        kaempfe: [{ id: 1000, pool_id: 10, kaempfer1_id: 100, status: 'angelegt' }],
        mannschaften: [],
        mannschaft_mitglieder: []
    });

    const exportiert = await exportiereWettkampfdaten(repos);
    assert.equal(exportiert.kampfflaechen.length, 1);
    assert.equal(exportiert.pools.length, 1);
    assert.equal(exportiert.teilnehmer.length, 1);
    assert.equal(exportiert.kaempfe.length, 1);
    assert.equal(exportiert.mannschaften.length, 0);
    assert.equal(exportiert.mannschaft_mitglieder.length, 0);
});
```

- [ ] **Step 2: Test ausführen, um das Fehlschlagen zu bestätigen**

Run: `node --test tests/unit/db/offline/turnierWettkampfdaten.test.js`
Expected: FAIL — `Cannot find module '../../../../src/db/offline/turnierWettkampfdaten.js'`

- [ ] **Step 3: `src/db/offline/turnierWettkampfdaten.js` implementieren**

```javascript
import { normalisiereKampfStatus } from '../../shared/turnierRegeln.js';

// CouchDB-Äquivalent zu importWettkampfdaten (src/controllers/turnierController.js) für den
// Offline-Import (importTurnier): einfacher als das Original, da (a) eine Turnier-Datenbank
// per Konstruktion nur dieses eine Turnier enthält -- keine turnier_id-Filterung nötig --
// und (b) importTurnier immer ein brandneues, leeres Turnier anlegt, weshalb der
// Abgleich-mit-bestehender-Mannschaft-Zweig des Originals (nur für den online-only
// importTurnierErgebnisse-Reimport relevant) hier komplett entfällt: jede Mannschaft wird
// immer frisch angelegt.
export async function importiereWettkampfdaten(repos, daten) {
    const { kampfflaechenRepository, poolsRepository, turnierTeilnehmerRepository, kaempfeRepository, mannschaftenRepository, mannschaftMitgliederRepository } = repos;
    const { kampfflaechen = [], pools = [], teilnehmer = [], kaempfe = [], mannschaften = [], mannschaft_mitglieder: mannschaftMitglieder = [] } = daten;

    const kampfflaecheIdMap = new Map();
    for (const kf of kampfflaechen) {
        const neu = await kampfflaechenRepository.create({ bezeichnung: kf.bezeichnung, status: kf.status || 'frei' });
        kampfflaecheIdMap.set(kf.id, neu._id);
    }

    const poolIdMap = new Map();
    for (const p of pools) {
        const neu = await poolsRepository.create({
            kampfflaeche_id: p.kampfflaeche_id != null ? (kampfflaecheIdMap.get(p.kampfflaeche_id) ?? null) : null,
            bezeichnung: p.bezeichnung,
            modus: p.modus || 'Jeder-gegen-Jeden',
            altersklasse: p.altersklasse,
            geschlecht: p.geschlecht,
            gewichtsklasse: p.gewichtsklasse,
            kampfzeit_sekunden: p.kampfzeit_sekunden || 240,
            matte_reihenfolge: p.matte_reihenfolge ?? null,
            status: p.status || 'angelegt',
            typ: p.typ || 'einzel',
            mannschafts_gewichtsklassen: p.mannschafts_gewichtsklassen ?? null,
            golden_score_aktiv: p.golden_score_aktiv === undefined ? true : !!p.golden_score_aktiv,
            golden_score_max_sekunden: p.golden_score_max_sekunden ?? null
        });
        poolIdMap.set(p.id, neu._id);
    }

    const teilnehmerIdMap = new Map();
    for (const t of teilnehmer) {
        const neu = await turnierTeilnehmerRepository.create({
            pool_id: t.pool_id != null ? (poolIdMap.get(t.pool_id) ?? null) : null,
            judopass_id: t.judopass_id || '',
            vorname: t.vorname,
            nachname: t.nachname,
            geburtsjahr: t.geburtsjahr,
            lizenz_ablauf: t.lizenz_ablauf || '1970-01-01',
            geschlecht: t.geschlecht,
            verein: t.verein,
            gewicht: t.gewicht || 0,
            altersklasse: t.altersklasse,
            gewichtsklasse: t.gewichtsklasse,
            startgeld_bezahlt: !!t.startgeld_bezahlt,
            graduierung: t.graduierung || null,
            status: t.status || 'angemeldet',
            fuer_mannschaft: !!t.fuer_mannschaft
        });
        teilnehmerIdMap.set(t.id, neu._id);
    }

    // Erster Durchlauf ohne die selbstreferenzierenden Quelle-Felder (deren Zielkämpfe evtl.
    // noch gar nicht eingefügt sind), zweiter Durchlauf trägt sie nach -- analog zum
    // Original.
    const kampfIdMap = new Map();
    for (const k of kaempfe) {
        const neuerKaempfer1Id = k.kaempfer1_id != null ? (teilnehmerIdMap.get(k.kaempfer1_id) ?? null) : null;
        const neuerKaempfer2Id = k.kaempfer2_id != null ? (teilnehmerIdMap.get(k.kaempfer2_id) ?? null) : null;
        const neu = await kaempfeRepository.create({
            pool_id: poolIdMap.get(k.pool_id),
            kaempfer1_id: neuerKaempfer1Id,
            kaempfer2_id: neuerKaempfer2Id,
            sieger_id: k.sieger_id != null ? (teilnehmerIdMap.get(k.sieger_id) ?? null) : null,
            kampfzeit_in_sekunden: k.kampfzeit_in_sekunden || 0,
            unterbewertung_kaempfer1: k.unterbewertung_kaempfer1 || 0,
            unterbewertung_kaempfer2: k.unterbewertung_kaempfer2 || 0,
            status: normalisiereKampfStatus(k.status, neuerKaempfer1Id, neuerKaempfer2Id),
            reihenfolge_nummer: k.reihenfolge_nummer ?? null,
            matten_reihenfolge: k.matten_reihenfolge ?? null,
            gruppe: k.gruppe ?? null
        });
        kampfIdMap.set(k.id, neu._id);
    }

    for (const k of kaempfe) {
        if (k.kaempfer1_quelle_kampf_id == null && k.kaempfer2_quelle_kampf_id == null) continue;
        await kaempfeRepository.update(kampfIdMap.get(k.id), {
            kaempfer1_quelle_kampf_id: k.kaempfer1_quelle_kampf_id != null ? (kampfIdMap.get(k.kaempfer1_quelle_kampf_id) ?? null) : null,
            kaempfer1_quelle_typ: k.kaempfer1_quelle_typ ?? null,
            kaempfer2_quelle_kampf_id: k.kaempfer2_quelle_kampf_id != null ? (kampfIdMap.get(k.kaempfer2_quelle_kampf_id) ?? null) : null,
            kaempfer2_quelle_typ: k.kaempfer2_quelle_typ ?? null
        });
    }

    const mannschaftIdMap = new Map();
    for (const m of mannschaften) {
        const neu = await mannschaftenRepository.create({
            pool_id: m.pool_id != null ? (poolIdMap.get(m.pool_id) ?? null) : null,
            verein: m.verein,
            bezeichnung: m.bezeichnung,
            status: m.status || 'angemeldet'
        });
        mannschaftIdMap.set(m.id, neu._id);
    }

    for (const mm of mannschaftMitglieder) {
        const neueMannschaftId = mannschaftIdMap.get(mm.mannschaft_id);
        const neueTeilnehmerId = mm.turnier_teilnehmer_id != null ? (teilnehmerIdMap.get(mm.turnier_teilnehmer_id) ?? null) : null;
        if (!neueMannschaftId || !neueTeilnehmerId) continue;
        await mannschaftMitgliederRepository.create({
            mannschaft_id: neueMannschaftId,
            turnier_teilnehmer_id: neueTeilnehmerId,
            gewichtsklasse: mm.gewichtsklasse
        });
    }

    return {
        kampfflaechen: kampfflaechen.length,
        pools: pools.length,
        teilnehmer: teilnehmer.length,
        kaempfe: kaempfe.length
    };
}

// CouchDB-Äquivalent zu den Export-Abfragen in exportTurnier (src/controllers/turnierController.js):
// deutlich einfacher, da eine Turnier-Datenbank per Konstruktion nur dieses eine Turnier
// enthält -- alle Repositories liefern direkt "alles" statt über eine turnier_id/pool_id-
// Kette filtern zu müssen. mannschaftenRepository/mannschaftMitgliederRepository haben kein
// eigenes findAll -- die generische query({}) (aus baseRepository.js) liefert hier
// gleichwertig "alle Dokumente dieses Typs".
export async function exportiereWettkampfdaten(repos) {
    const { kampfflaechenRepository, poolsRepository, turnierTeilnehmerRepository, kaempfeRepository, mannschaftenRepository, mannschaftMitgliederRepository } = repos;

    const kampfflaechen = await kampfflaechenRepository.findAll();
    const pools = await poolsRepository.findAll();
    const teilnehmer = await turnierTeilnehmerRepository.findAll();
    const kaempfe = await kaempfeRepository.findAll();
    const mannschaften = await mannschaftenRepository.query({});
    const mannschaftMitglieder = await mannschaftMitgliederRepository.query({});

    return { kampfflaechen, pools, teilnehmer, kaempfe, mannschaften, mannschaft_mitglieder: mannschaftMitglieder };
}
```

- [ ] **Step 4: Test ausführen, um das Bestehen zu bestätigen**

Run: `node --test tests/unit/db/offline/turnierWettkampfdaten.test.js`
Expected: PASS

- [ ] **Step 5: Vollständige Unit-Test-Suite ausführen**

Run: `npm run test:unit`
Expected: alle Tests grün.

- [ ] **Step 6: Committen**

```bash
git add src/db/offline/turnierWettkampfdaten.js tests/unit/db/offline/turnierWettkampfdaten.test.js
git commit -m "feat: Wettkampfdaten-Import/Export-Modul (ID-Umschreibung) für Offline-Turniere"
```

---

### Task 3: `importTurnier` + `exportTurnier` in `src/controllers/offline/turnierController.js` ergänzen

**Files:**
- Modify: `src/controllers/offline/turnierController.js` (zwei neue Exporte ergänzen, bestehende Funktionen bleiben unverändert)
- Modify: `tests/unit/controllers/offline/turnierController.test.js` (Tests ergänzen)

**Interfaces:**
- Consumes: `importiereWettkampfdaten`, `exportiereWettkampfdaten` (Task 2);
  `GUELTIGE_STATUS_WERTE` (Task 1); `OFFLINE_VEREIN_ID` aus
  `../../db/offline/offlineAccounts.js` (bereits vorhanden); die bereits im File
  importierten Repositories/`ladeStatusEffektiv`.
- Produces: `importTurnier(turnierDbRegistry, req, res)`, `exportTurnier(turnierDbRegistry, req, res)`
  — für Task 4 (Routen) dieses Plans.

- [ ] **Step 1: Fehlschlagende Tests ergänzen**

An `tests/unit/controllers/offline/turnierController.test.js` anfügen. Die
Import-Zeile aus `../../../../src/controllers/offline/turnierController.js` am
Dateianfang um `importTurnier, exportTurnier` erweitern, und zusätzlich ergänzen:

```javascript
import { OFFLINE_VEREIN_ID } from '../../../../src/db/offline/offlineAccounts.js';
```

```javascript
function bufferZuBase64(objekt) {
    return Buffer.from(JSON.stringify(objekt), 'utf-8').toString('base64');
}

test('importTurnier legt ein neues Turnier mit umgeschriebenen IDs an und ersetzt alle bestehenden lokalen Turniere', async () => {
    const alteRegistry = createTurnierDbRegistry(nano);
    const altesTurnierRes = fakeRes();
    await createTurnier(alteRegistry, { body: { bezeichnung: 'Altes Turnier', ort: 'X', datum: '2025-01-01', ausrichter: 'Z' } }, altesTurnierRes);
    const alteTurnierId = altesTurnierRes.body.turnierId;

    const importDaten = {
        turnier: { bezeichnung: 'Importiertes Turnier', ort: 'Musterstadt', datum: '2026-06-01', ausrichter: 'TV Muster' },
        kampfflaechen: [{ id: 1, bezeichnung: 'Matte 1' }],
        pools: [{ id: 10, kampfflaeche_id: 1, bezeichnung: 'Pool A' }],
        teilnehmer: [{ id: 100, pool_id: 10, vorname: 'Max', nachname: 'Mustermann' }],
        kaempfe: [{ id: 1000, pool_id: 10, kaempfer1_id: 100, status: 'wartet' }],
        mannschaften: [],
        mannschaft_mitglieder: []
    };

    const importRes = fakeRes();
    await importTurnier(alteRegistry, { body: { contentBase64: bufferZuBase64(importDaten) } }, importRes);
    assert.equal(importRes.statusCode, 201);
    assert.ok(importRes.body.success);
    assert.deepEqual(importRes.body.imported, { kampfflaechen: 1, pools: 1, teilnehmer: 1, kaempfe: 1 });

    const neueTurnierId = importRes.body.turnierId;
    assert.notEqual(neueTurnierId, alteTurnierId);

    const alleIds = await alteRegistry.listTurnierIds();
    assert.ok(!alleIds.includes(alteTurnierId));
    assert.ok(alleIds.includes(neueTurnierId));

    const getRes = fakeRes();
    await getTurnier(alteRegistry, { params: { id: neueTurnierId } }, getRes);
    assert.equal(getRes.body.bezeichnung, 'Importiertes Turnier');
    assert.equal(getRes.body.verein_id, OFFLINE_VEREIN_ID);
});

test('importTurnier lehnt eine Datei ohne Turnier-Pflichtfelder ab', async () => {
    const registry = createTurnierDbRegistry(nano);
    const daten = { turnier: { bezeichnung: 'Unvollständig' } };
    const res = fakeRes();
    await importTurnier(registry, { body: { contentBase64: bufferZuBase64(daten) } }, res);
    assert.equal(res.statusCode, 400);
});

test('exportTurnier liefert 403, solange die Anmeldefrist eines veröffentlichten Turniers noch nicht abgelaufen ist', async () => {
    const registry = createTurnierDbRegistry(nano);
    const createRes = fakeRes();
    await createTurnier(registry, { body: { bezeichnung: 'Export-Test', ort: 'X', datum: '2099-01-01', ausrichter: 'Z' } }, createRes);
    const turnierId = createRes.body.turnierId;
    await veroeffentlicheTurnier(registry, { params: { id: turnierId } }, fakeRes());

    const res = fakeRes();
    await exportTurnier(registry, { params: { id: turnierId } }, res);
    assert.equal(res.statusCode, 403);
});

test('exportTurnier liefert die vollständigen Wettkampfdaten eines abgeschlossenen Turniers', async () => {
    const registry = createTurnierDbRegistry(nano);
    const importDaten = {
        turnier: { bezeichnung: 'Export-Voll', ort: 'X', datum: '2020-01-01', ausrichter: 'Z', status: 'abgeschlossen' },
        kampfflaechen: [{ id: 1, bezeichnung: 'Matte 1' }],
        pools: [],
        teilnehmer: [],
        kaempfe: [],
        mannschaften: [],
        mannschaft_mitglieder: []
    };
    const importRes = fakeRes();
    await importTurnier(registry, { body: { contentBase64: bufferZuBase64(importDaten) } }, importRes);
    const turnierId = importRes.body.turnierId;

    const res = fakeRes();
    res.setHeader = () => {};
    res.send = function (body) { this.sentBody = body; return this; };
    await exportTurnier(registry, { params: { id: turnierId } }, res);

    const exportiert = JSON.parse(res.sentBody);
    assert.equal(exportiert.turnier.bezeichnung, 'Export-Voll');
    assert.equal(exportiert.kampfflaechen.length, 1);
});
```

(`fakeRes()` muss für den letzten Test `setHeader`/`send` unterstützen — die bestehende
`fakeRes()`-Helferfunktion aus Task 3 des vorigen Plans hat nur `status`/`json`; im letzten
Test wird dafür direkt auf dem von `fakeRes()` zurückgegebenen Objekt `setHeader`/`send`
überschrieben, wie oben gezeigt, statt die gemeinsame Helferfunktion selbst zu ändern.)

- [ ] **Step 2: Tests ausführen, um das Fehlschlagen zu bestätigen**

Run: `node --test tests/unit/controllers/offline/turnierController.test.js`
Expected: FAIL — `importTurnier`/`exportTurnier` sind nicht exportiert.

- [ ] **Step 3: `importTurnier` + `exportTurnier` in `src/controllers/offline/turnierController.js` ergänzen**

Import-Block am Dateianfang erweitern. Die Datei importiert aus Task 3 des vorigen Plans
bereits `createTurnierRepository`, `createTurnierTeilnehmerRepository`,
`createKampfflaechenRepository`, `createPoolsRepository`, `createKaempfeRepository`,
`randomUUID`, `ermittleEffektivenStatus`, `validiereZahlungsdaten` — diese unverändert
lassen und ergänzen:

```javascript
import { createMannschaftenRepository } from '../../db/repositories/mannschaftenRepository.js';
import { createMannschaftMitgliederRepository } from '../../db/repositories/mannschaftMitgliederRepository.js';
import { importiereWettkampfdaten, exportiereWettkampfdaten } from '../../db/offline/turnierWettkampfdaten.js';
import { GUELTIGE_STATUS_WERTE } from '../../shared/turnierRegeln.js';
import { OFFLINE_VEREIN_ID } from '../../db/offline/offlineAccounts.js';
```

Am Dateiende (nach `beendeDurchfuehrung`) ergänzen:

```javascript
function baueWettkampfdatenRepos(db) {
    return {
        kampfflaechenRepository: createKampfflaechenRepository(db),
        poolsRepository: createPoolsRepository(db),
        turnierTeilnehmerRepository: createTurnierTeilnehmerRepository(db),
        kaempfeRepository: createKaempfeRepository(db),
        mannschaftenRepository: createMannschaftenRepository(db),
        mannschaftMitgliederRepository: createMannschaftMitgliederRepository(db)
    };
}

// Gegenstück zu importTurnier in src/controllers/turnierController.js: importiert eine
// zuvor exportierte Turnier-JSON als komplett NEUES Turnier mit frischen IDs. Der
// Offline-Kiosk-Betrieb geht von genau einem aktiven Turnier aus -- vor dem Import werden
// deshalb alle lokal vorhandenen Turnier-Datenbanken vollständig entfernt.
export async function importTurnier(turnierDbRegistry, req, res) {
    try {
        const { contentBase64 } = req.body;
        if (!contentBase64) {
            return res.status(400).json({ success: false, error: 'Dateiinhalt ist erforderlich.' });
        }

        let daten;
        try {
            const jsonStr = Buffer.from(contentBase64, 'base64').toString('utf-8');
            daten = JSON.parse(jsonStr);
        } catch (e) {
            return res.status(400).json({ success: false, error: 'Datei konnte nicht gelesen werden: ' + e.message });
        }

        const t = daten && daten.turnier;
        if (!t || !t.bezeichnung || !t.ort || !t.datum || !t.ausrichter) {
            return res.status(400).json({ success: false, error: 'Ungültiges Import-Format: Turnier-Pflichtfelder (Bezeichnung, Ort, Datum, Ausrichter) fehlen.' });
        }

        let ak = t.altersklassen;
        if (typeof ak === 'string') {
            try { ak = JSON.parse(ak); } catch (e) { ak = []; }
        }
        let mak = t.mannschafts_altersklassen;
        if (typeof mak === 'string') {
            try { mak = JSON.parse(mak); } catch (e) { mak = []; }
        }

        const bestehendeIds = await turnierDbRegistry.listTurnierIds();
        for (const id of bestehendeIds) {
            await turnierDbRegistry.deleteTurnierDb(id);
        }

        const kampfflaechen = (daten && daten.kampfflaechen) || [];
        const pools = (daten && daten.pools) || [];
        const teilnehmer = (daten && daten.teilnehmer) || [];
        const kaempfe = (daten && daten.kaempfe) || [];
        const mannschaften = (daten && daten.mannschaften) || [];
        const mannschaftMitglieder = (daten && daten.mannschaft_mitglieder) || [];

        const turnierId = randomUUID();
        const db = await turnierDbRegistry.openTurnierDb(turnierId);

        await createTurnierRepository(db).save({
            bezeichnung: t.bezeichnung,
            ort: t.ort,
            datum: t.datum,
            ausrichter: t.ausrichter,
            nutze_gewichtsklassen: !!t.nutze_gewichtsklassen,
            anzahl_kampfflaechen: kampfflaechen.length || parseInt(t.anzahl_kampfflaechen, 10) || 1,
            bundesland: t.bundesland || null,
            plz: t.plz || null,
            ausschreibung_pdf_base64: t.ausschreibung_pdf_base64 || null,
            ausschreibung_dateiname: t.ausschreibung_pdf_base64 ? (t.ausschreibung_dateiname || 'Ausschreibung.pdf') : null,
            altersklassen: ak || {},
            mannschafts_altersklassen: mak || [],
            status: GUELTIGE_STATUS_WERTE.includes(t.status) ? t.status : 'entwurf',
            anmeldeschluss: t.anmeldeschluss || null,
            startgeld: t.startgeld !== undefined && t.startgeld !== '' ? parseFloat(t.startgeld) : null,
            iban: t.iban || null,
            kontoinhaber: t.kontoinhaber || null,
            verwendungszweck: t.verwendungszweck || null,
            verein_id: OFFLINE_VEREIN_ID,
            urspruengliche_id: t.urspruengliche_id ?? t.id ?? null
        });

        const importiert = await importiereWettkampfdaten(baueWettkampfdatenRepos(db), { kampfflaechen, pools, teilnehmer, kaempfe, mannschaften, mannschaft_mitglieder: mannschaftMitglieder });

        return res.status(201).json({ success: true, turnierId, imported: importiert });
    } catch (error) {
        console.error('[Offline-Turnier-Import-Fehler]:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
}

// Gegenstück zu exportTurnier in src/controllers/turnierController.js: liefert die
// Wettkampfdaten eines Turniers als JSON-Datei-Download. Kein Vereinszugriffs-Check
// (Offline ist Single-Tenant) -- nur die Anmeldefrist-Sperre bleibt bestehen.
export async function exportTurnier(turnierDbRegistry, req, res) {
    try {
        const turnierId = req.params.id;
        const db = await turnierDbRegistry.useTurnierDb(turnierId);
        const turnier = await createTurnierRepository(db).get();
        if (!turnier) {
            return res.status(404).json({ success: false, error: 'Turnier nicht gefunden.' });
        }

        const statusEffektiv = await ladeStatusEffektiv(db, turnier);
        if (!['anmeldung_geschlossen', 'in_durchfuehrung', 'abgeschlossen'].includes(statusEffektiv)) {
            return res.status(403).json({ success: false, error: 'Das Turnier kann erst exportiert werden, wenn die Anmeldefrist abgelaufen ist.' });
        }

        const wettkampfdaten = await exportiereWettkampfdaten(baueWettkampfdatenRepos(db));

        const exportData = {
            exportiert_am: new Date().toISOString(),
            turnier: { ...turnier, id: turnierId },
            ...wettkampfdaten
        };

        const dateiname = `turnier_${turnierId}_export_${new Date().toISOString().slice(0, 10)}.json`;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="${dateiname}"`);
        res.send(JSON.stringify(exportData, null, 2));
    } catch (error) {
        console.error('[Offline-Turnier-Export-Fehler]:', error);
        res.status(500).json({ success: false, error: error.message });
    }
}
```

- [ ] **Step 4: Tests ausführen, um das Bestehen zu bestätigen**

Run: `node --test tests/unit/controllers/offline/turnierController.test.js`
Expected: PASS

- [ ] **Step 5: Vollständige Unit-Test-Suite ausführen**

Run: `npm run test:unit`
Expected: alle Tests grün.

- [ ] **Step 6: Committen**

```bash
git add src/controllers/offline/turnierController.js tests/unit/controllers/offline/turnierController.test.js
git commit -m "feat: importTurnier + exportTurnier im Offline-Turnier-Controller"
```

---

### Task 4: Offline-Import/Export-Routen ergänzen (additiv, weiterhin nicht in app.js eingehängt)

**Files:**
- Modify: `src/routes/offline/turnierRoutes.js`
- Modify: `tests/unit/routes/offline/turnierRoutes.test.js`

**Interfaces:**
- Consumes: `importTurnier`, `exportTurnier` (Task 3).
- Produces: erweitert `getTurnierRoutesOffline(turnierDbRegistry)` um `POST /import` und
  `GET /:id/export`, an derselben Stelle im Router wie im Online-Original (vor der
  generischen `/:id`-Route, damit `import`/`export` nicht als ID interpretiert werden).

- [ ] **Step 1: Fehlschlagenden Test ergänzen**

An `tests/unit/routes/offline/turnierRoutes.test.js` anfügen:

```javascript
test('POST /import legt ein neues Turnier an, GET /:id/export liefert es als Datei zurück', async () => {
    const importDaten = {
        turnier: { bezeichnung: 'Routen-Import', ort: 'X', datum: '2020-01-01', ausrichter: 'Z', status: 'abgeschlossen' },
        kampfflaechen: [], pools: [], teilnehmer: [], kaempfe: [], mannschaften: [], mannschaft_mitglieder: []
    };
    const contentBase64 = Buffer.from(JSON.stringify(importDaten), 'utf-8').toString('base64');

    const importResp = await fetch(`${baseUrl}/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentBase64 })
    });
    assert.equal(importResp.status, 201);
    const { turnierId } = await importResp.json();

    const exportResp = await fetch(`${baseUrl}/${turnierId}/export`);
    assert.equal(exportResp.status, 200);
    const exportiert = await exportResp.json();
    assert.equal(exportiert.turnier.bezeichnung, 'Routen-Import');
});
```

- [ ] **Step 2: Test ausführen, um das Fehlschlagen zu bestätigen**

Run: `node --test tests/unit/routes/offline/turnierRoutes.test.js`
Expected: FAIL — 404 (Route existiert noch nicht)

- [ ] **Step 3: `src/routes/offline/turnierRoutes.js` erweitern**

Import-Zeile erweitern:

```javascript
import {
    createTurnier, updateTurnier, getTurnier, getTurniere, deleteTurnier,
    veroeffentlicheTurnier, sageTurnierAb, beendeDurchfuehrung, importTurnier, exportTurnier
} from '../../controllers/offline/turnierController.js';
```

Nach `router.post('/', ...)` und vor den Lebenszyklus-Routen ergänzen:

```javascript
    // Import vor der generischen "/:id"-Route, damit "import" nicht als ID interpretiert wird
    router.post('/import', (req, res) => importTurnier(turnierDbRegistry, req, res));
```

Nach den Lebenszyklus-Routen und vor `router.get('/:id', ...)` ergänzen:

```javascript
    // Export vor der generischen "/:id"-Route, damit "export" nicht als ID interpretiert wird
    router.get('/:id/export', (req, res) => exportTurnier(turnierDbRegistry, req, res));
```

- [ ] **Step 4: Test ausführen, um das Bestehen zu bestätigen**

Run: `node --test tests/unit/routes/offline/turnierRoutes.test.js`
Expected: PASS

- [ ] **Step 5: Vollständige Unit-Test-Suite ausführen**

Run: `npm run test:unit`
Expected: alle Tests grün.

- [ ] **Step 6: Committen**

```bash
git add src/routes/offline/turnierRoutes.js tests/unit/routes/offline/turnierRoutes.test.js
git commit -m "feat: Offline-Import/Export-Routen ergänzt (additiv, noch nicht in app.js eingehängt)"
```
