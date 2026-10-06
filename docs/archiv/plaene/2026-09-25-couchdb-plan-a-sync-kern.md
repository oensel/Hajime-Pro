# Plan A – Sync-Kern (CouchDB-Umbau) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Der Hallen-Server (`SYNC_ROLLE=server`) bekommt eine eingebettete Dokument-DB unter `/db`, die die Live-Daten des (einzigen) Turniers spiegelt. Waage, Scoreboard und Mattenleitung schreiben im Sync-Modus in diese Dokument-DB, und eine Brücke überträgt die Änderungen über die bestehende Fachlogik in die relationale DB.

**Architecture:**
- **Relationale DB bleibt führend.** Ein *Abgleich* schreibt nach jeder Änderung den Ist-Stand der Live-Tabellen als Dokumente (`bearbeitet_von: 'server'`).
- **Die Brücke** liest den `_changes`-Feed. Für jedes Dokument, das nicht vom Server stammt, ermittelt sie per Feld-Vergleich mit der SQL-Zeile, was geändert werden soll, und ruft dafür Service-Funktionen auf, die aus den Controllern herausgelöst wurden.
- **Das Frontend** spricht über `public/js/datenzugriff.js`. Ohne Sync nutzt es REST wie bisher, im Sync-Modus PouchDB über HTTP gegen `/db`.

**Tech Stack:** Node 24 (ESM), Express 4, Knex (SQLite/PostgreSQL), `pouchdb-node@9` + `pouchdb-find@9` + `express-pouchdb@4.2.0` (Server), `pouchdb@9` (nur `dist/pouchdb.min.js` für den Browser), Playwright, `node:test` für reine Module.

**Spec:** `docs/superpowers/specs/2026-09-25-couchdb-umbau-design.md` (Abschnitte 3–8 und 10). Plan A deckt Abschnitt 14 Punkt 1 ab. Client-Modus, Replikation und Offline-Kaskade folgen in Plan B, der Cluster in Plan C.

## Global Constraints

- Alle Code-Kommentare, Bezeichner, UI-Texte und Commit-Messages auf Deutsch, im Stil des bestehenden Codes: ausführliche erklärende Kommentare an nicht offensichtlichen Stellen.
- `src/shared/` bleibt frei von knex, DOM und Node-APIs. Die Module müssen unverändert im Browser über `/js/shared/...` ladbar sein.
- Ohne `SYNC_ROLLE` (Cloud, heutige Dev-/Test-Umgebung) verhält sich die App **exakt wie bisher**. Die bestehende Suite `npm run test:e2e` muss nach jedem Task grün sein.
- Genau ein Turnier pro Hallen-Server. Das Anlegen oder Einlesen eines Turniers löscht im Sync-Modus alle Turnierdaten (SQL und Dokument-DB); `benutzer` und `vereine` bleiben erhalten.
- Dokument-DB-Name: `turnier_<instanz_id>`. Dokument-IDs: `<typ>:<sql-id>` (Typen: `kampfflaeche`, `pool`, `teilnehmer`, `kampf`, `mannschaft`, `mannschaftskampf`). Ausnahmen: offline angelegte Teilnehmer `teilnehmer:u-<uuid>`, dazu `konfig:steuerung` und `konflikt:<uuid>`.
- Die Spalte heißt `kaempfe.matten_reihenfolge`. Die Spec schreibt an einigen Stellen `matte_reihenfolge`; maßgeblich ist die Spalte.
- Commit-Trailer jeder Commit-Message: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

## Abweichungen zur Spec (in Task 12 in die Spec übernehmen)

1. **Spiegelung per Abgleich statt per Controller-Hook:** Es gibt keinen `spiegleNachDokumentDb(tabelle, ids)`-Aufruf in jedem Controller. Stattdessen stößt eine Middleware nach jedem erfolgreichen schreibenden `/api`-Request einen Abgleich an. Der Abgleich vergleicht alle Live-Zeilen des Turniers (wenige hundert) mit den Dokumenten. Grund: Die Schreibpfade liegen über `poolController.js` und fünf Manager verteilt; ein Hook pro Stelle wäre fehleranfällig. Datei `src/sync/abgleich.js` statt `spiegeln.js`.
2. **Idempotenz über den Feld-Vergleich:** Die Brücke wendet nur Felder an, die sich von der SQL-Zeile unterscheiden. Ein erneutes Anwenden ist daher wirkungslos. `sync_angewendet` wird nach der Anwendung geschrieben, nicht in derselben Transaktion, und dient dem schnellen Überspringen und der Nachvollziehbarkeit.
3. **Neue Spalte `turnier_teilnehmer.dokument_id`:** Sie ordnet eine offline angelegte Nachmeldung (`teilnehmer:u-<uuid>`) ihrer SQL-Zeile zu.
4. **Absichtsfelder, die nur im Dokument existieren:** `forfeit_teilnehmer_id` und `forfeit_art` (für „nicht angetreten“/„disqualifiziert“), `live_farbe` (bisher `global.liveColors`) und `letzte_ablehnung` (Rückmeldung der Brücke an das Frontend).
5. **Service-Funktionen bleiben in den Controller-Dateien.** Sie werden dort als eigene Exporte ohne `req`/`res` herausgelöst, statt in neue Dateien verschoben. Grund: Die Hilfsfunktionen (Altersklassen, Kampfbereitschaft, Rechte) liegen dort, und ein Umzug würde über 1000 Zeilen bewegen.
6. **`/db` ist in Plan A so offen wie die heutige Hallen-REST-API** (Offline-Mock-User). Nur die aktuelle Turnier-DB ist erreichbar, andere DB-Namen liefern 404. Die Absicherung per `SYNC_SECRET` kommt mit der Replikation in Plan B.

---

## Dateiübersicht

| Datei | Neu/Ändern | Verantwortung |
|---|---|---|
| `package.json` | ändern | Abhängigkeiten, Scripts `test:unit`, `test:e2e:sync` |
| `src/sync/konfig.js` | neu | `.env` → Sync-Konfiguration |
| `src/utils/dbUmgebung.js` | neu | Wahl der knex-Umgebung inkl. `DB_CLIENT` |
| `migrations/20260925100000_sync_grundlagen.js` | neu | `turniere.instanz_id`, `turnier_teilnehmer.dokument_id`, Tabelle `sync_angewendet` |
| `src/shared/dokumentAbbildung.js` | neu | rein: Zeile ↔ Dokument, Vergleich |
| `src/shared/mattenAnsicht.js` | neu | rein: Kampfliste einer Matte (bisher SQL-Join in `getKaempfe`) |
| `src/sync/dokumentDb.js` | neu | PouchDB/LevelDB, `express-pouchdb`-Middleware |
| `src/sync/abgleich.js` | neu | SQL → Dokumente |
| `src/sync/bruecke.js` | neu | Dokumente → Fachlogik → SQL |
| `src/sync/syncDienst.js` | neu | Zusammenbau, Turnier-Instanz, Zurücksetzen, Leerlauf |
| `src/routes/syncRoutes.js` | neu | `/api/sync/status`, Test-Endpunkte |
| `src/app.js` | ändern | Einbindung |
| `src/controllers/kampfController.js` | ändern | Service-Exporte, `getKaempfe` nutzt `mattenAnsicht` |
| `src/controllers/kampfflaecheController.js` | ändern | Service-Exporte |
| `src/controllers/teilnehmerController.js` | ändern | Service-Exporte |
| `src/controllers/turnierController.js` | ändern | Zurücksetzen und Instanz beim Anlegen/Import |
| `public/js/datenzugriff.js` | neu | REST- oder Dokument-Backend fürs Frontend |
| `public/js/waage-modal.js`, `public/js/scoreboard.js`, `public/js/kampf.js`, `public/js/turnier.js` | ändern | Umstellung auf `Datenzugriff` |
| `public/teilnehmer.html`, `public/steuerung.html`, `public/kampf.html` | ändern | Skripte einbinden |
| `tests/unit/*.test.js` | neu | `node:test` für reine Module |
| `playwright.sync.config.js`, `tests/e2e-sync/*` | neu | Sync-Suite (Server-Modus) |
| `CLAUDE.md`, Spec | ändern | Doku |

---

### Task 1: Abhängigkeiten, Sync-Konfiguration, DB-Umgebung, Unit-Test-Runner

**Files:**
- Modify: `package.json`
- Create: `src/sync/konfig.js`, `src/utils/dbUmgebung.js`, `tests/unit/konfig.test.js`
- Modify: `src/app.js:33-40`

**Interfaces:**
- Produces: `liesSyncKonfig(env) → { rolle: 'server'|'client'|null, istServer: boolean, istClient: boolean, datenverzeichnis: string }`; `waehleKnexUmgebung(env) → 'online'|'offline'`

- [ ] **Step 1: Abhängigkeiten installieren**

```bash
npm install pouchdb-node@9.0.0 pouchdb-find@9.0.0 express-pouchdb@4.2.0 pouchdb@9.0.0
```

Falls npm `leveldown` wegen `allowScripts` meldet: `npm approve-scripts leveldown` ausführen. `leveldown` bringt vorkompilierte Binaries mit; ein Spike unter Node 24/Windows lief am 2026-09-25 erfolgreich.

- [ ] **Step 2: Scripts in `package.json` ergänzen**

Im `"scripts"`-Block hinzufügen:

```json
"test:unit": "node --test \"tests/unit/**/*.test.js\"",
"test:e2e:sync": "playwright test --config=playwright.sync.config.js"
```

- [ ] **Step 3: Fehlschlagenden Test schreiben** – `tests/unit/konfig.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liesSyncKonfig } from '../../src/sync/konfig.js';
import { waehleKnexUmgebung } from '../../src/utils/dbUmgebung.js';

test('ohne SYNC_ROLLE ist Sync aus', () => {
    const k = liesSyncKonfig({});
    assert.equal(k.rolle, null);
    assert.equal(k.istServer, false);
    assert.equal(k.istClient, false);
    assert.equal(k.datenverzeichnis, './data/dokumente');
});

test('SYNC_ROLLE=server wird erkannt, unbekannte Werte nicht', () => {
    assert.equal(liesSyncKonfig({ SYNC_ROLLE: 'server' }).istServer, true);
    assert.equal(liesSyncKonfig({ SYNC_ROLLE: 'Server' }).rolle, null);
    assert.equal(liesSyncKonfig({ SYNC_DATENVERZEICHNIS: './x' }).datenverzeichnis, './x');
});

test('knex-Umgebung: Cloud, Halle mit SQLite, Halle mit PostgreSQL', () => {
    assert.equal(waehleKnexUmgebung({ IS_OFFLINE: 'false' }), 'online');
    assert.equal(waehleKnexUmgebung({}), 'online');
    assert.equal(waehleKnexUmgebung({ IS_OFFLINE: 'true' }), 'offline');
    assert.equal(waehleKnexUmgebung({ IS_OFFLINE: 'true', DB_CLIENT: 'sqlite' }), 'offline');
    assert.equal(waehleKnexUmgebung({ IS_OFFLINE: 'true', DB_CLIENT: 'pg' }), 'online');
});
```

- [ ] **Step 4: Test laufen lassen, Fehlschlag prüfen**

Run: `npm run test:unit`
Expected: FAIL mit `Cannot find module ... src/sync/konfig.js`

- [ ] **Step 5: Implementieren**

`src/sync/konfig.js`:

```js
// Liest die Sync-Einstellungen aus der Umgebung. SYNC_ROLLE entscheidet, ob dieser Knoten eine
// Dokument-DB betreibt: 'server' = Hallen-Server (relationale DB + /db + Brücke), 'client' =
// Notebook/Tablet (nur lokale PouchDB, ab Plan B), leer = heutiges Verhalten ohne Sync (Cloud).
export function liesSyncKonfig(env = process.env) {
    const rolle = env.SYNC_ROLLE === 'server' || env.SYNC_ROLLE === 'client' ? env.SYNC_ROLLE : null;
    return {
        rolle,
        istServer: rolle === 'server',
        istClient: rolle === 'client',
        datenverzeichnis: env.SYNC_DATENVERZEICHNIS || './data/dokumente'
    };
}
```

`src/utils/dbUmgebung.js`:

```js
// Wählt die knex-Umgebung aus knexfile.cjs. IS_OFFLINE=true heißt "Hallenbetrieb" — welche
// relationale DB dort läuft, steuert DB_CLIENT: 'pg' (Pflicht im Server-Cluster, nutzt dieselben
// DB_HOST/DB_USER/...-Variablen wie die Cloud-Konfiguration) oder SQLite (Standard, Entwicklung
// und einzelne Hallenrechner). Ohne IS_OFFLINE=true immer die Cloud-Konfiguration.
export function waehleKnexUmgebung(env = process.env) {
    if (env.IS_OFFLINE !== 'true') return 'online';
    return env.DB_CLIENT === 'pg' ? 'online' : 'offline';
}
```

In `src/app.js` die Zeilen

```js
const environment = process.env.IS_OFFLINE === 'true' ? 'offline' : 'online';
const knex = knexLib(knexConfig[environment]);

// Der Super-Admin-Bootstrap betrifft nur den Online-Mehrbenutzerbetrieb (Vereins-Erstfreigabe) —
// der Offline-Modus arbeitet mit seinem eigenen isolierten Mock-User, siehe requireAuth.
if (environment === 'online') {
```

ersetzen durch

```js
const environment = waehleKnexUmgebung();
const knex = knexLib(knexConfig[environment]);

// Der Super-Admin-Bootstrap betrifft nur den Online-Mehrbenutzerbetrieb (Vereins-Erstfreigabe) —
// der Hallenbetrieb (IS_OFFLINE=true, auch mit DB_CLIENT=pg) arbeitet mit seinem eigenen
// isolierten Mock-User, siehe requireAuth.
if (process.env.IS_OFFLINE !== 'true') {
```

und oben bei den Imports ergänzen: `import { waehleKnexUmgebung } from './utils/dbUmgebung.js';`

- [ ] **Step 6: Tests laufen lassen**

Run: `npm run test:unit` → Expected: PASS (3 Tests)
Run: `npm run test:e2e` → Expected: PASS (unverändertes Verhalten)

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/sync/konfig.js src/utils/dbUmgebung.js src/app.js tests/unit/konfig.test.js
git commit -m "feat(sync): Sync-Konfiguration, DB_CLIENT-Entkopplung und Unit-Test-Runner"
```

---

### Task 2: Migration für Sync-Grundlagen

**Files:**
- Create: `migrations/20260925100000_sync_grundlagen.js`, `tests/unit/migration-sync.test.js`

**Interfaces:**
- Produces: `turniere.instanz_id` (string, nullable), `turnier_teilnehmer.dokument_id` (string, nullable), Tabelle `sync_angewendet(doc_id, rev, angewendet_am)` mit PK `(doc_id, rev)`

- [ ] **Step 1: Fehlschlagenden Test schreiben** – `tests/unit/migration-sync.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import knexLib from 'knex';

test('Migration legt Sync-Spalten und sync_angewendet an', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'hajime-mig-'));
    const knex = knexLib({
        client: 'sqlite3',
        connection: { filename: path.join(dir, 't.sqlite') },
        useNullAsDefault: true,
        migrations: { directory: path.resolve('migrations') }
    });
    try {
        await knex.migrate.latest();
        assert.equal(await knex.schema.hasColumn('turniere', 'instanz_id'), true);
        assert.equal(await knex.schema.hasColumn('turnier_teilnehmer', 'dokument_id'), true);
        assert.equal(await knex.schema.hasTable('sync_angewendet'), true);
        await knex('sync_angewendet').insert({ doc_id: 'kampf:1', rev: '1-a' });
        await assert.rejects(knex('sync_angewendet').insert({ doc_id: 'kampf:1', rev: '1-a' }));
    } finally {
        await knex.destroy();
        rmSync(dir, { recursive: true, force: true });
    }
});
```

- [ ] **Step 2: Fehlschlag prüfen**

Run: `npm run test:unit` → Expected: FAIL (`hasColumn` liefert false)

- [ ] **Step 3: Migration schreiben** – `migrations/20260925100000_sync_grundlagen.js`

```js
// Grundlagen für die Synchronisierung mit der Dokument-DB (CouchDB-Umbau, siehe
// docs/superpowers/specs/2026-09-25-couchdb-umbau-design.md):
//  - turniere.instanz_id: Kennung der Turnier-Instanz auf dem Hallen-Server. Die Dokument-DB heißt
//    turnier_<instanz_id>; bei jedem neu angelegten/eingelesenen Turnier entsteht eine neue
//    Kennung, damit Clients mit altem Stand nie in die neue DB zurückreplizieren.
//  - turnier_teilnehmer.dokument_id: ordnet eine offline an der Waage angelegte Nachmeldung
//    (Dokument teilnehmer:u-<uuid>) ihrer später von der Brücke angelegten SQL-Zeile zu.
//  - sync_angewendet: welche Dokument-Revisionen die Brücke bereits verarbeitet hat.
export async function up(knex) {
    await knex.schema.alterTable('turniere', (table) => {
        table.string('instanz_id', 64).nullable();
    });
    await knex.schema.alterTable('turnier_teilnehmer', (table) => {
        table.string('dokument_id', 128).nullable();
    });
    await knex.schema.createTable('sync_angewendet', (table) => {
        table.string('doc_id', 128).notNullable();
        table.string('rev', 64).notNullable();
        table.timestamp('angewendet_am').defaultTo(knex.fn.now());
        table.primary(['doc_id', 'rev']);
    });
}

export async function down(knex) {
    await knex.schema.dropTableIfExists('sync_angewendet');
    await knex.schema.alterTable('turnier_teilnehmer', (table) => {
        table.dropColumn('dokument_id');
    });
    await knex.schema.alterTable('turniere', (table) => {
        table.dropColumn('instanz_id');
    });
}
```

- [ ] **Step 4: Tests laufen lassen**

Run: `npm run test:unit` → Expected: PASS
Run: `npm run test:e2e` → Expected: PASS (die Migration läuft über `global-setup.js` automatisch mit)

- [ ] **Step 5: Commit**

```bash
git add migrations/20260925100000_sync_grundlagen.js tests/unit/migration-sync.test.js
git commit -m "feat(sync): Migration für Turnier-Instanz, Dokument-Zuordnung und sync_angewendet"
```

---

### Task 3: Dokument-Abbildung (rein, `src/shared/`)

**Files:**
- Create: `src/shared/dokumentAbbildung.js`, `tests/unit/dokumentAbbildung.test.js`

**Interfaces:**
- Produces (alle Exporte, Browser-tauglich):
  - `LIVE_TABELLEN: { kampfflaechen:'kampfflaeche', pools:'pool', turnier_teilnehmer:'teilnehmer', kaempfe:'kampf', mannschaften:'mannschaft', mannschaftskaempfe:'mannschaftskampf' }`
  - `LIVE_PRAEFIXE: string[]` (z. B. `'kampf:'`)
  - `dokumentIdFuer(tabelle, zeile) → string`
  - `mitServerStand(bestehendesDokument|null, tabelle, zeile) → Dokument` (setzt `bearbeitet_von: 'server'`, `typ`, `sql_id`, alle Spalten, übernimmt `_rev` und die Nur-Dokument-Felder, entfernt `forfeit_*`)
  - `unterscheidetSichVomServerStand(dokument|null, tabelle, zeile) → boolean`
  - `geaenderteFelder(dokument, zeile, felder: string[]) → object` (Feld → Dokumentwert, nur abweichende)
  - `gleicheWerte(a, b) → boolean`

- [ ] **Step 1: Fehlschlagenden Test schreiben** – `tests/unit/dokumentAbbildung.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    dokumentIdFuer, mitServerStand, unterscheidetSichVomServerStand, geaenderteFelder, gleicheWerte, LIVE_PRAEFIXE
} from '../../src/shared/dokumentAbbildung.js';

test('Dokument-IDs', () => {
    assert.equal(dokumentIdFuer('kaempfe', { id: 7 }), 'kampf:7');
    assert.equal(dokumentIdFuer('turnier_teilnehmer', { id: 3 }), 'teilnehmer:3');
    assert.equal(dokumentIdFuer('turnier_teilnehmer', { id: 3, dokument_id: 'teilnehmer:u-abc' }), 'teilnehmer:u-abc');
    assert.ok(LIVE_PRAEFIXE.includes('mannschaftskampf:'));
});

test('mitServerStand übernimmt Spalten, _rev und Nur-Dokument-Felder, entfernt Forfeit-Absicht', () => {
    const alt = { _id: 'kampf:7', _rev: '3-x', status: 'bereit', live_farbe: 'red', forfeit_teilnehmer_id: 4, forfeit_art: 'disqualifiziert', bearbeitet_von: 'browser' };
    const datum = new Date('2026-09-25T10:00:00Z');
    const neu = mitServerStand(alt, 'kaempfe', { id: 7, status: 'beendet', sieger_id: 5, updated_at: datum });
    assert.equal(neu._id, 'kampf:7');
    assert.equal(neu._rev, '3-x');
    assert.equal(neu.typ, 'kampf');
    assert.equal(neu.sql_id, 7);
    assert.equal(neu.status, 'beendet');
    assert.equal(neu.updated_at, '2026-09-25T10:00:00.000Z');
    assert.equal(neu.live_farbe, 'red');
    assert.equal(neu.bearbeitet_von, 'server');
    assert.equal('forfeit_teilnehmer_id' in neu, false);
    assert.equal('forfeit_art' in neu, false);
});

test('Vergleich toleriert SQLite/PostgreSQL-Darstellungen', () => {
    assert.equal(gleicheWerte(1, true), true);
    assert.equal(gleicheWerte(0, false), true);
    assert.equal(gleicheWerte('60.00', 60), true);
    assert.equal(gleicheWerte(null, undefined), true);
    assert.equal(gleicheWerte('U18', 'U18'), true);
    assert.equal(gleicheWerte(5, 6), false);
});

test('unterscheidetSichVomServerStand', () => {
    const zeile = { id: 7, status: 'bereit' };
    const doc = mitServerStand(null, 'kaempfe', zeile);
    assert.equal(unterscheidetSichVomServerStand(doc, 'kaempfe', zeile), false);
    assert.equal(unterscheidetSichVomServerStand(doc, 'kaempfe', { id: 7, status: 'beendet' }), true);
    assert.equal(unterscheidetSichVomServerStand({ ...doc, bearbeitet_von: 'browser' }, 'kaempfe', zeile), true);
    assert.equal(unterscheidetSichVomServerStand(null, 'kaempfe', zeile), true);
});

test('geaenderteFelder liefert nur abweichende Felder mit Dokumentwert', () => {
    const diff = geaenderteFelder(
        { status: 'beendet', sieger_id: 5, unterbewertung_kaempfer1: 10 },
        { status: 'gestartet', sieger_id: null, unterbewertung_kaempfer1: 10 },
        ['status', 'sieger_id', 'unterbewertung_kaempfer1']
    );
    assert.deepEqual(diff, { status: 'beendet', sieger_id: 5 });
});
```

- [ ] **Step 2: Fehlschlag prüfen**

Run: `npm run test:unit` → Expected: FAIL (Modul fehlt)

- [ ] **Step 3: Implementieren** – `src/shared/dokumentAbbildung.js`

```js
/**
 * Reine Abbildung zwischen Zeilen der relationalen Live-Tabellen und Dokumenten der Sync-DB
 * (CouchDB-Umbau). Server- und clientseitig identisch nutzbar — keine Abhängigkeit von knex/DOM.
 *
 * Grundregel: ein Dokument spiegelt genau eine Tabellenzeile, Feldnamen = Spaltennamen, damit
 * die übrige src/shared/-Logik (kampfProgression.js, pausenRegel.js, mattenAnsicht.js) Dokumente
 * und DB-Zeilen gleich verarbeiten kann. Zusätzlich gibt es Felder, die NUR im Dokument
 * existieren (Absichten der Matte/Waage und Rückmeldungen der Brücke) — sie überlebt jeder
 * Abgleich mit dem Server-Stand.
 */

export const LIVE_TABELLEN = {
    kampfflaechen: 'kampfflaeche',
    pools: 'pool',
    turnier_teilnehmer: 'teilnehmer',
    kaempfe: 'kampf',
    mannschaften: 'mannschaft',
    mannschaftskaempfe: 'mannschaftskampf'
};

export const LIVE_PRAEFIXE = Object.values(LIVE_TABELLEN).map(typ => `${typ}:`);

// Absichten, die mit der Übernahme durch den Server erledigt sind und danach entfernt werden.
const ERLEDIGTE_ABSICHTEN = ['forfeit_teilnehmer_id', 'forfeit_art'];

export function dokumentIdFuer(tabelle, zeile) {
    if (tabelle === 'turnier_teilnehmer' && zeile.dokument_id) return zeile.dokument_id;
    return `${LIVE_TABELLEN[tabelle]}:${zeile.id}`;
}

function normalisiere(wert) {
    if (wert instanceof Date) return wert.toISOString();
    if (wert === undefined) return null;
    return wert;
}

// Vergleichswert, der die Darstellungsunterschiede zwischen SQLite (1/0, Zahlen) und PostgreSQL
// (true/false, DECIMAL als String "60.00") sowie Date-Objekten glättet.
function vergleichswert(wert) {
    const w = normalisiere(wert);
    if (w === null) return null;
    if (typeof w === 'boolean') return w ? 1 : 0;
    if (typeof w === 'string' && /^-?\d+(\.\d+)?$/.test(w)) return Number(w);
    return w;
}

export function gleicheWerte(a, b) {
    return JSON.stringify(vergleichswert(a)) === JSON.stringify(vergleichswert(b));
}

function spaltenFelder(tabelle, zeile) {
    const felder = { typ: LIVE_TABELLEN[tabelle], sql_id: zeile.id };
    for (const [spalte, wert] of Object.entries(zeile)) felder[spalte] = normalisiere(wert);
    return felder;
}

export function mitServerStand(bestehendesDokument, tabelle, zeile) {
    const neu = {
        ...(bestehendesDokument || {}),
        ...spaltenFelder(tabelle, zeile),
        _id: dokumentIdFuer(tabelle, zeile),
        bearbeitet_von: 'server'
    };
    if (bestehendesDokument && bestehendesDokument._rev) neu._rev = bestehendesDokument._rev;
    delete neu._conflicts;
    for (const feld of ERLEDIGTE_ABSICHTEN) delete neu[feld];
    return neu;
}

export function unterscheidetSichVomServerStand(dokument, tabelle, zeile) {
    if (!dokument) return true;
    if (dokument.bearbeitet_von !== 'server') return true;
    const soll = spaltenFelder(tabelle, zeile);
    return Object.keys(soll).some(feld => !gleicheWerte(dokument[feld], soll[feld]));
}

export function geaenderteFelder(dokument, zeile, felder) {
    const diff = {};
    for (const feld of felder) {
        if (!gleicheWerte(dokument[feld], zeile[feld])) diff[feld] = dokument[feld];
    }
    return diff;
}
```

- [ ] **Step 4: Tests laufen lassen**

Run: `npm run test:unit` → Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/shared/dokumentAbbildung.js tests/unit/dokumentAbbildung.test.js
git commit -m "feat(sync): reine Abbildung Tabellenzeile <-> Sync-Dokument"
```

---

### Task 4: Mattenansicht als reine Funktion, `getKaempfe` darauf umstellen

**Files:**
- Create: `src/shared/mattenAnsicht.js`, `tests/unit/mattenAnsicht.test.js`
- Modify: `src/controllers/kampfController.js` (Zweig `else if (kampfflaecheId)` in `getKaempfe`, heute ca. Zeilen 111–185)

**Interfaces:**
- Consumes: `letztesKampfEndeProTeilnehmer`, `pruefeKampfPause` aus `src/shared/pausenRegel.js`
- Produces: `baueMattenAnsicht({ kaempfe, pools, teilnehmer, mannschaftskaempfe, mannschaften }, kampfflaecheId, jetzt) → Array` in exakt der Form, die `GET /api/kaempfe?kampfflaecheId=` heute liefert (`kaempfe.*` + `pool_bezeichnung`, `pool_kampfzeit`, `pool_altersklasse`, `pool_golden_score_aktiv`, `pool_golden_score_max_sekunden`, `kaempfer1/2_vorname|nachname|verein`, `siegpunkte_mannschaft1/2`, `mannschaft1/2_bezeichnung|verein`, `wartet_auf_einzelpools`, `pausenwarnung`)

- [ ] **Step 1: Fehlschlagenden Test schreiben** – `tests/unit/mattenAnsicht.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baueMattenAnsicht } from '../../src/shared/mattenAnsicht.js';

const pools = [
    { id: 1, kampfflaeche_id: 10, bezeichnung: 'U18 -73', kampfzeit_sekunden: 240, altersklasse: 'U18', golden_score_aktiv: 1, golden_score_max_sekunden: null, typ: 'einzel', status: 'gestartet' },
    { id: 2, kampfflaeche_id: 10, bezeichnung: 'Team U15', kampfzeit_sekunden: 180, altersklasse: 'U15', golden_score_aktiv: 1, golden_score_max_sekunden: 180, typ: 'mannschaft', status: 'gestartet' },
    { id: 3, kampfflaeche_id: 11, bezeichnung: 'andere Matte', kampfzeit_sekunden: 240, altersklasse: 'U18', typ: 'einzel', status: 'gestartet' }
];
const teilnehmer = [
    { id: 100, vorname: 'Anna', nachname: 'Adler', verein: 'JC A' },
    { id: 101, vorname: 'Berta', nachname: 'Busch', verein: 'JC B' }
];
const kaempfe = [
    { id: 6, pool_id: 1, status: 'bereit', matten_reihenfolge: 2, kaempfer1_id: 100, kaempfer2_id: 101 },
    { id: 5, pool_id: 1, status: 'beendet', matten_reihenfolge: 1, kaempfer1_id: 100, kaempfer2_id: 101, updated_at: '2026-09-25T10:00:00.000Z' },
    { id: 7, pool_id: 2, status: 'angelegt', matten_reihenfolge: null, mannschaftskampf_id: 50, mannschaft_gewichtsklasse: '-50' },
    { id: 8, pool_id: 3, status: 'bereit', matten_reihenfolge: 1 }
];
const mannschaftskaempfe = [{ id: 50, mannschaft1_id: 70, mannschaft2_id: 71, siegpunkte_mannschaft1: 1, siegpunkte_mannschaft2: 0 }];
const mannschaften = [{ id: 70, bezeichnung: 'Team A', verein: 'JC A' }, { id: 71, bezeichnung: 'Team B', verein: 'JC B' }];

test('liefert nur Kämpfe der Matte, sortiert nach matten_reihenfolge (NULL zuletzt), dann id', () => {
    const ansicht = baueMattenAnsicht({ kaempfe, pools, teilnehmer, mannschaftskaempfe, mannschaften }, 10, Date.parse('2026-09-25T10:02:00Z'));
    assert.deepEqual(ansicht.map(k => k.id), [5, 6, 7]);
});

test('reichert Pool-, Kämpfer- und Mannschaftsfelder an', () => {
    const ansicht = baueMattenAnsicht({ kaempfe, pools, teilnehmer, mannschaftskaempfe, mannschaften }, 10, Date.parse('2026-09-25T10:02:00Z'));
    const k6 = ansicht.find(k => k.id === 6);
    assert.equal(k6.pool_bezeichnung, 'U18 -73');
    assert.equal(k6.pool_kampfzeit, 240);
    assert.equal(k6.kaempfer1_nachname, 'Adler');
    assert.equal(k6.kaempfer2_verein, 'JC B');
    const k7 = ansicht.find(k => k.id === 7);
    assert.equal(k7.pool_bezeichnung, 'Team U15 -50 kg');
    assert.equal(k7.mannschaft1_bezeichnung, 'Team A');
    assert.equal(k7.siegpunkte_mannschaft1, 1);
    assert.equal(k7.wartet_auf_einzelpools, true);
});

test('Pausenwarnung für bereit-Kampf zwei Minuten nach dem letzten Kampfende (U18: 10 Min.)', () => {
    const ansicht = baueMattenAnsicht({ kaempfe, pools, teilnehmer, mannschaftskaempfe, mannschaften }, 10, Date.parse('2026-09-25T10:02:00Z'));
    assert.notEqual(ansicht.find(k => k.id === 6).pausenwarnung, null);
    assert.equal(ansicht.find(k => k.id === 5).pausenwarnung, null);
});
```

- [ ] **Step 2: Fehlschlag prüfen**

Run: `npm run test:unit` → Expected: FAIL (Modul fehlt)

- [ ] **Step 3: Implementieren** – `src/shared/mattenAnsicht.js`

```js
/**
 * Baut die Kampfliste einer Matte in genau der Form, die GET /api/kaempfe?kampfflaecheId=
 * liefert (Scoreboard, Mattenleitung, Anzeige). Rein und knex-/DOM-frei: der Server füttert sie
 * mit SQL-Zeilen (kampfController.getKaempfe), das Frontend im Sync-Modus mit Dokumenten der
 * Dokument-DB (public/js/datenzugriff.js) — beide Wege liefern dadurch garantiert dieselbe Ansicht.
 */
import { letztesKampfEndeProTeilnehmer, pruefeKampfPause } from './pausenRegel.js';

function nachId(liste) {
    const map = new Map();
    for (const eintrag of liste || []) map.set(Number(eintrag.id), eintrag);
    return map;
}

export function baueMattenAnsicht({ kaempfe, pools, teilnehmer, mannschaftskaempfe, mannschaften }, kampfflaecheId, jetzt) {
    const mattenId = Number(kampfflaecheId);
    const poolsDerMatte = (pools || []).filter(p => Number(p.kampfflaeche_id) === mattenId);
    const poolById = nachId(poolsDerMatte);
    const teilnehmerById = nachId(teilnehmer);
    const begegnungById = nachId(mannschaftskaempfe);
    const mannschaftById = nachId(mannschaften);

    const kaempfeDerMatte = (kaempfe || [])
        .filter(k => poolById.has(Number(k.pool_id)))
        .sort((a, b) => {
            // NULL-Reihenfolgen (noch nicht eingeplante Kämpfe) ans Ende, dann nach ID.
            const ra = a.matten_reihenfolge == null ? Infinity : Number(a.matten_reihenfolge);
            const rb = b.matten_reihenfolge == null ? Infinity : Number(b.matten_reihenfolge);
            return ra !== rb ? ra - rb : Number(a.id) - Number(b.id);
        })
        .map(k => {
            const pool = poolById.get(Number(k.pool_id));
            const t1 = teilnehmerById.get(Number(k.kaempfer1_id));
            const t2 = teilnehmerById.get(Number(k.kaempfer2_id));
            const mk = k.mannschaftskampf_id ? begegnungById.get(Number(k.mannschaftskampf_id)) : null;
            const m1 = mk ? mannschaftById.get(Number(mk.mannschaft1_id)) : null;
            const m2 = mk ? mannschaftById.get(Number(mk.mannschaft2_id)) : null;
            return {
                ...k,
                pool_bezeichnung: pool.bezeichnung,
                pool_kampfzeit: pool.kampfzeit_sekunden,
                pool_altersklasse: pool.altersklasse,
                pool_golden_score_aktiv: pool.golden_score_aktiv,
                pool_golden_score_max_sekunden: pool.golden_score_max_sekunden,
                kaempfer1_vorname: t1 ? t1.vorname : null,
                kaempfer1_nachname: t1 ? t1.nachname : null,
                kaempfer1_verein: t1 ? t1.verein : null,
                kaempfer2_vorname: t2 ? t2.vorname : null,
                kaempfer2_nachname: t2 ? t2.nachname : null,
                kaempfer2_verein: t2 ? t2.verein : null,
                siegpunkte_mannschaft1: mk ? mk.siegpunkte_mannschaft1 : null,
                siegpunkte_mannschaft2: mk ? mk.siegpunkte_mannschaft2 : null,
                mannschaft1_bezeichnung: m1 ? m1.bezeichnung : null,
                mannschaft1_verein: m1 ? m1.verein : null,
                mannschaft2_bezeichnung: m2 ? m2.bezeichnung : null,
                mannschaft2_verein: m2 ? m2.verein : null
            };
        });

    // Mannschaftskampf-Einzelkämpfe erst, wenn alle Einzel-Pools der Matte fertig sind (gleiche
    // Regel wie poolController.planeKaempfeFuerKampfflaeche) — sichtbar bleiben sie trotzdem.
    const einzelPools = poolsDerMatte.filter(p => p.typ !== 'mannschaft');
    const alleEinzelPoolsAbgeschlossen = einzelPools.every(p => p.status === 'kaempfe_beendet' || p.status === 'abgeschlossen');
    for (const kampf of kaempfeDerMatte) {
        if (!alleEinzelPoolsAbgeschlossen && kampf.mannschaftskampf_id) kampf.wartet_auf_einzelpools = true;
        if (kampf.mannschaft_gewichtsklasse) {
            const gk = String(kampf.mannschaft_gewichtsklasse);
            kampf.pool_bezeichnung = `${kampf.pool_bezeichnung} ${/kg$/i.test(gk) ? gk : gk + ' kg'}`;
        }
    }

    // Pausenwarnung mit echten Zeitstempeln, siehe pausenRegel.js.
    const letztesEnde = letztesKampfEndeProTeilnehmer(kaempfeDerMatte);
    return kaempfeDerMatte.map(kampf => {
        if (kampf.status !== 'bereit') return { ...kampf, pausenwarnung: null };
        const pruefung = pruefeKampfPause(kampf, kampf.pool_altersklasse, letztesEnde, jetzt);
        return { ...kampf, pausenwarnung: pruefung.ok ? null : pruefung };
    });
}
```

- [ ] **Step 4: Unit-Tests laufen lassen**

Run: `npm run test:unit` → Expected: PASS. Schlägt der Pausen-Test fehl, `letztesKampfEndeProTeilnehmer` in `src/shared/pausenRegel.js` lesen und prüfen, welches Zeitfeld es auswertet. Die Fixtur dann an dieses Feld anpassen, **nicht** die Regel.

- [ ] **Step 5: `getKaempfe` umstellen**

In `src/controllers/kampfController.js` den kompletten Zweig `} else if (kampfflaecheId) { ... return res.json(mitPausenwarnung);` ersetzen durch:

```js
        } else if (kampfflaecheId) {
            // Die Ansicht selbst baut die reine Funktion baueMattenAnsicht (src/shared/) — dieselbe,
            // die das Frontend im Sync-Modus auf die Dokumente der Dokument-DB anwendet.
            const mattenId = parseInt(kampfflaecheId);
            const pools = await knex('pools').where({ kampfflaeche_id: mattenId });
            const poolIds = pools.map(p => p.id);
            const kaempfeDerMatte = poolIds.length ? await knex('kaempfe').whereIn('pool_id', poolIds) : [];
            const teilnehmerIds = [...new Set(kaempfeDerMatte.flatMap(k => [k.kaempfer1_id, k.kaempfer2_id]).filter(Boolean))];
            const teilnehmer = teilnehmerIds.length ? await knex('turnier_teilnehmer').whereIn('id', teilnehmerIds) : [];
            const begegnungIds = [...new Set(kaempfeDerMatte.map(k => k.mannschaftskampf_id).filter(Boolean))];
            const mannschaftskaempfe = begegnungIds.length ? await knex('mannschaftskaempfe').whereIn('id', begegnungIds) : [];
            const mannschaftIds = [...new Set(mannschaftskaempfe.flatMap(m => [m.mannschaft1_id, m.mannschaft2_id]).filter(Boolean))];
            const mannschaften = mannschaftIds.length ? await knex('mannschaften').whereIn('id', mannschaftIds) : [];

            return res.json(baueMattenAnsicht({ kaempfe: kaempfeDerMatte, pools, teilnehmer, mannschaftskaempfe, mannschaften }, mattenId, Date.now()));
```

Import oben ergänzen: `import { baueMattenAnsicht } from '../shared/mattenAnsicht.js';`. Den Import von `letztesKampfEndeProTeilnehmer`/`pruefeKampfPause` nur entfernen, wenn er danach in der Datei nicht mehr verwendet wird (vorher mit grep prüfen).

- [ ] **Step 6: Regression**

Run: `npm run test:e2e` → Expected: PASS. Scheitern Tests an der Reihenfolge, liegt das an NULL-Reihenfolgen: SQLite sortierte sie bisher nach vorne. Dann in `baueMattenAnsicht` statt `Infinity` den Wert `-Infinity` verwenden (altes SQLite-Verhalten), den Unit-Test entsprechend anpassen und im Kommentar begründen.

- [ ] **Step 7: Commit**

```bash
git add src/shared/mattenAnsicht.js tests/unit/mattenAnsicht.test.js src/controllers/kampfController.js
git commit -m "refactor: Kampfliste einer Matte als reine Funktion baueMattenAnsicht"
```

---

### Task 5: Dokument-DB, Sync-Dienst, Turnier-Instanz, `/api/sync/status`, Sync-Suite

**Files:**
- Create: `src/sync/dokumentDb.js`, `src/sync/syncDienst.js`, `src/routes/syncRoutes.js`
- Create: `playwright.sync.config.js`, `tests/e2e-sync/test-env.js`, `tests/e2e-sync/global-setup.js`, `tests/e2e-sync/helpers.js`, `tests/e2e-sync/sync-grundlagen.spec.js`
- Modify: `src/app.js`, `src/controllers/turnierController.js` (`createTurnier`, `importTurnier`)

**Interfaces:**
- Consumes: `liesSyncKonfig` (Task 1)
- Produces:
  - `erzeugeDokumentDb({ datenverzeichnis }) → { PouchDB, middleware, oeffne(name) }`, `turnierDbName(instanzId) → string`
  - `leereTurnierdaten(knex) → Promise<void>`
  - `starteSyncDienst({ knex, konfig }) → Promise<SyncDienst|null>` mit `SyncDienst = { middleware, status(), vorTurnierwechsel(), aktiviereTurnier(turnierId), planeAbgleich(), leerlauf(), zustand }`; `zustand = { instanzId, turnierId, db }`
  - Express: `req.app.get('sync')` liefert den SyncDienst oder `null`
  - HTTP: `GET /api/sync/status → { rolle, instanz_id, turnier_id, db_name }`; `POST /api/sync/test/leerlauf` (nur bei `NODE_ENV=test`)
- In diesem Task sind `planeAbgleich` und `leerlauf` noch leere Hüllen, die Tasks 6 und 8 füllen.

- [ ] **Step 1: Sync-Suite anlegen**

`tests/e2e-sync/test-env.js`:

```js
// Gemeinsame Konfiguration der Sync-Suite (Hallen-Server mit SYNC_ROLLE=server). Eigener Port,
// eigene SQLite-Datei und eigenes Dokument-Verzeichnis, damit sie neben npm run test:e2e und einem
// Dev-Server laufen kann.
export const SYNC_TEST_PORT = 3200;
export const SYNC_BASE_URL = `http://localhost:${SYNC_TEST_PORT}`;
export const SYNC_TEST_SQLITE_PATH = './data/test-sync.sqlite';
export const SYNC_TEST_DOKUMENTE = './data/test-sync-dokumente';

export const syncServerEnv = {
    ...process.env,
    IS_OFFLINE: 'true',
    DB_CLIENT: 'sqlite',
    DB_SQLITE_PATH: SYNC_TEST_SQLITE_PATH,
    PORT: String(SYNC_TEST_PORT),
    SYNC_ROLLE: 'server',
    SYNC_DATENVERZEICHNIS: SYNC_TEST_DOKUMENTE,
    NODE_ENV: 'test',
    STEUERUNG_PASSWORD: '',
    SMTP_HOST: ''
};
```

`tests/e2e-sync/global-setup.js`:

```js
// Setzt SQLite-Datei und Dokument-Verzeichnis der Sync-Suite vor jedem Lauf zurück.
import { existsSync, unlinkSync, rmSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import knexLib from 'knex';
import { SYNC_TEST_SQLITE_PATH, SYNC_TEST_DOKUMENTE } from './test-env.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export default async function globalSetup() {
    const dbPath = path.resolve(projectRoot, SYNC_TEST_SQLITE_PATH);
    if (existsSync(dbPath)) unlinkSync(dbPath);
    rmSync(path.resolve(projectRoot, SYNC_TEST_DOKUMENTE), { recursive: true, force: true });

    const knex = knexLib({
        client: 'sqlite3',
        connection: { filename: dbPath },
        useNullAsDefault: true,
        migrations: { directory: path.resolve(projectRoot, 'migrations') }
    });
    try {
        await knex.migrate.latest();
    } finally {
        await knex.destroy();
    }
}
```

`playwright.sync.config.js`:

```js
import { defineConfig, devices } from '@playwright/test';
import { SYNC_BASE_URL, syncServerEnv } from './tests/e2e-sync/test-env.js';

// Sync-Suite: Hallen-Server mit eingebetteter Dokument-DB (SYNC_ROLLE=server). Seriell gegen eine
// gemeinsame DB wie die Haupt-Suite — zusätzlich trägt der Hallen-Server immer nur EIN Turnier,
// jedes neu angelegte Turnier löscht das vorherige.
export default defineConfig({
    testDir: './tests/e2e-sync',
    testMatch: '**/*.spec.js',
    fullyParallel: false,
    workers: 1,
    retries: 0,
    reporter: [['list']],
    globalSetup: './tests/e2e-sync/global-setup.js',
    use: { baseURL: SYNC_BASE_URL, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
    webServer: {
        command: 'node src/app.js',
        url: SYNC_BASE_URL,
        env: syncServerEnv,
        reuseExistingServer: false,
        timeout: 30_000,
        stdout: 'pipe',
        stderr: 'pipe'
    }
});
```

`tests/e2e-sync/helpers.js`:

```js
import { expect } from '@playwright/test';

export async function syncStatus(request) {
    const resp = await request.get('/api/sync/status');
    expect(resp.ok()).toBeTruthy();
    return resp.json();
}

// Wartet, bis Brücke und Abgleich alle anstehenden Änderungen verarbeitet haben (Test-Endpunkt).
export async function warteLeerlauf(request) {
    const resp = await request.post('/api/sync/test/leerlauf');
    expect(resp.ok(), await resp.text()).toBeTruthy();
}

export async function legeTurnierAn(request, bezeichnung, anzahl_kampfflaechen = 1) {
    const resp = await request.post('/api/turniere', {
        data: { bezeichnung, ort: 'Teststadt', datum: '2027-03-20', ausrichter: 'JC Test', anzahl_kampfflaechen }
    });
    expect(resp.ok(), await resp.text()).toBeTruthy();
    return (await resp.json()).turnierId;
}

export async function ladeDokument(request, dbName, id) {
    const resp = await request.get(`/db/${dbName}/${encodeURIComponent(id)}`);
    return resp.ok() ? resp.json() : null;
}

export async function schreibeDokument(request, dbName, dokument) {
    const resp = await request.put(`/db/${dbName}/${encodeURIComponent(dokument._id)}`, { data: dokument });
    expect(resp.ok(), await resp.text()).toBeTruthy();
    return resp.json();
}

export async function alleDokumente(request, dbName) {
    const resp = await request.get(`/db/${dbName}/_all_docs?include_docs=true`);
    expect(resp.ok()).toBeTruthy();
    return (await resp.json()).rows.map(r => r.doc).filter(d => !d._id.startsWith('_design/'));
}
```

- [ ] **Step 2: Fehlschlagenden Test schreiben** – `tests/e2e-sync/sync-grundlagen.spec.js`

```js
import { test, expect } from '@playwright/test';
import { syncStatus, legeTurnierAn } from './helpers.js';

test.describe.serial('Sync-Grundlagen: Dokument-DB und Turnier-Instanz', () => {
    test('Status meldet Server-Rolle, anfangs ohne Turnier', async ({ request }) => {
        const status = await syncStatus(request);
        expect(status.rolle).toBe('server');
        expect(status.instanz_id).toBeNull();
    });

    test('Turnier anlegen erzeugt Instanz und Dokument-DB', async ({ request }) => {
        const turnierId = await legeTurnierAn(request, 'Sync Grundlagen 1');
        const status = await syncStatus(request);
        expect(status.turnier_id).toBe(turnierId);
        expect(status.instanz_id).toMatch(/^[0-9a-f-]{36}$/);
        expect(status.db_name).toBe(`turnier_${status.instanz_id}`);
        expect((await request.get(`/db/${status.db_name}`)).ok()).toBeTruthy();
        expect((await request.get('/db/irgendeine_andere_db')).status()).toBe(404);
    });

    test('zweites Turnier ersetzt das erste komplett (SQL und Dokument-DB)', async ({ request }) => {
        const alt = await syncStatus(request);
        await legeTurnierAn(request, 'Sync Grundlagen 2');
        const neu = await syncStatus(request);
        expect(neu.instanz_id).not.toBe(alt.instanz_id);
        expect((await request.get(`/db/${alt.db_name}`)).status()).toBe(404);
        const turniere = await (await request.get('/api/turniere')).json();
        const liste = Array.isArray(turniere) ? turniere : (turniere.turniere || []);
        expect(liste.map(t => t.bezeichnung)).toEqual(['Sync Grundlagen 2']);
    });
});
```

Die Antwortform von `GET /api/turniere` vor dem Lauf in `getTurniere` (`turnierController.js:290`) nachsehen und die Zeile `const liste = ...` passend vereinfachen.

- [ ] **Step 3: Fehlschlag prüfen**

Run: `npm run test:e2e:sync` → Expected: FAIL (`/api/sync/status` liefert 404)

- [ ] **Step 4: `src/sync/dokumentDb.js`**

```js
// Eingebettete, CouchDB-kompatible Dokument-DB: PouchDB auf LevelDB, per express-pouchdb unter
// /db über HTTP erreichbar (Replikationsprotokoll wie echtes CouchDB, siehe Spec Abschnitt 5).
import PouchDBBasis from 'pouchdb-node';
import pouchFind from 'pouchdb-find';
import expressPouchdb from 'express-pouchdb';
import { mkdirSync } from 'fs';
import path from 'path';

PouchDBBasis.plugin(pouchFind);

export function turnierDbName(instanzId) {
    return `turnier_${instanzId}`;
}

export function erzeugeDokumentDb({ datenverzeichnis }) {
    const verzeichnis = path.resolve(datenverzeichnis);
    mkdirSync(verzeichnis, { recursive: true });
    const PouchDB = PouchDBBasis.defaults({ prefix: verzeichnis + path.sep });
    const middleware = expressPouchdb(PouchDB, {
        mode: 'minimumForPouchDB',
        configPath: path.join(verzeichnis, 'config.json'),
        logPath: path.join(verzeichnis, 'log.txt')
    });
    return {
        PouchDB,
        middleware,
        oeffne(name) {
            return new PouchDB(name);
        }
    };
}
```

- [ ] **Step 5: `src/sync/syncDienst.js`**

```js
// Zentraler Sync-Dienst des Hallen-Servers: hält die Dokument-DB der aktuellen Turnier-Instanz,
// setzt beim Turnierwechsel alles zurück und bündelt Abgleich (SQL -> Dokumente, Task 6) und Brücke
// (Dokumente -> SQL, Task 8). Genau ein Turnier pro Hallen-Server (Spec Abschnitt 8).
import { randomUUID } from 'crypto';
import { erzeugeDokumentDb, turnierDbName } from './dokumentDb.js';

// Löscht alle Turnierdaten; benutzer/vereine bleiben erhalten (Login am Hallen-Server).
export async function leereTurnierdaten(knex) {
    await knex('kaempfe').del();
    await knex('mannschaftskaempfe').del();
    await knex('mannschaft_mitglieder').del();
    await knex('mannschaften').del();
    await knex('turnier_teilnehmer').del();
    await knex('pools').del();
    await knex('kampfflaechen').del();
    await knex('turniere').del();
    await knex('sync_angewendet').del();
}

export async function starteSyncDienst({ knex, konfig }) {
    if (!konfig.istServer) return null;

    const dokumentDb = erzeugeDokumentDb(konfig);
    const zustand = { instanzId: null, turnierId: null, db: null };

    // Nur die DB der aktuellen Instanz ist über /db erreichbar — alle anderen Namen (alte
    // Instanzen, Tippfehler) liefern 404, damit niemand eine gelöschte DB versehentlich per
    // Replikation wieder anlegt. GET /db/ (Server-Info) bleibt erlaubt, PouchDB-Clients brauchen es.
    function middleware(req, res, next) {
        const erstesSegment = decodeURIComponent(req.path.split('/')[1] || '');
        if (erstesSegment === '' || erstesSegment.startsWith('_')) {
            if (erstesSegment === '' && req.method === 'GET') return dokumentDb.middleware(req, res, next);
            return res.status(404).json({ error: 'not_found' });
        }
        if (!zustand.instanzId || erstesSegment !== turnierDbName(zustand.instanzId)) {
            return res.status(404).json({ error: 'not_found', reason: 'Keine aktuelle Turnier-DB' });
        }
        return dokumentDb.middleware(req, res, next);
    }

    async function aktiviereTurnier(turnierId) {
        const turnier = await knex('turniere').where({ id: turnierId }).first();
        if (!turnier) return;
        let instanzId = turnier.instanz_id;
        if (!instanzId) {
            instanzId = randomUUID();
            await knex('turniere').where({ id: turnierId }).update({ instanz_id: instanzId });
        }
        zustand.db = dokumentDb.oeffne(turnierDbName(instanzId));
        await zustand.db.createIndex({ index: { fields: ['typ'] } });
        zustand.instanzId = instanzId;
        zustand.turnierId = turnier.id;
        await dienst.nachAktivierung();
    }

    async function vorTurnierwechsel() {
        await dienst.vorDeaktivierung();
        if (zustand.db) await zustand.db.destroy();
        zustand.db = null;
        zustand.instanzId = null;
        zustand.turnierId = null;
        await leereTurnierdaten(knex);
    }

    const dienst = {
        zustand,
        middleware,
        aktiviereTurnier,
        vorTurnierwechsel,
        status() {
            return {
                rolle: konfig.rolle,
                instanz_id: zustand.instanzId,
                turnier_id: zustand.turnierId,
                db_name: zustand.instanzId ? turnierDbName(zustand.instanzId) : null
            };
        },
        // Werden in Task 6 (Abgleich) und Task 8 (Brücke) belegt.
        planeAbgleich() {},
        async leerlauf() {},
        async nachAktivierung() {},
        async vorDeaktivierung() {}
    };

    // Beim Serverstart: das (einzige) vorhandene Turnier aktivieren.
    const vorhanden = await knex('turniere').orderBy('id', 'desc').first();
    if (vorhanden) await aktiviereTurnier(vorhanden.id);

    return dienst;
}
```

- [ ] **Step 6: `src/routes/syncRoutes.js`**

```js
import express from 'express';

// /api/sync/status ist IMMER gemountet (auch ohne Sync, dann rolle: null) — das Frontend
// (datenzugriff.js) entscheidet anhand der Antwort zwischen REST- und Dokument-Backend.
export function getSyncRoutes(holeSync) {
    const router = express.Router();

    router.get('/status', (req, res) => {
        const sync = holeSync();
        if (!sync) return res.json({ rolle: null, instanz_id: null, turnier_id: null, db_name: null });
        return res.json(sync.status());
    });

    if (process.env.NODE_ENV === 'test') {
        router.post('/test/leerlauf', async (req, res) => {
            const sync = holeSync();
            if (sync) await sync.leerlauf();
            res.json({ success: true });
        });
    }

    return router;
}
```

- [ ] **Step 7: Einbindung in `src/app.js`**

Imports ergänzen:

```js
import { liesSyncKonfig } from './sync/konfig.js';
import { starteSyncDienst } from './sync/syncDienst.js';
import { getSyncRoutes } from './routes/syncRoutes.js';
```

Direkt nach `app.set('knex', knex);`:

```js
// Sync-Dienst (nur SYNC_ROLLE=server) — top-level await: die Dokument-DB muss vor dem ersten
// Request bereitstehen.
const syncKonfig = liesSyncKonfig();
const sync = await starteSyncDienst({ knex, konfig: syncKonfig });
app.set('sync', sync);
```

**Vor** `app.use(express.json({ limit: '15mb' }));` einfügen. Das ist zwingend, weil `express.json()` sonst die Request-Bodies konsumiert, die `express-pouchdb` selbst lesen muss:

```js
if (sync) {
    app.use('/db', sync.middleware);
}
```

Bei den übrigen Routen ergänzen:

```js
app.use('/api/sync', getSyncRoutes(() => app.get('sync')));
```

- [ ] **Step 8: Turnier anlegen/einlesen im Sync-Modus**

In `src/controllers/turnierController.js`, `createTurnier`, direkt vor `const [idObj] = await knex('turniere').insert({` einfügen:

```js
        // Hallen-Server mit Sync: genau ein Turnier — das Anlegen ersetzt das bisherige komplett
        // (SQL + Dokument-DB, siehe Spec Abschnitt 8). Der Bestätigungsdialog sitzt im Frontend.
        const sync = req.app.get('sync');
        if (sync) await sync.vorTurnierwechsel();
```

und direkt nach `await synchronisiereKampfflaechen(knex, turnierId, parseInt(anzahl_kampfflaechen) || 1);`:

```js
        if (sync) await sync.aktiviereTurnier(turnierId);
```

In `importTurnier` direkt vor `const neuesTurnierId = await knex.transaction(async (trx) => {`:

```js
        const sync = req.app.get('sync');
        if (sync) await sync.vorTurnierwechsel();
```

und nach dem Ende der Transaktion (in der Zeile nach `});`, die `neuesTurnierId` zuweist):

```js
        if (sync) await sync.aktiviereTurnier(neuesTurnierId);
```

- [ ] **Step 9: Tests laufen lassen**

Run: `npm run test:e2e:sync` → Expected: PASS (3 Tests)
Run: `npm run test:e2e` → Expected: PASS
Run: `npm run test:unit` → Expected: PASS

- [ ] **Step 10: `.gitignore` prüfen und Commit**

Prüfen, ob `data/` in `.gitignore` steht. Falls nicht, `data/test-sync.sqlite` und `data/test-sync-dokumente/` eintragen.

```bash
git add src/sync/dokumentDb.js src/sync/syncDienst.js src/routes/syncRoutes.js src/app.js src/controllers/turnierController.js playwright.sync.config.js tests/e2e-sync .gitignore
git commit -m "feat(sync): eingebettete Dokument-DB, Turnier-Instanz und Sync-Suite"
```

---

### Task 6: Abgleich SQL → Dokumente

**Files:**
- Create: `src/sync/abgleich.js`, `tests/e2e-sync/sync-abgleich.spec.js`
- Modify: `src/sync/syncDienst.js`, `src/app.js`, `tests/e2e-sync/helpers.js`

**Interfaces:**
- Consumes: `LIVE_TABELLEN`, `LIVE_PRAEFIXE`, `dokumentIdFuer`, `mitServerStand`, `unterscheidetSichVomServerStand` (Task 3); `zustand` (Task 5)
- Produces: `erzeugeAbgleich({ knex, zustand }) → { fuehreAus(): Promise<void>, plane(): void, leerlauf(): Promise<void> }`; das Dokument `konfig:steuerung` mit `{ typ:'konfig', turnier_id, bezeichnung, datum, instanz_id, steuerung_passwort_sha256 }`

- [ ] **Step 1: DK8-Aufbau in die Helfer übernehmen**

In `tests/e2e-sync/helpers.js` ergänzen. Das ist eine Kopie von `richteDk8TurnierEin` samt `TEILNEHMER_FIXTUR` aus `tests/e2e/steuerung-dk8-online-vs-offline.spec.js`, jetzt exportiert und auf `legeTurnierAn` umgestellt:

```js
export const DK8_TEILNEHMER = [
    { vorname: 'Anna', nachname: 'Adler', verein: 'JC Alpha', gewicht: 60 },
    { vorname: 'Berta', nachname: 'Busch', verein: 'JC Beta', gewicht: 61 },
    { vorname: 'Clara', nachname: 'Conrad', verein: 'JC Gamma', gewicht: 62 },
    { vorname: 'Diana', nachname: 'Diehl', verein: 'JC Delta', gewicht: 63 },
    { vorname: 'Elena', nachname: 'Ebert', verein: 'JC Epsilon', gewicht: 64 },
    { vorname: 'Frida', nachname: 'Fuchs', verein: 'JC Zeta', gewicht: 65 },
    { vorname: 'Greta', nachname: 'Graf', verein: 'JC Eta', gewicht: 66 },
    { vorname: 'Hanna', nachname: 'Hoffmann', verein: 'JC Theta', gewicht: 67 }
];

// Turnier + Matte + DK8-Pool mit 8 Teilnehmern, Pool der Matte zugeordnet (11 Kämpfe).
export async function richteDk8TurnierEin(request, bezeichnung) {
    const turnierId = await legeTurnierAn(request, bezeichnung);
    const [{ id: matId }] = await (await request.get(`/api/kampfflaechen?turnierId=${turnierId}`)).json();
    const poolResp = await request.post('/api/pools', {
        data: { turnier_id: turnierId, bezeichnung: `${bezeichnung} Pool`, altersklasse: 'U18', geschlecht: 'männlich', gewichtsklasse: '-73kg' }
    });
    expect(poolResp.ok(), await poolResp.text()).toBeTruthy();
    const { poolId } = await poolResp.json();
    const teilnehmerIds = [];
    for (const t of DK8_TEILNEHMER) {
        const tResp = await request.post('/api/teilnehmer', {
            data: {
                turnier_id: turnierId, vorname: t.vorname, nachname: t.nachname, verein: t.verein,
                geburtsjahr: 2009, geschlecht: 'männlich', gewicht: t.gewicht, altersklasse: 'U18', gewichtsklasse: '-73kg'
            }
        });
        expect(tResp.ok(), await tResp.text()).toBeTruthy();
        teilnehmerIds.push((await tResp.json()).teilnehmerId);
    }
    for (const teilnehmerId of teilnehmerIds) {
        const r = await request.post('/api/pools/verschieben', { data: { teilnehmerId, zielPoolId: poolId } });
        expect(r.ok(), await r.text()).toBeTruthy();
    }
    const z = await request.put('/api/pools/kampfflaeche-zuordnen', { data: { poolId, kampflaecheId: matId, position: 1 } });
    expect(z.ok(), await z.text()).toBeTruthy();
    return { turnierId, matId, poolId, teilnehmerIds };
}
```

- [ ] **Step 2: Fehlschlagenden Test schreiben** – `tests/e2e-sync/sync-abgleich.spec.js`

```js
import { test, expect } from '@playwright/test';
import { syncStatus, warteLeerlauf, richteDk8TurnierEin, alleDokumente, ladeDokument } from './helpers.js';

test.describe.serial('Abgleich: relationale DB -> Dokumente', () => {
    let dbName;
    let matId;

    test('nach dem Aufbau stehen alle Live-Daten als Server-Dokumente bereit', async ({ request }) => {
        ({ matId } = await richteDk8TurnierEin(request, 'Sync Abgleich'));
        await warteLeerlauf(request);
        dbName = (await syncStatus(request)).db_name;
        const docs = await alleDokumente(request, dbName);
        const anzahl = (typ) => docs.filter(d => d.typ === typ).length;
        expect(anzahl('kampf')).toBe(11);
        expect(anzahl('teilnehmer')).toBe(8);
        expect(anzahl('pool')).toBe(1);
        expect(anzahl('kampfflaeche')).toBe(1);
        expect(docs.filter(d => d.typ !== 'konfig').every(d => d.bearbeitet_von === 'server')).toBe(true);
        const konfig = await ladeDokument(request, dbName, 'konfig:steuerung');
        expect(konfig.bezeichnung).toBe('Sync Abgleich');
    });

    test('REST-Ergebnis erscheint samt Kaskade in den Dokumenten', async ({ request }) => {
        const kaempfe = await (await request.get(`/api/kaempfe?kampfflaecheId=${matId}`)).json();
        const erster = kaempfe.find(k => k.status === 'bereit');
        const put = await request.put(`/api/kaempfe/${erster.id}`, {
            data: { status: 'beendet', sieger_id: erster.kaempfer1_id, unterbewertung_kaempfer1: 10, unterbewertung_kaempfer2: 0, kampfzeit_in_sekunden: 30 }
        });
        expect(put.ok(), await put.text()).toBeTruthy();
        await warteLeerlauf(request);

        const doc = await ladeDokument(request, dbName, `kampf:${erster.id}`);
        expect(doc.status).toBe('beendet');
        expect(doc.sieger_id).toBe(erster.kaempfer1_id);
        expect(doc.bearbeitet_von).toBe('server');

        const sqlNachher = await (await request.get(`/api/kaempfe?kampfflaecheId=${matId}`)).json();
        for (const k of sqlNachher) {
            const d = await ladeDokument(request, dbName, `kampf:${k.id}`);
            expect([d.kaempfer1_id, d.kaempfer2_id, d.status, d.matten_reihenfolge])
                .toEqual([k.kaempfer1_id, k.kaempfer2_id, k.status, k.matten_reihenfolge]);
        }
    });
});
```

- [ ] **Step 3: Fehlschlag prüfen**

Run: `npm run test:e2e:sync` → Expected: FAIL (0 Kampf-Dokumente)

- [ ] **Step 4: `src/sync/abgleich.js`**

```js
// Abgleich relationale DB -> Dokument-DB: schreibt den Ist-Stand aller Live-Tabellen des
// aktuellen Turniers als Dokumente (bearbeitet_von: 'server'). Vergleicht bewusst IMMER das ganze
// Turnier (wenige hundert Zeilen) statt einzelner geänderter IDs: die Schreibpfade sind über
// Controller und Manager verteilt, ein Vollvergleich kann keinen davon übersehen.
//
// Nicht angefasst werden Dokumente mit einer Änderung von Matte/Waage, die die Brücke noch nicht
// verarbeitet hat (sonst würde der Abgleich sie überschreiben, bevor sie in SQL angekommen ist).
import { createHash } from 'crypto';
import { LIVE_TABELLEN, LIVE_PRAEFIXE, dokumentIdFuer, mitServerStand, unterscheidetSichVomServerStand } from '../shared/dokumentAbbildung.js';

async function ladeLiveZeilen(knex, turnierId) {
    const pools = await knex('pools').where({ turnier_id: turnierId });
    const poolIds = pools.map(p => p.id);
    return {
        kampfflaechen: await knex('kampfflaechen').where({ turnier_id: turnierId }),
        pools,
        turnier_teilnehmer: await knex('turnier_teilnehmer').where({ turnier_id: turnierId }),
        kaempfe: poolIds.length ? await knex('kaempfe').whereIn('pool_id', poolIds) : [],
        mannschaften: await knex('mannschaften').where({ turnier_id: turnierId }),
        mannschaftskaempfe: poolIds.length ? await knex('mannschaftskaempfe').whereIn('pool_id', poolIds) : []
    };
}

function baueKonfigDokument(turnier, bestehend) {
    const passwort = process.env.STEUERUNG_PASSWORD || '';
    const soll = {
        _id: 'konfig:steuerung',
        typ: 'konfig',
        turnier_id: turnier.id,
        bezeichnung: turnier.bezeichnung,
        datum: turnier.datum instanceof Date ? turnier.datum.toISOString().slice(0, 10) : turnier.datum,
        instanz_id: turnier.instanz_id,
        steuerung_passwort_sha256: passwort ? createHash('sha256').update(passwort).digest('hex') : null,
        bearbeitet_von: 'server'
    };
    if (bestehend) {
        const gleich = Object.keys(soll).every(k => JSON.stringify(bestehend[k]) === JSON.stringify(soll[k]));
        if (gleich) return null;
        soll._rev = bestehend._rev;
    }
    return soll;
}

export function erzeugeAbgleich({ knex, zustand }) {
    let kette = Promise.resolve();
    let geplant = null;

    async function intern() {
        const { db, turnierId } = zustand;
        if (!db || !turnierId) return;

        const turnier = await knex('turniere').where({ id: turnierId }).first();
        if (!turnier) return;
        const zeilen = await ladeLiveZeilen(knex, turnierId);
        const alle = await db.allDocs({ include_docs: true });
        const docs = new Map(alle.rows.filter(r => !r.id.startsWith('_design/')).map(r => [r.id, r.doc]));
        const angewendet = new Set((await knex('sync_angewendet').select('doc_id', 'rev')).map(z => `${z.doc_id}@${z.rev}`));

        const schreiben = [];
        const gesehen = new Set();
        for (const [tabelle, liste] of Object.entries(zeilen)) {
            for (const zeile of liste) {
                const id = dokumentIdFuer(tabelle, zeile);
                gesehen.add(id);
                const doc = docs.get(id);
                if (doc && doc.bearbeitet_von !== 'server' && !angewendet.has(`${id}@${doc._rev}`)) continue;
                if (!unterscheidetSichVomServerStand(doc, tabelle, zeile)) continue;
                schreiben.push(mitServerStand(doc, tabelle, zeile));
            }
        }

        // Dokumente, deren Zeile es nicht mehr gibt, löschen — außer noch nicht übernommene
        // Nachmeldungen (sql_id null) und als Dublette verknüpfte Nachmeldungen.
        for (const [id, doc] of docs) {
            if (gesehen.has(id) || !LIVE_PRAEFIXE.some(p => id.startsWith(p))) continue;
            if (doc.dublette_von) continue;
            if (doc.bearbeitet_von !== 'server' && doc.sql_id == null) continue;
            schreiben.push({ _id: id, _rev: doc._rev, _deleted: true });
        }

        const konfig = baueKonfigDokument(turnier, docs.get('konfig:steuerung'));
        if (konfig) schreiben.push(konfig);

        // Konflikte (409) entstehen, wenn eine Matte das Dokument gleichzeitig ändert — dann
        // verarbeitet die Brücke deren Änderung und stößt danach einen neuen Abgleich an.
        if (schreiben.length) await db.bulkDocs(schreiben);
    }

    function fuehreAus() {
        kette = kette.then(intern).catch(err => console.error('[Sync] Abgleich fehlgeschlagen:', err));
        return kette;
    }

    function plane() {
        if (geplant) return;
        geplant = setTimeout(() => {
            geplant = null;
            fuehreAus();
        }, 100);
    }

    async function leerlauf() {
        while (geplant) await new Promise(r => setTimeout(r, 20));
        await kette;
    }

    return { fuehreAus, plane, leerlauf, LIVE_TABELLEN };
}
```

- [ ] **Step 5: In den Sync-Dienst einbinden**

In `src/sync/syncDienst.js` den Import `import { erzeugeAbgleich } from './abgleich.js';` ergänzen, nach `const zustand = ...` die Zeile `const abgleich = erzeugeAbgleich({ knex, zustand });` einfügen und im `dienst`-Objekt ersetzen:

```js
        planeAbgleich() { abgleich.plane(); },
        async leerlauf() { await abgleich.leerlauf(); },
        async nachAktivierung() { await abgleich.fuehreAus(); },
        async vorDeaktivierung() { await abgleich.leerlauf(); }
```

- [ ] **Step 6: Middleware für REST-Schreibzugriffe**

In `src/app.js` **vor** den `/api/...`-Routen, aber nach `express.json()`:

```js
// Nach jedem erfolgreichen schreibenden API-Request den Abgleich SQL -> Dokumente anstoßen
// (entprellt). So erreichen Änderungen der Turnierleitung die Matten/Waagen, ohne dass jeder
// Controller einzeln daran denken muss.
if (sync) {
    app.use('/api', (req, res, next) => {
        if (req.method !== 'GET') {
            res.on('finish', () => {
                if (res.statusCode < 400) sync.planeAbgleich();
            });
        }
        next();
    });
}
```

- [ ] **Step 7: Tests laufen lassen**

Run: `npm run test:e2e:sync` → Expected: PASS
Run: `npm run test:e2e` → Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/sync/abgleich.js src/sync/syncDienst.js src/app.js tests/e2e-sync
git commit -m "feat(sync): Abgleich der Live-Tabellen in die Dokument-DB"
```

---

### Task 7: Service-Funktionen aus den Controllern herauslösen

**Files:**
- Create: `src/utils/fachFehler.js`
- Modify: `src/controllers/kampfController.js` (`updateKampf`, neue Exporte), `src/controllers/kampfflaecheController.js` (`pausiereKampfflaeche`, `setzeKampfflaecheFort`), `src/controllers/teilnehmerController.js` (`createTeilnehmer`, `updateTeilnehmer`, `bestaetigeKampfbereit`, `markiereNichtAngetreten`, `disqualifiziere`)

**Interfaces:**
- Produces (alle ohne `req`/`res`; werfen `FachFehler` mit `statusCode`):
  - `class FachFehler extends Error { statusCode; code?; daten? }`
  - `aktualisiereKampf(knex, id, felder) → Promise<void>` (Body von `updateKampf`)
  - `setzeMattenReihenfolge(knex, kampfId, wert) → Promise<void>` (neu, nur für Kämpfe im Status `bereit`)
  - `pausiereMatte(knex, id)`, `setzeMatteFort(knex, id) → Promise<void>`
  - `legeTeilnehmerAn(knex, daten, kontext) → Promise<number>` (neue ID; bei Dublette `FachFehler(409)` mit `code: 'DUBLETTE'` und `daten: { bestehendeId }`)
  - `aktualisiereTeilnehmerDaten(knex, id, daten, kontext) → Promise<void>`
  - `bestaetigeKampfbereitschaft(knex, id, kontext) → Promise<void>`
  - `werteForfeit(knex, teilnehmerId, kampfId, art, kontext) → Promise<void>` (`art` = `'nicht_angetreten'` \| `'disqualifiziert'`)
  - `kontext = { istGastgeberVerein: boolean, istPrivilegiert: boolean, userVereinName: string|null }`; `HALLEN_KONTEXT = { istGastgeberVerein: true, istPrivilegiert: true, userVereinName: null }` (exportiert aus `teilnehmerController.js`)

- [ ] **Step 1: `src/utils/fachFehler.js`**

```js
// Fachlicher Fehler einer Service-Funktion (ohne req/res): trägt den HTTP-Status, den die
// REST-Route zurückgibt, bzw. den die Sync-Brücke als Ablehnung an die Matte/Waage meldet.
export class FachFehler extends Error {
    constructor(statusCode, nachricht, { code = null, daten = null } = {}) {
        super(nachricht);
        this.statusCode = statusCode;
        this.code = code;
        this.daten = daten;
    }
}
```

- [ ] **Step 2: `kampfController.js` umbauen**

`export async function updateKampf(...)` umbenennen und umbauen zu:

```js
export async function aktualisiereKampf(knex, id, felder) {
    const {
        kaempfer1_id, kaempfer2_id, sieger_id, kampfzeit_in_sekunden,
        unterbewertung_kaempfer1, unterbewertung_kaempfer2, status,
        reihenfolge_nummer, matten_reihenfolge
    } = felder;
    // ... restlicher Body von updateKampf unverändert, mit genau diesen Ersetzungen:
    //   return res.status(404).json({ success: false, error: 'Kampf nicht gefunden.' });
    //     -> throw new FachFehler(404, 'Kampf nicht gefunden.');
    //   return res.status(400).json({ success: false, error: X });  -> throw new FachFehler(400, X);
    //   return res.status(409).json({ success: false, error: X });  -> throw new FachFehler(409, X);
    //   das abschließende "return res.json({ success: true, ... })" entfällt
    //   try/catch um den Body entfällt
}

export async function updateKampf(knex, req, res) {
    try {
        await aktualisiereKampf(knex, req.params.id, req.body);
        return res.json({ success: true, message: 'Kampf erfolgreich aktualisiert.' });
    } catch (error) {
        return res.status(error.statusCode || 500).json({ success: false, error: error.message });
    }
}

// Setzt die Matten-Reihenfolge eines einzelnen Kampfes (Sync-Brücke: eine Matte hat zwei Kämpfe
// getauscht, jede Seite kommt als eigene Dokument-Änderung an). Gleiche Einschränkung wie
// tauscheKaempfeReihenfolge: nur noch nicht gestartete Kämpfe.
export async function setzeMattenReihenfolge(knex, kampfId, wert) {
    const kampf = await knex('kaempfe').where({ id: kampfId }).first();
    if (!kampf) throw new FachFehler(404, 'Kampf nicht gefunden.');
    if (kampf.status !== 'bereit') {
        throw new FachFehler(409, 'Es können nur noch nicht gestartete Kämpfe (Status "bereit") umsortiert werden.');
    }
    await knex('kaempfe').where({ id: kampfId }).update({ matten_reihenfolge: wert, updated_at: knex.fn.now() });
}
```

Den Import `import { FachFehler } from '../utils/fachFehler.js';` ergänzen. Den Kommentarblock über den Folgekämpfen (Korrekturschutz) unverändert mitnehmen.

- [ ] **Step 3: `kampfflaecheController.js` umbauen**

```js
export async function pausiereMatte(knex, id) {
    const kf = await knex('kampfflaechen').where({ id }).first();
    if (!kf) throw new FachFehler(404, 'Kampffläche nicht gefunden.');
    if (kf.status === 'gesperrt') throw new FachFehler(400, 'Eine gesperrte Matte muss erst entsperrt werden.');
    await knex('kampfflaechen').where({ id }).update({ status: 'pausiert', updated_at: knex.fn.now() });
}

export async function pausiereKampfflaeche(knex, req, res) {
    try {
        await pausiereMatte(knex, req.params.id);
        return res.json({ success: true, message: 'Matte pausiert.' });
    } catch (error) {
        return res.status(error.statusCode || 500).json({ success: false, error: error.message });
    }
}

export async function setzeMatteFort(knex, id) {
    const kf = await knex('kampfflaechen').where({ id }).first();
    if (!kf) throw new FachFehler(404, 'Kampffläche nicht gefunden.');
    if (kf.status !== 'pausiert') throw new FachFehler(400, 'Diese Matte ist nicht pausiert.');
    await knex('kampfflaechen').where({ id }).update({ status: 'frei', updated_at: knex.fn.now() });
    await synchronisiereMattenStatus(knex, parseInt(id, 10));
}

export async function setzeKampfflaecheFort(knex, req, res) {
    try {
        await setzeMatteFort(knex, req.params.id);
        return res.json({ success: true, message: 'Matte fortgesetzt.' });
    } catch (error) {
        return res.status(error.statusCode || 500).json({ success: false, error: error.message });
    }
}
```

Den bisherigen Kommentar über `pausiereKampfflaeche` bzw. `setzeKampfflaecheFort` über `pausiereMatte` bzw. `setzeMatteFort` stellen. Import `FachFehler` ergänzen.

- [ ] **Step 4: `teilnehmerController.js` umbauen**

Nach den Hilfsfunktionen (hinter `leiteStatusAusKampfbereitschaftAb`) einfügen:

```js
// Rechte-Kontext der Service-Funktionen: REST-Routen leiten ihn aus dem angemeldeten Benutzer ab,
// die Sync-Brücke des Hallen-Servers nutzt HALLEN_KONTEXT (dort gilt wie bei IS_OFFLINE jeder als
// ausrichtender Verein).
export const HALLEN_KONTEXT = Object.freeze({ istGastgeberVerein: true, istPrivilegiert: true, userVereinName: null });

async function ermittleKontext(knex, req, turnier) {
    const user = await ladeBenutzerMitAktivemVerein(knex, req.user.id);
    const istGastgeberVerein = process.env.IS_OFFLINE === 'true' || hatVereinsZugriffAufTurnier(user, turnier);
    return {
        istGastgeberVerein,
        istPrivilegiert: istGastgeberVerein || !!(user && user.ist_super_admin),
        userVereinName: await resolveUserVereinName(knex, user),
        userGefunden: !!user
    };
}
```

**`createTeilnehmer` → `legeTeilnehmerAn(knex, daten, kontext)`:**
- Der Body liest seine Felder aus `daten` statt aus `req.body`.
- `user`, `istGastgeberVerein`, `userVereinName` und `istPrivilegiertFuerLizenzUndStartgeld` kommen aus `kontext`: `kontext.istGastgeberVerein`, `kontext.userVereinName`, `kontext.istPrivilegiert`.
- Jedes `return res.status(N).json({ success: false, error: X })` wird zu `throw new FachFehler(N, X)`.
- Der Dubletten-Fall wird zu:

```js
            if (bestehenderTeilnehmer) {
                throw new FachFehler(409, `${bestehenderTeilnehmer.vorname} ${bestehenderTeilnehmer.nachname} wurde für dieses Turnier bereits eingewogen/angemeldet.`, {
                    code: 'DUBLETTE', daten: { bestehendeId: bestehenderTeilnehmer.id }
                });
            }
```

- Am Ende steht `return teilnehmerId;`.
- Zusätzlich: Ist `daten.dokument_id` gesetzt, wird es in `neuerTeilnehmer.dokument_id` übernommen.

Der neue Controller:

```js
export async function createTeilnehmer(knex, req, res) {
    try {
        const turnier = await knex('turniere').where({ id: parseInt(req.body.turnier_id) }).first();
        if (!turnier) return res.status(404).json({ success: false, error: 'Turnier nicht gefunden.' });
        const kontext = await ermittleKontext(knex, req, turnier);
        if (!kontext.userGefunden) return res.status(401).json({ success: false, error: 'Benutzerprofil nicht gefunden.' });
        const teilnehmerId = await legeTeilnehmerAn(knex, req.body, kontext);
        return res.status(201).json({ success: true, teilnehmerId });
    } catch (error) {
        if (!error.statusCode) console.error('[Backend-Fehler Waage/Anmeldung]:', error);
        return res.status(error.statusCode || 500).json({ success: false, error: error.message });
    }
}
```

`legeTeilnehmerAn` lädt das Turnier selbst noch einmal und wirft `FachFehler(404, 'Turnier nicht gefunden.')`, wenn es fehlt. Die Brücke hat keinen Controller, der das vorab prüft.

**`updateTeilnehmer` → `aktualisiereTeilnehmerDaten(knex, id, daten, kontext)`:** gleiches Muster. `isSameClub` wird mit `kontext.userVereinName` berechnet. Der Controller lädt `athlet` und `turnier` für `ermittleKontext` und ruft danach die Service-Funktion auf.

**`bestaetigeKampfbereit` → `bestaetigeKampfbereitschaft(knex, id, kontext)`:** gleiches Muster. Der 403-Fall wird zu `if (!kontext.istGastgeberVerein) throw new FachFehler(403, ...)`.

**`loeseKampfAlsForfeitAuf` → `werteForfeit(knex, teilnehmerId, kampfId, art, kontext)`:**

```js
export async function werteForfeit(knex, teilnehmerId, kampfId, art, kontext) {
    const athlet = await knex('turnier_teilnehmer').where({ id: teilnehmerId }).first();
    if (!athlet) throw new FachFehler(404, 'Teilnehmer nicht gefunden.');
    if (!kontext.istGastgeberVerein) throw new FachFehler(403, 'Nur Mitglieder des ausrichtenden Vereins dürfen dies markieren.');
    await loeseKampfAlsForfeitAuf(knex, athlet, kampfId, art);
}
```

In `loeseKampfAlsForfeitAuf` wird jedes `throw Object.assign(new Error(X), { statusCode: N })` zu `throw new FachFehler(N, X)`.

`markiereNichtAngetreten` und `disqualifiziere` lesen danach nur noch Teilnehmer und Turnier für `ermittleKontext` und rufen `werteForfeit(knex, parseInt(id, 10), parseInt(kampf_id, 10), 'nicht_angetreten' | 'disqualifiziert', kontext)` auf.

Import `FachFehler` ergänzen.

- [ ] **Step 5: Regression**

Run: `npm run test:e2e` → Expected: PASS. Das ist der Nachweis für das reine Refactoring. Bei Fehlern die betroffene Funktion Zeile für Zeile mit `git diff` gegen die alte Fassung vergleichen.
Run: `npm run test:e2e:sync` → Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/utils/fachFehler.js src/controllers/kampfController.js src/controllers/kampfflaecheController.js src/controllers/teilnehmerController.js
git commit -m "refactor: Service-Funktionen ohne req/res für Kampf, Matte und Teilnehmer"
```

---

### Task 8: Brücke Dokumente → Fachlogik

**Files:**
- Create: `src/sync/bruecke.js`, `tests/e2e-sync/sync-bruecke.spec.js`
- Modify: `src/sync/syncDienst.js`, `src/routes/syncRoutes.js`

**Interfaces:**
- Consumes: Service-Funktionen und `HALLEN_KONTEXT` (Task 7), `geaenderteFelder`, `mitServerStand` (Task 3), Abgleich (Task 6)
- Produces:
  - `erzeugeBruecke({ knex, zustand, abgleich }) → { starte(), stoppe(): Promise, leerlauf(): Promise, neuStarten(): Promise }`
  - Dokumentfeld `letzte_ablehnung = { rev, art: 'fachlich'|'technisch', grund, zeit }` (von der Brücke gesetzt; `rev` = abgelehnte Revision)
  - Dokumente `konflikt:<uuid>` mit `{ typ:'konflikt', konflikt_typ: 'abgelehnt'|'bruecke_fehler'|'dublette', prioritaet:'normal', bezug_id, grund, version_lokal, erstellt_am, erledigt:false }`
  - `POST /api/sync/test/bruecke-neustart` (nur `NODE_ENV=test`)
- Semantik der Frontend-Schreibvorgänge:
  - **Kampf:** Ergebnisfelder `status`, `sieger_id`, `unterbewertung_kaempfer1/2`, `kampfzeit_in_sekunden`, außerdem `matten_reihenfolge`, `live_farbe`, `forfeit_teilnehmer_id` + `forfeit_art`
  - **Matte:** `status` `'pausiert'` bzw. zurück zu einem anderen Status = fortsetzen
  - **Teilnehmer:** Waage-Felder, `status: 'kampfbereit'` = bestätigen; neue Dokumente mit `sql_id: null` = Nachmeldung

- [ ] **Step 1: Fehlschlagenden Test schreiben** – `tests/e2e-sync/sync-bruecke.spec.js`

```js
import { test, expect } from '@playwright/test';
import { syncStatus, warteLeerlauf, richteDk8TurnierEin, alleDokumente, ladeDokument, schreibeDokument } from './helpers.js';

test.describe.serial('Brücke: Dokument-Änderungen landen über die Fachlogik in der relationalen DB', () => {
    let dbName, matId, turnierId;

    test.beforeAll(async ({ request }) => {
        ({ matId, turnierId } = await richteDk8TurnierEin(request, 'Sync Brücke'));
        await warteLeerlauf(request);
        dbName = (await syncStatus(request)).db_name;
    });

    const sqlKaempfe = async (request) => (await request.get(`/api/kaempfe?kampfflaecheId=${matId}`)).json();

    // Nachmeldungen zuerst: nach dem ersten echten Kampf sperrt die Fachlogik die Teilnehmerliste
    // (turnierHatEchteKaempfe in poolController.js).
    test('Nachmeldung und Dublette', async ({ request }) => {
        const neu = {
            _id: 'teilnehmer:u-11111111-1111-4111-8111-111111111111', typ: 'teilnehmer', sql_id: null, bearbeitet_von: 'test',
            turnier_id: turnierId, vorname: 'Nina', nachname: 'Nach', verein: 'JC Neu', judopass_id: 'NP-1',
            geburtsjahr: 2009, geschlecht: 'männlich', gewicht: 70, altersklasse: 'U18', gewichtsklasse: '-73kg'
        };
        await schreibeDokument(request, dbName, neu);
        await warteLeerlauf(request);
        const doc = await ladeDokument(request, dbName, neu._id);
        expect(doc.sql_id).toBeGreaterThan(0);
        expect(doc.bearbeitet_von).toBe('server');

        const dublette = { ...neu, _id: 'teilnehmer:u-22222222-2222-4222-8222-222222222222', gewicht: 71.5 };
        await schreibeDokument(request, dbName, dublette);
        await warteLeerlauf(request);
        const alle = await (await request.get(`/api/teilnehmer?turnierId=${turnierId}`)).json();
        const liste = Array.isArray(alle) ? alle : alle.teilnehmer;
        expect(liste.filter(t => t.judopass_id === 'NP-1')).toHaveLength(1);
        expect(parseFloat(liste.find(t => t.judopass_id === 'NP-1').gewicht)).toBe(71.5);
        const dDoc = await ladeDokument(request, dbName, dublette._id);
        expect(dDoc.dublette_von).toBe(neu._id);
        expect(dDoc.sql_id).toBe(doc.sql_id);
    });

    test('Ergebnis per Dokument -> SQL + Kaskade', async ({ request }) => {
        const erster = (await sqlKaempfe(request)).find(k => k.status === 'bereit');
        const doc = await ladeDokument(request, dbName, `kampf:${erster.id}`);
        await schreibeDokument(request, dbName, {
            ...doc, status: 'beendet', sieger_id: doc.kaempfer1_id,
            unterbewertung_kaempfer1: 10, unterbewertung_kaempfer2: 0, kampfzeit_in_sekunden: 42, bearbeitet_von: 'test'
        });
        await warteLeerlauf(request);
        const sql = (await sqlKaempfe(request)).find(k => k.id === erster.id);
        expect(sql.status).toBe('beendet');
        expect(sql.sieger_id).toBe(doc.kaempfer1_id);
        expect((await ladeDokument(request, dbName, `kampf:${erster.id}`)).bearbeitet_von).toBe('server');
    });

    test('abgelehnte Änderung: Konflikt-Dokument, letzte_ablehnung, Server-Stand wiederhergestellt', async ({ request }) => {
        const matte = await ladeDokument(request, dbName, `kampfflaeche:${matId}`);
        await schreibeDokument(request, dbName, { ...matte, status: 'pausiert', bearbeitet_von: 'test' });
        await warteLeerlauf(request);
        const bereit = (await sqlKaempfe(request)).find(k => k.status === 'bereit');
        const doc = await ladeDokument(request, dbName, `kampf:${bereit.id}`);
        const { rev } = await schreibeDokument(request, dbName, { ...doc, status: 'gestartet', bearbeitet_von: 'test' });
        await warteLeerlauf(request);

        const nachher = await ladeDokument(request, dbName, `kampf:${bereit.id}`);
        expect(nachher.status).toBe('bereit');
        expect(nachher.letzte_ablehnung.rev).toBe(rev);
        expect(nachher.letzte_ablehnung.grund).toContain('pausiert');
        const konflikte = (await alleDokumente(request, dbName)).filter(d => d.typ === 'konflikt' && d.bezug_id === `kampf:${bereit.id}`);
        expect(konflikte).toHaveLength(1);
        expect(konflikte[0].konflikt_typ).toBe('abgelehnt');

        const m2 = await ladeDokument(request, dbName, `kampfflaeche:${matId}`);
        await schreibeDokument(request, dbName, { ...m2, status: 'frei', bearbeitet_von: 'test' });
        await warteLeerlauf(request);
        const kf = await (await request.get(`/api/kampfflaechen?turnierId=${turnierId}`)).json();
        expect(kf[0].status).not.toBe('pausiert');
    });

    test('Forfeit per Dokument', async ({ request }) => {
        const bereit = (await sqlKaempfe(request)).find(k => k.status === 'bereit');
        const doc = await ladeDokument(request, dbName, `kampf:${bereit.id}`);
        await schreibeDokument(request, dbName, { ...doc, forfeit_teilnehmer_id: doc.kaempfer2_id, forfeit_art: 'disqualifiziert', bearbeitet_von: 'test' });
        await warteLeerlauf(request);
        const sql = (await sqlKaempfe(request)).find(k => k.id === bereit.id);
        expect(sql.status).toBe('beendet');
        expect(sql.sieger_id).toBe(doc.kaempfer1_id);
        const nachher = await ladeDokument(request, dbName, `kampf:${bereit.id}`);
        expect(nachher.forfeit_art).toBeUndefined();
    });

    test('Neustart der Brücke wendet nichts doppelt an', async ({ request }) => {
        const vorher = await (await request.get(`/api/teilnehmer?turnierId=${turnierId}`)).json();
        const r = await request.post('/api/sync/test/bruecke-neustart');
        expect(r.ok()).toBeTruthy();
        await warteLeerlauf(request);
        const nachher = await (await request.get(`/api/teilnehmer?turnierId=${turnierId}`)).json();
        expect(JSON.stringify(nachher)).toBe(JSON.stringify(vorher));
    });
});
```

Die Antwortform von `GET /api/teilnehmer?turnierId=` in `getTeilnehmerByTurnier` nachsehen und `liste` passend vereinfachen.

- [ ] **Step 2: Fehlschlag prüfen**

Run: `npm run test:e2e:sync` → Expected: FAIL (SQL bleibt unverändert)

- [ ] **Step 3: `src/sync/bruecke.js`**

```js
// Brücke Dokument-DB -> relationale DB (nur Hallen-Server). Liest den _changes-Feed und wendet
// jede Änderung, die NICHT vom Server selbst stammt (bearbeitet_von !== 'server'), über die
// bestehende Fachlogik an. Was angewendet werden soll, ergibt sich aus dem Feld-Vergleich mit der
// SQL-Zeile — dadurch ist erneutes Anwenden wirkungslos (idempotent), auch nach einem Neustart.
//
// Lehnt die Fachlogik ab (FachFehler) oder scheitert sie technisch, bekommt das Dokument den
// Server-Stand zurück plus letzte_ablehnung (Rückmeldung an Matte/Waage), und ein
// konflikt:-Dokument hält beide Versionen für die Turnierleitung fest (Spec Abschnitt 10).
import { randomUUID } from 'crypto';
import { geaenderteFelder, mitServerStand } from '../shared/dokumentAbbildung.js';
import { aktualisiereKampf, setzeMattenReihenfolge } from '../controllers/kampfController.js';
import { pausiereMatte, setzeMatteFort } from '../controllers/kampfflaecheController.js';
import {
    HALLEN_KONTEXT, legeTeilnehmerAn, aktualisiereTeilnehmerDaten, bestaetigeKampfbereitschaft, werteForfeit
} from '../controllers/teilnehmerController.js';

const KAMPF_ERGEBNIS_FELDER = ['status', 'sieger_id', 'unterbewertung_kaempfer1', 'unterbewertung_kaempfer2', 'kampfzeit_in_sekunden'];
const TEILNEHMER_WAAGE_FELDER = [
    'vorname', 'nachname', 'judopass_id', 'verein', 'geburtsjahr', 'lizenz_ablauf', 'geschlecht',
    'gewicht', 'altersklasse', 'gewichtsklasse', 'graduierung', 'startgeld_bezahlt', 'gewogen'
];

function waageDaten(doc) {
    const daten = {};
    for (const feld of TEILNEHMER_WAAGE_FELDER) if (doc[feld] !== undefined) daten[feld] = doc[feld];
    return daten;
}

async function wendeKampfAn(knex, doc) {
    const id = doc.sql_id;
    const zeile = await knex('kaempfe').where({ id }).first();
    if (!zeile) return { tabelle: 'kaempfe', zeile: null };

    if (doc.live_farbe) {
        global.liveColors = global.liveColors || {};
        global.liveColors[id] = doc.live_farbe;
    }
    if (doc.forfeit_teilnehmer_id && !['beendet', 'freilos'].includes(zeile.status)) {
        await werteForfeit(knex, Number(doc.forfeit_teilnehmer_id), id, doc.forfeit_art === 'disqualifiziert' ? 'disqualifiziert' : 'nicht_angetreten', HALLEN_KONTEXT);
    } else {
        const ergebnis = geaenderteFelder(doc, zeile, KAMPF_ERGEBNIS_FELDER);
        if (Object.keys(ergebnis).length) await aktualisiereKampf(knex, id, ergebnis);
    }
    const reihenfolge = geaenderteFelder(doc, await knex('kaempfe').where({ id }).first(), ['matten_reihenfolge']);
    if ('matten_reihenfolge' in reihenfolge) await setzeMattenReihenfolge(knex, id, reihenfolge.matten_reihenfolge);
    return { tabelle: 'kaempfe', zeile: await knex('kaempfe').where({ id }).first() };
}

async function wendeKampfflaecheAn(knex, doc) {
    const id = doc.sql_id;
    const zeile = await knex('kampfflaechen').where({ id }).first();
    if (!zeile) return { tabelle: 'kampfflaechen', zeile: null };
    if (doc.status === 'pausiert' && zeile.status !== 'pausiert') await pausiereMatte(knex, id);
    else if (doc.status !== 'pausiert' && zeile.status === 'pausiert') await setzeMatteFort(knex, id);
    return { tabelle: 'kampfflaechen', zeile: await knex('kampfflaechen').where({ id }).first() };
}

async function wendeTeilnehmerAn(knex, db, doc, legeKonfliktAn) {
    let id = doc.sql_id;
    if (id == null) {
        // Nachmeldung — bereits angelegt (z.B. vor einem Neustart)? Dann nur zuordnen.
        const vorhanden = await knex('turnier_teilnehmer').where({ dokument_id: doc._id }).first();
        if (vorhanden) {
            id = vorhanden.id;
        } else {
            try {
                id = await legeTeilnehmerAn(knex, { ...waageDaten(doc), turnier_id: doc.turnier_id, dokument_id: doc._id }, HALLEN_KONTEXT);
            } catch (err) {
                if (err.code !== 'DUBLETTE') throw err;
                // Dublette (z.B. an zwei Waagen offline doppelt nachgemeldet): Wiegedaten auf den
                // bestehenden Teilnehmer übernehmen, Nachmeldungs-Dokument als Dublette verknüpfen.
                const bestehendeId = err.daten.bestehendeId;
                await aktualisiereTeilnehmerDaten(knex, bestehendeId, waageDaten(doc), HALLEN_KONTEXT);
                const bestehend = await knex('turnier_teilnehmer').where({ id: bestehendeId }).first();
                await db.put({ ...doc, sql_id: bestehendeId, id: bestehendeId, dublette_von: bestehend.dokument_id || `teilnehmer:${bestehendeId}`, bearbeitet_von: 'server' });
                await legeKonfliktAn('dublette', doc, err.message);
                return { tabelle: 'turnier_teilnehmer', zeile: null, erledigt: true };
            }
        }
    } else {
        const zeile = await knex('turnier_teilnehmer').where({ id }).first();
        if (!zeile) return { tabelle: 'turnier_teilnehmer', zeile: null };
        if (Object.keys(geaenderteFelder(doc, zeile, TEILNEHMER_WAAGE_FELDER)).length) {
            await aktualisiereTeilnehmerDaten(knex, id, waageDaten(doc), HALLEN_KONTEXT);
        }
    }
    const nachher = await knex('turnier_teilnehmer').where({ id }).first();
    if (doc.status === 'kampfbereit' && ['angemeldet', 'nicht_erschienen'].includes(nachher.status)) {
        await bestaetigeKampfbereitschaft(knex, id, HALLEN_KONTEXT);
    }
    return { tabelle: 'turnier_teilnehmer', zeile: await knex('turnier_teilnehmer').where({ id }).first() };
}

export function erzeugeBruecke({ knex, zustand, abgleich }) {
    let feed = null;
    let kette = Promise.resolve();

    async function legeKonfliktAnIn(db, konfliktTyp, doc, grund) {
        await db.put({
            _id: `konflikt:${randomUUID()}`, typ: 'konflikt', konflikt_typ: konfliktTyp, prioritaet: 'normal',
            bezug_id: doc._id, grund, version_lokal: doc, erstellt_am: new Date().toISOString(), erledigt: false,
            bearbeitet_von: 'server'
        });
    }

    async function lehneAb(db, doc, tabelle, fehler) {
        const fachlich = !!fehler.statusCode;
        if (!fachlich) console.error('[Brücke] Technischer Fehler bei', doc._id, fehler);
        const zeile = doc.sql_id != null ? await knex(tabelle).where({ id: doc.sql_id }).first() : null;
        const ablehnung = { rev: doc._rev, art: fachlich ? 'fachlich' : 'technisch', grund: fehler.message, zeit: new Date().toISOString() };
        // Server-Stand zurück (oder bei nie angelegter Nachmeldung: nur die Ablehnung vermerken).
        const zurueck = zeile ? mitServerStand(doc, tabelle, zeile) : { ...doc, bearbeitet_von: 'server' };
        try {
            await db.put({ ...zurueck, letzte_ablehnung: ablehnung });
        } catch (err) {
            if (err.status !== 409) throw err; // neuere Änderung inzwischen da -> kommt als eigener Change
        }
        await legeKonfliktAnIn(db, fachlich ? 'abgelehnt' : 'bruecke_fehler', doc, fehler.message);
    }

    async function verarbeite(db, doc) {
        if (!doc || doc._deleted || doc.bearbeitet_von === 'server') return;
        const typ = doc._id.split(':')[0];
        const handler = {
            kampf: () => wendeKampfAn(knex, doc),
            kampfflaeche: () => wendeKampfflaecheAn(knex, doc),
            teilnehmer: () => wendeTeilnehmerAn(knex, db, doc, (t, d, g) => legeKonfliktAnIn(db, t, d, g))
        }[typ];
        if (!handler) return;

        const schonAngewendet = await knex('sync_angewendet').where({ doc_id: doc._id, rev: doc._rev }).first();
        if (schonAngewendet) return;

        const tabelle = { kampf: 'kaempfe', kampfflaeche: 'kampfflaechen', teilnehmer: 'turnier_teilnehmer' }[typ];
        try {
            await handler();
        } catch (fehler) {
            await lehneAb(db, doc, tabelle, fehler);
        }
        await knex('sync_angewendet').insert({ doc_id: doc._id, rev: doc._rev }).onConflict(['doc_id', 'rev']).ignore();
        await abgleich.fuehreAus();
    }

    function starte() {
        const db = zustand.db;
        if (!db || feed) return;
        feed = db.changes({ since: 0, live: true, include_docs: true });
        feed.on('change', (change) => {
            kette = kette.then(() => verarbeite(db, change.doc)).catch(err => console.error('[Brücke] Fehler:', err));
        });
        feed.on('error', (err) => console.error('[Brücke] Feed-Fehler:', err));
    }

    async function stoppe() {
        if (feed) {
            feed.cancel();
            feed = null;
        }
        await kette;
    }

    async function leerlauf() {
        // Dem Feed kurz Zeit geben, gerade geschriebene Dokumente zu melden, dann warten, bis
        // Brücke und Abgleich (der die Brücke erneut auslösen kann) beide ruhen.
        for (let i = 0; i < 3; i++) {
            await new Promise(r => setTimeout(r, 150));
            await kette;
            await abgleich.leerlauf();
        }
    }

    async function neuStarten() {
        await stoppe();
        starte();
    }

    return { starte, stoppe, leerlauf, neuStarten };
}
```

- [ ] **Step 4: In den Sync-Dienst einbinden**

In `src/sync/syncDienst.js` den Import `import { erzeugeBruecke } from './bruecke.js';` ergänzen, nach dem Abgleich `const bruecke = erzeugeBruecke({ knex, zustand, abgleich });` anlegen und im `dienst`-Objekt ersetzen bzw. ergänzen:

```js
        async leerlauf() { await abgleich.leerlauf(); await bruecke.leerlauf(); },
        async nachAktivierung() { await abgleich.fuehreAus(); bruecke.starte(); },
        async vorDeaktivierung() { await bruecke.stoppe(); await abgleich.leerlauf(); },
        async brueckeNeuStarten() { await bruecke.neuStarten(); },
```

- [ ] **Step 5: Test-Endpunkt**

In `src/routes/syncRoutes.js` innerhalb von `if (process.env.NODE_ENV === 'test')`:

```js
        router.post('/test/bruecke-neustart', async (req, res) => {
            const sync = holeSync();
            if (sync) await sync.brueckeNeuStarten();
            res.json({ success: true });
        });
```

- [ ] **Step 6: Tests laufen lassen**

Run: `npm run test:e2e:sync` → Expected: PASS
Run: `npm run test:e2e` → Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/sync/bruecke.js src/sync/syncDienst.js src/routes/syncRoutes.js tests/e2e-sync/sync-bruecke.spec.js
git commit -m "feat(sync): Brücke Dokument-DB -> Fachlogik mit Ablehnung und Konflikt-Dokumenten"
```

---

### Task 9: Frontend-Datenzugriff (REST- und Dokument-Backend)

**Files:**
- Create: `public/js/datenzugriff.js`, `tests/e2e-sync/sync-datenzugriff.spec.js`
- Modify: `src/app.js` (statische Route für `pouchdb.min.js`)

**Interfaces:**
- Consumes: `/api/sync/status` (Task 5), Dokument-Semantik der Brücke (Task 8), `baueMattenAnsicht` (Task 4)
- Produces: `window.Datenzugriff` (klassisches Skript, auch aus Modulen nutzbar) mit:
  - `init() → Promise<'rest'|'dokumente'>`
  - `ladeKampfflaechen(turnierId) → Promise<Array>`
  - `ladeKaempfeDerMatte(matId) → Promise<Array>` (Form wie `baueMattenAnsicht`)
  - `aktualisiereKampf(kampfId, felder) → Promise<Ergebnis>`
  - `tauscheReihenfolge(kampf1Id, kampf2Id, turnierId) → Promise<Ergebnis>`
  - `setzeLiveFarbe(kampfId, farbe) → Promise<Ergebnis>`
  - `pausiereMatte(matId) → Promise<Ergebnis>`
  - `werteForfeit(teilnehmerId, kampfId, aktion) → Promise<Ergebnis>` (`aktion` = `'nicht-angetreten'` \| `'disqualifizieren'`, wie die REST-Pfade)
  - `speichereTeilnehmer(id|null, payload) → Promise<Ergebnis & { teilnehmerId }>`
  - `bestaetigeKampfbereit(teilnehmerId) → Promise<Ergebnis>`
  - `Ergebnis = { ok: boolean, fehler?: string, ausstehend?: boolean, meldung?: string }`

- [ ] **Step 1: Statische Route für PouchDB**

In `src/app.js` bei den anderen `node_modules`-Routen:

```js
app.use('/js/pouchdb', express.static(path.join(__dirname, '../node_modules/pouchdb/dist')));
```

- [ ] **Step 2: Fehlschlagenden Test schreiben** – `tests/e2e-sync/sync-datenzugriff.spec.js`

Der Test lädt eine leere Seite und bindet die beiden Skripte per `addScriptTag` ein. So wird das Modul im echten Browser gegen den Sync-Server geprüft, ohne dass es an einer UI hängt.

```js
import { test, expect } from '@playwright/test';
import { warteLeerlauf, richteDk8TurnierEin } from './helpers.js';

test.describe.serial('Datenzugriff im Browser (Dokument-Backend)', () => {
    let matId, turnierId;

    test.beforeAll(async ({ request }) => {
        ({ matId, turnierId } = await richteDk8TurnierEin(request, 'Sync Datenzugriff'));
        await warteLeerlauf(request);
    });

    async function ladeModul(page) {
        await page.goto('/login.html');
        await page.addScriptTag({ url: '/js/pouchdb/pouchdb.min.js' });
        await page.addScriptTag({ url: '/js/datenzugriff.js' });
        return page.evaluate(() => window.Datenzugriff.init());
    }

    test('wählt das Dokument-Backend und liefert dieselbe Mattenansicht wie REST', async ({ page, request }) => {
        expect(await ladeModul(page)).toBe('dokumente');
        const ausDokumenten = await page.evaluate((m) => window.Datenzugriff.ladeKaempfeDerMatte(m), matId);
        const ausRest = await (await request.get(`/api/kaempfe?kampfflaecheId=${matId}`)).json();
        const kern = (l) => l.map(k => [k.id, k.status, k.kaempfer1_nachname, k.kaempfer2_nachname, k.pool_bezeichnung, k.matten_reihenfolge]);
        expect(kern(ausDokumenten)).toEqual(kern(ausRest));
        const matten = await page.evaluate((t) => window.Datenzugriff.ladeKampfflaechen(t), turnierId);
        expect(matten.map(m => m.id)).toEqual([matId]);
    });

    // Nachmeldungen zuerst: nach dem ersten echten Kampf sperrt die Fachlogik die Teilnehmerliste
    // (turnierHatEchteKaempfe in poolController.js).
    test('Nachmeldung liefert die neue SQL-ID', async ({ page, request }) => {
        await ladeModul(page);
        const ergebnis = await page.evaluate((t) => window.Datenzugriff.speichereTeilnehmer(null, {
            turnier_id: t, vorname: 'Paul', nachname: 'Probe', verein: 'JC P', judopass_id: 'PP-1',
            geburtsjahr: 2009, geschlecht: 'männlich', gewicht: 72, altersklasse: 'U18', gewichtsklasse: '-73kg', gewogen: true
        }), turnierId);
        expect(ergebnis.ok).toBe(true);
        expect(ergebnis.teilnehmerId).toBeGreaterThan(0);
        const t = await (await request.get(`/api/teilnehmer/${ergebnis.teilnehmerId}`)).json();
        expect(JSON.stringify(t)).toContain('Probe');
    });
    test('Ergebnis speichern wartet auf die Server-Bestätigung', async ({ page, request }) => {
        await ladeModul(page);
        const bereit = (await (await request.get(`/api/kaempfe?kampfflaecheId=${matId}`)).json()).find(k => k.status === 'bereit');
        const ergebnis = await page.evaluate(({ id, sieger }) => window.Datenzugriff.aktualisiereKampf(id, {
            status: 'beendet', sieger_id: sieger, unterbewertung_kaempfer1: 10, unterbewertung_kaempfer2: 0, kampfzeit_in_sekunden: 12
        }), { id: bereit.id, sieger: bereit.kaempfer1_id });
        expect(ergebnis).toEqual({ ok: true });
        const sql = (await (await request.get(`/api/kaempfe?kampfflaecheId=${matId}`)).json()).find(k => k.id === bereit.id);
        expect(sql.status).toBe('beendet');
    });

    test('abgelehnte Aktion liefert die Fehlermeldung der Fachlogik', async ({ page, request }) => {
        await ladeModul(page);
        const beendet = (await (await request.get(`/api/kaempfe?kampfflaecheId=${matId}`)).json()).find(k => k.status === 'beendet');
        const ergebnis = await page.evaluate((id) => window.Datenzugriff.aktualisiereKampf(id, { status: 'gestartet' }), beendet.id);
        expect(ergebnis.ok).toBe(false);
        expect(ergebnis.fehler).toContain('beendeter Kampf');
    });

});
```

- [ ] **Step 3: Fehlschlag prüfen**

Run: `npm run test:e2e:sync` → Expected: FAIL (`/js/datenzugriff.js` liefert 404)

- [ ] **Step 4: `public/js/datenzugriff.js`**

```js
// Einheitlicher Datenzugriff für Waage, Scoreboard und Mattenleitung (CouchDB-Umbau, Spec
// Abschnitt 5). Zwei Backends mit identischer Schnittstelle:
//  - 'rest': heutiges Verhalten (Cloud, Betrieb ohne Sync) — exakt die bisherigen fetch-Aufrufe.
//  - 'dokumente': der Knoten hat eine Dokument-DB (/api/sync/status liefert db_name). Schreib-
//    vorgänge ändern Dokumente; die Brücke des Servers wendet sie über die Fachlogik an. Solange
//    der Server erreichbar ist, wartet jede Aktion auf dessen Bestätigung (bearbeitet_von:
//    'server') und liefert eine Ablehnung (letzte_ablehnung) als Fehlermeldung zurück.
//
// Klassisches Skript (kein ES-Modul), damit es auch von klassischen Skripten (kampf.js,
// teilnehmer.js) genutzt werden kann. Setzt window.PouchDB voraus (/js/pouchdb/pouchdb.min.js).
(function () {
    const WARTE_MS = 5000;
    let modus = null;
    let db = null;
    let baueMattenAnsicht = null;
    let bereit = null;

    function init() {
        if (!bereit) {
            bereit = (async () => {
                try {
                    const resp = await fetch('/api/sync/status');
                    const status = resp.ok ? await resp.json() : null;
                    if (status && status.db_name && window.PouchDB) {
                        db = new window.PouchDB(`${window.location.origin}/db/${status.db_name}`, { skip_setup: true });
                        ({ baueMattenAnsicht } = await import('/js/shared/mattenAnsicht.js'));
                        modus = 'dokumente';
                        return modus;
                    }
                } catch (err) {
                    console.warn('[Datenzugriff] Sync-Status nicht lesbar, nutze REST:', err);
                }
                modus = 'rest';
                return modus;
            })();
        }
        return bereit;
    }

    // ---------- Hilfen Dokument-Backend ----------

    async function alleDokumente() {
        const res = await db.allDocs({ include_docs: true });
        return res.rows.map(r => r.doc).filter(d => d && !d._id.startsWith('_design/'));
    }

    function revNummer(rev) {
        return parseInt(String(rev).split('-')[0], 10) || 0;
    }

    // Wartet, bis der Server die eigene Revision verarbeitet hat.
    async function warteAufServer(docId, eigeneRev) {
        const ende = Date.now() + WARTE_MS;
        while (Date.now() < ende) {
            await new Promise(r => setTimeout(r, 150));
            let doc;
            try {
                doc = await db.get(docId);
            } catch (err) {
                if (err.status === 404) return { ok: false, fehler: 'Datensatz wurde auf dem Server entfernt.' };
                continue;
            }
            if (doc.bearbeitet_von === 'server' && revNummer(doc._rev) > revNummer(eigeneRev)) {
                if (doc.letzte_ablehnung && doc.letzte_ablehnung.rev === eigeneRev) {
                    return { ok: false, fehler: doc.letzte_ablehnung.grund, doc };
                }
                return { ok: true, doc };
            }
        }
        return { ok: true, ausstehend: true, meldung: 'Lokal gespeichert, Server-Bestätigung steht noch aus.' };
    }

    async function aendereDokument(docId, aenderung) {
        const doc = await db.get(docId);
        Object.assign(doc, aenderung, { bearbeitet_von: 'browser' });
        const { rev } = await db.put(doc);
        return warteAufServer(docId, rev);
    }

    function ohneDoc(ergebnis) {
        const { doc, ...rest } = ergebnis;
        return rest;
    }

    async function teilnehmerDokumentZuId(teilnehmerId) {
        const docs = await alleDokumente();
        return docs.find(d => d.typ === 'teilnehmer' && Number(d.id) === Number(teilnehmerId));
    }

    async function restJson(url, optionen) {
        const resp = await fetch(url, optionen);
        const daten = await resp.json().catch(() => ({}));
        return { ok: resp.ok && daten.success !== false, fehler: resp.ok ? undefined : (daten.error || `Fehler ${resp.status}`), daten };
    }

    const JSON_HEADER = { 'Content-Type': 'application/json' };

    // ---------- öffentliche Schnittstelle ----------

    async function ladeKampfflaechen(turnierId) {
        await init();
        if (modus === 'rest') {
            const resp = await fetch(`/api/kampfflaechen?turnierId=${turnierId}`);
            const daten = await resp.json();
            if (!resp.ok) throw new Error(daten.error || 'Fehler beim Laden der Kampfflächen.');
            return daten;
        }
        return (await alleDokumente())
            .filter(d => d.typ === 'kampfflaeche' && Number(d.turnier_id) === Number(turnierId))
            .sort((a, b) => a.id - b.id);
    }

    async function ladeKaempfeDerMatte(matId) {
        await init();
        if (modus === 'rest') {
            const resp = await fetch(`/api/kaempfe?kampfflaecheId=${matId}`);
            const daten = await resp.json();
            if (!resp.ok) throw new Error(daten.error || 'Fehler beim Laden der Kämpfe.');
            return daten;
        }
        const docs = await alleDokumente();
        const vomTyp = (typ) => docs.filter(d => d.typ === typ);
        return baueMattenAnsicht({
            kaempfe: vomTyp('kampf'), pools: vomTyp('pool'), teilnehmer: vomTyp('teilnehmer'),
            mannschaftskaempfe: vomTyp('mannschaftskampf'), mannschaften: vomTyp('mannschaft')
        }, matId, Date.now());
    }

    async function aktualisiereKampf(kampfId, felder) {
        await init();
        if (modus === 'rest') {
            const r = await restJson(`/api/kaempfe/${kampfId}`, { method: 'PUT', headers: JSON_HEADER, body: JSON.stringify(felder) });
            return r.ok ? { ok: true } : { ok: false, fehler: r.fehler };
        }
        return ohneDoc(await aendereDokument(`kampf:${kampfId}`, felder));
    }

    async function tauscheReihenfolge(kampf1Id, kampf2Id, turnierId) {
        await init();
        if (modus === 'rest') {
            const r = await restJson('/api/kaempfe/reihenfolge-tauschen', {
                method: 'PUT', headers: JSON_HEADER, body: JSON.stringify({ turnierId, kampf1Id, kampf2Id })
            });
            return r.ok ? { ok: true } : { ok: false, fehler: r.fehler || 'Tausch fehlgeschlagen.' };
        }
        const a = await db.get(`kampf:${kampf1Id}`);
        const b = await db.get(`kampf:${kampf2Id}`);
        if (a.status !== 'bereit' || b.status !== 'bereit') {
            return { ok: false, fehler: 'Es können nur noch nicht gestartete Kämpfe (Status "bereit") getauscht werden.' };
        }
        const ra = a.matten_reihenfolge;
        a.matten_reihenfolge = b.matten_reihenfolge;
        b.matten_reihenfolge = ra;
        a.bearbeitet_von = 'browser';
        b.bearbeitet_von = 'browser';
        const [resA, resB] = await db.bulkDocs([a, b]);
        if (resA.error || resB.error) return { ok: false, fehler: 'Tausch fehlgeschlagen, bitte erneut versuchen.' };
        const e1 = await warteAufServer(a._id, resA.rev);
        const e2 = await warteAufServer(b._id, resB.rev);
        if (!e1.ok) return ohneDoc(e1);
        return ohneDoc(e2);
    }

    async function setzeLiveFarbe(kampfId, farbe) {
        await init();
        if (modus === 'rest') {
            const r = await restJson(`/api/kaempfe/${kampfId}/color`, { method: 'PUT', headers: JSON_HEADER, body: JSON.stringify({ color: farbe }) });
            return r.ok ? { ok: true } : { ok: false, fehler: r.fehler };
        }
        const doc = await db.get(`kampf:${kampfId}`);
        doc.live_farbe = farbe;
        doc.bearbeitet_von = 'browser';
        await db.put(doc);
        return { ok: true };
    }

    async function pausiereMatte(matId) {
        await init();
        if (modus === 'rest') {
            const r = await restJson(`/api/kampfflaechen/${matId}/pausieren`, { method: 'POST' });
            return r.ok ? { ok: true, meldung: r.daten.message } : { ok: false, fehler: r.fehler || 'Matte konnte nicht pausiert werden.' };
        }
        const ergebnis = ohneDoc(await aendereDokument(`kampfflaeche:${matId}`, { status: 'pausiert' }));
        return ergebnis.ok ? { ...ergebnis, meldung: ergebnis.meldung || 'Matte pausiert.' } : ergebnis;
    }

    async function werteForfeit(teilnehmerId, kampfId, aktion) {
        await init();
        if (modus === 'rest') {
            const r = await restJson(`/api/teilnehmer/${teilnehmerId}/${aktion}`, {
                method: 'POST', headers: JSON_HEADER, body: JSON.stringify({ kampf_id: kampfId })
            });
            return r.ok ? { ok: true } : { ok: false, fehler: r.fehler || 'Aktion fehlgeschlagen.' };
        }
        return ohneDoc(await aendereDokument(`kampf:${kampfId}`, {
            forfeit_teilnehmer_id: Number(teilnehmerId),
            forfeit_art: aktion === 'disqualifizieren' ? 'disqualifiziert' : 'nicht_angetreten'
        }));
    }

    async function speichereTeilnehmer(id, payload) {
        await init();
        if (modus === 'rest') {
            const r = await restJson(id ? `/api/teilnehmer/${id}` : '/api/teilnehmer', {
                method: id ? 'PUT' : 'POST', headers: JSON_HEADER, body: JSON.stringify(payload)
            });
            return r.ok ? { ok: true, teilnehmerId: id || r.daten.teilnehmerId } : { ok: false, fehler: r.fehler || 'Fehler beim Speichern' };
        }
        const jetzt = new Date().toISOString();
        if (id) {
            const doc = await teilnehmerDokumentZuId(id);
            if (!doc) return { ok: false, fehler: 'Teilnehmer nicht gefunden.' };
            const ergebnis = await aendereDokument(doc._id, { ...payload, ...(payload.gewogen ? { gewogen_am: jetzt } : {}) });
            return { ...ohneDoc(ergebnis), teilnehmerId: Number(id) };
        }
        const neu = {
            _id: `teilnehmer:u-${crypto.randomUUID()}`, typ: 'teilnehmer', sql_id: null, bearbeitet_von: 'browser',
            ...payload, turnier_id: parseInt(payload.turnier_id, 10), ...(payload.gewogen ? { gewogen_am: jetzt } : {})
        };
        const { rev } = await db.put(neu);
        const ergebnis = await warteAufServer(neu._id, rev);
        return { ...ohneDoc(ergebnis), teilnehmerId: ergebnis.doc ? ergebnis.doc.sql_id : null };
    }

    async function bestaetigeKampfbereit(teilnehmerId) {
        await init();
        if (modus === 'rest') {
            const r = await restJson(`/api/teilnehmer/${teilnehmerId}/kampfbereit`, { method: 'POST' });
            return r.ok ? { ok: true } : { ok: false, fehler: r.fehler || 'Fehler bei der Bestätigung.' };
        }
        const doc = await teilnehmerDokumentZuId(teilnehmerId);
        if (!doc) return { ok: false, fehler: 'Teilnehmer nicht gefunden.' };
        return ohneDoc(await aendereDokument(doc._id, { status: 'kampfbereit' }));
    }

    window.Datenzugriff = {
        init,
        modus: () => modus,
        ladeKampfflaechen,
        ladeKaempfeDerMatte,
        aktualisiereKampf,
        tauscheReihenfolge,
        setzeLiveFarbe,
        pausiereMatte,
        werteForfeit,
        speichereTeilnehmer,
        bestaetigeKampfbereit
    };
})();
```

- [ ] **Step 5: Tests laufen lassen**

Run: `npm run test:e2e:sync` → Expected: PASS. Scheitert der Test „abgelehnte Aktion“ am Meldungstext, die Meldung aus `aktualisiereKampf` nachsehen (`'Ein bereits beendeter Kampf kann nicht erneut gestartet werden.'`) und `toContain` auf einen eindeutigen Teil davon anpassen.

- [ ] **Step 6: Commit**

```bash
git add public/js/datenzugriff.js src/app.js tests/e2e-sync/sync-datenzugriff.spec.js
git commit -m "feat(sync): Frontend-Datenzugriff mit REST- und Dokument-Backend"
```

---

### Task 10: Waage auf `Datenzugriff` umstellen

**Files:**
- Modify: `public/teilnehmer.html` (Skripte), `public/js/waage-modal.js` (Speichern ca. Z. 895–930, Kampfbereit ca. Z. 740–760)
- Create: `tests/e2e-sync/sync-waage.spec.js`

**Interfaces:**
- Consumes: `Datenzugriff.speichereTeilnehmer`, `Datenzugriff.bestaetigeKampfbereit` (Task 9)

- [ ] **Step 1: Fehlschlagenden Test schreiben** – `tests/e2e-sync/sync-waage.spec.js`

```js
import { test, expect } from '@playwright/test';
import { warteLeerlauf, richteDk8TurnierEin, syncStatus, ladeDokument } from './helpers.js';

test('Waage im Sync-Modus: Gewicht ändern läuft über die Dokument-DB in die relationale DB', async ({ page, request }) => {
    const { turnierId, teilnehmerIds } = await richteDk8TurnierEin(request, 'Sync Waage');
    await warteLeerlauf(request);
    const { db_name } = await syncStatus(request);

    await page.goto(`/teilnehmer.html?turnierId=${turnierId}`);
    await page.evaluate((id) => window.oeffneWaageModal(id), teilnehmerIds[0]);
    await expect(page.locator('#vorname')).toHaveValue('Anna');
    await page.locator('#gewicht').fill('59,40');
    await page.locator('#submitBtn').click();
    const ja = page.getByRole('button', { name: 'Ja' });
    if (await ja.isVisible().catch(() => false)) await ja.click();

    await expect.poll(async () => {
        const t = await (await request.get(`/api/teilnehmer/${teilnehmerIds[0]}`)).json();
        return parseFloat((t.teilnehmer || t).gewicht);
    }).toBe(59.4);
    const doc = await ladeDokument(request, db_name, `teilnehmer:${teilnehmerIds[0]}`);
    expect(doc.bearbeitet_von).toBe('server');
});
```

`getTeilnehmerById` (`teilnehmerController.js:322`) auf die Antwortform prüfen und `(t.teilnehmer || t)` passend vereinfachen.

Zusätzlich als Nachweis des Dokument-Wegs vor dem Klick die Revision merken (`const revVorher = (await ladeDokument(request, db_name, `teilnehmer:${teilnehmerIds[0]}`))._rev`) und am Ende `expect(parseInt(doc._rev, 10)).toBeGreaterThan(parseInt(revVorher, 10) + 1)` prüfen (Browser-Änderung + Server-Bestätigung). Über REST entsteht nur eine neue Revision durch den Abgleich.

- [ ] **Step 2: Test gegen alten Code laufen lassen**

Run: `npx playwright test --config=playwright.sync.config.js tests/e2e-sync/sync-waage.spec.js`
Expected: FAIL nur an der Revisions-Prüfung (REST-Weg); die fachliche Prüfung des Gewichts besteht bereits.

- [ ] **Step 3: Skripte einbinden**

In `public/teilnehmer.html` vor `<script src="/js/teilnehmer.js"></script>`:

```html
<script src="/js/pouchdb/pouchdb.min.js"></script>
<script src="/js/datenzugriff.js"></script>
```

- [ ] **Step 4: Speichern umstellen** – `public/js/waage-modal.js`

Den Block von `try {` bis zum zugehörigen `} catch (error) {` um `fetch(zielUrl, ...)` ersetzen durch:

```js
            try {
                // Datenzugriff wählt selbst REST (ohne Sync) oder die Dokument-DB (Hallen-Server mit
                // Sync, später auch offline am Client) — die Bedienung der Waage ist identisch.
                const result = await window.Datenzugriff.speichereTeilnehmer(effektiveId || null, payload);

                if (result.ok) {
                    const gespeicherteId = effektiveId || result.teilnehmerId;
```

Den restlichen Erfolgszweig bis zum `} else {` unverändert lassen. Den `else`-Zweig ersetzen durch:

```js
                } else {
                    window.zeigeNotification(result.fehler || 'Fehler beim Speichern', 'error');
                }
```

Nach der Erfolgs-Notification ergänzen:

```js
                    if (result.ausstehend) window.zeigeNotification(result.meldung, 'info');
```

Die Variablen `zielUrl` und `methode` werden danach nicht mehr gebraucht und fallen weg.

- [ ] **Step 5: Kampfbereit umstellen** – `public/js/waage-modal.js`

Im Click-Handler von `kampfbereitBtn` die zwei Zeilen

```js
                const response = await fetch(`/api/teilnehmer/${teilnehmerId}/kampfbereit`, { method: 'POST' });
                const result = await response.json();
                if (result.success) {
```

ersetzen durch:

```js
                const result = await window.Datenzugriff.bestaetigeKampfbereit(teilnehmerId);
                if (result.ok) {
```

Außerdem `result.error` durch `result.fehler` ersetzen.

- [ ] **Step 6: Tests laufen lassen**

Run: `npm run test:e2e:sync` → Expected: PASS. Im Server-Log (`stdout: 'pipe'`) dürfen keine `PUT /api/teilnehmer`-Fehler auftauchen.
Run: `npm run test:e2e` → Expected: PASS (REST-Backend)

- [ ] **Step 7: Commit**

```bash
git add public/teilnehmer.html public/js/waage-modal.js tests/e2e-sync/sync-waage.spec.js
git commit -m "feat(sync): Waage speichert über Datenzugriff (REST oder Dokument-DB)"
```

---

### Task 11: Scoreboard und Mattenleitung auf `Datenzugriff` umstellen

**Files:**
- Modify: `public/steuerung.html`, `public/kampf.html` (Skripte), `public/js/scoreboard.js`, `public/js/kampf.js`
- Create: `tests/e2e-sync/sync-scoreboard.spec.js`

**Interfaces:**
- Consumes: `Datenzugriff.*` (Task 9)
- Die Offline-Zweige (`isOfflineMode && offlineState`) in `scoreboard.js` und der JSON-Export/-Import in `kampf.js` bleiben **unverändert**. Sie werden in Plan B entfernt.

- [ ] **Step 1: Fehlschlagenden Test schreiben** – `tests/e2e-sync/sync-scoreboard.spec.js`

```js
import { test, expect } from '@playwright/test';
import { warteLeerlauf, richteDk8TurnierEin, syncStatus, alleDokumente } from './helpers.js';

// Spielt alle 11 Kämpfe über steuerung.html — identische Bedienfolge wie
// tests/e2e/steuerung-dk8-online-vs-offline.spec.js (W gewinnt jeden Kampf per Ippon).
async function spieleKomplettDurch(page, anzahl) {
    let vorher = 'Kämpfer 1|Kämpfer 2';
    for (let i = 0; i < anzahl; i++) {
        await page.locator('#btnNaechsterKampfLive').click();
        await page.waitForFunction(
            (v) => `${document.getElementById('nameW').value}|${document.getElementById('nameB').value}` !== v, vorher
        );
        vorher = await page.evaluate(() => `${document.getElementById('nameW').value}|${document.getElementById('nameB').value}`);
        await page.evaluate(() => window.changeScore('W', 'ippon', 1));
        await expect(page.locator('#btnErgebnisSendenLive')).toBeVisible();
        await page.locator('#btnErgebnisSendenLive').click();
        await expect(page.locator('#btnNaechsterKampfLive')).toBeVisible();
    }
}

test('Scoreboard im Sync-Modus: kompletter DK8-Pool, Ergebnis wie online', async ({ page, request }) => {
    const { turnierId, matId } = await richteDk8TurnierEin(request, 'Sync Scoreboard');
    await warteLeerlauf(request);

    await page.goto(`/steuerung.html?turnierId=${turnierId}&matId=${matId}`);
    await expect(page.locator('#matSelect')).toHaveValue(String(matId));
    await spieleKomplettDurch(page, 11);
    await warteLeerlauf(request);

    const kaempfe = await (await request.get(`/api/kaempfe?kampfflaecheId=${matId}`)).json();
    expect(kaempfe).toHaveLength(11);
    expect(kaempfe.every(k => k.status === 'beendet')).toBe(true);
    const finale = kaempfe.find(k => k.reihenfolge_nummer === 'F');
    expect(finale.sieger_id).toBe(finale.kaempfer1_id);
    expect(finale.kaempfer1_nachname).toBe('Adler');

    // Nachweis, dass die Ergebnisse über die Dokument-DB kamen: jedes Kampf-Dokument hat eine
    // Revision > 2 (Anlage durch Abgleich + mindestens eine Browser-Änderung + Server-Bestätigung).
    const { db_name } = await syncStatus(request);
    const docs = (await alleDokumente(request, db_name)).filter(d => d.typ === 'kampf');
    expect(docs.every(d => parseInt(d._rev, 10) > 2)).toBe(true);
});
```

- [ ] **Step 2: Gegen den alten Code laufen lassen**

Run: `npx playwright test --config=playwright.sync.config.js tests/e2e-sync/sync-scoreboard.spec.js`
Expected: FAIL beim `_rev`-Nachweis (die Ergebnisse kamen per REST, die Revisionen stammen nur aus Abgleichen). Die fachlichen Assertions sollten bereits bestehen.

- [ ] **Step 3: Skripte einbinden**

In `public/steuerung.html` vor `<script type="module" src="js/scoreboard.js"></script>`, und in `public/kampf.html` vor `<script src="/js/kampf.js"></script>`:

```html
<script src="/js/pouchdb/pouchdb.min.js"></script>
<script src="/js/datenzugriff.js"></script>
```

- [ ] **Step 4: `scoreboard.js` umstellen**

Nur die Nicht-Offline-Zweige ändern. Jede Ersetzung einzeln:

1. **Live-Farbe** (ca. Z. 238): `fetch(\`/api/kaempfe/${currentFightId}/color\`, { ...body: JSON.stringify({ color: ... }) })` ersetzen durch `window.Datenzugriff.setzeLiveFarbe(currentFightId, <derselbe Farbwert>)`. Ein vorhandenes `.catch(...)` bleibt.
2. **Kampfflächen laden** (ca. Z. 1507): die Zeilen

   ```js
           const response = await fetch(`/api/kampfflaechen?turnierId=${turnierId}`);
           if (!response.ok) throw new Error('Fehler beim Laden der Kampfflächen für das Turnier.');
           const matten = await response.json();
   ```

   ersetzen durch

   ```js
           const matten = await window.Datenzugriff.ladeKampfflaechen(turnierId);
   ```

3. **Kämpfe laden** (ca. Z. 1570, 1835 und 1889, jeweils im `else`- bzw. Nicht-Offline-Zweig): jedes

   ```js
               const response = await fetch(`/api/kaempfe?kampfflaecheId=${selectedMatId}`);
               if (!response.ok) throw new Error('Fehler beim Laden der Kämpfe.');
               const kaempfe = await response.json();
   ```

   (Variablennamen je Stelle übernehmen) ersetzen durch

   ```js
               const kaempfe = await window.Datenzugriff.ladeKaempfeDerMatte(selectedMatId);
   ```

4. **Kampf starten** (ca. Z. 1657): `await fetch(\`/api/kaempfe/${naechster.id}\`, { method: 'PUT', ... JSON.stringify({ status: 'gestartet' }) });` ersetzen durch

   ```js
                   const start = await window.Datenzugriff.aktualisiereKampf(naechster.id, { status: 'gestartet' });
                   if (!start.ok) throw new Error(start.fehler);
   ```

5. **Ergebnis senden** (ca. Z. 1802): den `fetch`-Block samt `if (!response.ok) throw ...` ersetzen durch

   ```js
               const ergebnis = await window.Datenzugriff.aktualisiereKampf(currentFightId, payload);
               if (!ergebnis.ok) throw new Error(ergebnis.fehler || 'Fehler beim Aktualisieren des Kampfes auf dem Server.');
               zeigeNotification(ergebnis.ausstehend ? ergebnis.meldung : "Kampfergebnis erfolgreich übermittelt und gespeichert!", ergebnis.ausstehend ? "info" : "success");
   ```

   Die alte `zeigeNotification(...)`-Zeile direkt danach entfällt.

6. **Reihenfolge tauschen** (ca. Z. 1962): den `fetch`-Block samt Fehlerbehandlung ersetzen durch

   ```js
               const tausch = await window.Datenzugriff.tauscheReihenfolge(pausenWarnungKampf.id, pausenWarnungDanach.id, localStorage.getItem('aktiveTurnierId'));
               if (!tausch.ok) throw new Error(tausch.fehler || 'Tausch fehlgeschlagen.');
   ```

   Die Zeile `const turnierId = localStorage.getItem('aktiveTurnierId');` entfällt, wenn sie danach ungenutzt ist.

7. **Korrektur** (ca. Z. 2149): den `fetch`-Block samt Fehlerbehandlung ersetzen durch

   ```js
               const korrektur = await window.Datenzugriff.aktualisiereKampf(kampfId, payload);
               if (!korrektur.ok) throw new Error(korrektur.fehler || 'Korrektur fehlgeschlagen.');
   ```

Danach mit `grep -n "fetch(" public/js/scoreboard.js` prüfen, dass nur noch diese Aufrufe übrig sind: `/api/auth/*`, `/api/turniere` (Turnierauswahl) und die Offline-Zweige. Alle anderen `fetch`-Aufrufe auf `/api/kaempfe` oder `/api/kampfflaechen` müssen ersetzt sein.

- [ ] **Step 5: `kampf.js` umstellen**

1. `ladeMatten` (ca. Z. 77):

   ```js
               const response = await fetch(`/api/kampfflaechen?turnierId=${turnierId}`);
               const mats = await response.json();

               if (!response.ok) throw new Error(mats.error || 'Fehler beim Laden der Kampfflächen.');
   ```

   ersetzen durch `const mats = await window.Datenzugriff.ladeKampfflaechen(turnierId);`

2. `ladeKämpfe` (ca. Z. 113):

   ```js
               const response = await fetch(`/api/kaempfe?kampfflaecheId=${matId}`);
               allFights = await response.json();

               if (!response.ok) throw new Error(allFights.error || 'Fehler beim Laden der Kämpfe.');
   ```

   ersetzen durch `allFights = await window.Datenzugriff.ladeKaempfeDerMatte(matId);`

3. Pausieren (ca. Z. 348): der `try`-Block wird zu

   ```js
               try {
                   const result = await window.Datenzugriff.pausiereMatte(matId);
                   if (!result.ok) throw new Error(result.fehler || 'Matte konnte nicht pausiert werden.');
                   zeigeNotification(result.meldung || 'Matte pausiert.', 'success');
               } catch (err) {
   ```

4. Forfeit (ca. Z. 403): der `try`-Block wird zu

   ```js
           try {
               const result = await window.Datenzugriff.werteForfeit(teilnehmerId, kampfId, aktion);
               if (!result.ok) throw new Error(result.fehler || 'Aktion fehlgeschlagen.');
               zeigeNotification('Forfeit gewertet.', 'success');
               ladeKämpfe(mattenSelect.value);
           } catch (err) {
   ```

5. `startKampf` (ca. Z. 422): den `fetch`-Block samt `if (!response.ok) {...}` ersetzen durch

   ```js
               const start = await window.Datenzugriff.aktualisiereKampf(kampf.id, { status: 'gestartet' });
               if (!start.ok) throw new Error(start.fehler || 'Fehler beim Starten des Kampfes.');
   ```

6. Ergebnis-Formular (ca. Z. 513): den `fetch`-Block samt `if (!response.ok) {...}` ersetzen durch

   ```js
               const ergebnis = await window.Datenzugriff.aktualisiereKampf(id, {
                   status: 'beendet', sieger_id, unterbewertung_kaempfer1, unterbewertung_kaempfer2, kampfzeit_in_sekunden
               });
               if (!ergebnis.ok) throw new Error(ergebnis.fehler || 'Fehler beim Speichern des Ergebnisses.');
   ```

Die Aufrufe von `ersatz-optionen`, `auswechseln` und `/api/offline/*` bleiben unverändert.

- [ ] **Step 6: Tests laufen lassen**

Run: `npm run test:e2e:sync` → Expected: PASS (inkl. `_rev`-Nachweis)
Run: `npm run test:e2e` → Expected: PASS (die Online-vs-Offline-Specs nutzen das REST-Backend)

- [ ] **Step 7: Commit**

```bash
git add public/steuerung.html public/kampf.html public/js/scoreboard.js public/js/kampf.js tests/e2e-sync/sync-scoreboard.spec.js
git commit -m "feat(sync): Scoreboard und Mattenleitung über Datenzugriff"
```

---

### Task 12: Bestätigungsdialog beim Turnier-Anlegen, Doku, Spec-Nachträge

**Files:**
- Modify: `public/js/turnier.js` (Speichern ca. Z. 632), `CLAUDE.md`, `docs/superpowers/specs/2026-09-25-couchdb-umbau-design.md`

**Interfaces:**
- Consumes: `/api/sync/status` (Task 5)

- [ ] **Step 1: Dialog in `turnier.js`**

Direkt vor `const url = turnierId ? ...` einfügen:

```js
            // Hallen-Server mit Sync trägt genau ein Turnier: eine Neuanlage löscht das bisherige
            // komplett (siehe Spec CouchDB-Umbau Abschnitt 8) — vorher ausdrücklich nachfragen.
            if (!turnierId) {
                const syncStatus = await fetch('/api/sync/status').then(r => r.json()).catch(() => ({}));
                if (syncStatus.rolle === 'server' && syncStatus.instanz_id) {
                    const bestaetigt = window.zeigeZentraleBestaetigung
                        ? await window.zeigeZentraleBestaetigung(
                            'Auf diesem Hallen-Server wird immer nur ein Turnier ausgetragen. Das Anlegen löscht alle Daten des bisherigen Turniers (Teilnehmer, Pools, Kämpfe). Fortfahren?',
                            'Neues Turnier anlegen',
                            'warning'
                        )
                        : confirm('Alle Daten des bisherigen Turniers auf diesem Server werden gelöscht. Fortfahren?');
                    if (!bestaetigt) return;
                }
            }
```

- [ ] **Step 2: Manuell prüfen**

Den Server lokal mit `SYNC_ROLLE=server IS_OFFLINE=true` starten (Browser-Vorschau über `.claude/launch.json`), ein Turnier anlegen, ein zweites anlegen: Der Dialog erscheint. Nach „Abbrechen“ bleibt das erste Turnier erhalten.

- [ ] **Step 3: `CLAUDE.md` ergänzen**

Unter „Commands“ nach dem E2E-Block:

```markdown
- **Unit-Tests (reine Module):** `npm run test:unit` — `node:test` für `src/shared/`- und Sync-Hilfsmodule (`tests/unit/`)
- **Sync-Suite:** `npm run test:e2e:sync` — Hallen-Server mit `SYNC_ROLLE=server` (Port 3200, `data/test-sync.sqlite`, Dokument-DB unter `data/test-sync-dokumente/`); `POST /api/sync/test/leerlauf` wartet in Tests, bis Brücke und Abgleich fertig sind
```

Unter „Zentrale Architekturkonzepte“ ergänzen:

```markdown
- **Sync-Schicht (CouchDB-Umbau, `src/sync/`):** mit `SYNC_ROLLE=server` betreibt der Hallen-Server eine eingebettete Dokument-DB (PouchDB/LevelDB, `express-pouchdb` unter `/db`, eine DB `turnier_<instanz_id>` für das einzige Turnier). `abgleich.js` spiegelt die Live-Tabellen nach jedem Schreibzugriff als Dokumente (`bearbeitet_von: 'server'`), `bruecke.js` wendet Dokument-Änderungen von Waage/Scoreboard/Mattenleitung über die Service-Funktionen der Controller an (`aktualisiereKampf`, `werteForfeit`, `legeTeilnehmerAn`, …) und meldet Ablehnungen per `letzte_ablehnung` + `konflikt:`-Dokument zurück. Das Frontend spricht über `public/js/datenzugriff.js` (REST ohne Sync, Dokument-DB mit Sync). Die relationale DB bleibt führend. Design: `docs/superpowers/specs/2026-09-25-couchdb-umbau-design.md`
```

Unter „Commands“ bei „DB-Umschaltung“ ergänzen: „Im Hallenbetrieb wählt `DB_CLIENT=pg` PostgreSQL statt SQLite (Pflicht im Server-Cluster).“

- [ ] **Step 4: Spec-Nachträge**

In der Spec die Punkte aus „Abweichungen zur Spec“ (Kopf dieses Plans) in die jeweiligen Abschnitte einarbeiten:
- Abschnitt 5: `spiegeln.js` → `abgleich.js` samt Beschreibung. Die Service-Funktionen bleiben in den Controller-Dateien.
- Abschnitt 6: `matte_reihenfolge` → `matten_reihenfolge`; die Nur-Dokument-Felder `live_farbe`, `forfeit_teilnehmer_id`/`forfeit_art`, `letzte_ablehnung` und `dublette_von` ergänzen; die Spalte `turnier_teilnehmer.dokument_id` ergänzen.
- Abschnitt 7: „Turnierleitung“ auf die Abgleich-Middleware umschreiben; „Idempotenz“ auf den Feld-Vergleich umschreiben (`sync_angewendet` nicht in derselben Transaktion).

- [ ] **Step 5: Alle Suites**

Run: `npm run test:unit && npm run test:e2e && npm run test:e2e:sync` → Expected: alle PASS

- [ ] **Step 6: Commit**

```bash
git add public/js/turnier.js CLAUDE.md docs/superpowers/specs/2026-09-25-couchdb-umbau-design.md
git commit -m "docs(sync): Bestätigung beim Turnierwechsel, CLAUDE.md und Spec-Nachträge zu Plan A"
```

---

## Nicht Teil von Plan A (→ Plan B / C)

- Client-Modus (`SYNC_ROLLE=client`), Replikation, `SYNC_SECRET`, Offline-Kaskade `kaskadeLokal`, Mattenwahl, Heartbeat, eingeschränktes Frontend, Sync-Statusleiste, Instanzwechsel am Client, Auflösung von `_conflicts` (Wiegungen) und Status `klaerung`, Konfliktliste in der Oberfläche, Entfernen des alten JSON-Offline-Mechanismus → **Plan B**
- Cluster, `DB_CLIENT=pg` mit Streaming-Replikation, keepalived → **Plan C**
