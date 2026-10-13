# Teilnehmer-App Phase 2b (Pools, Turnier-Dashboard, Turnierbaum, Optik der Turnier-App) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die PWA „Hajime Live“ bekommt Reiterleiste unten (Suche, Pools, Turnier, Übersicht), Vereine und Klassen direkt auf dem Startbildschirm, die Pool-Ansicht mit Turnierbaum und Kampfliste, das Handy-Dashboard der Matten und die Optik der Turnier-App; dafür liefert der Live-Prozess zusätzlich Pools und alle Kämpfe an die Cloud.

**Architecture:** Der Snapshot (Phase 1) bekommt die Felder `pools` und `kaempfe`, die Cloud speichert sie in `live_pools`/`live_kaempfe` und löst Kämpfernamen beim Abruf aus `live_teilnehmer` auf. Neue Endpunkte liefern Klassen, Pool-Liste, Pool mit Kämpfen und das Dashboard. Die PWA wird in Ansichtsmodule zerlegt (`ansicht-*.js`) hinter einem Hash-Router; Logik ohne DOM (Baum-Modell, Übersicht-Gruppierung, Anzeigetexte) liegt in reinen Modulen und wird in Node getestet.

**Tech Stack:** Node.js (ESM), Express 5, Knex/PostgreSQL, `node:test`, Playwright, Vanilla-JS-PWA, Material Icons und Schriften aus `public/` (lokal).

**Spec:** `docs/specs/2026-10-13-teilnehmer-app-phase2b-design.md` (ergänzt `docs/specs/2026-10-12-teilnehmer-app-design.md`)

## Global Constraints

- Antworten, Kommentare und Commit-Texte auf Deutsch; Commits enden mit `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Keine neuen personenbezogenen Felder; Snapshot-Felder `pools`/`kaempfe` sind beim Empfang optional (ältere Hallen funktionieren weiter).
- Mannschafts-Pools und der Sammelpool „Verspätet“ erscheinen nicht in `pools`/`kaempfe`; Einzelkämpfe mit `mannschaftskampf_id` ebenfalls nicht.
- Alle Namen in der PWA ausschließlich über `textContent`/`createTextNode` (nie `innerHTML`).
- Optik: Tokens aus `docs/specs/2026-10-13-teilnehmer-app-phase2b-design.md` Abschnitt 3; Schriften über `/css/schriften.css`, Icons über `/icons/material/material-icons.woff2`.
- Kontrast: Text ≥ 4,5 : 1, Symbole/Rahmen ≥ 3 : 1, Hell und Dunkel; ein Unit-Test prüft die Farbpaare in `teilnehmer-app/css/app.css`.
- Kämpfer 2 trägt `farbe2` (Blau oder Rot), Kämpfer 1 Weiß; Namensformat überall „Vorname Nachname“.
- Reiterleiste unten: Suche, Pools, Turnier, Übersicht; Hash-Routen siehe Task 4.
- `.claude/launch.json` (lokale Änderung des Nutzers) wird nicht committed.

## Review Focus

1. Ältere Halle ohne `pools`/`kaempfe` im Snapshot: Pools, Turnier und Baum zeigen einen Hinweis, nichts bricht (Task 2, 3, 6).
2. Baum mit Freilos, offenem Vorkampf und unbekannten Kämpfern („offen“, „Freilos“) (Task 6).
3. Zusatzkampf (zweiter Kampf derselben Paarung) im Kampfbogen (Task 6).
4. Link auf einen Kampf oder Pool, den es nicht (mehr) gibt: keine Fehlerseite, Hinweis „nicht gefunden“ (Task 6, 7).
5. Kontrast und Dunkelmodus der Primär-, Stern- und Statusfarben (Task 4); Matte ohne laufenden Kampf zeigt „Pause“ (Task 7).

---

### Task 1: Snapshot um Pools und Kämpfe erweitern

**Files:**
- Create: `migrations/20261013100000_live_views_farbe.js`
- Modify: `src/live/snapshot.js`
- Test: `tests/unit/liveSnapshot.test.js` (ergänzen), `tests/unit/liveViews.test.js` (ergänzen)

**Interfaces:**
- Produces: Snapshot-Felder `pools: [{ id, bezeichnung, modus, status, matteId, altersklasse, geschlecht, gewichtsklasse, farbe2 }]`, `kaempfe: [{ id, poolId, nr, status, reihenfolge, k1, k2, sieger, p1, p2 }]`; Views `live.turniere`/`live.pools` mit Spalte `farbe_kaempfer2`.

- [ ] **Step 1: Failing tests schreiben**

An `tests/unit/liveSnapshot.test.js` anhängen (Helfer `turnier`, `matten`, `pool`, `teil`, `kampf` stehen oben in der Datei):

```js
test('baueSnapshot: pools und kaempfe für die App (Baum, Kampfliste, Dashboard)', () => {
    const roh = {
        turnier: { ...turnier, farbe_kaempfer2: 'rot' },
        kampfflaechen: matten,
        pools: [pool(), pool({ id: 11, typ: 'mannschaft', bezeichnung: 'Team' }), pool({ id: 12, verspaetet: true, bezeichnung: 'Verspätet' }),
            pool({ id: 13, bezeichnung: 'U15 m -50', farbe_kaempfer2: 'blau', modus: 'Doppel-KO-8' })],
        teilnehmer: [teil(1), teil(2)],
        kaempfe: [
            kampf(1, 1, 2, { reihenfolge_nummer: 'R1' }),
            kampf(2, 1, 2, { mannschaftskampf_id: 5 }),
            kampf(3, 1, 2, { pool_id: 11 }),
            kampf(4, 1, null, { status: 'freilos', pool_id: 13, reihenfolge_nummer: 'H1', sieger_id: 1, unterbewertung_kaempfer1: 7 })
        ]
    };
    const s = baueSnapshot(roh, { geheimnis: 'g' });
    assert.deepEqual(s.pools.map(p => p.id), [10, 13]);
    assert.deepEqual(s.pools[0], {
        id: 10, bezeichnung: 'U15 w -44', modus: 'Jeder-gegen-Jeden', status: 'matte_zugewiesen', matteId: 1,
        altersklasse: 'U15', geschlecht: 'w', gewichtsklasse: '-44', farbe2: 'rot'
    });
    assert.equal(s.pools[1].farbe2, 'blau');
    assert.deepEqual(s.kaempfe.map(k => k.id), [1, 4]);
    const t1 = s.teilnehmer.find(t => t.vorname === 'V1').key;
    const t2 = s.teilnehmer.find(t => t.vorname === 'V2').key;
    assert.deepEqual(s.kaempfe[0], { id: 1, poolId: 10, nr: 'R1', status: 'bereit', reihenfolge: 1, k1: t1, k2: t2, sieger: null, p1: 0, p2: 0 });
    assert.deepEqual(s.kaempfe[1], { id: 4, poolId: 13, nr: 'H1', status: 'freilos', reihenfolge: 4, k1: t1, k2: null, sieger: t1, p1: 7, p2: 0 });
});

test('baueSnapshot: ohne Turnierfarbe gilt blau', () => {
    const s = baueSnapshot({ turnier, kampfflaechen: matten, pools: [pool()], teilnehmer: [teil(1)], kaempfe: [] }, { geheimnis: 'g' });
    assert.equal(s.pools[0].farbe2, 'blau');
});
```

In `tests/unit/liveViews.test.js` die vorhandene Datei lesen und nach dem dortigen Muster eine Prüfung ergänzen, dass `live.turniere` und `live.pools` die Spalte `farbe_kaempfer2` liefern (Abfrage über die Rolle `live_ro`, wie die übrigen Tests der Datei).

- [ ] **Step 2: Fehlschlag prüfen**

Run: `node --test tests/unit/liveSnapshot.test.js tests/unit/liveViews.test.js`
Expected: FAIL (`s.pools` ist `undefined`, Spalte fehlt).

- [ ] **Step 3: Migration schreiben**

`migrations/20261013100000_live_views_farbe.js`:

```js
// Teilnehmer-App Phase 2b: die Views liefern zusätzlich die Farbe von Kämpfer 2 (Turnier und Pool), damit das Dashboard der
// App Blau/Rot wie die Halle zeigt. Neue Spalten stehen am Ende (CREATE OR REPLACE VIEW verlangt die alte Reihenfolge).
export async function up(knex) {
    await knex.raw(`CREATE OR REPLACE VIEW live.turniere AS
        SELECT id, urspruengliche_id, bezeichnung, datum, status, live_freigabe, farbe_kaempfer2
        FROM public.turniere`);
    await knex.raw(`CREATE OR REPLACE VIEW live.pools AS
        SELECT id, turnier_id, kampfflaeche_id, bezeichnung, modus, typ, status, verspaetet,
               altersklasse, geschlecht, gewichtsklasse, matte_reihenfolge, farbe_kaempfer2
        FROM public.pools`);
}

export async function down(knex) {
    await knex.raw(`DROP VIEW IF EXISTS live.pools`);
    await knex.raw(`CREATE VIEW live.pools AS
        SELECT id, turnier_id, kampfflaeche_id, bezeichnung, modus, typ, status, verspaetet,
               altersklasse, geschlecht, gewichtsklasse, matte_reihenfolge
        FROM public.pools`);
    await knex.raw(`DROP VIEW IF EXISTS live.turniere`);
    await knex.raw(`CREATE VIEW live.turniere AS
        SELECT id, urspruengliche_id, bezeichnung, datum, status, live_freigabe
        FROM public.turniere`);
}
```

- [ ] **Step 4: `baueSnapshot` erweitern**

In `src/live/snapshot.js` vor dem `return` von `baueSnapshot` einfügen:

```js
    const einzelPools = pools.filter(p => p.typ !== 'mannschaft' && !p.verspaetet).sort((a, b) => a.id - b.id);
    const poolIdsAusgabe = new Set(einzelPools.map(p => p.id));
    const poolsAusgabe = einzelPools.map(p => ({
        id: p.id, bezeichnung: p.bezeichnung, modus: p.modus, status: p.status,
        matteId: p.kampfflaeche_id != null ? p.kampfflaeche_id : null,
        altersklasse: p.altersklasse, geschlecht: p.geschlecht, gewichtsklasse: p.gewichtsklasse,
        farbe2: p.farbe_kaempfer2 || turnier.farbe_kaempfer2 || 'blau'
    }));
    const kaempfeAusgabe = kaempfe
        .filter(k => !k.mannschaftskampf_id && poolIdsAusgabe.has(k.pool_id))
        .sort((a, b) => a.id - b.id)
        .map(k => ({
            id: k.id, poolId: k.pool_id, nr: k.reihenfolge_nummer == null ? '' : String(k.reihenfolge_nummer), status: k.status,
            reihenfolge: k.matten_reihenfolge == null ? null : Number(k.matten_reihenfolge),
            k1: keyVonId.get(k.kaempfer1_id) ?? null, k2: keyVonId.get(k.kaempfer2_id) ?? null,
            sieger: keyVonId.get(k.sieger_id) ?? null,
            p1: Number(k.unterbewertung_kaempfer1) || 0, p2: Number(k.unterbewertung_kaempfer2) || 0
        }));
```

und im zurückgegebenen Objekt nach `warteschlangen` ergänzen: `pools: poolsAusgabe, kaempfe: kaempfeAusgabe`.

- [ ] **Step 5: Tests laufen lassen**

Run: `node --test tests/unit/liveSnapshot.test.js tests/unit/liveViews.test.js tests/unit/liveEndeZuEnde.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add migrations/20261013100000_live_views_farbe.js src/live/snapshot.js tests/unit/liveSnapshot.test.js tests/unit/liveViews.test.js
git commit -m "feat: Snapshot enthält Pools und Kämpfe für die Teilnehmer-App" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Cloud-Tabellen und Ingest für Pools und Kämpfe

**Files:**
- Create: `migrations/20261013110000_live_cloud_pools_kaempfe.js`
- Modify: `src/liveCloud/ingest.js`
- Test: `tests/unit/liveCloudIngest.test.js` (ergänzen)

**Interfaces:**
- Consumes: Snapshot-Felder aus Task 1.
- Produces: Tabellen `live_pools(turnier_key, pool_id, bezeichnung, modus, status, matte_id, altersklasse, geschlecht, gewichtsklasse, farbe2)` und `live_kaempfe(turnier_key, kampf_id, pool_id, nr, status, reihenfolge, k1_key, k2_key, sieger_key, p1, p2)`; `uebernimmPaket` schreibt sie, fehlende Felder gelten als leer.

- [ ] **Step 1: Failing test schreiben**

An `tests/unit/liveCloudIngest.test.js` anhängen (Helfer `paket`, `teilnehmer`, `rueck` stehen oben):

```js
test('Pools und Kämpfe werden übernommen, ersetzt, zurückgezogen und sind optional', async () => {
    const { knex } = db;
    const mit = paket({
        turnierKey: 'P1',
        pools: [{ id: 10, bezeichnung: 'U15 w -44', modus: 'Doppel-KO-8', status: 'matte_zugewiesen', matteId: 1, altersklasse: 'U15', geschlecht: 'w', gewichtsklasse: '-44', farbe2: 'rot' }],
        kaempfe: [
            { id: 1, poolId: 10, nr: 'H1', status: 'beendet', reihenfolge: 1, k1: 'a1', k2: 'a2', sieger: 'a1', p1: 7, p2: 0 },
            { id: 1, poolId: 10, nr: 'H1', status: 'beendet', reihenfolge: 1, k1: 'a1', k2: 'a2', sieger: 'a1', p1: 7, p2: 0 },
            { id: 2, poolId: 10, nr: 'H2', status: 'freilos', reihenfolge: null, k1: 'a1', k2: null, sieger: 'a1', p1: 0, p2: 0 }
        ]
    });
    assert.equal(await uebernimmPaket(knex, mit), 'uebernommen');
    const pools = await knex('live_pools').where({ turnier_key: 'P1' });
    assert.equal(pools.length, 1);
    assert.equal(pools[0].farbe2, 'rot');
    assert.equal(pools[0].matte_id, 1);
    const kaempfe = await knex('live_kaempfe').where({ turnier_key: 'P1' }).orderBy('kampf_id');
    assert.equal(kaempfe.length, 2);
    assert.equal(kaempfe[0].k1_key, 'a1');
    assert.equal(kaempfe[0].p1, 7);
    assert.equal(kaempfe[1].reihenfolge, null);

    assert.equal(await uebernimmPaket(knex, paket({ turnierKey: 'P1', sequenz: 2000, pools: [], kaempfe: [] })), 'uebernommen');
    assert.equal((await knex('live_kaempfe').where({ turnier_key: 'P1' })).length, 0);

    assert.equal(await uebernimmPaket(knex, paket({ turnierKey: 'P2' })), 'uebernommen');
    assert.equal((await knex('live_pools').where({ turnier_key: 'P2' })).length, 0);

    await uebernimmPaket(knex, paket({ turnierKey: 'P3', sequenz: 10, pools: mit.pools, kaempfe: mit.kaempfe }));
    assert.equal(await uebernimmPaket(knex, rueck('P3', 20)), 'zurueckgezogen');
    assert.equal((await knex('live_kaempfe').where({ turnier_key: 'P3' })).length, 0);
    assert.equal((await knex('live_pools').where({ turnier_key: 'P3' })).length, 0);
});

test('pruefePaket: pools und kaempfe müssen Listen sein, wenn vorhanden', () => {
    assert.match(pruefePaket(paket({ pools: 'x' })), /pools/);
    assert.match(pruefePaket(paket({ kaempfe: {} })), /kaempfe/);
    assert.equal(pruefePaket(paket({ pools: [], kaempfe: [] })), null);
});
```

- [ ] **Step 2: Fehlschlag prüfen**

Run: `node --test tests/unit/liveCloudIngest.test.js`
Expected: FAIL (Tabelle `live_pools` fehlt).

- [ ] **Step 3: Migration schreiben**

`migrations/20261013110000_live_cloud_pools_kaempfe.js`:

```js
// Teilnehmer-App Phase 2b: Pools und Kämpfe der freigegebenen Turniere (Baum, Kampfliste, Dashboard).
export async function up(knex) {
    await knex.schema.createTable('live_pools', (t) => {
        t.text('turnier_key').notNullable().references('turnier_key').inTable('live_turniere').onDelete('CASCADE');
        t.integer('pool_id').notNullable();
        t.text('bezeichnung').notNullable().defaultTo('');
        t.text('modus').notNullable().defaultTo('');
        t.text('status').notNullable().defaultTo('');
        t.integer('matte_id');
        t.text('altersklasse').notNullable().defaultTo('');
        t.text('geschlecht').notNullable().defaultTo('');
        t.text('gewichtsklasse').notNullable().defaultTo('');
        t.text('farbe2').notNullable().defaultTo('blau');
        t.primary(['turnier_key', 'pool_id']);
    });

    await knex.schema.createTable('live_kaempfe', (t) => {
        t.text('turnier_key').notNullable().references('turnier_key').inTable('live_turniere').onDelete('CASCADE');
        t.integer('kampf_id').notNullable();
        t.integer('pool_id').notNullable();
        t.text('nr').notNullable().defaultTo('');
        t.text('status').notNullable().defaultTo('');
        t.integer('reihenfolge');
        t.text('k1_key');
        t.text('k2_key');
        t.text('sieger_key');
        t.integer('p1').notNullable().defaultTo(0);
        t.integer('p2').notNullable().defaultTo(0);
        t.primary(['turnier_key', 'kampf_id']);
        t.index(['turnier_key', 'pool_id']);
    });
}

export async function down(knex) {
    await knex.schema.dropTableIfExists('live_kaempfe');
    await knex.schema.dropTableIfExists('live_pools');
}
```

- [ ] **Step 4: Ingest erweitern**

In `src/liveCloud/ingest.js`:

1. In `pruefePaket` nach der Schleife über `['vereine', 'matten', 'teilnehmer', 'warteschlangen']` einfügen:

```js
    for (const feld of ['pools', 'kaempfe']) {
        if (paket[feld] !== undefined && !Array.isArray(paket[feld])) return `${feld} muss eine Liste sein`;
    }
    if ((paket.pools || []).length > 2000 || (paket.kaempfe || []).length > 20000) return 'zu viele Pools oder Kämpfe';
```

2. Zwei Zeilenbauer ergänzen (neben `positionsZeilen`):

```js
function poolZeilen(turnierKey, pools) {
    const gesehen = new Set();
    const zeilen = [];
    for (const p of pools || []) {
        if (!Number.isInteger(p?.id) || gesehen.has(p.id)) continue;
        gesehen.add(p.id);
        zeilen.push({
            turnier_key: turnierKey, pool_id: p.id, bezeichnung: text(p.bezeichnung, 200), modus: text(p.modus, 60),
            status: text(p.status, 40), matte_id: ganzzahl(p.matteId), altersklasse: text(p.altersklasse, 20),
            geschlecht: text(p.geschlecht, 5), gewichtsklasse: text(p.gewichtsklasse, 20), farbe2: p.farbe2 === 'rot' ? 'rot' : 'blau'
        });
    }
    return zeilen;
}

function kampfZeilen(turnierKey, kaempfe) {
    const gesehen = new Set();
    const zeilen = [];
    for (const k of kaempfe || []) {
        if (!Number.isInteger(k?.id) || !Number.isInteger(k?.poolId) || gesehen.has(k.id)) continue;
        gesehen.add(k.id);
        const key = (wert) => (wert ? text(wert, 64) : null);
        zeilen.push({
            turnier_key: turnierKey, kampf_id: k.id, pool_id: k.poolId, nr: text(k.nr, 30), status: text(k.status, 30),
            reihenfolge: ganzzahl(k.reihenfolge), k1_key: key(k.k1), k2_key: key(k.k2), sieger_key: key(k.sieger),
            p1: ganzzahl(k.p1) ?? 0, p2: ganzzahl(k.p2) ?? 0
        });
    }
    return zeilen;
}
```

3. In `uebernimmPaket` an den zwei Stellen, die `live_teilnehmer` und `live_kampf_positionen` löschen (Rücknahme und Ersetzen), jeweils ergänzen:

```js
                await trx('live_pools').where({ turnier_key: key }).del();
                await trx('live_kaempfe').where({ turnier_key: key }).del();
```

und nach `fuegeEin(trx, 'live_kampf_positionen', …)`:

```js
        await fuegeEin(trx, 'live_pools', poolZeilen(key, paket.pools));
        await fuegeEin(trx, 'live_kaempfe', kampfZeilen(key, paket.kaempfe));
```

- [ ] **Step 5: Tests laufen lassen**

Run: `node --test tests/unit/liveCloudIngest.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add migrations/20261013110000_live_cloud_pools_kaempfe.js src/liveCloud/ingest.js tests/unit/liveCloudIngest.test.js
git commit -m "feat: Cloud speichert Pools und Kämpfe der Turniere" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Abfragen und Endpunkte (Klassen, Pools, Pool mit Kämpfen, Dashboard)

**Files:**
- Modify: `src/liveCloud/abfrage.js`, `src/routes/liveRoutes.js`
- Test: `tests/unit/liveCloudAbfrage.test.js` (ergänzen), `tests/unit/liveCloudRoutes.test.js` (ergänzen)

**Interfaces:**
- Produces:
  - `ladeTurnier(...)` zusätzlich `klassen: [{ altersklasse, geschlecht, pools: [{ poolId, gewichtsklasse, bezeichnung }] }]`
  - `listePools(knex, key): Promise<Array<{ poolId, bezeichnung, modus, status, matteId, matteBezeichnung, altersklasse, geschlecht, gewichtsklasse, teilnehmer, gesamt, beendet, laeuft }>>`
  - `ladePool(knex, key, poolId)` zusätzlich `pool.modus`, `pool.status`, `pool.farbe2` und `kaempfe: [{ id, nr, status, k1, k2, sieger, p1, p2, abstand }]` (`k1`/`k2`: `{ key, name, verein }` oder `null`, `sieger`: Schlüssel oder `null`, `abstand`: Anzahl offener Kämpfe der Matte davor oder `null`)
  - `ladeDashboard(knex, key): Promise<{ matten: [{ id, bezeichnung, farbe2, laufend, naechste, pools }], warteschlange }>`; `laufend`/`naechste`-Einträge `{ id, poolId, poolBezeichnung, farbe2, k1, k2 }` mit `k1`/`k2` als `{ name, verein }` oder `null`
  - Routen `GET /turniere/:key/pools`, `GET /turniere/:key/dashboard`

- [ ] **Step 1: Failing tests schreiben**

An `tests/unit/liveCloudAbfrage.test.js` anhängen. Das `before` der Datei legt Turnier `A` an; für die neuen Daten ein eigenes Turnier ergänzen, indem am Dateiende ein zweiter `before`-freier Aufbau läuft (die Funktion `uebernimmPaket` ist schon importiert):

```js
import { listePools, ladeDashboard } from '../../src/liveCloud/abfrage.js';

const poolDef = (id, extra = {}) => ({ id, bezeichnung: `Pool ${id}`, modus: 'Jeder-gegen-Jeden', status: 'matte_zugewiesen', matteId: 1, altersklasse: 'U15', geschlecht: 'w', gewichtsklasse: '-44', farbe2: 'blau', ...extra });
const kampfDef = (id, poolId, extra = {}) => ({ id, poolId, nr: `R${id}`, status: 'bereit', reihenfolge: id, k1: null, k2: null, sieger: null, p1: 0, p2: 0, ...extra });

test('Pools, Pool mit Kämpfen, Klassen und Dashboard', async () => {
    const { knex } = db;
    await uebernimmPaket(knex, paket('D', '2026-10-12', [
        t('x1', 'Anna', 'Muster'), t('x2', 'Mia', 'Mustermann'), t('x3', 'Lea', 'Koch'), t('x4', 'Jule', 'Berg')
    ], {
        matten: [{ id: 1, bezeichnung: 'Matte 1' }, { id: 2, bezeichnung: 'Matte 2' }],
        pools: [
            poolDef(10, { bezeichnung: 'U15 w -44', gewichtsklasse: '-44' }),
            poolDef(11, { bezeichnung: 'U15 w +48', gewichtsklasse: '+48', matteId: 1 }),
            poolDef(12, { bezeichnung: 'U15 m -50', geschlecht: 'm', gewichtsklasse: '-50', matteId: 2, farbe2: 'rot' }),
            poolDef(13, { bezeichnung: 'U11 w -30', altersklasse: 'U11', gewichtsklasse: '-30', matteId: null })
        ],
        kaempfe: [
            kampfDef(1, 10, { status: 'beendet', k1: 'x1', k2: 'x2', sieger: 'x1', p1: 7 }),
            kampfDef(2, 10, { status: 'gestartet', k1: 'x3', k2: 'x4' }),
            kampfDef(3, 10, { status: 'bereit', k1: 'x1', k2: 'x3' }),
            kampfDef(4, 11, { status: 'bereit', k1: 'x2', k2: 'x4', reihenfolge: 4 }),
            kampfDef(5, 11, { status: 'bereit', k1: 'x1', k2: 'x4', reihenfolge: null }),
            kampfDef(6, 12, { status: 'bereit', k1: 'x1', k2: 'x2' }),
            kampfDef(7, 10, { status: 'freilos', k1: 'x4', k2: null, sieger: 'x4' })
        ]
    }));
    for (const x of ['x1', 'x2', 'x3', 'x4']) {
        await knex('live_teilnehmer').where({ turnier_key: 'D', key: x }).update({ pool_id: 10 });
    }

    const pools = await listePools(knex, 'D');
    assert.deepEqual(pools.map(p => p.poolId), [10, 11, 12, 13]);
    const p10 = pools.find(p => p.poolId === 10);
    assert.equal(p10.gesamt, 4);
    assert.equal(p10.beendet, 2);
    assert.equal(p10.laeuft, 1);
    assert.equal(p10.teilnehmer, 4);
    assert.equal(p10.matteBezeichnung, 'Matte 1');
    assert.equal(pools.find(p => p.poolId === 13).matteId, null);

    const turnier = await ladeTurnier(knex, 'D');
    const u15w = turnier.klassen.find(k => k.altersklasse === 'U15' && k.geschlecht === 'w');
    assert.deepEqual(u15w.pools.map(p => p.gewichtsklasse), ['-44', '+48']);
    assert.deepEqual(turnier.klassen.map(k => `${k.altersklasse}${k.geschlecht}`), ['U11w', 'U15m', 'U15w']);

    const pool = await ladePool(knex, 'D', 10);
    assert.equal(pool.pool.modus, 'Jeder-gegen-Jeden');
    assert.equal(pool.kaempfe.length, 4);
    const k2 = pool.kaempfe.find(k => k.id === 2);
    assert.deepEqual(k2.k1, { key: 'x3', name: 'Lea Koch', verein: 'JC Muster' });
    assert.equal(k2.abstand, 0);
    assert.equal(pool.kaempfe.find(k => k.id === 3).abstand, 1);
    assert.equal(pool.kaempfe.find(k => k.id === 1).abstand, null);
    assert.equal(pool.kaempfe.find(k => k.id === 7).k2, null);
    assert.equal(pool.kaempfe.find(k => k.id === 1).sieger, 'x1');

    const d = await ladeDashboard(knex, 'D');
    const m1 = d.matten.find(m => m.id === 1);
    assert.equal(m1.laufend.id, 2);
    assert.equal(m1.laufend.poolBezeichnung, 'U15 w -44');
    assert.equal(m1.laufend.k1.name, 'Lea Koch');
    assert.deepEqual(m1.naechste.map(k => k.id), [3, 4, 5]);
    assert.deepEqual(m1.pools.map(p => [p.poolId, p.gesamt, p.beendet]), [[10, 4, 2], [11, 2, 0]]);
    const m2 = d.matten.find(m => m.id === 2);
    assert.equal(m2.laufend, null);
    assert.equal(m2.farbe2, 'rot');
    assert.deepEqual(d.warteschlange, [{ poolId: 13, bezeichnung: 'U11 w -30' }]);
});

test('Ältere Halle ohne Pools und Kämpfe: leere Antworten statt Fehler', async () => {
    const { knex } = db;
    assert.deepEqual(await listePools(knex, 'A'), []);
    const d = await ladeDashboard(knex, 'A');
    assert.deepEqual(d.matten.map(m => m.laufend), [null]);
    assert.deepEqual(d.warteschlange, []);
    assert.deepEqual((await ladeTurnier(knex, 'A')).klassen, []);
    const pool = await ladePool(knex, 'A', 10);
    assert.deepEqual(pool.kaempfe, []);
    assert.equal(pool.pool.modus, '');
    assert.equal(await ladeDashboard(knex, 'gibtsnicht'), null);
});
```

(`ladeDashboard` liefert `null`, wenn das Turnier unbekannt oder zurückgezogen ist.)

An `tests/unit/liveCloudRoutes.test.js` anhängen:

```js
test('App-API: Pools und Dashboard', async () => {
    await sende('/ingest', { methode: 'POST', ...mitToken(), body: paket('R8', {
        pools: [{ id: 10, bezeichnung: 'U15 w -44', modus: 'Jeder-gegen-Jeden', status: 'matte_zugewiesen', matteId: 1, altersklasse: 'U15', geschlecht: 'w', gewichtsklasse: '-44', farbe2: 'blau' }],
        kaempfe: [{ id: 1, poolId: 10, nr: 'R1', status: 'gestartet', reihenfolge: 1, k1: 'a1', k2: 'a2', sieger: null, p1: 0, p2: 0 }]
    }) });
    const pools = await (await sende('/turniere/R8/pools')).json();
    assert.equal(pools.pools.length, 1);
    assert.equal(pools.pools[0].laeuft, 1);
    const dash = await (await sende('/turniere/R8/dashboard')).json();
    assert.equal(dash.matten[0].laufend.k1.name, 'Anna Muster');
    assert.ok(dash.serverzeit);
    assert.equal((await sende('/turniere/gibtsnicht/dashboard')).status, 404);
    assert.equal((await sende('/turniere/gibtsnicht/pools')).status, 404);
    const pool = await (await sende('/turniere/R8/pools/10')).json();
    assert.equal(pool.kaempfe.length, 1);
});
```

Den neuen Routentest **vor** dem Test „App-API ist ratenbegrenzt“ einordnen (das Limit der Datei ist 40 Anfragen).

- [ ] **Step 2: Fehlschlag prüfen**

Run: `node --test tests/unit/liveCloudAbfrage.test.js tests/unit/liveCloudRoutes.test.js`
Expected: FAIL (`listePools` nicht exportiert).

- [ ] **Step 3: `abfrage.js` erweitern**

Am Anfang von `src/liveCloud/abfrage.js` ergänzen:

```js
const OFFEN = new Set(['bereit', 'vorbereiten', 'gestartet']);
const BEENDET = new Set(['beendet', 'freilos']);
const NAME = (z) => `${z.vorname} ${z.nachname}`.trim();

function gewichtSortierwert(gewichtsklasse) {
    const zahl = parseFloat(String(gewichtsklasse).replace(/[^\d.]/g, '')) || 0;
    return String(gewichtsklasse).startsWith('+') ? zahl + 1000 : zahl;
}

const nachReihenfolge = (a, b) => {
    const ra = a.reihenfolge == null ? Infinity : Number(a.reihenfolge);
    const rb = b.reihenfolge == null ? Infinity : Number(b.reihenfolge);
    return ra !== rb ? ra - rb : a.kampf_id - b.kampf_id;
};

async function ladeNamen(knex, turnierKey) {
    const zeilen = await knex('live_teilnehmer').where({ turnier_key: turnierKey }).select('key', 'vorname', 'nachname', 'verein');
    return new Map(zeilen.map(z => [z.key, { key: z.key, name: NAME(z), verein: z.verein }]));
}

const kaempferDto = (namen, key) => (key ? (namen.get(key) || { key, name: 'unbekannt', verein: '' }) : null);

function mattenName(kopf, matteId) {
    const m = (Array.isArray(kopf.matten) ? kopf.matten : []).find(x => x.id === matteId);
    return m ? m.bezeichnung : '';
}
```

In `ladeTurnier` vor dem `return` ergänzen und das Ergebnisobjekt um `klassen` erweitern:

```js
    const poolZeilen = await knex('live_pools').where({ turnier_key: turnierKey })
        .select('pool_id', 'bezeichnung', 'altersklasse', 'geschlecht', 'gewichtsklasse');
    const gruppen = new Map();
    for (const p of poolZeilen) {
        const schluessel = `${p.altersklasse}|${p.geschlecht}`;
        if (!gruppen.has(schluessel)) gruppen.set(schluessel, { altersklasse: p.altersklasse, geschlecht: p.geschlecht, pools: [] });
        gruppen.get(schluessel).pools.push({ poolId: p.pool_id, gewichtsklasse: p.gewichtsklasse, bezeichnung: p.bezeichnung });
    }
    const klassen = [...gruppen.values()]
        .map(g => ({ ...g, pools: g.pools.sort((a, b) => gewichtSortierwert(a.gewichtsklasse) - gewichtSortierwert(b.gewichtsklasse)) }))
        .sort((a, b) => a.altersklasse.localeCompare(b.altersklasse, 'de', { numeric: true }) || a.geschlecht.localeCompare(b.geschlecht));
```

(im `return` `klassen` ergänzen).

`ladePool` ersetzen durch:

```js
export async function ladePool(knex, turnierKey, poolId) {
    const [teilnehmerZeilen, poolZeile, kopf] = await Promise.all([
        sortiert(knex('live_teilnehmer').where({ turnier_key: turnierKey, pool_id: poolId })),
        knex('live_pools').where({ turnier_key: turnierKey, pool_id: poolId }).first(),
        knex('live_turniere').where({ turnier_key: turnierKey }).first()
    ]);
    if (!teilnehmerZeilen.length && !poolZeile) return null;
    const matteId = poolZeile ? poolZeile.matte_id : (teilnehmerZeilen[0] ? teilnehmerZeilen[0].matte_id : null);
    const kaempfeZeilen = await knex('live_kaempfe').where({ turnier_key: turnierKey, pool_id: poolId }).orderBy('kampf_id');

    // Wartepositionen: offene Kämpfe der ganzen Matte in Matten-Reihenfolge (ein laufender Kampf zählt mit).
    let warteschlange = [];
    if (matteId != null) {
        const poolIdsDerMatte = (await knex('live_pools').where({ turnier_key: turnierKey, matte_id: matteId }).select('pool_id')).map(p => p.pool_id);
        const offene = poolIdsDerMatte.length
            ? await knex('live_kaempfe').where({ turnier_key: turnierKey }).whereIn('pool_id', poolIdsDerMatte).whereIn('status', [...OFFEN])
            : [];
        warteschlange = offene.sort(nachReihenfolge).map(k => k.kampf_id);
    }
    const namen = await ladeNamen(knex, turnierKey);
    const bezeichnung = poolZeile ? poolZeile.bezeichnung : (teilnehmerZeilen[0] ? teilnehmerZeilen[0].pool_bezeichnung : '');
    return {
        pool: {
            id: poolId, bezeichnung,
            matteBezeichnung: poolZeile && kopf ? mattenName(kopf, poolZeile.matte_id) : (teilnehmerZeilen[0] ? teilnehmerZeilen[0].matte_bezeichnung : ''),
            modus: poolZeile ? poolZeile.modus : '', status: poolZeile ? poolZeile.status : '', farbe2: poolZeile ? poolZeile.farbe2 : 'blau'
        },
        teilnehmer: teilnehmerZeilen.map(teilnehmerDto),
        kaempfe: kaempfeZeilen.map(k => {
            const index = warteschlange.indexOf(k.kampf_id);
            return {
                id: k.kampf_id, nr: k.nr, status: k.status, k1: kaempferDto(namen, k.k1_key), k2: kaempferDto(namen, k.k2_key),
                sieger: k.sieger_key, p1: k.p1, p2: k.p2, abstand: index >= 0 ? index : null
            };
        })
    };
}
```

Am Dateiende ergänzen:

```js
export async function listePools(knex, turnierKey) {
    const [pools, kopf, teilnehmerZaehler, kampfZeilen] = await Promise.all([
        knex('live_pools').where({ turnier_key: turnierKey }),
        knex('live_turniere').where({ turnier_key: turnierKey }).first(),
        knex('live_teilnehmer').where({ turnier_key: turnierKey }).select('pool_id').count('* as anzahl').groupBy('pool_id'),
        knex('live_kaempfe').where({ turnier_key: turnierKey }).select('pool_id', 'status')
    ]);
    const anzahl = new Map(teilnehmerZaehler.map(z => [z.pool_id, Number(z.anzahl)]));
    const summen = new Map();
    for (const k of kampfZeilen) {
        const s = summen.get(k.pool_id) || { gesamt: 0, beendet: 0, laeuft: 0 };
        s.gesamt += 1;
        if (BEENDET.has(k.status)) s.beendet += 1;
        if (k.status === 'gestartet') s.laeuft += 1;
        summen.set(k.pool_id, s);
    }
    return pools
        .map(p => ({
            poolId: p.pool_id, bezeichnung: p.bezeichnung, modus: p.modus, status: p.status, matteId: p.matte_id,
            matteBezeichnung: kopf && p.matte_id != null ? mattenName(kopf, p.matte_id) : '',
            altersklasse: p.altersklasse, geschlecht: p.geschlecht, gewichtsklasse: p.gewichtsklasse,
            teilnehmer: anzahl.get(p.pool_id) || 0, ...(summen.get(p.pool_id) || { gesamt: 0, beendet: 0, laeuft: 0 })
        }))
        .sort((a, b) => (a.matteId ?? Infinity) - (b.matteId ?? Infinity) || a.poolId - b.poolId);
}

export async function ladeDashboard(knex, turnierKey) {
    const kopf = await knex('live_turniere').where({ turnier_key: turnierKey, zurueckgezogen: false }).first();
    if (!kopf) return null;
    const [pools, kaempfe, namen] = await Promise.all([
        knex('live_pools').where({ turnier_key: turnierKey }).orderBy('pool_id'),
        knex('live_kaempfe').where({ turnier_key: turnierKey }),
        ladeNamen(knex, turnierKey)
    ]);
    const poolNachId = new Map(pools.map(p => [p.pool_id, p]));
    const fuerAnzeige = (k) => {
        const p = poolNachId.get(k.pool_id);
        const dto = (key) => { const n = kaempferDto(namen, key); return n ? { name: n.name, verein: n.verein } : null; };
        return { id: k.kampf_id, poolId: k.pool_id, poolBezeichnung: p ? p.bezeichnung : '', farbe2: p ? p.farbe2 : 'blau', k1: dto(k.k1_key), k2: dto(k.k2_key) };
    };
    const summe = (poolId) => {
        const eigene = kaempfe.filter(k => k.pool_id === poolId);
        return { gesamt: eigene.length, beendet: eigene.filter(k => BEENDET.has(k.status)).length };
    };
    const matten = (Array.isArray(kopf.matten) ? kopf.matten : []).map(m => {
        const poolsDerMatte = pools.filter(p => p.matte_id === m.id);
        const ids = new Set(poolsDerMatte.map(p => p.pool_id));
        const dieser = kaempfe.filter(k => ids.has(k.pool_id)).sort(nachReihenfolge);
        const laufend = dieser.find(k => k.status === 'gestartet') || null;
        const naechste = dieser.filter(k => k.status === 'bereit' || k.status === 'vorbereiten').slice(0, 3);
        return {
            id: m.id, bezeichnung: m.bezeichnung,
            farbe2: laufend && poolNachId.get(laufend.pool_id) ? poolNachId.get(laufend.pool_id).farbe2 : 'blau',
            laufend: laufend ? fuerAnzeige(laufend) : null,
            naechste: naechste.map(fuerAnzeige),
            pools: poolsDerMatte.map(p => ({ poolId: p.pool_id, bezeichnung: p.bezeichnung, status: p.status, ...summe(p.pool_id) }))
        };
    });
    const warteschlange = pools.filter(p => p.matte_id == null).map(p => ({ poolId: p.pool_id, bezeichnung: p.bezeichnung }));
    return { matten, warteschlange, stand: kopf.stand, empfangenAm: kopf.empfangen_am };
}
```

- [ ] **Step 4: Routen ergänzen**

In `src/routes/liveRoutes.js` Import erweitern um `listePools, ladeDashboard` und vor `router.get('/turniere/:key/pools/:poolId', …)` einfügen:

```js
    router.get('/turniere/:key/pools', schluesselPruefen, async (req, res) => {
        try {
            if (!(await ladeTurnier(knex, req.params.key))) return res.status(404).json({ error: 'Turnier nicht gefunden' });
            res.json({ pools: await listePools(knex, req.params.key) });
        } catch (f) { fehler500(res, f); }
    });

    router.get('/turniere/:key/dashboard', schluesselPruefen, async (req, res) => {
        try {
            const dashboard = await ladeDashboard(knex, req.params.key);
            if (!dashboard) return res.status(404).json({ error: 'Turnier nicht gefunden' });
            res.json({ serverzeit: jetzt().toISOString(), ...dashboard });
        } catch (f) { fehler500(res, f); }
    });
```

- [ ] **Step 5: Tests laufen lassen**

Run: `node --test tests/unit/liveCloudAbfrage.test.js tests/unit/liveCloudRoutes.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/liveCloud/abfrage.js src/routes/liveRoutes.js tests/unit/liveCloudAbfrage.test.js tests/unit/liveCloudRoutes.test.js
git commit -m "feat: App-API liefert Klassen, Pools, Kämpfe und Dashboard" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Optik der Turnier-App, Reiterleiste, Router-Grundgerüst, Kontrasttest

**Files:**
- Create: `tests/unit/liveAppKontrast.test.js`
- Modify: `teilnehmer-app/css/app.css` (ersetzen), `teilnehmer-app/index.html`, `teilnehmer-app/sw.js`
- Create: `teilnehmer-app/js/ui.js`
- Modify: `teilnehmer-app/js/app.js` (zerlegen: Router bleibt, Ansichten ziehen um), `tests/e2e/live-app.spec.js`
- Create: `teilnehmer-app/js/ansicht-start.js`, `teilnehmer-app/js/ansicht-liste.js`, `teilnehmer-app/js/ansicht-uebersicht.js` (die vorhandenen Ansichten aus `app.js` ziehen um, siehe Step 5)

**Interfaces:**
- Produces:
  - `ui.js`: `h(tag, attribute, ...kinder)`, `icon(name)`, `speicherFuer(turnierKey)`, `setzeStatus(text, getrennt?)`, `zeigeTabs(key | null, aktiv)`, `kachel(t, speicher, neuZeichnen, { href?, markiert? })`
  - Routen (Hash): `#/` Turniere · `#/t/<k>` Suche · `#/t/<k>/pools` · `#/t/<k>/turnier/<matteId|alle>?` · `#/t/<k>/uebersicht` · `#/t/<k>/verein/<vk>` · `#/t/<k>/pool/<poolId>/<baum|kaempfe|teilnehmer>/<markierung>?`
  - Test-IDs: `tab-suche`, `tab-pools`, `tab-turnier`, `tab-uebersicht`, `verein-<vereinKey>`

- [ ] **Step 1: Failing Kontrasttest schreiben**

`tests/unit/liveAppKontrast.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const css = fs.readFileSync(new URL('../../teilnehmer-app/css/app.css', import.meta.url), 'utf8');

function tokens(block) {
    const t = {};
    for (const m of block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) t[m[1]] = m[2];
    return t;
}
const hell = tokens(css.slice(0, css.indexOf('@media (prefers-color-scheme: dark)')));
const dunkelBlock = css.slice(css.indexOf('@media (prefers-color-scheme: dark)'));
const dunkel = { ...hell, ...tokens(dunkelBlock.slice(0, dunkelBlock.indexOf('}\n}') + 1)) };

function leuchtdichte(hex) {
    const kanal = (i) => {
        const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * kanal(0) + 0.7152 * kanal(1) + 0.0722 * kanal(2);
}
function verhaeltnis(a, b) {
    const [hell1, dunkel1] = [leuchtdichte(a), leuchtdichte(b)].sort((x, y) => y - x);
    return (hell1 + 0.05) / (dunkel1 + 0.05);
}

// [Vordergrund, Untergrund, Mindestverhältnis]
const PAARE = [
    ['text', 'card', 4.5], ['text', 'bg', 4.5],
    ['muted', 'card', 4.5], ['muted', 'bg', 4.5],
    ['primary', 'card', 4.5], ['primary', 'bg', 4.5],
    ['on-primary', 'primary', 4.5],
    ['star-on', 'card', 3], ['star-on', 'bg', 3],
    ['ok', 'card', 4.5], ['warn', 'card', 4.5], ['live', 'card', 4.5], ['live', 'bg', 4.5],
    ['border-strong', 'card', 3]
];

for (const [name, farben] of [['hell', hell], ['dunkel', dunkel]]) {
    test(`Kontrast ${name}: alle Farbpaare erreichen das Mindestverhältnis`, () => {
        for (const [vorn, grund, minimum] of PAARE) {
            assert.ok(farben[vorn] && farben[grund], `Token fehlt: ${vorn} oder ${grund}`);
            const v = verhaeltnis(farben[vorn], farben[grund]);
            assert.ok(v >= minimum, `${vorn} auf ${grund}: ${v.toFixed(2)} < ${minimum} (${farben[vorn]} auf ${farben[grund]})`);
        }
    });
}
```

- [ ] **Step 2: Fehlschlag prüfen**

Run: `node --test tests/unit/liveAppKontrast.test.js`
Expected: FAIL (`Token fehlt: text`, Tokens des alten CSS heißen anders).

- [ ] **Step 3: `app.css` ersetzen**

`teilnehmer-app/css/app.css` komplett ersetzen:

```css
/* Hajime Live: Optik der Turnier-App (Waage, Dashboard). Tokens aus public/css/common.css; Schriften lokal. */
@import url('/css/schriften.css');
@font-face {
    font-family: 'Material Icons';
    font-style: normal;
    font-weight: 400;
    src: url('/icons/material/material-icons.woff2') format('woff2');
}

:root {
    --bg: #fcf9f2;
    --card: #ffffff;
    --primary: #1e3a8a;
    --on-primary: #ffffff;
    --text: #1e293b;
    --muted: #64748b;
    --border: #d9d4c7;
    --border-strong: #8a8372;
    --star-on: #b45309;
    --ok: #2e7d32;
    --warn: #b45309;
    --live: #c2410c;
    --kanji: rgba(30, 58, 138, 0.07);
}
@media (prefers-color-scheme: dark) {
    :root {
        --bg: #0b0f19;
        --card: #111827;
        --primary: #3b82f6;
        --on-primary: #0b0f19;
        --text: #f3f4f6;
        --muted: #9ca3af;
        --border: #1f2937;
        --border-strong: #6b7280;
        --star-on: #fbbf24;
        --ok: #4ade80;
        --warn: #fbbf24;
        --live: #fb923c;
        --kanji: rgba(59, 130, 246, 0.06);
    }
}

* { box-sizing: border-box; }
body {
    margin: 0; background: var(--bg); color: var(--text); min-height: 100vh;
    font: 15px/1.4 'Plus Jakarta Sans', Roboto, 'Segoe UI', sans-serif; padding-bottom: 78px;
}
.material-icons {
    font-family: 'Material Icons'; font-weight: normal; font-style: normal; font-size: 22px; line-height: 1;
    display: inline-block; letter-spacing: normal; text-transform: none; white-space: nowrap; direction: ltr;
    -webkit-font-smoothing: antialiased; vertical-align: middle;
}
.kopf {
    display: flex; justify-content: space-between; align-items: center; padding: 12px 16px;
    background: var(--card); border-bottom: 2px solid var(--border);
}
.titel { font-family: Outfit, sans-serif; font-weight: 800; letter-spacing: .5px; text-transform: uppercase; color: var(--primary); text-decoration: none; font-size: 16px; }
.live-schild { font-size: 11px; font-weight: 700; color: var(--ok); background: color-mix(in srgb, var(--ok) 12%, transparent); padding: 3px 9px; border-radius: 20px; }
.live-schild.getrennt { color: var(--live); background: color-mix(in srgb, var(--live) 12%, transparent); }
.kanji { position: fixed; right: -8px; bottom: 70px; font-size: 140px; line-height: 1; color: var(--kanji); pointer-events: none; z-index: 0; }
main { position: relative; z-index: 1; padding: 14px 14px 8px; max-width: 40rem; margin: 0 auto; }
h1 {
    font-family: Outfit, sans-serif; font-weight: 800; letter-spacing: .5px; text-transform: uppercase; color: var(--primary);
    font-size: 18px; margin: 0 0 12px; padding-bottom: 6px; border-bottom: 2px solid var(--primary);
    display: flex; justify-content: space-between; align-items: baseline; gap: 8px;
}
h1 small { font-family: 'Plus Jakarta Sans', sans-serif; font-size: 12px; font-weight: 600; color: var(--muted); text-transform: none; letter-spacing: 0; }
.abschnitt { font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: .5px; color: var(--muted); margin: 16px 0 6px; display: flex; justify-content: space-between; align-items: center; }
.zurueck { display: inline-flex; align-items: center; gap: 2px; color: var(--primary); font-weight: 700; font-size: 13px; text-decoration: none; margin-bottom: 8px; }

input[type="search"] {
    width: 100%; height: 44px; padding: 0 12px; font: inherit; color: var(--text); background: var(--card);
    border: 2px solid var(--border-strong); border-radius: 8px; margin-bottom: 4px;
}
.treffer { background: var(--card); border: 2px solid var(--border); border-radius: 8px; margin-top: 6px; overflow: hidden; }
.treffer a, .treffer div.t { display: block; padding: 10px 12px; border-top: 1px solid var(--border); text-decoration: none; color: var(--text); font-weight: 700; font-size: 14px; }
.treffer a:first-child, .treffer div.t:first-child { border-top: 0; }
.treffer small { display: block; font-weight: 600; color: var(--muted); font-size: 12px; }
.treffer .hinweis-zeile small { color: var(--warn); }

.raster { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.verein-kachel {
    display: flex; justify-content: space-between; align-items: center; gap: 6px; padding: 10px 12px; min-height: 44px;
    background: var(--card); border: 2px solid var(--border); border-radius: 8px; color: var(--text); text-decoration: none; font-weight: 700; font-size: 13px;
}
.verein-kachel span { color: var(--muted); font-size: 12px; font-weight: 700; }
.gruppe { background: var(--card); border: 2px solid var(--border); border-radius: 8px; margin-bottom: 8px; }
.gruppe > button {
    width: 100%; display: flex; justify-content: space-between; align-items: center; padding: 11px 12px; min-height: 44px;
    background: none; border: 0; font: inherit; font-weight: 700; color: var(--text); cursor: pointer;
}
.gruppe > button span { color: var(--muted); font-size: 12px; }
.gruppe.offen { border-color: var(--primary); }
.gruppe.offen > button { color: var(--primary); }
.chips { padding: 0 12px 10px; display: flex; flex-wrap: wrap; gap: 6px; }
.chip {
    display: inline-flex; align-items: center; min-height: 36px; padding: 0 12px; border: 2px solid var(--border-strong);
    border-radius: 18px; font-size: 13px; font-weight: 700; color: var(--text); background: var(--card); text-decoration: none; cursor: pointer; font-family: inherit;
}
.chip.an { border-color: var(--primary); color: var(--primary); }

.kachel {
    display: grid; grid-template-columns: 1fr auto; gap: 2px 8px; padding: 10px 12px; margin-bottom: 8px;
    background: var(--card); border: 2px solid var(--border); border-radius: 12px; cursor: pointer;
}
.kachel .name { font-weight: 800; font-size: 15px; }
.kachel .zeile { font-size: 12px; color: var(--muted); font-weight: 600; grid-column: 1; }
.kachel .zeile.status { font-weight: 800; font-size: 13px; margin-top: 2px; color: var(--muted); }
.kachel .zeile.status.bald { color: var(--warn); }
.kachel .zeile.status.laeuft { color: var(--live); }
.kachel .zeile.status.fertig { color: var(--ok); }
.kachel.laeuft { border-color: var(--live); }
.kachel.bald { border-left: 5px solid var(--warn); }
.kachel.markiert { border-color: var(--primary); background: color-mix(in srgb, var(--primary) 8%, var(--card)); }
.aktionen { grid-column: 2; grid-row: 1 / span 4; display: flex; align-items: center; gap: 0; }
.icon-knopf {
    min-width: 44px; min-height: 44px; border: 0; background: none; color: var(--muted); cursor: pointer;
    display: inline-flex; align-items: center; justify-content: center;
}
.icon-knopf .material-icons { font-size: 26px; }
.icon-knopf[aria-pressed="true"] { color: var(--star-on); }

.knopf {
    display: flex; align-items: center; justify-content: center; gap: 8px; min-height: 48px; padding: 0 16px; border-radius: 8px;
    border: 2px solid var(--primary); background: var(--primary); color: var(--on-primary); font: inherit; font-weight: 800;
    text-transform: uppercase; letter-spacing: .4px; font-size: 13px; cursor: pointer; text-decoration: none; width: 100%;
}
.knopf.leise { background: var(--card); color: var(--primary); }
.verein-kopf { background: var(--card); border: 2px solid var(--primary); border-radius: 12px; padding: 12px; margin-bottom: 12px; }
.verein-kopf .zeile-1 { display: flex; justify-content: space-between; align-items: center; font-weight: 800; color: var(--primary); margin-bottom: 10px; }
.verein-kopf .zeile-1 span { color: var(--muted); font-size: 12px; font-weight: 700; }
.schalter { display: flex; justify-content: space-between; align-items: center; margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border); font-weight: 700; font-size: 14px; min-height: 44px; }
.schalter input { width: 22px; height: 22px; accent-color: var(--primary); }

.hinweis { padding: 12px; border: 2px dashed var(--border-strong); border-radius: 8px; color: var(--muted); font-weight: 600; font-size: 14px; }
.leer { text-align: center; padding: 40px 12px; color: var(--muted); font-weight: 600; }
.leer .material-icons { font-size: 44px; display: block; margin-bottom: 8px; color: var(--border-strong); }
.status { position: fixed; left: 0; right: 0; bottom: 62px; z-index: 5; padding: 6px 16px; background: var(--card); border-top: 2px solid var(--border); font-size: 12px; font-weight: 700; color: var(--muted); }
.status.getrennt { color: var(--live); }
.status:empty { display: none; }
.reiter {
    position: fixed; left: 0; right: 0; bottom: 0; z-index: 6; display: flex; background: var(--card); border-top: 2px solid var(--border);
    padding-bottom: env(safe-area-inset-bottom);
}
.reiter a {
    flex: 1; display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 8px 0 6px; min-height: 56px;
    font-size: 11px; font-weight: 700; color: var(--muted); text-decoration: none;
}
.reiter a.aktiv { color: var(--primary); }
.reiter[hidden] { display: none; }

.segment { display: flex; border: 2px solid var(--border-strong); border-radius: 8px; overflow: hidden; margin-bottom: 12px; background: var(--card); }
.segment a { flex: 1; text-align: center; padding: 10px 0; font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: .3px; color: var(--muted); text-decoration: none; }
.segment a.aktiv { background: var(--primary); color: var(--on-primary); }

.pool-karte { background: var(--card); border: 2px solid var(--border); border-radius: 12px; padding: 10px 12px; margin-bottom: 8px; display: block; color: var(--text); text-decoration: none; }
.pool-karte .kopfzeile { display: flex; justify-content: space-between; align-items: center; gap: 8px; font-family: Outfit, sans-serif; font-weight: 800; text-transform: uppercase; color: var(--primary); font-size: 14px; }
.pool-karte .fuss { font-size: 12px; color: var(--muted); font-weight: 600; margin-top: 2px; }
.schild { font-family: 'Plus Jakarta Sans', sans-serif; font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: .5px; border-radius: 4px; padding: 2px 7px; color: var(--muted); border: 1px solid var(--border-strong); white-space: nowrap; }
.schild.laeuft { color: var(--live); border-color: var(--live); }
.schild.fertig { color: var(--ok); border-color: var(--ok); }
.balken { height: 6px; background: var(--border); border-radius: 3px; margin-top: 8px; }
.balken i { display: block; height: 6px; border-radius: 3px; background: var(--primary); }
.balken i.fertig { background: var(--ok); }

.matte-karte { background: var(--card); border: 2px solid var(--border); border-radius: 12px; padding: 12px; margin-bottom: 12px; }
.matte-kopf { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid var(--primary); padding-bottom: 6px; margin-bottom: 10px; font-family: Outfit, sans-serif; font-weight: 900; text-transform: uppercase; color: var(--primary); font-size: 17px; }
.laufend { border: 2px solid var(--primary); border-radius: 8px; padding: 10px; text-align: center; background: color-mix(in srgb, var(--primary) 6%, var(--card)); cursor: pointer; }
.laufend .etikett { display: inline-block; font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; color: var(--primary); background: color-mix(in srgb, var(--primary) 12%, transparent); padding: 2px 8px; border-radius: 4px; margin-bottom: 6px; }
.laufend .klasse { font-size: 13px; font-weight: 800; text-transform: uppercase; color: var(--primary); margin-bottom: 8px; }
.paarung { display: flex; font-size: 13px; font-weight: 700; }
.paarung > div { flex: 1; padding: 9px 10px; text-align: left; }
.paarung .farbe { color: #ffffff; border: 2px solid; border-radius: 8px 0 0 8px; }
.paarung .farbe.blau { background: #007bff; border-color: #0056b3; }
.paarung .farbe.rot { background: #dc3545; border-color: #bd2130; }
.paarung .weiss { background: #ffffff; color: #1f2937; border: 2px solid #d9d4c7; border-radius: 0 8px 8px 0; text-align: right; }
.paarung small { display: block; font-size: 11px; font-weight: 600; opacity: .9; }
.naechster { display: flex; gap: 8px; align-items: center; padding: 8px 10px; margin-bottom: 6px; background: var(--bg); border: 1px solid var(--border); border-radius: 6px; font-size: 13px; font-weight: 700; cursor: pointer; }
.naechster .nr { width: 22px; height: 22px; border-radius: 50%; background: var(--primary); color: var(--on-primary); font-size: 12px; text-align: center; line-height: 22px; flex-shrink: 0; }
.naechster em { margin-left: auto; font-style: normal; font-size: 11px; color: var(--muted); white-space: nowrap; }
.fortschritt { font-size: 13px; font-weight: 700; margin-bottom: 8px; }
.fortschritt .zeile { display: flex; justify-content: space-between; gap: 8px; }
.fortschritt .zeile span + span { color: var(--muted); font-size: 12px; }

.kampfzeile { display: flex; gap: 8px; align-items: center; padding: 10px 12px; margin-bottom: 6px; background: var(--card); border: 2px solid var(--border); border-radius: 8px; font-size: 13px; font-weight: 700; cursor: pointer; }
.kampfzeile .nr { font-size: 11px; color: var(--muted); min-width: 28px; }
.kampfzeile .sieger { color: var(--ok); }
.kampfzeile .rechts { margin-left: auto; text-align: right; font-size: 11px; color: var(--muted); text-transform: uppercase; white-space: nowrap; }
.kampfzeile.markiert { border-color: var(--primary); background: color-mix(in srgb, var(--primary) 8%, var(--card)); }

.scroll { overflow-x: auto; padding-bottom: 6px; }
.runden { display: flex; gap: 12px; align-items: flex-start; min-width: min-content; }
.runde { min-width: 150px; }
.runde-titel { font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: .5px; color: var(--muted); margin-bottom: 6px; }
.runde-liste { display: flex; flex-direction: column; justify-content: space-around; gap: 10px; }
.karte { background: var(--card); border: 2px solid var(--border); border-radius: 6px; font-size: 12px; font-weight: 700; overflow: hidden; }
.karte.laeuft { border-color: var(--live); }
.karte.markiert { border-color: var(--primary); }
.karte .z { padding: 5px 7px; display: flex; justify-content: space-between; gap: 6px; }
.karte .z + .z { border-top: 1px solid var(--border); }
.karte .z.sieger { background: color-mix(in srgb, var(--ok) 16%, transparent); color: var(--ok); }
.karte .z.offen { color: var(--muted); font-weight: 600; }
.karte .z.stern { border-left: 3px solid var(--star-on); }
.bogen { border-collapse: collapse; font-size: 12px; min-width: 100%; }
.bogen th, .bogen td { border: 1px solid var(--border); padding: 6px 5px; text-align: center; }
.bogen th { background: var(--card); font-weight: 700; }
.bogen th.name { text-align: left; min-width: 110px; }
.bogen td.gewonnen { background: color-mix(in srgb, var(--ok) 16%, transparent); color: var(--ok); font-weight: 800; }
.bogen td.verloren { color: var(--muted); }
.bogen td.laeuft { color: var(--live); font-weight: 800; }
.bogen td.diagonale { background: var(--border); }
.bogen td.markiert { outline: 3px solid var(--primary); outline-offset: -3px; }
.bogen .zusatz { display: inline-block; margin-left: 3px; padding: 0 4px; border-radius: 4px; background: color-mix(in srgb, var(--warn) 20%, transparent); font-size: 10px; }
```

- [ ] **Step 4: Kontrasttest laufen lassen**

Run: `node --test tests/unit/liveAppKontrast.test.js`
Expected: PASS (2 Tests). Schlägt ein Paar fehl, den betreffenden Token minimal abdunkeln (Hell) bzw. aufhellen (Dunkel) und erneut laufen lassen; die Fehlermeldung nennt Paar und Verhältnis.

- [ ] **Step 5: `index.html`, `ui.js`, Router und Ansichten**

`teilnehmer-app/index.html` ersetzen:

```html
<!doctype html>
<html lang="de">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="theme-color" content="#1e3a8a">
    <title>Hajime Live</title>
    <link rel="manifest" href="manifest.webmanifest">
    <link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
    <link rel="stylesheet" href="css/app.css">
</head>
<body>
    <header class="kopf">
        <a class="titel" href="#/">Hajime Live</a>
        <span class="live-schild" id="liveSchild">● Live</span>
    </header>
    <div class="kanji" aria-hidden="true">柔</div>
    <main id="inhalt" aria-live="polite"></main>
    <div id="statuszeile" data-testid="statuszeile" class="status"></div>
    <nav id="reiter" class="reiter" hidden></nav>
    <script type="module" src="js/app.js"></script>
</body>
</html>
```

`teilnehmer-app/js/ui.js` neu:

```js
// Gemeinsame Bausteine der Ansichten: DOM-Helfer, Reiterleiste, Statuszeile, Kachel. Alle Texte laufen über textContent.
import { kachelZeilen } from './anzeige.js';
import { erzeugeSpeicher } from './speicher.js';

export function h(tag, attribute = {}, ...kinder) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attribute)) {
        if (k === 'class') el.className = v;
        else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
        else if (k === 'checked' || k === 'hidden') { if (v) el.setAttribute(k, ''); }
        else if (v != null && v !== false) el.setAttribute(k, v);
    }
    for (const kind of kinder.flat()) {
        if (kind == null || kind === false) continue;
        el.append(kind instanceof Node ? kind : document.createTextNode(String(kind)));
    }
    return el;
}

export function icon(name) {
    const e = document.createElement('span');
    e.className = 'material-icons';
    e.setAttribute('aria-hidden', 'true');
    e.textContent = name;
    return e;
}

export function speicherFuer(turnierKey) {
    let storage = null;
    try { storage = window.localStorage; } catch { /* privater Modus */ }
    return erzeugeSpeicher(storage || { getItem: () => null, setItem() {} }, turnierKey);
}

export function setzeStatus(text, getrennt = false) {
    const zeile = document.getElementById('statuszeile');
    zeile.textContent = text || '';
    zeile.classList.toggle('getrennt', !!getrennt);
    const schild = document.getElementById('liveSchild');
    schild.textContent = getrennt ? '● Halle nicht verbunden' : '● Live';
    schild.classList.toggle('getrennt', !!getrennt);
}

const REITER = [
    ['suche', 'Suche', 'search', ''],
    ['pools', 'Pools', 'grid_view', '/pools'],
    ['turnier', 'Turnier', 'emoji_events', '/turnier'],
    ['uebersicht', 'Übersicht', 'star', '/uebersicht']
];

export function zeigeTabs(turnierKey, aktiv) {
    const nav = document.getElementById('reiter');
    nav.hidden = !turnierKey;
    if (!turnierKey) { nav.replaceChildren(); return; }
    nav.replaceChildren(...REITER.map(([id, titel, symbol, pfad]) => h('a', {
        href: `#/t/${encodeURIComponent(turnierKey)}${pfad}`, 'data-testid': `tab-${id}`,
        class: id === aktiv ? 'aktiv' : '', 'aria-current': id === aktiv ? 'page' : null
    }, icon(symbol), titel)));
}

// Teilnehmerkachel mit Stern und Glocke. href: Ziel beim Antippen der Kachel (Pool des Teilnehmers).
export function kachel(t, speicher, neuZeichnen, { href = null, markiert = false } = {}) {
    const z = kachelZeilen(t);
    const gesternt = speicher.istGesternt(t.key);
    const glocke = speicher.hatGlocke(t.key, t.vereinKey);
    const klassen = ['kachel'];
    if (z.art === 'laeuft') klassen.push('laeuft');
    if (z.art === 'bald') klassen.push('bald');
    if (markiert) klassen.push('markiert');
    const knopf = (testId, an, beschriftungAn, beschriftungAus, symbolAn, symbolAus, aktion) => h('button', {
        class: 'icon-knopf', 'data-testid': `${testId}-${t.key}`, 'aria-pressed': String(an),
        'aria-label': an ? beschriftungAn : beschriftungAus,
        onclick: (e) => { e.stopPropagation(); aktion(!an); neuZeichnen(); }
    }, icon(an ? symbolAn : symbolAus));
    return h('div', {
        class: klassen.join(' '), 'data-testid': `kachel-${t.key}`,
        onclick: () => { if (href) location.hash = href; }
    },
        h('div', { class: 'name' }, z.titel),
        h('div', { class: 'aktionen' },
            knopf('stern', gesternt, 'Nicht mehr verfolgen', 'Verfolgen', 'star', 'star_border', (an) => speicher.stern(t.key, an)),
            knopf('glocke', glocke, 'Benachrichtigung aus', 'Benachrichtigung an', 'notifications', 'notifications_off', (an) => speicher.glocke(t.key, an))),
        z.zeile1 && h('div', { class: 'zeile' }, z.zeile1),
        z.zeile2 && h('div', { class: `zeile status ${z.art}` }, z.zeile2),
        z.zeile3 && h('div', { class: `zeile status ${z.art}` }, z.zeile3));
}
```

`teilnehmer-app/js/app.js` ersetzen durch den Router, die bisherigen Ansichtsfunktionen ziehen in eigene Module um. Router:

```js
// Hajime Live: Hash-Router. Die Ansichten liegen in ansicht-*.js; jede exportiert eine Funktion (kontext) → Promise.
import { zeigeTabs, setzeStatus } from './ui.js';
import { zeigeTurniere, zeigeStart } from './ansicht-start.js';
import { zeigeVerein } from './ansicht-verein.js';
import { zeigeUebersicht } from './ansicht-uebersicht.js';

let stopp = null; // räumt Zeitgeber der aktuellen Ansicht auf
export function registriereStopp(funktion) { stopp = funktion; }

const ROUTEN = {
    suche: zeigeStart,
    uebersicht: zeigeUebersicht,
    verein: zeigeVerein
};

async function route() {
    if (stopp) { stopp(); stopp = null; }
    let teile;
    try {
        teile = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
    } catch {
        teile = [];
    }
    if (teile[0] !== 't' || !teile[1]) { zeigeTabs(null); setzeStatus(''); return zeigeTurniere(); }
    const kontext = { key: teile[1], teile: teile.slice(2) };
    const ansicht = kontext.teile[0] || 'suche';
    return (ROUTEN[ansicht] || zeigeStart)(kontext);
}

window.addEventListener('hashchange', route);
route();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
```

Hinweis: `registriereStopp` ruft jede Ansicht mit Zeitgeber (Übersicht, Turnier) beim Aufbau auf; weil `ansicht-*.js` aus `app.js` importiert wird und `app.js` die Ansichten importiert, entsteht ein Zirkelbezug. Deshalb `registriereStopp` stattdessen in `ui.js` ablegen: `let stoppFunktion = null; export function setzeStopp(f) { stoppFunktion = f; } export function rufeStopp() { if (stoppFunktion) { stoppFunktion(); stoppFunktion = null; } }` und im Router `rufeStopp()` aufrufen. (Die obige `registriereStopp`-Variante entfällt.)

Die vorhandenen Ansichten umziehen (Inhalt aus der bisherigen `app.js` unverändert, nur mit `h`, `kachel`, `speicherFuer`, `setzeStatus` aus `ui.js` und neuer Signatur `(kontext)`):

- `ansicht-start.js`: exportiert `zeigeTurniere()` (bisher `zeigeStart`, Startseite mit Turnierliste inkl. Offline-Zugang „Zuletzt geladen“) und `zeigeStart({ key })` (bisher `zeigeTurnier`; wird in Task 5 neu gebaut — vorerst die Suche mit Autovervollständigung beibehalten und das Vereins-Dropdown durch `<a>`-Links ersetzen).
- `ansicht-uebersicht.js`: `zeigeUebersicht({ key })` (bisher `zeigeUebersicht`, ruft `zeigeTabs(key, 'uebersicht')`, `setzeStopp(() => clearInterval(timer))`).
- `ansicht-verein.js`: `zeigeVerein({ key, teile })` (bisher `zeigeListe` für den Verein, `vereinKey = teile[1]`; wird in Task 8 neu gebaut).

Jede Ansicht ruft zu Beginn `zeigeTabs(key, '<reiter>')`. Der alte Pool-Pfad `#/t/<k>/pool/<id>` bleibt vorerst unter `ROUTEN.pool` auf `ansicht-pool.js` (Task 6) unbelegt; bis dahin zeigt ein Aufruf die Start-Ansicht.

`teilnehmer-app/sw.js`: `HUELLE` um `./js/ui.js`, `./js/ansicht-start.js`, `./js/ansicht-verein.js`, `./js/ansicht-uebersicht.js` und `CACHE = 'hajime-live-v2'` ändern (spätere Tasks ergänzen ihre Module).

- [ ] **Step 6: E2E-Spec auf die neuen Test-IDs umstellen**

In `tests/e2e/live-app.spec.js`: `menue-uebersicht` → `tab-uebersicht`; der Vereinswechsel `page.getByTestId('vereinsauswahl').selectOption('v2')` → `page.getByTestId('verein-v2').click()`; `verein-stern` bleibt (Task 8 ändert den Knopf, die Test-ID bleibt). Die Ansicht der Vereine als Link-Raster liefert Task 5, bis dahin schlägt der Vereins-Test fehl — ihn in dieser Task mit `test.fixme(...)` markieren und in Task 5 wieder aktivieren.

- [ ] **Step 7: Tests laufen lassen**

Run: `node --test tests/unit/liveApp.test.js tests/unit/liveAppKontrast.test.js && npx playwright test tests/e2e/live-app.spec.js`
Expected: Unit PASS; E2E: die beiden nicht markierten Tests (Suche → Pool → Stern → Übersicht, Rücknahme) PASS.

- [ ] **Step 8: Commit**

```bash
git add teilnehmer-app tests/unit/liveAppKontrast.test.js tests/e2e/live-app.spec.js
git commit -m "feat: Optik der Turnier-App, Reiterleiste und Router für Hajime Live" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Startbildschirm mit Vereinen und Klassen

**Files:**
- Modify: `teilnehmer-app/js/ansicht-start.js`, `teilnehmer-app/js/anzeige.js`
- Test: `tests/unit/liveApp.test.js` (ergänzen), `tests/e2e/live-app.spec.js`

**Interfaces:**
- Consumes: `ladeTurnier(...).vereine` und `.klassen` (Task 3), `api.turnier`, `api.suche`.
- Produces: `anzeige.js`: `klassenTitel({ altersklasse, geschlecht }): string` („U15 weiblich“), `gewichtText(gewichtsklasse): string` („−44 kg“); Test-IDs `verein-<vereinKey>`, `klasse-<altersklasse>-<geschlecht>`, `gewicht-<poolId>`.

- [ ] **Step 1: Failing test schreiben**

An `tests/unit/liveApp.test.js` anhängen:

```js
import { klassenTitel, gewichtText } from '../../teilnehmer-app/js/anzeige.js';

test('klassenTitel und gewichtText', () => {
    assert.equal(klassenTitel({ altersklasse: 'U15', geschlecht: 'w' }), 'U15 weiblich');
    assert.equal(klassenTitel({ altersklasse: 'U18', geschlecht: 'm' }), 'U18 männlich');
    assert.equal(klassenTitel({ altersklasse: 'U11', geschlecht: '' }), 'U11');
    assert.equal(gewichtText('-44'), '−44 kg');
    assert.equal(gewichtText('+48'), '+48 kg');
    assert.equal(gewichtText(''), '');
});
```

- [ ] **Step 2: Fehlschlag prüfen**

Run: `node --test tests/unit/liveApp.test.js`
Expected: FAIL (`klassenTitel` ist keine Funktion).

- [ ] **Step 3: `anzeige.js` ergänzen**

```js
export function gewichtText(gewichtsklasse) {
    return gewichtsklasse ? `${String(gewichtsklasse).replace(/^-/, '−')} kg` : '';
}

export function klassenTitel({ altersklasse, geschlecht }) {
    const g = geschlecht === 'w' ? 'weiblich' : geschlecht === 'm' ? 'männlich' : '';
    return [altersklasse, g].filter(Boolean).join(' ');
}
```

und `klasseText` so umbauen, dass es `gewichtText` benutzt (`const gewicht = gewichtText(gewichtsklasse)`).

- [ ] **Step 4: Startansicht bauen**

`zeigeStart({ key })` in `teilnehmer-app/js/ansicht-start.js` ersetzen (Imports aus `ui.js`, `api.js`, `anzeige.js`):

```js
export async function zeigeStart({ key }) {
    zeigeTabs(key, 'suche');
    let turnier;
    try { turnier = await api.turnier(key); } catch (f) {
        inhalt().replaceChildren(h('p', { class: 'hinweis' }, f.status === 404 ? 'Das Turnier ist nicht mehr verfügbar.' : 'Keine Verbindung.'));
        setzeStatus(f.status === 404 ? '' : 'Keine Verbindung', f.status !== 404);
        return;
    }
    const v = verbindung(turnier);
    setzeStatus(v.text, !v.verbunden);

    const trefferListe = h('div', { 'data-testid': 'treffer' });
    let suchTimer = null;
    const suchfeld = h('input', {
        type: 'search', placeholder: 'Name oder Vorname suchen', 'aria-label': 'Teilnehmer suchen', 'data-testid': 'suchfeld',
        autocomplete: 'off',
        oninput: () => {
            clearTimeout(suchTimer);
            const q = suchfeld.value.trim();
            if (q.length < 2) { trefferListe.replaceChildren(); return; }
            suchTimer = setTimeout(async () => {
                try {
                    const { treffer } = await api.suche(key, q);
                    trefferListe.replaceChildren(treffer.length
                        ? h('div', { class: 'treffer' }, treffer.map(t => trefferZeile(key, t)))
                        : h('p', { class: 'hinweis' }, 'Keine Treffer.'));
                } catch { trefferListe.replaceChildren(h('p', { class: 'hinweis' }, 'Keine Verbindung.')); }
            }, 250);
        }
    });

    const vereine = h('div', { class: 'raster' }, turnier.vereine.map(x => h('a', {
        class: 'verein-kachel', 'data-testid': `verein-${x.key}`, href: `#/t/${encodeURIComponent(key)}/verein/${encodeURIComponent(x.key)}`
    }, x.name, h('span', {}, String(x.anzahl)))));

    const klassen = (turnier.klassen || []).map(gruppe => {
        const id = `${gruppe.altersklasse}-${gruppe.geschlecht}`;
        const chips = h('div', { class: 'chips', hidden: true }, gruppe.pools.map(p => h('a', {
            class: 'chip', 'data-testid': `gewicht-${p.poolId}`,
            href: `#/t/${encodeURIComponent(key)}/pool/${p.poolId}/teilnehmer`
        }, gewichtText(p.gewichtsklasse) || p.bezeichnung)));
        const kasten = h('div', { class: 'gruppe' });
        const knopf = h('button', {
            type: 'button', 'data-testid': `klasse-${id}`, 'aria-expanded': 'false',
            onclick: () => {
                const offen = chips.hidden;
                chips.hidden = !offen;
                kasten.classList.toggle('offen', offen);
                knopf.setAttribute('aria-expanded', String(offen));
            }
        }, klassenTitel(gruppe), h('span', {}, `${gruppe.pools.length} Pools`));
        kasten.append(knopf, chips);
        return kasten;
    });

    inhalt().replaceChildren(
        h('h1', {}, turnier.name),
        suchfeld, trefferListe,
        h('div', { class: 'abschnitt' }, 'Vereine'),
        turnier.vereine.length ? vereine : h('p', { class: 'hinweis' }, 'Noch keine Teilnehmer gemeldet.'),
        h('div', { class: 'abschnitt' }, 'Alters- und Gewichtsklassen'),
        klassen.length ? klassen : h('p', { class: 'hinweis' }, 'Noch keine Pools von der Halle gemeldet.'));
}

function trefferZeile(key, t) {
    const z = kachelZeilen(t);
    const text = [z.titel, t.verein].filter(Boolean).join(' · ');
    const unten = [z.zeile1, z.zeile2 ?? z.zeile3].filter(Boolean).join(' · ');
    const inhaltsknoten = [text, h('small', {}, unten)];
    const hinweis = t.poolId == null || ['nicht_ausgelost', 'ohne_matte', 'verspaetet'].includes(t.zustand);
    return t.poolId != null
        ? h('a', { href: `#/t/${encodeURIComponent(key)}/pool/${t.poolId}/teilnehmer/${encodeURIComponent(t.key)}`, 'data-testid': `treffer-${t.key}`, class: hinweis ? 'hinweis-zeile' : '' }, inhaltsknoten)
        : h('div', { class: 't hinweis-zeile', 'data-testid': `treffer-${t.key}` }, inhaltsknoten);
}
```

`inhalt()` ist `() => document.getElementById('inhalt')`, in `ui.js` exportieren.

- [ ] **Step 5: E2E anpassen und erweitern**

In `tests/e2e/live-app.spec.js` das `paket()` um `pools` ergänzen (zwei Pools: `{ id: 10, bezeichnung: 'U15 w -44', modus: 'Jeder-gegen-Jeden', status: 'matte_zugewiesen', matteId: 1, altersklasse: 'U15', geschlecht: 'w', gewichtsklasse: '-44', farbe2: 'blau' }` und `{ id: 11, …'U15 m -50' … geschlecht: 'm', gewichtsklasse: '-50' }`), den `test.fixme` aus Task 4 entfernen und einen Test ergänzen:

```js
test('Startbildschirm: Vereine direkt, Klassen darunter, Klick auf Gewichtsklasse öffnet den Pool', async ({ page, request }) => {
    await sende(request, paket(Date.now()));
    await page.goto(`/live/#/t/${KEY}`);
    await expect(page.getByTestId('verein-v1')).toContainText('JC Muster');
    await expect(page.getByTestId('verein-v2')).toContainText('TV Beispiel');
    await page.getByTestId('klasse-U15-w').click();
    await page.getByTestId('gewicht-10').click();
    await expect(page).toHaveURL(new RegExp(`#/t/${KEY}/pool/10/teilnehmer`));
    await page.goto(`/live/#/t/${KEY}`);
    await page.getByTestId('verein-v2').click();
    await expect(page).toHaveURL(new RegExp(`#/t/${KEY}/verein/v2`));
});
```

- [ ] **Step 6: Tests laufen lassen**

Run: `node --test tests/unit/liveApp.test.js && npx playwright test tests/e2e/live-app.spec.js`
Expected: PASS (Pool- und Vereinsansicht rendern bis Task 6/8 noch die alte Darstellung bzw. die Startseite; geprüft wird die URL).

- [ ] **Step 7: Commit**

```bash
git add teilnehmer-app tests/unit/liveApp.test.js tests/e2e/live-app.spec.js
git commit -m "feat: Startbildschirm mit Vereinen als Raster und aufklappbaren Klassen" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Baum-Modell, Pool-Ansicht (Baum, Kämpfe, Teilnehmer) und Pool-Liste

**Files:**
- Create: `teilnehmer-app/js/baum.js`, `teilnehmer-app/js/ansicht-pool.js`, `teilnehmer-app/js/ansicht-pools.js`
- Modify: `teilnehmer-app/js/anzeige.js`, `teilnehmer-app/js/app.js`, `teilnehmer-app/sw.js`
- Test: `tests/unit/liveAppBaum.test.js`, `tests/unit/liveApp.test.js` (ergänzen), `tests/e2e/live-app.spec.js`

**Interfaces:**
- Consumes: `api.pool` (liefert `pool`, `teilnehmer`, `kaempfe` mit `{ id, nr, status, k1, k2, sieger, p1, p2, abstand }`), `api.pools`, `POOL_RUNDEN`, `UEBERKREUZ_GRUPPEN`, `UEBERKREUZ_FINALRUNDE` aus `/js/shared/poolRunden.js`.
- Produces: `baum.js`: `baueBaumModell(modus, kaempfe, defs)` → `{ abschnitte: Array<{ titel, art: 'runden', runden: Array<{ titel, kaempfe: Array<Karte|null> }> } | { titel, art: 'bogen', teilnehmer: Array<{ key, name, verein }>, zellen: Array<Array<Zelle|null>>, siege: number[] }> }`; `Karte = { id, nr, status, laeuft, zeilen: [{ key, name, sieger, punkte }] }`; `Zelle = { text, art: 'gewonnen'|'verloren'|'laeuft'|'offen'|'freilos', kampfId, zusatz: Array<{ text, gewonnen }> }`; `anzeige.js`: `poolStatus({ status, gesamt, beendet, laeuft }) → { text, art }`, `kampfStatus(kampf) → { text, art }`; Test-IDs `pool-<poolId>`, `reiter-baum|kaempfe|teilnehmer`, `kampf-<kampfId>`.

- [ ] **Step 1: Failing Tests schreiben**

`tests/unit/liveAppBaum.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { baueBaumModell } from '../../teilnehmer-app/js/baum.js';
import { POOL_RUNDEN, UEBERKREUZ_GRUPPEN, UEBERKREUZ_FINALRUNDE } from '../../src/shared/poolRunden.js';

const defs = { POOL_RUNDEN, UEBERKREUZ_GRUPPEN, UEBERKREUZ_FINALRUNDE };
const f = (key, name = key, verein = 'JC') => ({ key, name, verein });
const kampf = (id, nr, extra = {}) => ({ id, nr, status: 'bereit', k1: null, k2: null, sieger: null, p1: 0, p2: 0, abstand: null, ...extra });

test('Doppel-KO-8: Runden aus der Steuerung, fehlende Kämpfe sind null, Sieger und Punkte', () => {
    const m = baueBaumModell('Doppel-KO-8', [
        kampf(1, 'H1', { status: 'beendet', k1: f('a', 'Anna'), k2: f('b', 'Mia'), sieger: 'a', p1: 7 }),
        kampf(2, 'H2', { status: 'gestartet', k1: f('c', 'Lea'), k2: f('d', 'Jule') }),
        kampf(5, 'H5', { k1: f('a', 'Anna') })
    ], defs);
    assert.deepEqual(m.abschnitte.map(a => a.titel), ['Hauptrunde', 'Trostrunde']);
    const viertel = m.abschnitte[0].runden[0];
    assert.equal(viertel.titel, 'Viertelfinale');
    assert.equal(viertel.kaempfe.length, 4);
    assert.equal(viertel.kaempfe[2], null);
    const h1 = viertel.kaempfe[0];
    assert.equal(h1.zeilen[0].sieger, true);
    assert.equal(h1.zeilen[0].punkte, 7);
    assert.equal(h1.zeilen[1].sieger, false);
    assert.equal(viertel.kaempfe[1].laeuft, true);
    const halb = m.abschnitte[0].runden[1].kaempfe[0];
    assert.equal(halb.zeilen[1].name, 'offen');
    assert.equal(m.abschnitte[1].runden[0].titel, 'Trostrunde R1');
});

test('Freilos und unbekannte Kämpfer: "Freilos" bzw. "offen"', () => {
    const m = baueBaumModell('Doppel-KO-8', [
        kampf(1, 'H1', { status: 'freilos', k1: f('a', 'Anna'), k2: null, sieger: 'a' }),
        kampf(2, 'H2', { status: 'bereit', k1: null, k2: null })
    ], defs);
    const [frei, offen] = m.abschnitte[0].runden[0].kaempfe;
    assert.deepEqual(frei.zeilen.map(z => z.name), ['Anna', 'Freilos']);
    assert.deepEqual(offen.zeilen.map(z => z.name), ['offen', 'offen']);
});

test('Jeder gegen Jeden: Kampfbogen mit Siegen, Punkten und Zusatzkampf', () => {
    const m = baueBaumModell('Jeder-gegen-Jeden', [
        kampf(1, 'R1', { status: 'beendet', k1: f('a', 'Anna'), k2: f('b', 'Mia'), sieger: 'a', p1: 7, p2: 0 }),
        kampf(2, 'R2', { status: 'gestartet', k1: f('a', 'Anna'), k2: f('c', 'Lea') }),
        kampf(3, 'R3', { status: 'beendet', k1: f('b', 'Mia'), k2: f('c', 'Lea'), sieger: 'c', p1: 0, p2: 1 }),
        kampf(4, 'R4', { status: 'beendet', k1: f('b', 'Mia'), k2: f('c', 'Lea'), sieger: 'b', p1: 1, p2: 0 })
    ], defs);
    assert.equal(m.abschnitte.length, 1);
    const b = m.abschnitte[0];
    assert.equal(b.art, 'bogen');
    assert.deepEqual(b.teilnehmer.map(t => t.name), ['Anna', 'Mia', 'Lea']);
    assert.equal(b.zellen[0][1].art, 'gewonnen');
    assert.equal(b.zellen[0][1].text, '7:0');
    assert.equal(b.zellen[1][0].art, 'verloren');
    assert.equal(b.zellen[0][2].art, 'laeuft');
    assert.equal(b.zellen[0][0], null);
    assert.equal(b.zellen[1][2].zusatz.length, 1);
    assert.equal(b.zellen[1][2].zusatz[0].gewonnen, true);
    assert.deepEqual(b.siege, [1, 1, 1]);
});

test('Gruppen-Überkreuz: zwei Kampfbögen und die Finalrunde', () => {
    const m = baueBaumModell('Gruppen-Überkreuz', [
        kampf(1, 'V_A_1', { k1: f('a'), k2: f('b') }),
        kampf(2, 'V_B_1', { k1: f('c'), k2: f('d') }),
        kampf(3, 'HF1', { k1: f('a'), k2: f('d') })
    ], defs);
    assert.deepEqual(m.abschnitte.map(a => a.titel), ['Gruppe A', 'Gruppe B', 'Finalrunde']);
    assert.equal(m.abschnitte[2].runden[0].kaempfe[0].nr, 'HF1');
});

test('ohne Kämpfe ergibt sich ein leeres Modell', () => {
    const m = baueBaumModell('Doppel-KO-8', [], defs);
    assert.equal(m.abschnitte[0].runden[0].kaempfe.every(k => k === null), true);
    assert.equal(baueBaumModell('Jeder-gegen-Jeden', [], defs).abschnitte[0].teilnehmer.length, 0);
});
```

An `tests/unit/liveApp.test.js` anhängen:

```js
import { poolStatus, kampfStatus } from '../../teilnehmer-app/js/anzeige.js';

test('poolStatus und kampfStatus', () => {
    assert.deepEqual(poolStatus({ status: 'abgeschlossen', gesamt: 6, beendet: 6, laeuft: 0 }), { text: 'Abgeschlossen', art: 'fertig' });
    assert.deepEqual(poolStatus({ status: 'matte_zugewiesen', gesamt: 6, beendet: 2, laeuft: 1 }), { text: 'Läuft', art: 'laeuft' });
    assert.deepEqual(poolStatus({ status: 'matte_zugewiesen', gesamt: 6, beendet: 5, laeuft: 0 }), { text: 'Noch 1 Kampf', art: 'info' });
    assert.deepEqual(poolStatus({ status: 'matte_zugewiesen', gesamt: 6, beendet: 0, laeuft: 0 }), { text: 'Noch 6 Kämpfe', art: 'info' });
    assert.deepEqual(poolStatus({ status: 'angelegt', gesamt: 0, beendet: 0, laeuft: 0 }), { text: 'Noch nicht ausgelost', art: 'info' });
    assert.equal(kampfStatus({ status: 'beendet', p1: 7, p2: 0 }).text, '7:0 · beendet');
    assert.equal(kampfStatus({ status: 'gestartet' }).art, 'laeuft');
    assert.equal(kampfStatus({ status: 'bereit', abstand: 2 }).text, 'in 2 Kämpfen');
    assert.equal(kampfStatus({ status: 'bereit', abstand: 0 }).text, 'als Nächstes');
    assert.equal(kampfStatus({ status: 'bereit', abstand: null }).text, 'bereit');
    assert.equal(kampfStatus({ status: 'angelegt' }).text, 'wartet auf Gegner');
    assert.equal(kampfStatus({ status: 'freilos' }).text, 'Freilos');
});
```

- [ ] **Step 2: Fehlschlag prüfen**

Run: `node --test tests/unit/liveAppBaum.test.js tests/unit/liveApp.test.js`
Expected: FAIL (`baum.js` fehlt, `poolStatus` fehlt).

- [ ] **Step 3: `anzeige.js` ergänzen**

```js
export function poolStatus({ status, gesamt, beendet, laeuft }) {
    if (status === 'abgeschlossen') return { text: 'Abgeschlossen', art: 'fertig' };
    if (!gesamt) return { text: 'Noch nicht ausgelost', art: 'info' };
    if (laeuft > 0) return { text: 'Läuft', art: 'laeuft' };
    const rest = gesamt - beendet;
    if (rest <= 0) return { text: 'In Prüfung', art: 'info' };
    return { text: rest === 1 ? 'Noch 1 Kampf' : `Noch ${rest} Kämpfe`, art: 'info' };
}

export function kampfStatus(k) {
    switch (k.status) {
        case 'beendet': return { text: `${k.p1 ?? 0}:${k.p2 ?? 0} · beendet`, art: 'fertig' };
        case 'freilos': return { text: 'Freilos', art: 'info' };
        case 'gestartet': return { text: 'läuft', art: 'laeuft' };
        case 'bereit':
        case 'vorbereiten':
            if (k.abstand === 0) return { text: 'als Nächstes', art: 'bald' };
            if (Number.isInteger(k.abstand)) return { text: k.abstand === 1 ? 'in 1 Kampf' : `in ${k.abstand} Kämpfen`, art: 'bald' };
            return { text: 'bereit', art: 'info' };
        default: return { text: 'wartet auf Gegner', art: 'info' };
    }
}
```

- [ ] **Step 4: `baum.js` schreiben**

`teilnehmer-app/js/baum.js`:

```js
// Rein: Modell für Turnierbaum und Kampfbogen eines Pools (Darstellung in ansicht-pool.js). Die Rundendefinitionen
// (POOL_RUNDEN usw. aus src/shared/poolRunden.js) werden übergeben, damit das Modul in Node und im Browser läuft.
const BEENDET = new Set(['beendet', 'freilos']);

function karte(k) {
    if (!k) return null;
    const zeile = (kaempfer, slot) => {
        const freilos = k.status === 'freilos' && !kaempfer;
        return {
            key: kaempfer ? kaempfer.key : null,
            name: kaempfer ? kaempfer.name : (freilos ? 'Freilos' : 'offen'),
            sieger: BEENDET.has(k.status) && !!kaempfer && k.sieger === kaempfer.key,
            punkte: k.status === 'beendet' ? (slot === 1 ? k.p1 : k.p2) : null
        };
    };
    return { id: k.id, nr: k.nr, status: k.status, laeuft: k.status === 'gestartet', zeilen: [zeile(k.k1, 1), zeile(k.k2, 2)] };
}

function rundenAbschnitt(titel, rundenDef, nachNr) {
    return {
        titel, art: 'runden',
        runden: rundenDef.map(r => ({ titel: r.title, kaempfe: r.nummern.map(n => karte(nachNr.get(String(n)))) }))
    };
}

function kampfbogen(titel, kaempfe) {
    const sortiert = [...kaempfe].sort((a, b) => a.id - b.id);
    const teilnehmer = [];
    const bekannt = new Set();
    for (const k of sortiert) {
        for (const f of [k.k1, k.k2]) {
            if (f && !bekannt.has(f.key)) { bekannt.add(f.key); teilnehmer.push({ key: f.key, name: f.name, verein: f.verein || '' }); }
        }
    }
    const paarKey = (a, b) => [a, b].sort().join('|');
    const nachPaar = new Map();
    for (const k of sortiert) {
        if (!k.k1 || !k.k2) continue;
        const s = paarKey(k.k1.key, k.k2.key);
        nachPaar.set(s, [...(nachPaar.get(s) || []), k]);
    }
    const siege = teilnehmer.map(() => 0);
    const zellen = teilnehmer.map((zeile, i) => teilnehmer.map((spalte, j) => {
        if (i === j) return null;
        const paarung = nachPaar.get(paarKey(zeile.key, spalte.key)) || [];
        if (!paarung.length) return { text: '', art: 'offen', kampfId: null, zusatz: [] };
        const zelle = { text: '', art: 'offen', kampfId: paarung[0].id, zusatz: [] };
        paarung.forEach((k, idx) => {
            const ichBinK1 = k.k1 && k.k1.key === zeile.key;
            let text; let gewonnen = false; let art;
            if (k.status === 'freilos') { text = 'FL'; art = 'freilos'; }
            else if (k.status === 'beendet') {
                gewonnen = k.sieger === zeile.key;
                if (gewonnen) siege[i] += 1;
                text = `${ichBinK1 ? k.p1 : k.p2}:${ichBinK1 ? k.p2 : k.p1}`;
                art = gewonnen ? 'gewonnen' : 'verloren';
            } else { text = k.status === 'gestartet' ? 'läuft' : `#${k.nr}`; art = k.status === 'gestartet' ? 'laeuft' : 'offen'; }
            if (idx === 0) { zelle.text = text; zelle.art = art; } else zelle.zusatz.push({ text, gewonnen });
        });
        return zelle;
    }));
    return { titel, art: 'bogen', teilnehmer, zellen, siege };
}

export function baueBaumModell(modus, kaempfe, defs) {
    const { POOL_RUNDEN, UEBERKREUZ_GRUPPEN, UEBERKREUZ_FINALRUNDE } = defs;
    const nachNr = new Map(kaempfe.map(k => [String(k.nr), k]));
    if (POOL_RUNDEN[modus]) {
        return { abschnitte: [
            rundenAbschnitt('Hauptrunde', POOL_RUNDEN[modus].winner, nachNr),
            rundenAbschnitt('Trostrunde', POOL_RUNDEN[modus].loser, nachNr)
        ] };
    }
    if (/^Gruppen-(Ü|ue|Ue)berkreuz$/.test(modus)) {
        const abschnitte = [];
        for (const g of UEBERKREUZ_GRUPPEN) {
            const teil = kaempfe.filter(k => String(k.nr).startsWith(g.praefix));
            if (teil.length) abschnitte.push(kampfbogen(g.titel, teil));
        }
        const finale = UEBERKREUZ_FINALRUNDE.filter(r => r.nummern.some(n => nachNr.has(n)));
        if (finale.length) abschnitte.push(rundenAbschnitt('Finalrunde', finale, nachNr));
        return { abschnitte };
    }
    return { abschnitte: [kampfbogen('', kaempfe)] };
}
```

- [ ] **Step 5: Ansichten schreiben**

`teilnehmer-app/js/ansicht-pool.js`:

```js
// Pool: Reiter Baum, Kämpfe, Teilnehmer. Startreiter und Markierung kommen aus der Route:
// #/t/<k>/pool/<poolId>/<baum|kaempfe|teilnehmer>/<markierung>
import { api } from './api.js';
import { h, icon, inhalt, kachel, setzeStatus, speicherFuer, zeigeTabs, setzeStopp } from './ui.js';
import { klasseText, kachelZeilen, kampfStatus, gewichtText } from './anzeige.js';
import { baueBaumModell } from './baum.js';
import { POOL_RUNDEN, UEBERKREUZ_GRUPPEN, UEBERKREUZ_FINALRUNDE } from '/js/shared/poolRunden.js';

const REITER = [['baum', 'Baum'], ['kaempfe', 'Kämpfe'], ['teilnehmer', 'Teilnehmer']];
const defs = { POOL_RUNDEN, UEBERKREUZ_GRUPPEN, UEBERKREUZ_FINALRUNDE };

function kartenZeichnung(k, sterne, markierterKampf, key) {
    const klassen = ['karte'];
    if (k.laeuft) klassen.push('laeuft');
    if (markierterKampf != null && String(k.id) === String(markierterKampf)) klassen.push('markiert');
    return h('div', { class: klassen.join(' '), 'data-testid': `kampf-${k.id}` },
        k.zeilen.map(z => h('div', { class: `z${z.sieger ? ' sieger' : ''}${z.name === 'offen' ? ' offen' : ''}${z.key && sterne.has(z.key) ? ' stern' : ''}` },
            h('span', {}, z.key && sterne.has(z.key) ? `${z.name} ★` : z.name),
            z.punkte != null ? h('span', {}, String(z.punkte)) : null)));
}

function abschnittZeichnen(a, sterne, markierterKampf, key) {
    if (a.art === 'runden') {
        const leer = a.runden.every(r => r.kaempfe.every(k => k === null));
        return h('div', {},
            h('div', { class: 'abschnitt' }, a.titel),
            leer ? h('p', { class: 'hinweis' }, 'Noch keine Paarungen.')
                : h('div', { class: 'scroll' }, h('div', { class: 'runden' }, a.runden.map(r => h('div', { class: 'runde' },
                    h('div', { class: 'runde-titel' }, r.titel),
                    h('div', { class: 'runde-liste' }, r.kaempfe.map(k => (k ? kartenZeichnung(k, sterne, markierterKampf, key)
                        : h('div', { class: 'karte', style: 'visibility:hidden' }, h('div', { class: 'z' }, '–'))))))))));
    }
    if (!a.teilnehmer.length) return h('div', {}, a.titel && h('div', { class: 'abschnitt' }, a.titel), h('p', { class: 'hinweis' }, 'Noch keine Paarungen.'));
    return h('div', {},
        a.titel && h('div', { class: 'abschnitt' }, a.titel),
        h('div', { class: 'scroll' }, h('table', { class: 'bogen' },
            h('tr', {}, h('th', {}), ...a.teilnehmer.map((_, i) => h('th', {}, String(i + 1))), h('th', {}, 'Siege')),
            ...a.teilnehmer.map((t, i) => h('tr', {},
                h('th', { class: 'name' }, `${i + 1} ${t.name}${sterne.has(t.key) ? ' ★' : ''}`),
                ...a.zellen[i].map(z => (z === null ? h('td', { class: 'diagonale' }) : h('td', {
                    class: `${z.art}${markierterKampf != null && String(z.kampfId) === String(markierterKampf) ? ' markiert' : ''}`
                }, z.text, ...z.zusatz.map(x => h('span', { class: 'zusatz' }, x.text))))),
                h('td', {}, String(a.siege[i])))))));
}

export async function zeigePool({ key, teile }) {
    const poolId = teile[1];
    const startReiter = REITER.some(([id]) => id === teile[2]) ? teile[2] : 'baum';
    const markierung = teile[3] ?? null;
    zeigeTabs(key, 'pools');
    const speicher = speicherFuer(key);
    const cacheName = `hajime-live:cache-pool:${key}:${poolId}`;
    let daten;
    let ausCache = false;
    try {
        daten = await api.pool(key, poolId);
        try { localStorage.setItem(cacheName, JSON.stringify(daten)); } catch { /* ohne Speicher */ }
    } catch (f) {
        if (f.status === 404) { inhalt().replaceChildren(h('p', { class: 'hinweis' }, 'Pool nicht gefunden.')); return; }
        try { daten = JSON.parse(localStorage.getItem(cacheName)); } catch { daten = null; }
        ausCache = true;
        if (!daten) { inhalt().replaceChildren(h('p', { class: 'hinweis' }, 'Keine Verbindung.')); setzeStatus('Keine Verbindung', true); return; }
    }
    if (ausCache) setzeStatus('Keine Verbindung · zuletzt geladener Stand', true); else setzeStatus('');

    let reiter = startReiter;
    function zeichne() {
        const sterne = new Set(speicher.anfrage().teilnehmer);
        const kopf = [
            h('a', { class: 'zurueck', href: `#/t/${encodeURIComponent(key)}/pools` }, icon('chevron_left'), 'Pools'),
            h('h1', {}, daten.pool.bezeichnung, daten.pool.matteBezeichnung ? h('small', {}, daten.pool.matteBezeichnung) : null),
            h('div', { class: 'segment' }, REITER.map(([id, titel]) => h('a', {
                href: '#', 'data-testid': `reiter-${id}`, class: id === reiter ? 'aktiv' : '',
                onclick: (e) => { e.preventDefault(); reiter = id; zeichne(); }
            }, titel)))
        ];
        let rumpf;
        if (reiter === 'teilnehmer') {
            rumpf = daten.teilnehmer.length
                ? daten.teilnehmer.map(t => kachel(t, speicher, zeichne, { markiert: markierung === t.key }))
                : [h('p', { class: 'hinweis' }, 'Keine Teilnehmer.')];
        } else if (!daten.kaempfe.length) {
            rumpf = [h('p', { class: 'hinweis' }, daten.pool.modus || daten.pool.status ? 'Noch nicht ausgelost.' : 'Noch keine Kampfdaten von der Halle.')];
        } else if (reiter === 'kaempfe') {
            rumpf = daten.kaempfe.map(k => {
                const s = kampfStatus(k);
                const name = (f, slot) => (f ? f.name : (k.status === 'freilos' && slot === 2 ? 'Freilos' : 'offen'));
                const klasse = (f) => (f && k.sieger === f.key ? 'sieger' : '');
                return h('div', {
                    class: `kampfzeile${markierung != null && String(k.id) === String(markierung) && startReiter === 'kaempfe' ? ' markiert' : ''}`,
                    'data-testid': `kampf-${k.id}`,
                    onclick: () => { reiter = 'baum'; zeichne(); }
                }, h('span', { class: 'nr' }, k.nr), h('span', { class: klasse(k.k1) }, name(k.k1, 1)), '–', h('span', { class: klasse(k.k2) }, name(k.k2, 2)),
                h('span', { class: 'rechts' }, s.text));
            });
            rumpf.push(h('button', { class: 'knopf', type: 'button', 'data-testid': 'baum-oeffnen', onclick: () => { reiter = 'baum'; zeichne(); } },
                icon('account_tree'), 'Turnierbaum öffnen'));
        } else {
            const modell = baueBaumModell(daten.pool.modus, daten.kaempfe, defs);
            rumpf = modell.abschnitte.map(a => abschnittZeichnen(a, sterne, markierung, key));
        }
        inhalt().replaceChildren(...kopf, ...rumpf);
    }
    zeichne();
}
```

`teilnehmer-app/js/ansicht-pools.js`:

```js
// Reiter Pools: alle Einzel-Pools mit Matte, Status und Fortschritt, filterbar nach Matte.
import { api } from './api.js';
import { h, inhalt, setzeStatus, zeigeTabs } from './ui.js';
import { poolStatus, gewichtText, klassenTitel } from './anzeige.js';

export async function zeigePools({ key }) {
    zeigeTabs(key, 'pools');
    let antwort;
    try { antwort = await api.pools(key); } catch (f) {
        inhalt().replaceChildren(h('p', { class: 'hinweis' }, f.status === 404 ? 'Das Turnier ist nicht mehr verfügbar.' : 'Keine Verbindung.'));
        setzeStatus(f.status === 404 ? '' : 'Keine Verbindung', f.status !== 404);
        return;
    }
    setzeStatus('');
    const pools = antwort.pools;
    if (!pools.length) {
        inhalt().replaceChildren(h('h1', {}, 'Pools'), h('p', { class: 'hinweis' }, 'Noch keine Pools von der Halle gemeldet.'));
        return;
    }
    const matten = [...new Map(pools.filter(p => p.matteId != null).map(p => [p.matteId, p.matteBezeichnung])).entries()];
    let filter = 'alle';
    function zeichne() {
        const sichtbar = pools.filter(p => (filter === 'alle' ? true : filter === 'laeuft' ? p.laeuft > 0 : String(p.matteId) === filter));
        inhalt().replaceChildren(
            h('h1', {}, 'Pools'),
            h('div', { class: 'chips', style: 'padding:0 0 8px' }, [
                ['alle', 'Alle'], ...matten.map(([id, name]) => [String(id), name]), ['laeuft', 'Läuft']
            ].map(([id, titel]) => h('button', {
                class: `chip${filter === id ? ' an' : ''}`, type: 'button', 'data-testid': `filter-${id}`,
                onclick: () => { filter = id; zeichne(); }
            }, titel))),
            ...(sichtbar.length ? sichtbar.map(p => {
                const s = poolStatus(p);
                const anteil = p.gesamt ? Math.round((p.beendet / p.gesamt) * 100) : 0;
                return h('a', { class: 'pool-karte', 'data-testid': `pool-${p.poolId}`, href: `#/t/${encodeURIComponent(key)}/pool/${p.poolId}/baum` },
                    h('div', { class: 'kopfzeile' }, h('span', {}, p.bezeichnung || `${klassenTitel(p)} ${gewichtText(p.gewichtsklasse)}`), h('span', { class: `schild ${s.art}` }, s.text)),
                    h('div', { class: 'fuss' }, [p.matteBezeichnung || 'noch keine Matte', `${p.teilnehmer} Teilnehmer`, p.modus].filter(Boolean).join(' · ')),
                    h('div', { class: 'balken' }, h('i', { class: s.art === 'fertig' ? 'fertig' : '', style: `width:${anteil}%` })));
            }) : [h('p', { class: 'hinweis' }, 'Keine Pools in dieser Auswahl.')]));
    }
    zeichne();
}
```

In `api.js` ergänzen: `pools: (key) => hole(`${t(key)}/pools`)`, `dashboard: (key) => hole(`${t(key)}/dashboard`)`. In `ui.js` `inhalt`, `setzeStopp`, `rufeStopp` exportieren (siehe Task 4). In `app.js` `ROUTEN` um `pools: zeigePools` und `pool: zeigePool` ergänzen (Import). In `sw.js` die neuen Module in `HUELLE` aufnehmen und `/js/shared/poolRunden.js` zusätzlich cachen.

- [ ] **Step 6: E2E ergänzen**

In `tests/e2e/live-app.spec.js` das `paket()` um Kämpfe ergänzen (`kaempfe`: Pool 10 mit `H1` beendet `a1` schlägt `a2` 7:0, `H2` `gestartet` `a1` gegen `a2`… passend zu den Teilnehmern; Modus `Doppel-KO-8`) und anhängen:

```js
test('Pools: Liste, Baum, Kampfliste und Teilnehmer eines Pools', async ({ page, request }) => {
    await sende(request, paket(Date.now()));
    await page.goto(`/live/#/t/${KEY}`);
    await page.getByTestId('tab-pools').click();
    await expect(page.getByTestId('pool-10')).toContainText('U15 w −44');
    await page.getByTestId('pool-10').click();
    await expect(page.getByTestId('reiter-baum')).toHaveClass(/aktiv/);
    await expect(page.getByTestId('kampf-1')).toContainText('Anna Muster');
    await page.getByTestId('reiter-kaempfe').click();
    await expect(page.getByTestId('baum-oeffnen')).toBeVisible();
    await page.getByTestId('reiter-teilnehmer').click();
    await expect(page.getByTestId('kachel-a1')).toContainText('Anna Muster');
    await page.goto(`/live/#/t/${KEY}/pool/999/baum`);
    await expect(page.getByText('Pool nicht gefunden')).toBeVisible();
});
```

- [ ] **Step 7: Tests laufen lassen**

Run: `node --test tests/unit/liveAppBaum.test.js tests/unit/liveApp.test.js && npx playwright test tests/e2e/live-app.spec.js`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add teilnehmer-app tests/unit tests/e2e/live-app.spec.js
git commit -m "feat: Pools, Pool-Ansicht mit Turnierbaum, Kampfliste und Teilnehmern" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Turnier-Dashboard (Variante B) und Weg Kampf → Kampfliste → Baum

**Files:**
- Create: `teilnehmer-app/js/ansicht-turnier.js`
- Modify: `teilnehmer-app/js/app.js`, `teilnehmer-app/sw.js`, `teilnehmer-app/js/anzeige.js`
- Test: `tests/unit/liveApp.test.js` (ergänzen), `tests/e2e/live-app.spec.js`

**Interfaces:**
- Consumes: `api.dashboard` (Task 3), `verbindung`.
- Produces: `anzeige.js`: `kaempferAnzeige(k)` → `{ name, verein }` mit „offen“ für `null`; Test-IDs `matte-<id>`, `matte-alle`, `laufend-<matteId>`, `naechster-<kampfId>`; Klick auf einen Kampf → `#/t/<k>/pool/<poolId>/kaempfe/<kampfId>`.

- [ ] **Step 1: Failing Test schreiben**

An `tests/unit/liveApp.test.js` anhängen:

```js
import { kaempferAnzeige, kampfLink } from '../../teilnehmer-app/js/anzeige.js';

test('kaempferAnzeige und kampfLink', () => {
    assert.deepEqual(kaempferAnzeige({ name: 'Anna Muster', verein: 'JC Senden' }), { name: 'Anna Muster', verein: 'JC Senden' });
    assert.deepEqual(kaempferAnzeige(null), { name: 'offen', verein: '' });
    assert.equal(kampfLink('T 1', { poolId: 10, id: 55 }), '#/t/T%201/pool/10/kaempfe/55');
});
```

- [ ] **Step 2: Fehlschlag prüfen**

Run: `node --test tests/unit/liveApp.test.js`
Expected: FAIL.

- [ ] **Step 3: `anzeige.js` ergänzen**

```js
export function kaempferAnzeige(k) {
    return k ? { name: k.name, verein: k.verein || '' } : { name: 'offen', verein: '' };
}

export function kampfLink(turnierKey, kampf) {
    return `#/t/${encodeURIComponent(turnierKey)}/pool/${kampf.poolId}/kaempfe/${kampf.id}`;
}
```

- [ ] **Step 4: Dashboard-Ansicht**

`teilnehmer-app/js/ansicht-turnier.js`:

```js
// Reiter Turnier: das Dashboard der Halle fürs Handy (Variante B: eine Matte je Ansicht, Wechsel per Chip).
import { api } from './api.js';
import { h, icon, inhalt, setzeStatus, setzeStopp, zeigeTabs } from './ui.js';
import { kaempferAnzeige, kampfLink, verbindung, poolStatus } from './anzeige.js';

const MERKER = 'hajime-live-meta:matte';

function paarung(k) {
    const eins = kaempferAnzeige(k.k1);
    const zwei = kaempferAnzeige(k.k2);
    return h('div', { class: 'paarung' },
        h('div', { class: `farbe ${k.farbe2 === 'rot' ? 'rot' : 'blau'}` }, zwei.name, zwei.verein && h('small', {}, zwei.verein)),
        h('div', { class: 'weiss' }, eins.name, eins.verein && h('small', {}, eins.verein)));
}

function matteKarte(key, m) {
    const teile = [h('div', { class: 'matte-kopf' }, h('span', {}, m.bezeichnung), icon('sports_martial_arts'))];
    if (m.laufend) {
        teile.push(h('div', {
            class: 'laufend', 'data-testid': `laufend-${m.id}`, role: 'link', tabindex: '0',
            onclick: () => { location.hash = kampfLink(key, m.laufend); }
        }, h('span', { class: 'etikett' }, 'Laufender Kampf'), h('div', { class: 'klasse' }, m.laufend.poolBezeichnung), paarung(m.laufend)));
    } else {
        teile.push(h('div', { class: 'laufend' }, h('span', { class: 'etikett' }, 'Pause'), h('div', { class: 'klasse' }, 'Kein aktiver Kampf')));
    }
    teile.push(h('div', { class: 'abschnitt' }, 'Als Nächstes'));
    if (m.naechste.length) {
        m.naechste.forEach((k, i) => teile.push(h('div', {
            class: 'naechster', 'data-testid': `naechster-${k.id}`, onclick: () => { location.hash = kampfLink(key, k); }
        }, h('span', { class: 'nr' }, String(i + 1)), `${kaempferAnzeige(k.k1).name} – ${kaempferAnzeige(k.k2).name}`, h('em', {}, k.poolBezeichnung))));
    } else teile.push(h('p', { class: 'hinweis' }, 'Keine anstehenden Kämpfe.'));
    teile.push(h('div', { class: 'abschnitt' }, 'Pools und Fortschritt'));
    if (m.pools.length) {
        m.pools.forEach(p => {
            const s = poolStatus(p);
            const anteil = p.gesamt ? Math.round((p.beendet / p.gesamt) * 100) : 0;
            teile.push(h('a', { class: 'fortschritt', href: `#/t/${encodeURIComponent(key)}/pool/${p.poolId}/baum`, style: 'display:block;color:inherit;text-decoration:none' },
                h('div', { class: 'zeile' }, h('span', {}, p.bezeichnung), h('span', {}, s.text)),
                h('div', { class: 'balken' }, h('i', { class: s.art === 'fertig' ? 'fertig' : '', style: `width:${anteil}%` }))));
        });
    } else teile.push(h('p', { class: 'hinweis' }, 'Keine Pools zugeordnet.'));
    return h('div', { class: 'matte-karte', 'data-testid': `matte-karte-${m.id}` }, teile);
}

export async function zeigeTurnier({ key, teile }) {
    zeigeTabs(key, 'turnier');
    let auswahl = teile[1] || null;
    if (!auswahl) { try { auswahl = localStorage.getItem(`${MERKER}:${key}`); } catch { /* ohne Speicher */ } }
    let letzte = null;

    async function lade() {
        let antwort;
        let ausCache = false;
        try { antwort = await api.dashboard(key); letzte = antwort; } catch (f) {
            if (f.status === 404) {
                stoppeTimer();
                inhalt().replaceChildren(h('h1', {}, 'Turnier'), h('p', { class: 'hinweis' }, 'Das Turnier ist nicht mehr verfügbar.'));
                setzeStatus('');
                return;
            }
            antwort = letzte;
            ausCache = true;
        }
        if (!antwort) { inhalt().replaceChildren(h('h1', {}, 'Turnier'), h('p', { class: 'hinweis' }, 'Keine Verbindung.')); setzeStatus('Keine Verbindung', true); return; }
        const v = verbindung(antwort);
        setzeStatus(ausCache ? `Keine Verbindung · ${v.text}` : v.text, ausCache || !v.verbunden);
        if (!antwort.matten.length) {
            inhalt().replaceChildren(h('h1', {}, 'Turnier'), h('p', { class: 'hinweis' }, 'Noch keine Matten oder Kampfdaten von der Halle.'));
            return;
        }
        const gueltig = auswahl === 'alle' || antwort.matten.some(m => String(m.id) === String(auswahl));
        const aktiv = gueltig && auswahl ? String(auswahl) : String(antwort.matten[0].id);
        const sichtbar = aktiv === 'alle' ? antwort.matten : antwort.matten.filter(m => String(m.id) === aktiv);
        const chip = (id, titel) => h('button', {
            type: 'button', class: `chip${aktiv === String(id) ? ' an' : ''}`, 'data-testid': `matte-${id}`,
            onclick: () => { auswahl = String(id); try { localStorage.setItem(`${MERKER}:${key}`, auswahl); } catch { /* ohne Speicher */ } lade(); }
        }, titel);
        inhalt().replaceChildren(
            h('h1', {}, 'Turnier'),
            h('div', { class: 'chips', style: 'padding:0 0 10px' }, chip('alle', 'Alle Matten'), ...antwort.matten.map(m => chip(m.id, m.bezeichnung))),
            ...sichtbar.map(m => matteKarte(key, m)),
            antwort.warteschlange.length ? h('div', { class: 'abschnitt' }, 'Warteschlange ohne Matte') : null,
            antwort.warteschlange.length ? h('div', { class: 'chips', style: 'padding:0' }, antwort.warteschlange.map(p => h('a', {
                class: 'chip', href: `#/t/${encodeURIComponent(key)}/pool/${p.poolId}/teilnehmer`
            }, p.bezeichnung))) : null);
    }
    function stoppeTimer() { clearInterval(timer); }
    await lade();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') lade(); }, 5000);
    setzeStopp(stoppeTimer);
}
```

In `app.js` `ROUTEN.turnier = zeigeTurnier` ergänzen (`teile` enthält `['turnier', <matte>]`; beim Aufruf durch `kontext.teile` gilt `teile[1]` als Matte), in `sw.js` das Modul in `HUELLE` aufnehmen.

- [ ] **Step 5: E2E ergänzen**

`paket()` in `tests/e2e/live-app.spec.js` um `matten: [{ id: 1, bezeichnung: 'Matte 2' }]` (steht schon) und einen Kampf mit Status `gestartet` im Pool 10 sowie zwei `bereit`-Kämpfe ergänzen; Test anhängen:

```js
test('Turnier: Matte mit laufendem Kampf, Klick öffnet die Kampfliste, von dort der Baum', async ({ page, request }) => {
    await sende(request, paket(Date.now()));
    await page.goto(`/live/#/t/${KEY}`);
    await page.getByTestId('tab-turnier').click();
    await expect(page.getByTestId('matte-1')).toHaveClass(/an/);
    await expect(page.getByTestId('laufend-1')).toContainText('Laufender Kampf');
    await page.getByTestId('laufend-1').click();
    await expect(page).toHaveURL(new RegExp(`/pool/10/kaempfe/`));
    await expect(page.getByTestId('reiter-kaempfe')).toHaveClass(/aktiv/);
    await page.getByTestId('baum-oeffnen').click();
    await expect(page.getByTestId('reiter-baum')).toHaveClass(/aktiv/);
});
```

- [ ] **Step 6: Tests laufen lassen**

Run: `node --test tests/unit/liveApp.test.js && npx playwright test tests/e2e/live-app.spec.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add teilnehmer-app tests/unit/liveApp.test.js tests/e2e/live-app.spec.js
git commit -m "feat: Turnier-Dashboard fürs Handy und Weg Kampf, Kampfliste, Baum" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Vereinsansicht und Übersicht nach Dringlichkeit

**Files:**
- Create: `teilnehmer-app/js/uebersicht.js`
- Modify: `teilnehmer-app/js/ansicht-verein.js`, `teilnehmer-app/js/ansicht-uebersicht.js`, `teilnehmer-app/sw.js`
- Test: `tests/unit/liveAppUebersicht.test.js`, `tests/e2e/live-app.spec.js`

**Interfaces:**
- Consumes: `kachel`, `speicherFuer`, `api.verein`, `api.turnier`, `api.uebersicht`.
- Produces: `uebersicht.js`: `gruppiereUebersicht(teilnehmer, { teilnehmer: einzelneKeys, vereine: vereinKeys }): { gruppen: Array<{ id: 'jetzt'|'bald'|'verein'|'fertig', titel: string, vereinKey?: string, eintraege: Teilnehmer[] }> }`; Test-IDs `verein-stern` (Knopf „Verein verfolgen“), `verein-glocke-alle`, `gruppe-jetzt|bald|fertig|verein-<vereinKey>`.

- [ ] **Step 1: Failing Test schreiben**

`tests/unit/liveAppUebersicht.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { gruppiereUebersicht } from '../../teilnehmer-app/js/uebersicht.js';

const t = (key, zustand, extra = {}) => ({ key, vorname: key, nachname: 'X', vereinKey: 'v1', verein: 'JC Senden', zustand, abstand: null, platz: null, ...extra });

test('Übersicht: Dringlichkeit, Vereinsregel und Fertig/Wartend', () => {
    const liste = [
        t('mia', 'laeuft'),
        t('anna', 'in_n', { abstand: 3 }),
        t('tom', 'in_n', { abstand: 1, vereinKey: 'v2', verein: 'TV Münster' }),
        t('lena', 'in_n', { abstand: 8 }),
        t('ben', 'abgeschlossen', { platz: 1, vereinKey: 'v2', verein: 'TV Münster' }),
        t('emma', 'nicht_ausgelost'),
        t('max', 'als_naechstes')
    ];
    const { gruppen } = gruppiereUebersicht(liste, { teilnehmer: ['mia', 'anna', 'tom', 'ben', 'emma', 'max'], vereine: ['v1'] });
    assert.deepEqual(gruppen.map(g => g.id), ['jetzt', 'bald', 'verein', 'fertig']);
    assert.deepEqual(gruppen[0].eintraege.map(x => x.key), ['mia']);
    assert.deepEqual(gruppen[1].eintraege.map(x => x.key), ['max', 'tom', 'anna']);
    assert.equal(gruppen[2].vereinKey, 'v1');
    assert.equal(gruppen[2].titel, 'Vereinsregel: JC Senden');
    assert.deepEqual(gruppen[2].eintraege.map(x => x.key), ['lena']);
    assert.deepEqual(gruppen[3].eintraege.map(x => x.key), ['ben', 'emma']);
});

test('Übersicht: leere Blöcke entfallen, ein einzeln gesternter Vereinsangehöriger steht nicht doppelt', () => {
    const { gruppen } = gruppiereUebersicht([t('a', 'in_n', { abstand: 2 })], { teilnehmer: ['a'], vereine: ['v1'] });
    assert.deepEqual(gruppen.map(g => g.id), ['bald']);
    assert.deepEqual(gruppiereUebersicht([], { teilnehmer: [], vereine: [] }).gruppen, []);
});

test('Übersicht: Verein ohne einzeln gesternte Mitglieder, Reihenfolge nach Dringlichkeit', () => {
    const { gruppen } = gruppiereUebersicht([
        t('a', 'in_n', { abstand: 5 }), t('b', 'laeuft'), t('c', 'abgeschlossen', { platz: 2 })
    ], { teilnehmer: [], vereine: ['v1'] });
    assert.deepEqual(gruppen.map(g => g.id), ['verein']);
    assert.deepEqual(gruppen[0].eintraege.map(x => x.key), ['b', 'a', 'c']);
});
```

- [ ] **Step 2: Fehlschlag prüfen**

Run: `node --test tests/unit/liveAppUebersicht.test.js`
Expected: FAIL (`uebersicht.js` fehlt).

- [ ] **Step 3: `uebersicht.js` schreiben**

```js
// Rein: gruppiert die verfolgten Teilnehmer nach Dringlichkeit (Spec Phase 2b, Entscheidung 8).
const JETZT = new Set(['laeuft']);
const BALD = new Set(['als_naechstes', 'in_n', 'wartet_auf_gegner']);

// Kleiner Wert = dringender.
function rang(t) {
    if (t.zustand === 'laeuft') return 0;
    if (t.zustand === 'als_naechstes') return 1;
    if (t.zustand === 'in_n') return 2 + (Number.isInteger(t.abstand) ? t.abstand : 999);
    if (t.zustand === 'wartet_auf_gegner') return 1000;
    if (t.zustand === 'keine_weiteren') return 2000;
    if (t.zustand === 'abgeschlossen') return 3000 + (Number.isInteger(t.platz) ? t.platz : 99);
    return 4000;
}
const vergleich = (a, b) => rang(a) - rang(b) || `${a.nachname}${a.vorname}`.localeCompare(`${b.nachname}${b.vorname}`, 'de');

export function gruppiereUebersicht(teilnehmer, { teilnehmer: einzelne = [], vereine = [] } = {}) {
    const einzeln = new Set(einzelne);
    const sortiert = [...teilnehmer].sort(vergleich);
    const jetzt = sortiert.filter(t => einzeln.has(t.key) && JETZT.has(t.zustand));
    const bald = sortiert.filter(t => einzeln.has(t.key) && BALD.has(t.zustand));
    const fertig = sortiert.filter(t => einzeln.has(t.key) && !JETZT.has(t.zustand) && !BALD.has(t.zustand));
    const gruppen = [];
    if (jetzt.length) gruppen.push({ id: 'jetzt', titel: 'Gerade dran', eintraege: jetzt });
    if (bald.length) gruppen.push({ id: 'bald', titel: 'Als Nächstes', eintraege: bald });
    for (const vereinKey of vereine) {
        const mitglieder = sortiert.filter(t => t.vereinKey === vereinKey && !einzeln.has(t.key));
        if (mitglieder.length) gruppen.push({ id: 'verein', vereinKey, titel: `Vereinsregel: ${mitglieder[0].verein}`, eintraege: mitglieder });
    }
    if (fertig.length) gruppen.push({ id: 'fertig', titel: 'Fertig oder wartend', eintraege: fertig });
    return { gruppen };
}
```

- [ ] **Step 4: Tests laufen lassen**

Run: `node --test tests/unit/liveAppUebersicht.test.js`
Expected: PASS (3 Tests).

- [ ] **Step 5: Übersicht und Vereinsansicht bauen**

`ansicht-uebersicht.js`: die vorhandene Ladelogik (Cache `hajime-live:cache:<key>`, 404 → Merkzettel löschen, Offline-Hinweis, Aktualisierung alle 15 s über `setzeStopp`) beibehalten, die Darstellung ersetzen:

```js
        const { gruppen } = gruppiereUebersicht(antwort.teilnehmer, anfrage);
        inhalt().replaceChildren(
            h('h1', {}, 'Übersicht'),
            ...gruppen.flatMap(g => [
                h('div', { class: 'abschnitt', 'data-testid': g.id === 'verein' ? `gruppe-verein-${g.vereinKey}` : `gruppe-${g.id}` },
                    g.titel,
                    g.id === 'verein' ? h('label', { style: 'display:flex;gap:6px;align-items:center;text-transform:none;letter-spacing:0;font-size:12px' },
                        'Glocke für alle',
                        h('input', {
                            type: 'checkbox', checked: g.eintraege.every(t => speicher.hatGlocke(t.key, g.vereinKey)),
                            onchange: (e) => { speicher.vereinGlockeAlle(g.vereinKey, e.target.checked); lade(); }
                        })) : null),
                ...g.eintraege.map(t => kachel(t, speicher, lade, { href: t.poolId != null ? `#/t/${encodeURIComponent(key)}/pool/${t.poolId}/teilnehmer/${encodeURIComponent(t.key)}` : null }))
            ]),
            gruppen.length ? null : h('p', { class: 'hinweis' }, 'Die verfolgten Teilnehmer sind (noch) nicht gemeldet.'));
```

Leerer Zustand (keine Sterne): `h('div', { class: 'leer' }, icon('star_border'), 'Noch niemand verfolgt.', h('br'), 'Suche einen Teilnehmer oder wähle einen Verein und setze den Stern.', h('a', { class: 'knopf', href: `#/t/${encodeURIComponent(key)}` }, 'Teilnehmer suchen'))`.

`ansicht-verein.js` komplett:

```js
// Vereinsansicht: Verein verfolgen (deutlich abgesetzter Knopf), "Glocke für alle", Teilnehmer nach Pools gruppiert.
import { api } from './api.js';
import { h, icon, inhalt, kachel, setzeStatus, speicherFuer, zeigeTabs } from './ui.js';

export async function zeigeVerein({ key, teile }) {
    const vereinKey = teile[1];
    zeigeTabs(key, 'suche');
    const speicher = speicherFuer(key);
    let turnier;
    let liste;
    try {
        [turnier, liste] = await Promise.all([api.turnier(key), api.verein(key, vereinKey)]);
    } catch (f) {
        inhalt().replaceChildren(h('p', { class: 'hinweis' }, f.status === 404 ? 'Nicht gefunden.' : 'Keine Verbindung.'));
        setzeStatus(f.status === 404 ? '' : 'Keine Verbindung', f.status !== 404);
        return;
    }
    setzeStatus('');
    const name = (turnier.vereine.find(x => x.key === vereinKey) || {}).name || 'Verein';

    function zeichne() {
        const gesternt = speicher.vereinGesternt(vereinKey);
        const mitglieder = liste.teilnehmer;
        const nachPool = new Map();
        for (const t of mitglieder) {
            const id = t.poolId == null ? 'ohne' : String(t.poolId);
            if (!nachPool.has(id)) nachPool.set(id, { titel: t.poolBezeichnung || 'Noch nicht eingeteilt', matte: t.matteBezeichnung, eintraege: [] });
            nachPool.get(id).eintraege.push(t);
        }
        const kopf = h('div', { class: 'verein-kopf' },
            gesternt
                ? h('button', { class: 'knopf leise', type: 'button', 'data-testid': 'verein-stern', 'aria-pressed': 'true', onclick: () => { speicher.vereinStern(vereinKey, false); zeichne(); } },
                    icon('star'), 'Verein wird verfolgt')
                : h('button', { class: 'knopf', type: 'button', 'data-testid': 'verein-stern', 'aria-pressed': 'false', onclick: () => { speicher.vereinStern(vereinKey, true); zeichne(); } },
                    icon('star_border'), 'Verein verfolgen'),
            gesternt ? h('label', { class: 'schalter' }, 'Glocke für alle', h('input', {
                type: 'checkbox', 'data-testid': 'verein-glocke-alle',
                checked: mitglieder.length > 0 && mitglieder.every(t => speicher.hatGlocke(t.key, vereinKey)),
                onchange: (e) => { speicher.vereinGlockeAlle(vereinKey, e.target.checked); zeichne(); }
            })) : null);
        inhalt().replaceChildren(
            h('a', { class: 'zurueck', href: `#/t/${encodeURIComponent(key)}` }, icon('chevron_left'), 'Zurück'),
            h('h1', {}, name, h('small', {}, `${mitglieder.length} Teilnehmer`)),
            kopf,
            ...[...nachPool.values()].flatMap(g => [
                h('div', { class: 'abschnitt' }, g.titel, h('span', {}, g.matte || '')),
                ...g.eintraege.map(t => kachel(t, speicher, zeichne, { href: t.poolId != null ? `#/t/${encodeURIComponent(key)}/pool/${t.poolId}/teilnehmer/${encodeURIComponent(t.key)}` : null }))
            ]));
    }
    zeichne();
}
```

- [ ] **Step 6: E2E anpassen**

In `tests/e2e/live-app.spec.js` die bisherigen Tests auf die neuen Texte/Test-IDs anpassen: `verein-stern` ist jetzt der Knopf „Verein verfolgen“ (`toContainText('Verein verfolgen')` vor, `toContainText('Verein wird verfolgt')` nach dem Klick); in der Übersicht erwartet der Test `gruppe-verein-v2` mit der Kachel `kachel-b1`. Neuer Test:

```js
test('Verein verfolgen: Knopf, Glocke für alle, Vereinsblock in der Übersicht', async ({ page, request }) => {
    await sende(request, paket(Date.now()));
    await page.goto(`/live/#/t/${KEY}/verein/v1`);
    await expect(page.getByTestId('verein-stern')).toContainText('Verein verfolgen');
    await page.getByTestId('verein-stern').click();
    await expect(page.getByTestId('verein-stern')).toContainText('Verein wird verfolgt');
    await page.getByTestId('verein-glocke-alle').check();
    await expect(page.getByTestId('glocke-a1')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('tab-uebersicht').click();
    await expect(page.getByTestId('gruppe-verein-v1')).toContainText('Vereinsregel: JC Muster');
});
```

- [ ] **Step 7: Tests laufen lassen**

Run: `node --test tests/unit/liveAppUebersicht.test.js && npx playwright test tests/e2e/live-app.spec.js`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add teilnehmer-app tests/unit/liveAppUebersicht.test.js tests/e2e/live-app.spec.js
git commit -m "feat: Vereinsansicht mit gut sichtbarem Folgen-Knopf und Übersicht nach Dringlichkeit" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Demo-Daten, Service Worker, Dokumentation, Gesamtlauf

**Files:**
- Modify: `scripts/live-demo.mjs`, `teilnehmer-app/sw.js`, `docs/live-uplink.md`, `CLAUDE.md`

**Interfaces:** keine.

- [ ] **Step 1: Demo-Skript um Pools und Kämpfe erweitern**

In `scripts/live-demo.mjs` im Paket `pools` (`id: 1` `U15 w -44` Matte 2, Modus `Doppel-KO-8`; `id: 2` `U15 m -50` Matte 1, `Jeder-gegen-Jeden`; `id: 3` `U11 w -30` ohne Matte) und `kaempfe` ergänzen (Doppel-KO mit `H1` beendet, `H2` gestartet, `H3` bereit, `H4` bereit; Jeder-gegen-Jeden mit zwei beendeten Kämpfen), passend zu den Demo-Teilnehmern `d1`…`d8`.

- [ ] **Step 2: Service Worker prüfen**

`HUELLE` in `teilnehmer-app/sw.js` muss alle Module enthalten: `./js/ui.js`, `./js/baum.js`, `./js/uebersicht.js`, `./js/ansicht-start.js`, `./js/ansicht-pools.js`, `./js/ansicht-pool.js`, `./js/ansicht-turnier.js`, `./js/ansicht-verein.js`, `./js/ansicht-uebersicht.js`; `CACHE = 'hajime-live-v3'`. Die absoluten Pfade (`/css/schriften.css`, `/js/shared/poolRunden.js`, Schriften, Icons) lädt der Worker beim ersten Abruf und hält sie dann vor (Netz zuerst, Cache als Rückfall; `/api/` bleibt ausgenommen).

- [ ] **Step 3: Dokumentation**

`docs/live-uplink.md`: Abschnitt „Cloud-Seite“ um die neuen Endpunkte (`/pools`, `/dashboard`, erweiterter Pool) und die Snapshot-Felder `pools`/`kaempfe` ergänzen; Hinweis, dass ein älterer Live-Prozess ohne diese Felder weiter funktioniert (Pools, Turnier und Baum zeigen dann „Noch keine Kampfdaten von der Halle“). `CLAUDE.md`: Eintrag „Live-Uplink für die Teilnehmer-App“ um Phase 2b ergänzen (Dateien `teilnehmer-app/js/ansicht-*.js`, `baum.js`, `uebersicht.js`, Tests `tests/unit/liveAppBaum.test.js`, `liveAppUebersicht.test.js`, `liveAppKontrast.test.js`).

- [ ] **Step 4: Gesamtlauf**

Run: `npm run test:unit`
Expected: 0 Fehler (bekannte Windows-Aufräum-Flakiness `EPERM` beim Löschen des Temp-Verzeichnisses einzeln erneut laufen lassen).

Run: `npx playwright test tests/e2e/live-app.spec.js tests/e2e/live-freigabe.spec.js --repeat-each 3`
Expected: alle bestanden.

- [ ] **Step 5: Sichtprüfung**

`preview_start` mit Konfiguration `hajime-live`, `node scripts/live-demo.mjs`, danach `http://localhost:3000/live/` in Hell und Dunkel (`resize_window` mit `colorScheme`) und mobiler Breite (375 px) durchgehen: Start, Pools, Baum, Kämpfe, Turnier, Übersicht, Verein. Auffälligkeiten (Abschneiden, Kontrast) vor dem Commit beheben.

- [ ] **Step 6: Commit**

```bash
git add scripts/live-demo.mjs teilnehmer-app/sw.js docs/live-uplink.md CLAUDE.md
git commit -m "docs: Phase 2b der Teilnehmer-App (Demo-Daten, Service Worker, Betrieb)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Self-Review (gegen die Spec Phase 2b)

- **Entscheidung 1 (Reiterleiste):** Task 4 (`zeigeTabs`, `tab-*`). **2 (Start mit Vereinen/Klassen):** Task 5. **3 (Pools):** Task 6 (`ansicht-pools.js`). **4 (Startreiter je Weg):** Task 5 (Suche/Klasse → `teilnehmer`), Task 6 (Pools → `baum`), Task 7 (Dashboard → `kaempfe`). **5 (Baum):** Task 6 (`baum.js`, `poolRunden`). **6/7 (Dashboard B, Kampf → Kampfliste → Baum):** Task 7. **8 (Übersicht):** Task 8. **9 (Verein folgen, Kontrast):** Task 4 (Kontrasttest, `.knopf`), Task 8. **10 (Ausschlüsse):** Task 1. **11 (Dunkelmodus):** Task 4.
- **Datenerweiterung (Spec 4):** Task 1 (Snapshot, Views), Task 2 (Tabellen, Ingest), Task 3 (Endpunkte; `klassen`, `pools`, Pool mit Kämpfen, `dashboard`).
- **Typkonsistenz:** `ladePool` liefert `kaempfe[].k1/k2` als `{ key, name, verein }` (Task 3) ↔ `baueBaumModell`-Eingabe (Task 6) ↔ `kampfStatus` (`p1`, `p2`, `abstand`). `ladeDashboard` liefert `laufend/naechste` mit `k1/k2` als `{ name, verein }` (Task 3) ↔ `kaempferAnzeige` (Task 7).
- **Bekannte Abweichungen von der Spec:** Das Dashboard aktualisiert alle 5 s per Polling; die Matten-Chips zeigen Namen aus `live_turniere.matten`. Die Kampfliste zeigt `abstand` je Kampf (Warteposition der Matte); sie wird in `ladePool` berechnet.
- **Nicht geprüft/offen:** Verhalten auf iOS; Mannschaftsbegegnungen im Baum.
