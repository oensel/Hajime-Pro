# Offline-Turniere-Controller Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eine vollständige, additive CouchDB-Variante des Turniere-Controllers/-Routen für
den Offline-Betrieb bauen (Liste, CRUD, Lebenszyklus-Übergänge) — fertig getestet, aber
noch **nicht** in `app.js` eingehängt. Der eigentliche Cutover (alle Offline-Router
gemeinsam einhängen) ist ein späterer, eigener Schritt (siehe Spec).

**Architecture:** Zwei reine, framework-freie Hilfsfunktions-Module wandern aus dem
bestehenden `src/controllers/turnierController.js` nach `src/shared/turnierRegeln.js`
(Statusableitung + Zahlungsdaten-Validierung), damit die neue Offline-Variante sie
verlustfrei mitbenutzen kann, ohne Logik zu duplizieren. Ein neues Prüfungs-Modul
`src/db/offline/turnierStatusPruefung.js` bildet das CouchDB-Äquivalent zu
`turnierHatEchteKaempfe` (`src/controllers/poolController.js`) — korrekt `false` für jedes
heute existierende Offline-Turnier, da Pools/Kämpfe in dieser Phase des Cutovers noch
nicht nach CouchDB migriert sind (das ändert sich automatisch, sobald ein späterer
Schritt dieses Cutovers sie migriert, ohne dass dieser Code dann angepasst werden muss).
Der neue Controller `src/controllers/offline/turnierController.js` nutzt ausschließlich
bereits vorhandene, getestete Repositories (`turnierRepository`, `turnierTeilnehmerRepository`,
`kampfflaechenRepository`, `poolsRepository`, `kaempfeRepository`) und die
`turnierDbRegistry` aus dem Fundament-Plan.

**Tech Stack:** Node.js/Express, `nano`/CouchDB-Repositories, `node --test` gegen die
bestehende In-Memory-Test-Infrastruktur (`tests/unit/helpers/couchTestServer.js`).

**Spec:** [docs/superpowers/specs/2026-09-24-offline-couchdb-cutover.md](../specs/2026-09-24-offline-couchdb-cutover.md)
(Abschnitt "Korrektur nach Schritt 1" und "Umsetzungsreihenfolge", Schritt 2).

## Global Constraints

- Online-Betrieb (Postgres/Knex) und der bestehende `src/controllers/turnierController.js`-
  Verhaltensweg bleiben vollständig unverändert — Task 1 extrahiert Logik verlustfrei, ändert
  aber kein Verhalten.
- Dieser Plan hängt NICHTS in `app.js` ein. `src/controllers/offline/turnierController.js`
  und `src/routes/offline/turnierRoutes.js` sind additiv/ruhend, bis der spätere,
  dedizierte Cutover-Schritt sie zusammen mit allen anderen Offline-Routern einhängt.
- Turnier-IDs sind ab jetzt UUID-Strings (kein `parseInt`), da CouchDB-Datenbanknamen keine
  Ganzzahlen sind.
- Tests folgen der bestehenden Konvention: ein `startTestCouchServer()`-Aufruf pro Testdatei.

---

### Task 1: Turnier-Geschäftsregeln nach `src/shared/turnierRegeln.js` extrahieren

**Files:**
- Create: `src/shared/turnierRegeln.js`
- Modify: `src/controllers/turnierController.js:1-88` (Funktionen entfernen, Import ergänzen)
- Test: `tests/unit/shared/turnierRegeln.test.js`

**Interfaces:**
- Produces: `berechneAnmeldefrist(anmeldeschluss)`, `istAnmeldefristAbgelaufen(turnier)`,
  `ermittleEffektivenStatus(turnier, { hatEchteKaempfe = false } = {})`,
  `validiereZahlungsdaten(startgeld, iban, kontoinhaber, verwendungszweck)` — exakt dieselbe
  Logik wie heute in `src/controllers/turnierController.js`, nur verschoben, kein
  Verhaltensunterschied.

- [ ] **Step 1: Fehlschlagenden Test schreiben**

`tests/unit/shared/turnierRegeln.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    berechneAnmeldefrist,
    istAnmeldefristAbgelaufen,
    ermittleEffektivenStatus,
    validiereZahlungsdaten
} from '../../../src/shared/turnierRegeln.js';

test('berechneAnmeldefrist setzt bei reinem Datum 23:59:59.999 Ortszeit an', () => {
    const frist = berechneAnmeldefrist('2026-05-10');
    assert.equal(frist.getHours(), 23);
    assert.equal(frist.getMinutes(), 59);
});

test('istAnmeldefristAbgelaufen ist ohne hinterlegte Frist false', () => {
    assert.equal(istAnmeldefristAbgelaufen({ anmeldeschluss: null }), false);
});

test('istAnmeldefristAbgelaufen ist bei einer Frist in der Vergangenheit true', () => {
    assert.equal(istAnmeldefristAbgelaufen({ anmeldeschluss: '2000-01-01' }), true);
});

test('ermittleEffektivenStatus gibt Nicht-veroeffentlicht-Status unverändert zurück', () => {
    assert.equal(ermittleEffektivenStatus({ status: 'entwurf' }), 'entwurf');
    assert.equal(ermittleEffektivenStatus({ status: 'abgesagt' }), 'abgesagt');
});

test('ermittleEffektivenStatus leitet in_durchfuehrung ab, wenn der Wettkampftag erreicht ist', () => {
    const heuteStr = new Date().toISOString().slice(0, 10);
    assert.equal(ermittleEffektivenStatus({ status: 'veroeffentlicht', datum: heuteStr }), 'in_durchfuehrung');
});

test('ermittleEffektivenStatus leitet in_durchfuehrung ab, wenn bereits echte Kämpfe existieren', () => {
    const morgen = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    assert.equal(
        ermittleEffektivenStatus({ status: 'veroeffentlicht', datum: morgen }, { hatEchteKaempfe: true }),
        'in_durchfuehrung'
    );
});

test('ermittleEffektivenStatus leitet anmeldung_geschlossen ab, wenn die Frist abgelaufen ist', () => {
    const morgen = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    assert.equal(
        ermittleEffektivenStatus({ status: 'veroeffentlicht', datum: morgen, anmeldeschluss: '2000-01-01' }),
        'anmeldung_geschlossen'
    );
});

test('validiereZahlungsdaten verlangt IBAN/Kontoinhaber/Verwendungszweck bei Startgeld > 0', () => {
    assert.ok(validiereZahlungsdaten('10', '', 'Max Mustermann', 'Startgeld'));
    assert.equal(validiereZahlungsdaten('10', 'DE123', 'Max Mustermann', 'Startgeld'), null);
});

test('validiereZahlungsdaten ist ohne Startgeld immer gültig', () => {
    assert.equal(validiereZahlungsdaten(undefined, '', '', ''), null);
    assert.equal(validiereZahlungsdaten('0', '', '', ''), null);
});
```

- [ ] **Step 2: Test ausführen, um das Fehlschlagen zu bestätigen**

Run: `node --test tests/unit/shared/turnierRegeln.test.js`
Expected: FAIL — `Cannot find module '../../../src/shared/turnierRegeln.js'`

- [ ] **Step 3: `src/shared/turnierRegeln.js` erstellen (Code 1:1 aus `turnierController.js` übernommen)**

```javascript
// Anmeldeschluss wird als reines Datum (ohne Uhrzeit) gespeichert; die Frist gilt bis
// einschließlich 24:00 Uhr Ortszeit dieses Tages. setHours (lokale Zeit) statt setUTCHours,
// da UTC-Mitternacht je nach Zeitzone des Servers mehrere Stunden von der tatsächlichen
// deutschen Ortszeit abweicht.
export function berechneAnmeldefrist(anmeldeschluss) {
    const deadline = new Date(anmeldeschluss);
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(anmeldeschluss).trim())) {
        deadline.setHours(23, 59, 59, 999);
    }
    return deadline;
}

// Export und Ergebnis-Upload sind erst sinnvoll, wenn sich die Anmeldungen nicht mehr ändern
// können — ohne hinterlegte Frist gilt sie als noch nicht abgelaufen (sicherer Default).
export function istAnmeldefristAbgelaufen(turnier) {
    if (!turnier.anmeldeschluss) return false;
    return new Date() > berechneAnmeldefrist(turnier.anmeldeschluss);
}

// Nur 'entwurf' | 'veroeffentlicht' | 'abgeschlossen' | 'abgesagt' werden physisch gespeichert.
// 'anmeldung_geschlossen' und 'in_durchfuehrung' sind reine Ableitungen (kein Cronjob nötig).
export function ermittleEffektivenStatus(turnier, { hatEchteKaempfe = false } = {}) {
    if (turnier.status !== 'veroeffentlicht') return turnier.status;

    const heuteStr = new Date().toISOString().slice(0, 10);
    const wettkampftagErreicht = turnier.datum && String(turnier.datum).slice(0, 10) <= heuteStr;
    if (wettkampftagErreicht || hatEchteKaempfe) return 'in_durchfuehrung';
    if (istAnmeldefristAbgelaufen(turnier)) return 'anmeldung_geschlossen';
    return 'veroeffentlicht';
}

// Wird ein Startgeld verlangt, müssen die Zahlungsdaten vollständig sein, sonst kann später
// niemand zuverlässig bezahlen (fehlende IBAN/Kontoinhaber/Verwendungszweck).
export function validiereZahlungsdaten(startgeld, iban, kontoinhaber, verwendungszweck) {
    const startgeldWert = startgeld !== undefined && startgeld !== '' ? parseInt(startgeld, 10) : 0;
    if (startgeldWert > 0) {
        if (!iban || !iban.trim() || !kontoinhaber || !kontoinhaber.trim() || !verwendungszweck || !verwendungszweck.trim()) {
            return 'Wenn ein Startgeld verlangt wird, müssen IBAN, Kontoinhaber und Verwendungszweck ausgefüllt sein.';
        }
    }
    return null;
}
```

- [ ] **Step 4: `src/controllers/turnierController.js` anpassen**

Zeilen 5-37 (die vier oben verschobenen Funktionen) entfernen. Zeilen 78-88
(`validiereZahlungsdaten`) ebenfalls entfernen. Am Dateianfang ergänzen:

```javascript
import { ermittleEffektivenStatus, istAnmeldefristAbgelaufen, validiereZahlungsdaten } from '../shared/turnierRegeln.js';
```

(`berechneAnmeldefrist` wird in `turnierController.js` selbst nirgends direkt aufgerufen,
nur über `istAnmeldefristAbgelaufen` — daher nicht importieren, nur die drei tatsächlich
genutzten Namen.)

- [ ] **Step 5: Test ausführen, um das Bestehen zu bestätigen**

Run: `node --test tests/unit/shared/turnierRegeln.test.js`
Expected: PASS

- [ ] **Step 6: Bestehendes Verhalten per E2E-Test bestätigen**

Run: `npx playwright test tests/e2e/turnier-anlegen.spec.js`
Expected: alle Tests weiterhin grün — reine Verschiebung, kein Verhaltensunterschied.

- [ ] **Step 7: Vollständige Unit-Test-Suite ausführen**

Run: `npm run test:unit`
Expected: alle Tests grün.

- [ ] **Step 8: Committen**

```bash
git add src/shared/turnierRegeln.js src/controllers/turnierController.js tests/unit/shared/turnierRegeln.test.js
git commit -m "refactor: Turnier-Geschäftsregeln nach src/shared/turnierRegeln.js extrahiert"
```

---

### Task 2: Turnier-DB-Registry erweitern + Kämpfe-Prüfung für Offline-Turniere

**Files:**
- Modify: `src/db/offline/turnierDbRegistry.js`
- Create: `src/db/offline/turnierStatusPruefung.js`
- Modify: `tests/unit/db/offline/turnierDbRegistry.test.js` (neuer Test ergänzt)
- Test: `tests/unit/db/offline/turnierStatusPruefung.test.js`

**Interfaces:**
- Consumes: `createPoolsRepository(db)` aus `../repositories/poolsRepository.js` (`findAll`),
  `createKaempfeRepository(db)` aus `../repositories/kaempfeRepository.js` (`findByPool`).
- Produces: `turnierDbRegistry.deleteTurnierDb(turnierId)` — löscht die gesamte
  CouchDB-Datenbank dieses Turniers (samt allen Pools/Teilnehmern/Kämpfen etc., da eine
  Turnier-Datenbank per Konstruktion nur dieses eine Turnier enthält) und entfernt den
  Cache-Eintrag. `pruefeHatEchteKaempfe(poolsRepository, kaempfeRepository)` → `boolean` —
  CouchDB-Äquivalent zu `turnierHatEchteKaempfe` (`src/controllers/poolController.js`):
  `true`, sobald irgendein Pool dieses Turniers einen Kampf mit Status `gestartet` oder
  `beendet` hat.

- [ ] **Step 1: Fehlschlagenden Test für `deleteTurnierDb` schreiben**

An `tests/unit/db/offline/turnierDbRegistry.test.js` anfügen:

```javascript
test('deleteTurnierDb löscht die Turnier-Datenbank vollständig und entfernt sie aus dem Cache', async () => {
    const registry = createTurnierDbRegistry(nano);
    const turnierId = randomUUID();

    const db = await registry.openTurnierDb(turnierId);
    await db.insert({ _id: 'turnier:meta', typ: 'turnier', name: 'Zu löschendes Turnier' });

    await registry.deleteTurnierDb(turnierId);

    const idsNachLoeschen = await registry.listTurnierIds();
    assert.ok(!idsNachLoeschen.includes(turnierId));

    // Erneutes Öffnen legt eine frische, leere Datenbank an (kein Cache-Rest vom alten Handle).
    const neueDb = await registry.openTurnierDb(turnierId);
    const gelesen = await neueDb.get('turnier:meta').catch((err) => (err.statusCode === 404 ? null : Promise.reject(err)));
    assert.equal(gelesen, null);
});
```

- [ ] **Step 2: Test ausführen, um das Fehlschlagen zu bestätigen**

Run: `node --test tests/unit/db/offline/turnierDbRegistry.test.js`
Expected: FAIL — `registry.deleteTurnierDb is not a function`

- [ ] **Step 3: `deleteTurnierDb` in `src/db/offline/turnierDbRegistry.js` implementieren**

Die Datei enthält aktuell:

```javascript
import { ensureDatabase } from '../couch.js';

const PRAEFIX = 'turnier_';

export function createTurnierDbRegistry(nano) {
    const cache = new Map();

    async function openTurnierDb(turnierId) {
        if (typeof turnierId !== 'string' || !GUELTIGE_TURNIER_ID.test(turnierId)) {
            throw new Error(`Ungültige Turnier-ID: ${turnierId}`);
        }
        if (cache.has(turnierId)) return cache.get(turnierId);
        const db = await ensureDatabase(nano, `${PRAEFIX}${turnierId}`);
        cache.set(turnierId, db);
        return db;
    }

    async function listTurnierIds() {
        const alleDatenbanken = await nano.db.list();
        return alleDatenbanken
            .filter((name) => name.startsWith(PRAEFIX))
            .map((name) => name.slice(PRAEFIX.length));
    }

    return { openTurnierDb, listTurnierIds };
}
```

Ergänze `deleteTurnierDb` und gib es im Rückgabeobjekt mit zurück:

```javascript
    async function deleteTurnierDb(turnierId) {
        await nano.db.destroy(`${PRAEFIX}${turnierId}`);
        cache.delete(turnierId);
    }

    return { openTurnierDb, listTurnierIds, deleteTurnierDb };
```

(Die genaue Zeile mit `GUELTIGE_TURNIER_ID`/dem Guard in `openTurnierDb` bereits so vorhanden
lassen — nur die neue Funktion ergänzen, sonst nichts an der Datei ändern.)

- [ ] **Step 4: Test ausführen, um das Bestehen zu bestätigen**

Run: `node --test tests/unit/db/offline/turnierDbRegistry.test.js`
Expected: PASS

- [ ] **Step 5: Fehlschlagenden Test für `pruefeHatEchteKaempfe` schreiben**

`tests/unit/db/offline/turnierStatusPruefung.test.js`:

```javascript
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startTestCouchServer } from '../../helpers/couchTestServer.js';
import { connect, ensureDatabase } from '../../../../src/db/couch.js';
import { createPoolsRepository } from '../../../../src/db/repositories/poolsRepository.js';
import { createKaempfeRepository } from '../../../../src/db/repositories/kaempfeRepository.js';
import { pruefeHatEchteKaempfe } from '../../../../src/db/offline/turnierStatusPruefung.js';

let server;
let nano;

before(async () => {
    server = await startTestCouchServer();
    nano = connect(server.url);
});

after(async () => {
    await server.close();
});

test('pruefeHatEchteKaempfe ist false, wenn das Turnier noch keine Pools hat', async () => {
    const db = await ensureDatabase(nano, `test-${randomUUID()}`);
    const poolsRepository = createPoolsRepository(db);
    const kaempfeRepository = createKaempfeRepository(db);

    assert.equal(await pruefeHatEchteKaempfe(poolsRepository, kaempfeRepository), false);
});

test('pruefeHatEchteKaempfe ist false, wenn alle Kämpfe noch nicht gestartet sind', async () => {
    const db = await ensureDatabase(nano, `test-${randomUUID()}`);
    const poolsRepository = createPoolsRepository(db);
    const kaempfeRepository = createKaempfeRepository(db);

    const pool = await poolsRepository.create({ bezeichnung: 'Pool A' });
    await kaempfeRepository.create({ pool_id: pool._id, status: 'bereit' });

    assert.equal(await pruefeHatEchteKaempfe(poolsRepository, kaempfeRepository), false);
});

test('pruefeHatEchteKaempfe ist true, sobald ein Kampf gestartet oder beendet ist', async () => {
    const db = await ensureDatabase(nano, `test-${randomUUID()}`);
    const poolsRepository = createPoolsRepository(db);
    const kaempfeRepository = createKaempfeRepository(db);

    const pool = await poolsRepository.create({ bezeichnung: 'Pool A' });
    await kaempfeRepository.create({ pool_id: pool._id, status: 'gestartet' });

    assert.equal(await pruefeHatEchteKaempfe(poolsRepository, kaempfeRepository), true);
});
```

- [ ] **Step 6: Test ausführen, um das Fehlschlagen zu bestätigen**

Run: `node --test tests/unit/db/offline/turnierStatusPruefung.test.js`
Expected: FAIL — `Cannot find module '../../../../src/db/offline/turnierStatusPruefung.js'`

- [ ] **Step 7: `src/db/offline/turnierStatusPruefung.js` implementieren**

```javascript
// CouchDB-Äquivalent zu turnierHatEchteKaempfe (src/controllers/poolController.js): true,
// sobald irgendein Pool dieses Turniers einen Kampf mit Status 'gestartet' oder 'beendet'
// hat. Solange Pools/Kämpfe für den Offline-Betrieb noch nicht nach CouchDB migriert sind
// (spätere Schritte dieses Cutovers), liefert das für JEDES heute existierende
// Offline-Turnier korrekt false -- die Turnier-Datenbank enthält dann schlicht noch keine
// Pool-/Kampf-Dokumente. Sobald die Migration diese Dokumente dort ablegt, wird diese
// Prüfung ohne Codeänderung automatisch wahr.
export async function pruefeHatEchteKaempfe(poolsRepository, kaempfeRepository) {
    const pools = await poolsRepository.findAll();
    for (const pool of pools) {
        const kaempfe = await kaempfeRepository.findByPool(pool._id);
        if (kaempfe.some((k) => k.status === 'gestartet' || k.status === 'beendet')) {
            return true;
        }
    }
    return false;
}
```

- [ ] **Step 8: Test ausführen, um das Bestehen zu bestätigen**

Run: `node --test tests/unit/db/offline/turnierStatusPruefung.test.js`
Expected: PASS

- [ ] **Step 9: Vollständige Unit-Test-Suite ausführen**

Run: `npm run test:unit`
Expected: alle Tests grün.

- [ ] **Step 10: Committen**

```bash
git add src/db/offline/turnierDbRegistry.js src/db/offline/turnierStatusPruefung.js tests/unit/db/offline/turnierDbRegistry.test.js tests/unit/db/offline/turnierStatusPruefung.test.js
git commit -m "feat: deleteTurnierDb + pruefeHatEchteKaempfe für Offline-Turnier-Cutover"
```

---

### Task 3: Offline-Turnier-Controller (CRUD + Lebenszyklus + Kampfflächen-Sync)

**Files:**
- Create: `src/controllers/offline/turnierController.js`
- Test: `tests/unit/controllers/offline/turnierController.test.js`

**Interfaces:**
- Consumes: `turnierDbRegistry` (Task 1 des Fundament-Plans, erweitert in Task 2 dieses
  Plans: `openTurnierDb`, `listTurnierIds`, `deleteTurnierDb`); `createTurnierRepository(db)`
  (`get`, `save`); `createTurnierTeilnehmerRepository(db)` (`findAll`);
  `createKampfflaechenRepository(db)` (`create`, `findAll`, `remove` — aus `baseRepository`);
  `pruefeHatEchteKaempfe` (Task 2); `ermittleEffektivenStatus`, `validiereZahlungsdaten`
  (Task 1); `entfernungZuPlzInKm` aus `../../utils/entfernungHelper.js` (bereits vorhanden,
  unverändert).
- Produces: `createTurnier(turnierDbRegistry, req, res)`, `getTurnier(turnierDbRegistry, req, res)`,
  `getTurniere(turnierDbRegistry, req, res)`, `updateTurnier(turnierDbRegistry, req, res)`,
  `deleteTurnier(turnierDbRegistry, req, res)`, `veroeffentlicheTurnier(turnierDbRegistry, req, res)`,
  `sageTurnierAb(turnierDbRegistry, req, res)`, `beendeDurchfuehrung(turnierDbRegistry, req, res)`
  — für Task 4 (Routen) dieses Plans.

- [ ] **Step 1: Fehlschlagenden Test schreiben**

`tests/unit/controllers/offline/turnierController.test.js`:

```javascript
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestCouchServer } from '../../helpers/couchTestServer.js';
import { connect } from '../../../../src/db/couch.js';
import { createTurnierDbRegistry } from '../../../../src/db/offline/turnierDbRegistry.js';
import { createKampfflaechenRepository } from '../../../../src/db/repositories/kampfflaechenRepository.js';
import {
    createTurnier, getTurnier, getTurniere, updateTurnier, deleteTurnier,
    veroeffentlicheTurnier, sageTurnierAb, beendeDurchfuehrung
} from '../../../../src/controllers/offline/turnierController.js';

let server;
let nano;
let registry;

before(async () => {
    server = await startTestCouchServer();
    nano = connect(server.url);
    registry = createTurnierDbRegistry(nano);
});

after(async () => {
    await server.close();
});

function fakeRes() {
    return {
        statusCode: 200,
        body: null,
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.body = payload; return this; }
    };
}

test('createTurnier legt ein Turnier mit Kampfflächen an und getTurnier liest es zurück', async () => {
    const createRes = fakeRes();
    await createTurnier(registry, {
        body: { bezeichnung: 'Testturnier', ort: 'Musterstadt', datum: '2026-05-10', ausrichter: 'TV Muster', anzahl_kampfflaechen: '2' }
    }, createRes);

    assert.equal(createRes.statusCode, 201);
    assert.ok(createRes.body.success);
    const turnierId = createRes.body.turnierId;

    const db = await registry.openTurnierDb(turnierId);
    const kampfflaechen = await createKampfflaechenRepository(db).findAll();
    assert.equal(kampfflaechen.length, 2);

    const getRes = fakeRes();
    await getTurnier(registry, { params: { id: turnierId } }, getRes);
    assert.equal(getRes.body.bezeichnung, 'Testturnier');
    assert.equal(getRes.body.status_effektiv, 'entwurf');
    assert.equal(getRes.body.teilnehmer_anzahl, 0);
});

test('createTurnier lehnt Startgeld ohne Zahlungsdaten ab', async () => {
    const res = fakeRes();
    await createTurnier(registry, {
        body: { bezeichnung: 'X', ort: 'Y', datum: '2026-01-01', ausrichter: 'Z', startgeld: '10' }
    }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.success, false);
});

test('updateTurnier passt Felder an und synchronisiert die Kampfflächen-Anzahl', async () => {
    const createRes = fakeRes();
    await createTurnier(registry, {
        body: { bezeichnung: 'Vorher', ort: 'Y', datum: '2026-01-01', ausrichter: 'Z', anzahl_kampfflaechen: '1' }
    }, createRes);
    const turnierId = createRes.body.turnierId;

    const updateRes = fakeRes();
    await updateTurnier(registry, {
        params: { id: turnierId },
        body: { bezeichnung: 'Nachher', ort: 'Y', datum: '2026-01-01', ausrichter: 'Z', anzahl_kampfflaechen: '3' }
    }, updateRes);
    assert.equal(updateRes.statusCode, 200);

    const db = await registry.openTurnierDb(turnierId);
    const kampfflaechen = await createKampfflaechenRepository(db).findAll();
    assert.equal(kampfflaechen.length, 3);

    const getRes = fakeRes();
    await getTurnier(registry, { params: { id: turnierId } }, getRes);
    assert.equal(getRes.body.bezeichnung, 'Nachher');
});

test('updateTurnier meldet 404 für eine unbekannte Turnier-ID', async () => {
    const res = fakeRes();
    await updateTurnier(registry, {
        params: { id: 'nicht-vorhanden-00000000-0000-0000-0000-000000000000' },
        body: { bezeichnung: 'X', ort: 'Y', datum: '2026-01-01', ausrichter: 'Z' }
    }, res);
    assert.equal(res.statusCode, 404);
});

test('getTurniere listet alle lokal angelegten Turniere', async () => {
    const registryEigen = createTurnierDbRegistry(nano);
    await createTurnier(registryEigen, { body: { bezeichnung: 'Liste A', ort: 'X', datum: '2026-01-01', ausrichter: 'Z' } }, fakeRes());
    await createTurnier(registryEigen, { body: { bezeichnung: 'Liste B', ort: 'X', datum: '2026-02-01', ausrichter: 'Z' } }, fakeRes());

    const res = fakeRes();
    await getTurniere(registryEigen, { query: {} }, res);
    const bezeichnungen = res.body.map((t) => t.bezeichnung);
    assert.ok(bezeichnungen.includes('Liste A'));
    assert.ok(bezeichnungen.includes('Liste B'));
});

test('deleteTurnier löscht ein leeres Entwurfs-Turnier vollständig', async () => {
    const createRes = fakeRes();
    await createTurnier(registry, { body: { bezeichnung: 'Löschbar', ort: 'X', datum: '2026-01-01', ausrichter: 'Z' } }, createRes);
    const turnierId = createRes.body.turnierId;

    const deleteRes = fakeRes();
    await deleteTurnier(registry, { params: { id: turnierId } }, deleteRes);
    assert.equal(deleteRes.statusCode, 200);

    const getRes = fakeRes();
    await getTurnier(registry, { params: { id: turnierId } }, getRes);
    assert.equal(getRes.statusCode, 404);
});

test('Lebenszyklus: veroeffentlichen -> absagen', async () => {
    const createRes = fakeRes();
    await createTurnier(registry, { body: { bezeichnung: 'Lebenszyklus', ort: 'X', datum: '2026-01-01', ausrichter: 'Z' } }, createRes);
    const turnierId = createRes.body.turnierId;

    const veroeffentlichenRes = fakeRes();
    await veroeffentlicheTurnier(registry, { params: { id: turnierId } }, veroeffentlichenRes);
    assert.equal(veroeffentlichenRes.statusCode, 200);

    const absagenRes = fakeRes();
    await sageTurnierAb(registry, { params: { id: turnierId } }, absagenRes);
    assert.equal(absagenRes.statusCode, 200);

    const getRes = fakeRes();
    await getTurnier(registry, { params: { id: turnierId } }, getRes);
    assert.equal(getRes.body.status, 'abgesagt');
});

test('beendeDurchfuehrung lehnt ein Turnier ab, das nicht in Durchführung ist', async () => {
    const createRes = fakeRes();
    await createTurnier(registry, { body: { bezeichnung: 'Nicht in Durchführung', ort: 'X', datum: '2099-01-01', ausrichter: 'Z' } }, createRes);
    const turnierId = createRes.body.turnierId;

    const res = fakeRes();
    await beendeDurchfuehrung(registry, { params: { id: turnierId } }, res);
    assert.equal(res.statusCode, 403);
});
```

- [ ] **Step 2: Test ausführen, um das Fehlschlagen zu bestätigen**

Run: `node --test tests/unit/controllers/offline/turnierController.test.js`
Expected: FAIL — `Cannot find module '../../../../src/controllers/offline/turnierController.js'`

- [ ] **Step 3: `src/controllers/offline/turnierController.js` implementieren**

```javascript
import { randomUUID } from 'node:crypto';
import { createTurnierRepository } from '../../db/repositories/turnierRepository.js';
import { createTurnierTeilnehmerRepository } from '../../db/repositories/turnierTeilnehmerRepository.js';
import { createKampfflaechenRepository } from '../../db/repositories/kampfflaechenRepository.js';
import { createPoolsRepository } from '../../db/repositories/poolsRepository.js';
import { createKaempfeRepository } from '../../db/repositories/kaempfeRepository.js';
import { pruefeHatEchteKaempfe } from '../../db/offline/turnierStatusPruefung.js';
import { ermittleEffektivenStatus, validiereZahlungsdaten } from '../../shared/turnierRegeln.js';
import { entfernungZuPlzInKm } from '../../utils/entfernungHelper.js';

async function ladeStatusEffektiv(db, turnier) {
    const hatEchteKaempfe = await pruefeHatEchteKaempfe(createPoolsRepository(db), createKaempfeRepository(db));
    return ermittleEffektivenStatus(turnier, { hatEchteKaempfe });
}

// Analog zur bisherigen Knex-Logik in turnierController.js: gleicht die Anzahl der
// Kampfflächen-Dokumente an die gewünschte Anzahl an (auffüllen mit "Matte N" oder die
// überzähligen letzten Matten entfernen).
async function synchronisiereKampfflaechen(db, anzahl) {
    const kampfflaechenRepository = createKampfflaechenRepository(db);
    const aktuelleMatten = await kampfflaechenRepository.findAll();
    const aktuelleAnzahl = aktuelleMatten.length;

    if (aktuelleAnzahl < anzahl) {
        for (let i = aktuelleAnzahl + 1; i <= anzahl; i++) {
            await kampfflaechenRepository.create({ bezeichnung: `Matte ${i}` });
        }
    } else if (aktuelleAnzahl > anzahl) {
        const mattenZuLoeschen = aktuelleMatten.slice(anzahl);
        for (const matte of mattenZuLoeschen) {
            await kampfflaechenRepository.remove(matte._id);
        }
    }
}

function leseFormularFelder(body) {
    const { bezeichnung, ort, datum, ausrichter, anzahl_kampfflaechen, nutze_gewichtsklassen, bundesland, plz, altersklassen, mannschafts_altersklassen, anmeldeschluss, startgeld, iban, kontoinhaber, verwendungszweck } = body;
    return {
        bezeichnung, ort, datum, ausrichter,
        anzahl_kampfflaechen: parseInt(anzahl_kampfflaechen) || 1,
        // Sicherer Check: Akzeptiert die Zahl 1, den String "1" oder das Boolean true
        nutze_gewichtsklassen: nutze_gewichtsklassen === 1 || nutze_gewichtsklassen === true || nutze_gewichtsklassen === '1' || nutze_gewichtsklassen === 'true',
        bundesland: bundesland || null,
        plz: plz || null,
        altersklassen: altersklassen || {},
        mannschafts_altersklassen: mannschafts_altersklassen || [],
        anmeldeschluss: anmeldeschluss || null,
        startgeld: startgeld !== undefined && startgeld !== '' ? parseInt(startgeld, 10) : null,
        iban: iban || null,
        kontoinhaber: kontoinhaber || null,
        verwendungszweck: verwendungszweck || null
    };
}

export async function createTurnier(turnierDbRegistry, req, res) {
    try {
        const { startgeld, iban, kontoinhaber, verwendungszweck } = req.body;
        const zahlungsFehler = validiereZahlungsdaten(startgeld, iban, kontoinhaber, verwendungszweck);
        if (zahlungsFehler) {
            return res.status(400).json({ success: false, error: zahlungsFehler });
        }

        const felder = leseFormularFelder(req.body);
        const turnierId = randomUUID();
        const db = await turnierDbRegistry.openTurnierDb(turnierId);

        await createTurnierRepository(db).save({ ...felder, status: 'entwurf' });
        await synchronisiereKampfflaechen(db, felder.anzahl_kampfflaechen);

        res.status(201).json({ success: true, turnierId });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}

export async function updateTurnier(turnierDbRegistry, req, res) {
    try {
        const { startgeld, iban, kontoinhaber, verwendungszweck } = req.body;
        const zahlungsFehler = validiereZahlungsdaten(startgeld, iban, kontoinhaber, verwendungszweck);
        if (zahlungsFehler) {
            return res.status(400).json({ success: false, error: zahlungsFehler });
        }

        const { id } = req.params;
        const db = await turnierDbRegistry.openTurnierDb(id);
        const turnierRepository = createTurnierRepository(db);
        const bestehendesTurnier = await turnierRepository.get();
        if (!bestehendesTurnier) {
            return res.status(404).json({ success: false, error: 'Turnier nicht gefunden.' });
        }
        if (bestehendesTurnier.status === 'abgeschlossen') {
            return res.status(403).json({ success: false, error: 'Ein abgeschlossenes Turnier befindet sich im schreibgeschützten Archiv-Zustand.' });
        }

        const felder = leseFormularFelder(req.body);
        // verein_id wird hier absichtlich nicht angefasst -- spread von bestehendesTurnier
        // VOR den neuen Feldern erhält es unverändert (analog zur bisherigen Knex-Logik).
        await turnierRepository.save({ ...bestehendesTurnier, ...felder, updated_at: new Date().toISOString() });
        await synchronisiereKampfflaechen(db, felder.anzahl_kampfflaechen);

        res.json({ success: true, message: 'Turnier erfolgreich aktualisiert.' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}

export async function getTurnier(turnierDbRegistry, req, res) {
    try {
        const db = await turnierDbRegistry.openTurnierDb(req.params.id);
        const turnier = await createTurnierRepository(db).get();
        if (!turnier) return res.status(404).json({ error: 'Turnier nicht gefunden.' });

        const statusEffektiv = await ladeStatusEffektiv(db, turnier);
        const teilnehmerAnzahl = (await createTurnierTeilnehmerRepository(db).findAll()).length;

        res.json({ ...turnier, id: req.params.id, status_effektiv: statusEffektiv, teilnehmer_anzahl: teilnehmerAnzahl });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

export async function getTurniere(turnierDbRegistry, req, res) {
    try {
        const { zukuenftig, lat, lon } = req.query;
        const turnierIds = await turnierDbRegistry.listTurnierIds();

        const turniere = [];
        for (const turnierId of turnierIds) {
            const db = await turnierDbRegistry.openTurnierDb(turnierId);
            const turnier = await createTurnierRepository(db).get();
            if (!turnier) continue;
            const teilnehmerAnzahl = (await createTurnierTeilnehmerRepository(db).findAll()).length;
            turniere.push({
                ...turnier,
                id: turnierId,
                teilnehmer_anzahl: teilnehmerAnzahl,
                status_effektiv: ermittleEffektivenStatus(turnier),
                entfernung_km: entfernungZuPlzInKm(turnier.plz, lat, lon)
            });
        }

        let ergebnis = turniere;
        if (zukuenftig === 'true') {
            const jetzt = new Date();
            const heuteStr = `${jetzt.getFullYear()}-${String(jetzt.getMonth() + 1).padStart(2, '0')}-${String(jetzt.getDate()).padStart(2, '0')}`;
            ergebnis = ergebnis.filter((t) => (t.datum && t.datum >= heuteStr) || t.status === 'entwurf');
        }

        ergebnis.sort((a, b) => (b.datum || '').localeCompare(a.datum || ''));
        res.json(ergebnis);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

export async function deleteTurnier(turnierDbRegistry, req, res) {
    try {
        const { id } = req.params;
        const db = await turnierDbRegistry.openTurnierDb(id);
        const turnier = await createTurnierRepository(db).get();
        if (!turnier) {
            return res.status(404).json({ success: false, error: 'Turnier nicht gefunden.' });
        }

        const statusEffektiv = await ladeStatusEffektiv(db, turnier);
        if (statusEffektiv === 'in_durchfuehrung' || statusEffektiv === 'abgeschlossen') {
            return res.status(403).json({ success: false, error: 'Ein Turnier in Durchführung oder abgeschlossenes Turnier kann nicht gelöscht werden.' });
        }

        const teilnehmerAnzahl = (await createTurnierTeilnehmerRepository(db).findAll()).length;
        if (teilnehmerAnzahl > 0) {
            return res.status(409).json({ success: false, error: 'Ein Turnier mit angemeldeten Teilnehmern kann nicht gelöscht werden.' });
        }

        await turnierDbRegistry.deleteTurnierDb(id);
        res.json({ success: true, message: 'Turnier erfolgreich gelöscht.' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}

export async function veroeffentlicheTurnier(turnierDbRegistry, req, res) {
    try {
        const db = await turnierDbRegistry.openTurnierDb(req.params.id);
        const turnierRepository = createTurnierRepository(db);
        const turnier = await turnierRepository.get();
        if (!turnier) {
            return res.status(404).json({ success: false, error: 'Turnier nicht gefunden.' });
        }
        if (turnier.status !== 'entwurf') {
            return res.status(400).json({ success: false, error: 'Nur Turniere im Entwurf können veröffentlicht werden.' });
        }

        await turnierRepository.save({ ...turnier, status: 'veroeffentlicht', updated_at: new Date().toISOString() });
        res.json({ success: true, message: 'Turnier erfolgreich veröffentlicht.' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}

export async function sageTurnierAb(turnierDbRegistry, req, res) {
    try {
        const db = await turnierDbRegistry.openTurnierDb(req.params.id);
        const turnierRepository = createTurnierRepository(db);
        const turnier = await turnierRepository.get();
        if (!turnier) {
            return res.status(404).json({ success: false, error: 'Turnier nicht gefunden.' });
        }
        if (turnier.status === 'abgeschlossen') {
            return res.status(403).json({ success: false, error: 'Ein bereits abgeschlossenes Turnier kann nicht mehr abgesagt werden.' });
        }

        await turnierRepository.save({ ...turnier, status: 'abgesagt', updated_at: new Date().toISOString() });
        res.json({ success: true, message: 'Turnier erfolgreich abgesagt.' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}

export async function beendeDurchfuehrung(turnierDbRegistry, req, res) {
    try {
        const db = await turnierDbRegistry.openTurnierDb(req.params.id);
        const turnierRepository = createTurnierRepository(db);
        const turnier = await turnierRepository.get();
        if (!turnier) {
            return res.status(404).json({ success: false, error: 'Turnier nicht gefunden.' });
        }

        const statusEffektiv = await ladeStatusEffektiv(db, turnier);
        if (statusEffektiv !== 'in_durchfuehrung') {
            return res.status(403).json({ success: false, error: 'Nur ein Turnier in Durchführung kann als beendet markiert werden.' });
        }

        await turnierRepository.save({ ...turnier, status: 'abgeschlossen', updated_at: new Date().toISOString() });
        res.json({ success: true, message: 'Durchführung erfolgreich beendet.' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}
```

- [ ] **Step 4: Test ausführen, um das Bestehen zu bestätigen**

Run: `node --test tests/unit/controllers/offline/turnierController.test.js`
Expected: PASS

- [ ] **Step 5: Vollständige Unit-Test-Suite ausführen**

Run: `npm run test:unit`
Expected: alle Tests grün.

- [ ] **Step 6: Committen**

```bash
git add src/controllers/offline/turnierController.js tests/unit/controllers/offline/turnierController.test.js
git commit -m "feat: Offline-Turnier-Controller (CRUD + Lebenszyklus) für CouchDB"
```

---

### Task 4: Offline-Turnier-Routen (additiv, nicht in app.js eingehängt)

**Files:**
- Create: `src/routes/offline/turnierRoutes.js`
- Test: `tests/unit/routes/offline/turnierRoutes.test.js`

**Interfaces:**
- Consumes: alle acht Controller-Funktionen aus Task 3.
- Produces: `getTurnierRoutesOffline(turnierDbRegistry)` → Express-Router mit denselben
  URL-Pfaden/Methoden wie `src/routes/turnierRoutes.js` (ohne `import`/`export`/
  `ausschreibung`/`import-ergebnisse` — die kommen mit einem eigenen Plan). Wird von diesem
  Plan **nicht** in `app.js` eingehängt.

- [ ] **Step 1: Fehlschlagenden Test schreiben**

`tests/unit/routes/offline/turnierRoutes.test.js`:

```javascript
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { startTestCouchServer } from '../../helpers/couchTestServer.js';
import { connect } from '../../../../src/db/couch.js';
import { createTurnierDbRegistry } from '../../../../src/db/offline/turnierDbRegistry.js';
import { getTurnierRoutesOffline } from '../../../../src/routes/offline/turnierRoutes.js';

let couchServer;
let nano;
let httpServer;
let baseUrl;

before(async () => {
    couchServer = await startTestCouchServer();
    nano = connect(couchServer.url);
    const registry = createTurnierDbRegistry(nano);

    const app = express();
    app.use(express.json());
    app.use('/api/turniere', getTurnierRoutesOffline(registry));

    httpServer = await new Promise((resolve) => {
        const s = app.listen(0, () => resolve(s));
    });
    baseUrl = `http://127.0.0.1:${httpServer.address().port}/api/turniere`;
});

after(async () => {
    await new Promise((resolve) => httpServer.close(resolve));
    await couchServer.close();
});

test('POST / legt ein Turnier an, GET /:id liest es zurück, POST /:id/veroeffentlichen ändert den Status', async () => {
    const createResp = await fetch(baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bezeichnung: 'Routen-Test', ort: 'X', datum: '2026-01-01', ausrichter: 'Z' })
    });
    assert.equal(createResp.status, 201);
    const { turnierId } = await createResp.json();

    const getResp = await fetch(`${baseUrl}/${turnierId}`);
    assert.equal(getResp.status, 200);
    const turnier = await getResp.json();
    assert.equal(turnier.bezeichnung, 'Routen-Test');

    const veroeffentlichenResp = await fetch(`${baseUrl}/${turnierId}/veroeffentlichen`, { method: 'POST' });
    assert.equal(veroeffentlichenResp.status, 200);
});

test('GET / listet Turniere', async () => {
    await fetch(baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bezeichnung: 'Für die Liste', ort: 'X', datum: '2026-01-01', ausrichter: 'Z' })
    });

    const listResp = await fetch(baseUrl);
    assert.equal(listResp.status, 200);
    const liste = await listResp.json();
    assert.ok(liste.some((t) => t.bezeichnung === 'Für die Liste'));
});

test('DELETE /:id löscht ein leeres Turnier', async () => {
    const createResp = await fetch(baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bezeichnung: 'Zu löschen', ort: 'X', datum: '2026-01-01', ausrichter: 'Z' })
    });
    const { turnierId } = await createResp.json();

    const deleteResp = await fetch(`${baseUrl}/${turnierId}`, { method: 'DELETE' });
    assert.equal(deleteResp.status, 200);

    const getResp = await fetch(`${baseUrl}/${turnierId}`);
    assert.equal(getResp.status, 404);
});
```

- [ ] **Step 2: Test ausführen, um das Fehlschlagen zu bestätigen**

Run: `node --test tests/unit/routes/offline/turnierRoutes.test.js`
Expected: FAIL — `Cannot find module '../../../../src/routes/offline/turnierRoutes.js'`

- [ ] **Step 3: `src/routes/offline/turnierRoutes.js` implementieren**

```javascript
import express from 'express';
import {
    createTurnier, updateTurnier, getTurnier, getTurniere, deleteTurnier,
    veroeffentlicheTurnier, sageTurnierAb, beendeDurchfuehrung
} from '../../controllers/offline/turnierController.js';

// Offline-Pendant zu src/routes/turnierRoutes.js -- noch NICHT in app.js eingehängt (siehe
// Plan). requireAuth ist die einzige Middleware: requireTournamentEditAccess und
// requireVereinFreigabe sind im Offline-Betrieb bereits heute reine No-Ops (siehe
// src/middleware/auth.js), eine Online-Mehrbenutzer-Berechtigungsprüfung ergibt für den
// Single-Tenant-Offline-Betrieb keinen Sinn. import/export/ausschreibung/import-ergebnisse
// sind bewusst nicht Teil dieser Datei -- eigener Folgeplan.
export function getTurnierRoutesOffline(turnierDbRegistry) {
    const router = express.Router();

    router.get('/', (req, res) => getTurniere(turnierDbRegistry, req, res));
    router.post('/', (req, res) => createTurnier(turnierDbRegistry, req, res));

    router.post('/:id/veroeffentlichen', (req, res) => veroeffentlicheTurnier(turnierDbRegistry, req, res));
    router.post('/:id/absagen', (req, res) => sageTurnierAb(turnierDbRegistry, req, res));
    router.post('/:id/durchfuehrung-beenden', (req, res) => beendeDurchfuehrung(turnierDbRegistry, req, res));

    router.get('/:id', (req, res) => getTurnier(turnierDbRegistry, req, res));
    router.put('/:id', (req, res) => updateTurnier(turnierDbRegistry, req, res));
    router.delete('/:id', (req, res) => deleteTurnier(turnierDbRegistry, req, res));

    return router;
}
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
git commit -m "feat: Offline-Turnier-Routen (additiv, noch nicht in app.js eingehängt)"
```
