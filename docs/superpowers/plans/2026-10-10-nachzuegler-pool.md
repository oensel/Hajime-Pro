# Nachzügler in ausgeloste Altersklassen — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Teilnehmer, die nach der Auslosung ihrer Altersklasse dazukommen, werden auf der Pools-Seite per bestätigtem Vorschlag in einen offenen Pool eingefügt oder landen in einem gemeinsamen Sammelpool „Verspätet“, aus dem sie per Drag&Drop verschoben werden; Sperren gelten je Pool statt je Altersklasse.

**Architecture:** Der Zustand wird weiter aus den Pools abgeleitet (`ermittleAltersklassenPoolZustand` liefert zusätzlich `gesperrtePoolIds`). Die Vorschlagsberechnung ist eine reine Funktion (`src/services/nachzuegler.js`), die API steckt im `poolController.js`. Das Einsortieren nutzt den vorhandenen Pool-Neuaufbau (`regeneriereKampfplanFuerPool`) und plant danach die Matte neu. Der Sammelpool trägt `pools.verspaetet = true` und wird serverseitig überall außer mit `mitVerspaetet=1` (nur `pools.js`) ausgeblendet.

**Tech Stack:** Node.js/Express, Knex (PostgreSQL), `node:test` (Unit), Playwright (E2E), Vanilla-JS-Frontend.

**Spec:** `docs/specs/2026-10-10-nachzuegler-pool-design.md` (Revision 2; ergänzt `docs/specs/2026-10-08-waage-runden-design.md`)

## Global Constraints

- Sprache der Oberfläche, Fehlermeldungen und Kommentare: Deutsch; Code-Bezeichner wie im Bestand (`istXyz`, `ermittleXyz`).
- Routen sind Factories mit Knex-Injection (`getPoolRoutes(knex)`); keine neuen globalen Zustände.
- Neue Spalten nur über eine Migration in `migrations/` (Dateiname `YYYYMMDDHHMMSS_beschreibung.js`, ES-Modul, `up`/`down`).
- `src/shared/` bleibt DB-/DOM-frei; `clientAntworten.js` und der Server müssen dieselbe Sperrregel rechnen.
- Ein Pool ist gesperrt, sobald er einen Kampf mit Status `gestartet`/`beendet` hat (`poolHatBereitsEchteKaempfe`); Einfügen nur in Pools ohne solche Kämpfe.
- Mannschafts-Pools (`typ = 'mannschaft'`) sind nie Ziel eines Nachzüglers und behalten ihr Sperrmodell.
- Sammelpool: genau einer je Turnier, `bezeichnung = 'Verspätet'`, `altersklasse = 'Verspätet'`, `geschlecht = 'mixed'`, `gewichtsklasse = '-'` (NOT-NULL-Spalten), `modus = 'Nicht startbereit'`, keine Kämpfe, keine Matte, `verspaetet = true`.
- Der Sammelpool taucht nur in `pools.html` auf (`/api/pools/details?...&mitVerspaetet=1`); alle anderen Auflistungen blenden ihn aus.
- Kein „Abweisen“, keine „Eigener Pool je Nachzügler“-Funktion.
- Tests laufen seriell gegen eine gemeinsame DB; neue E2E-Specs legen ein eigenes Turnier an.
- `teilnehmerController.js` enthält ein NUL-Byte (Grep meldet „binary file“): Änderungen dort per exaktem `Edit` mit eindeutigem Kontext, nicht per Neuschreiben der Datei.

## Review Focus

- Nachzügler wird eingefügt, während parallel ein Kampf des Pools startet → 409, Teilnehmer bleibt unzugeordnet bzw. landet im Sammelpool (Task 5, Test).
- Pool wächst über eine Systemgrenze (5 → 6: Gruppen-Überkreuz, 8 → 9: Doppel-KO-16) oder über 32 → richtiges System bzw. Pool wird nicht angeboten (Task 4, Test).
- Teilnehmer ohne Gewicht (`gewicht` leer/0) → kein Vorschlag, wandert in den Sammelpool, kein Absturz (Task 4/5, Test).
- Sammelpool taucht nirgends sonst auf: Siegerliste, Urkunden, Matten, Dashboard, Übersicht, „Pools aufteilen“, Altersklassen-Status (Task 3, Test).
- Drag&Drop aus dem Sammelpool erzeugt keinen Kampfplan für den Sammelpool (Task 5, Test).
- Client-Gerät (Dokument-DB) rechnet `gesperrtePoolIds` wie der Server (Task 1, Test).

---

### Task 1: `gesperrtePoolIds` im Pool-Zustand (Server und Client-Antwort)

**Files:**
- Modify: `src/controllers/poolController.js:455-481` (`ermittleAltersklassenPoolZustand`), `src/controllers/poolController.js:1012-1028` (`pruefeTeilnehmerlisteGesperrt`)
- Modify: `src/shared/clientAntworten.js:131-156`
- Test: `tests/unit/clientAntworten.test.js`

**Interfaces:**
- Produces: `ermittleAltersklassenPoolZustand(knex, turnierId)` → `{ ausgelosteAltersklassen: string[], gesperrteAltersklassen: string[], gesperrtePoolIds: number[] }`; `GET /api/pools/vorhanden` und Client-Antwort `/pools/vorhanden` enthalten zusätzlich `gesperrtePoolIds: number[]`.

- [ ] **Step 1: Failing test ergänzen**

In `tests/unit/clientAntworten.test.js` den bestehenden Aufruf (Zeile 63) um das neue Feld erweitern und einen Fall mit gesperrtem Pool ergänzen. Die vorhandene Hilfsfunktion `anfrage(...)` und die Fixture-Struktur (`docs.pool`, `docs.teilnehmer`, `docs.kampf`) aus den benachbarten Tests übernehmen (Datei zuerst lesen). Erwartung:

```js
assert.deepEqual(
    (await anfrage('GET', '/pools/vorhanden', { query: { turnierId: '1' } })).body,
    { mannschaftenGesperrt: false, gesperrt: false, gesperrteAltersklassen: [], gesperrtePoolIds: [], ausgelosteAltersklassen: [] }
);
```

und in einem neuen Test mit einem Einzel-Pool `{ id: 7, turnier_id: 1, typ: 'einzel', altersklasse: 'U11' }`, einem Teilnehmer mit `pool_id: 7` und einem Kampf `{ pool_id: 7, status: 'beendet' }`:

```js
assert.deepEqual(body.gesperrtePoolIds, [7]);
assert.deepEqual(body.gesperrteAltersklassen, ['U11']);
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag prüfen**

Run: `npm run test:unit -- tests/unit/clientAntworten.test.js`
Expected: FAIL (`gesperrtePoolIds` fehlt).

- [ ] **Step 3: Client-Antwort implementieren**

In `src/shared/clientAntworten.js` (Block `if (pfad === '/pools/vorhanden')`) den Schluss ersetzen:

```js
            const einzelPoolIds = new Set(pools.map(p => String(p.id)));
            const gesperrtePoolIds = [...poolIdsMitEchtenKaempfen]
                .filter(id => einzelPoolIds.has(id))
                .map(Number)
                .sort((a, b) => a - b);
            const mannschaftsPoolIds = new Set(turnierPools.filter(p => p.typ === 'mannschaft').map(p => String(p.id)));
            return ok({
                mannschaftenGesperrt: [...mannschaftsPoolIds].some(id => poolIdsMitEchtenKaempfen.has(id)),
                gesperrt: gesperrt.size > 0,
                gesperrteAltersklassen: [...gesperrt].sort(),
                gesperrtePoolIds,
                ausgelosteAltersklassen: [...ausgelost].sort()
            });
```

In derselben Funktion die Zeile `const pools = turnierPools.filter(p => p.typ !== 'mannschaft');` auf `... && !p.verspaetet` erweitern (Sammelpool zählt nicht als ausgeloste Altersklasse).

- [ ] **Step 4: Server-Zustand implementieren**

In `poolController.js` `ermittleAltersklassenPoolZustand`: die Pool-Abfrage um `.andWhere({ verspaetet: false })` ergänzen (die Spalte kommt in Task 3; bis dahin Reihenfolge der Tasks beachten: Task 3 vor Task 1 ausführen **oder** diese Zeile erst in Task 3 Step 4 setzen — Entscheidung: die Zeile wird in Task 3 ergänzt) und am Ende ändern:

```js
    return {
        ausgelosteAltersklassen: [...ausgelost].sort(),
        gesperrteAltersklassen: [...gesperrt].sort(),
        gesperrtePoolIds: pools.filter(p => poolIdsMitEchtenKaempfen.has(p.id)).map(p => p.id).sort((a, b) => a - b)
    };
```

In `pruefeTeilnehmerlisteGesperrt` das Feld mit ausgeben:

```js
        const { gesperrteAltersklassen, ausgelosteAltersklassen, gesperrtePoolIds } = await ermittleAltersklassenPoolZustand(knex, turnierId);
        return res.json({
            gesperrt: gesperrteAltersklassen.length > 0,
            gesperrteAltersklassen,
            gesperrtePoolIds,
            ausgelosteAltersklassen,
            mannschaftenGesperrt: await mannschaftsPoolsHabenEchteKaempfe(knex, turnierId)
        });
```

Den Kommentar darüber auf „gesperrte Pools bzw. Altersklassen“ anpassen.

- [ ] **Step 5: Tests laufen lassen**

Run: `npm run test:unit -- tests/unit/clientAntworten.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/controllers/poolController.js src/shared/clientAntworten.js tests/unit/clientAntworten.test.js
git commit -m "feat: gesperrtePoolIds im Pool-Zustand und in /pools/vorhanden"
```

---

### Task 2: Teilnehmer-Sperre je Pool, Anmeldung in ausgeloste Klassen erlaubt

**Files:**
- Modify: `src/controllers/teilnehmerController.js:56-101` (Konstanten, `istAltersklasseGesperrt`, `ermittleSperrgrund`, `istAltersklasseAusgelost`), `:227-229`, `:437-441`, `aktualisiereTeilnehmerDaten` (Ende, nach dem `update`)
- Modify: `src/controllers/poolController.js` (Export von `regeneriereKampfplanFuerPool`)
- Modify: `tests/e2e/waage-runden.spec.js:98-109, 148-162`

**Interfaces:**
- Consumes: `ermittleAltersklassenPoolZustand(...).gesperrtePoolIds` (Task 1)
- Produces: `export async function regeneriereKampfplanFuerPool(knex, poolId)` aus `poolController.js` (unverändertes Verhalten, nur exportiert)

- [ ] **Step 1: E2E-Spec auf das neue Verhalten umstellen (Failing test)**

In `tests/e2e/waage-runden.spec.js` den Test „Ausgeloste Altersklasse ist ohne Neu-Generieren abgewiesen (409), Nachmeldung ebenso“ ersetzen:

```js
    test('Ausgeloste Altersklasse ist ohne Neu-Generieren abgewiesen (409), Nachmeldung ist möglich', async ({ request }) => {
        const doppelt = await generiere(request, { altersklassen: ['U11'] });
        expect(doppelt.status()).toBe(409);

        // Nachmeldung in ausgeloste Klasse: wird angenommen, der Teilnehmer startet ohne Pool
        const { resp, body } = await legeTeilnehmerAn(request, 'U11', 99, { gewogen: true, gewichtsklasse: '-30' });
        expect(resp.status(), JSON.stringify(body)).toBe(201);
        const alle = await holeTeilnehmer(request);
        expect(alle.find(t => t.id === body.teilnehmerId).pool_id).toBeNull();
        await request.delete(`/api/teilnehmer/${body.teilnehmerId}`); // wieder aufräumen

        const vorhanden = await (await request.get(`/api/pools/vorhanden?turnierId=${turnierId}`)).json();
        expect(vorhanden.ausgelosteAltersklassen).toEqual(['U11', 'U13']);
        expect(vorhanden.gesperrteAltersklassen).toEqual([]);
        expect(vorhanden.gesperrtePoolIds).toEqual([]);
        expect(vorhanden.gesperrt).toBe(false);
    });
```

Im Test „Ein U11-Kampf wird beendet …“ nach `expect(vorhanden.gesperrteAltersklassen).toEqual(['U11']);` ergänzen: `expect(vorhanden.gesperrtePoolIds).toEqual([u11Pool.id]);`. Den Test „Teilnehmer gesperrter Klassen sind gesperrt …“ umbenennen in „Teilnehmer gesperrter Pools sind gesperrt, offene Pools bleiben bearbeitbar“ (Inhalt unverändert, `teilnehmer.U11[0]` liegt im Pool mit dem beendeten Kampf).

- [ ] **Step 2: Test laufen lassen, Fehlschlag prüfen**

Run: `npx playwright test tests/e2e/waage-runden.spec.js -g "Nachmeldung ist möglich"`
Expected: FAIL (Antwort 409 statt 201).

- [ ] **Step 3: Sperrregel auf den Pool umstellen**

In `src/controllers/teilnehmerController.js` den Block 56-66 ersetzen:

```js
// Waage in Runden: die Sperre gilt je Pool. Ein Teilnehmer ist gesperrt, sobald sein eigener Pool echte
// Kämpfe hat; Teilnehmer ohne Pool (oder im Sammelpool "Verspätet") sind nie gesperrt. Neue Anmeldungen
// sind auch in ausgeloste Altersklassen möglich (Nachzügler, siehe poolController getNachzuegler).
const POOL_GESPERRT_FEHLER = 'Der Pool dieses Teilnehmers ist gesperrt, da dort bereits Kämpfe stattgefunden haben.';

async function istPoolGesperrt(knex, athlet) {
    if (athlet.pool_id == null) return false;
    const { gesperrtePoolIds } = await ermittleAltersklassenPoolZustand(knex, athlet.turnier_id);
    return gesperrtePoolIds.includes(Number(athlet.pool_id));
}
```

In `ermittleSperrgrund` die letzte Zeile ersetzen:

```js
    return await istPoolGesperrt(knex, athlet) ? POOL_GESPERRT_FEHLER : null;
```

Die Funktion `istAltersklasseAusgelost` (Zeilen 97-101) und die Konstante `ALTERSKLASSE_AUSGELOST_FEHLER` löschen; den Kommentar „Alle Teilnehmer sind gesperrt, wenn ihre eigene Altersklasse echte Kämpfe hat.“ in „… wenn ihr eigener Pool echte Kämpfe hat.“ ändern.

Bei der Anmeldung (um Zeile 227) den Block

```js
    if (await istAltersklasseAusgelost(knex, turnier.id, ermittelteAltersklasse)) {
        throw new FachFehler(409, ALTERSKLASSE_AUSGELOST_FEHLER);
    }
```

ersatzlos entfernen; in `aktualisiereTeilnehmerDaten` den Block „Wechsel in eine bereits ausgeloste Altersklasse …“ (Zeilen 437-441) ebenfalls entfernen. Ist `ermittelteAltersklasse` danach ungenutzt, die Variable nur dann entfernen, wenn sie nicht mehr für den Insert gebraucht wird (Datei lesen).

- [ ] **Step 4: Altersklassenwechsel löst den Pool**

`regeneriereKampfplanFuerPool` in `poolController.js` exportieren (`export async function regeneriereKampfplanFuerPool(knex, poolId)`), und in `teilnehmerController.js` den Import erweitern:

```js
import { turnierHatEchteKaempfe, mannschaftsPoolsHabenEchteKaempfe, ermittleAltersklassenPoolZustand, regeneriereKampfplanFuerPool } from './poolController.js';
```

Am Ende von `aktualisiereTeilnehmerDaten`, nach dem `knex('turnier_teilnehmer').where({ id }).update(...)`:

```js
    // Wechselt ein Teilnehmer die Altersklasse, passt er nicht mehr in seinen Pool: Pool lösen und neu
    // aufbauen; er erscheint dann als Nachzügler (der Pool ist wegen ermittleSperrgrund ohne echte Kämpfe).
    // Der Sammelpool "Verspätet" hat keinen Kampfplan und wird nicht neu aufgebaut.
    if (athlet.pool_id != null && updates.altersklasse && updates.altersklasse !== athlet.altersklasse) {
        const alterPool = await knex('pools').where({ id: athlet.pool_id }).first();
        await knex('turnier_teilnehmer').where({ id }).update({ pool_id: null });
        if (alterPool && !alterPool.verspaetet) await regeneriereKampfplanFuerPool(knex, athlet.pool_id);
    }
```

(`pools.verspaetet` existiert ab Task 3; bis dahin liefert `alterPool.verspaetet` `undefined`, das Verhalten ist korrekt.)

- [ ] **Step 5: Tests laufen lassen**

Run: `npx playwright test tests/e2e/waage-runden.spec.js tests/e2e/teilnehmer-pools-verteilung.spec.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/controllers/teilnehmerController.js src/controllers/poolController.js tests/e2e/waage-runden.spec.js
git commit -m "feat: Teilnehmer-Sperre je Pool, Nachmeldung in ausgeloste Altersklassen erlaubt"
```

---

### Task 3: Spalte `pools.verspaetet` und Ausblendung des Sammelpools überall außer `pools.html`

**Files:**
- Create: `migrations/20261010100000_add_verspaetet_zu_pools.js`
- Modify: `src/controllers/poolController.js` — `getPoolsMitDetails` (~1081), `getKampfflaechenMitPools` (~1358), `verteilePools` (~1605), `getDashboardData` (~2015), `getPoolUebersicht` (~2170), `ermittleAltersklassenPoolZustand` (~457)
- Modify: `src/services/urkundenDaten.js:78-88` (`ladePools`)
- Modify: `public/js/pools.js:134, 627` (`&mitVerspaetet=1`)
- Test: `tests/unit/urkundenDatenVerspaetet.test.js` (neu)

**Interfaces:**
- Produces: Spalte `pools.verspaetet boolean not null default false`; `GET /api/pools/details` blendet `verspaetet = true` standardmäßig aus, mit Query `mitVerspaetet=1` nicht.

- [ ] **Step 1: Migration schreiben**

```js
// Sammelpool "Verspätet" für Nachzügler (docs/specs/2026-10-10-nachzuegler-pool-design.md): das Kennzeichen steuert
// die Ausblendung in allen Anzeigen außer der Pool-Verwaltung, unabhängig vom Namen des Pools.
export async function up(knex) {
    await knex.schema.alterTable('pools', (table) => {
        table.boolean('verspaetet').notNullable().defaultTo(false);
    });
}

export async function down(knex) {
    await knex.schema.alterTable('pools', (table) => { table.dropColumn('verspaetet'); });
}
```

`setup_db.js` (Tabelle `pools`, Zeile ~123) um `table.boolean('verspaetet').notNullable().defaultTo(false);` ergänzen, damit ein frisch aufgebautes Schema identisch ist.

- [ ] **Step 2: Failing Test für die Urkunden-Ausblendung**

`tests/unit/urkundenDatenVerspaetet.test.js` nach dem Muster der DB-Unit-Tests (`tests/unit/migration-sync.test.js`, Start über `tests/helpers/testPostgres.js`): Turnier, ein regulärer Einzel-Pool (`bezeichnung: 'U11 m -30kg'`) mit einem Teilnehmer und ein Sammelpool (`verspaetet: true`, `bezeichnung: 'Verspätet'`, `altersklasse: 'Verspätet'`, `geschlecht: 'mixed'`, `gewichtsklasse: '-'`) mit einem Teilnehmer. Erwartung:

```js
const uebersicht = await ladeUebersicht(knex, turnierId);
assert.deepEqual(uebersicht.pools.map(p => p.bezeichnung), ['U11 m -30kg']);
const jePool = await ladeUrkundenDatenJePool(knex, turnierId, { platzbereich: 'alle', poolIds: null, reihenfolge: 'absteigend' });
assert.ok(jePool.every(p => p.poolId !== sammelPoolId));
```

(Pflichtspalten von `turniere`/`pools` aus den Migrationen ablesen.)

- [ ] **Step 3: Test laufen lassen, Fehlschlag prüfen**

Run: `npm run test:unit -- tests/unit/urkundenDatenVerspaetet.test.js`
Expected: FAIL (`verspaetet` unbekannt bzw. Sammelpool erscheint)

- [ ] **Step 4: Ausblendung implementieren**

In `src/services/urkundenDaten.js` `ladePools`:

```js
async function ladePools(knex, turnierId, poolIds) {
    // Der Sammelpool "Verspätet" (Nachzügler) erhält keine Siegerehrung und damit keine Urkunden.
    let abfrage = knex('pools').where({ turnier_id: turnierId, verspaetet: false });
```

In `poolController.js`:

- `getPoolsMitDetails`: Abfrage ersetzen durch
  ```js
  const mitVerspaetet = req.query.mitVerspaetet === '1';
  const abfrage = knex('pools').where({ turnier_id: turnierId }).andWhereNot({ typ: 'mannschaft' });
  if (!mitVerspaetet) abfrage.andWhere({ verspaetet: false });
  const pools = await abfrage;
  ```
- `getKampfflaechenMitPools`: an der Pool-Abfrage `.where('pools.turnier_id', turnierId)` → `.where('pools.turnier_id', turnierId).andWhere('pools.verspaetet', false)`.
- `verteilePools`: `const pools = await knex('pools').where({ turnier_id: parseInt(turnierId), verspaetet: false });`
- `getDashboardData`: `.where('pools.turnier_id', parseInt(turnierId)).andWhere('pools.verspaetet', false);`
- `getPoolUebersicht`: `.where({ turnier_id: parseInt(turnierId), verspaetet: false })` und die Teilnehmerabfrage um `.whereIn('pool_id', pools.map(p => p.id))` ergänzen (Teilnehmer des Sammelpools bleiben außen vor).
- `ermittleAltersklassenPoolZustand`: `.where({ turnier_id: turnierId, verspaetet: false })`.
- `getAltersklassenStatus` nutzt `ermittleAltersklassenPoolZustand` und bleibt dadurch frei vom Sammelpool; Teilnehmer im Sammelpool zählen weiter über ihre eigene Altersklasse.

In `public/js/pools.js` an den beiden Aufrufen (Zeilen 134 und 627) `&mitVerspaetet=1` an die URL hängen; Zeile 1778 (Druck aller Pools) bleibt ohne.

- [ ] **Step 5: Tests laufen lassen**

Run: `npm run test:unit -- tests/unit/urkundenDatenVerspaetet.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add migrations/20261010100000_add_verspaetet_zu_pools.js setup_db.js src/controllers/poolController.js src/services/urkundenDaten.js public/js/pools.js tests/unit/urkundenDatenVerspaetet.test.js
git commit -m "feat: pools.verspaetet, Sammelpool aus allen Anzeigen außer pools.html ausblenden"
```

---

### Task 4: Vorschlagsberechnung für Nachzügler (reine Funktion)

**Files:**
- Create: `src/services/nachzuegler.js`
- Modify: `src/controllers/poolController.js` (Exports `pruefeGewichtsspanne`, `waehleWettkampfsystem`)
- Test: `tests/unit/nachzuegler.test.js`

**Interfaces:**
- Consumes: `pruefeGewichtsspanne(teilnehmerListe, altersklasse) -> { zulaessig }`, `waehleWettkampfsystem(anzahl) -> string` (wirft ab 33)
- Produces:
  ```js
  export function berechneVorschlag(nachzuegler, offenePools, { pruefeSpanne, waehleSystem })
  // nachzuegler: { id, altersklasse, geschlecht, gewicht, gewichtsklasse }
  // offenePools: [{ id, bezeichnung, altersklasse, geschlecht, gewichtsklasse, kampfflaeche_id, teilnehmer: [{ gewicht }] }]
  // -> { poolId, bezeichnung, teilnehmerNachher, systemNachher, matteId } | null
  ```

- [ ] **Step 1: Failing Tests schreiben**

`tests/unit/nachzuegler.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { berechneVorschlag } from '../../src/services/nachzuegler.js';

// vereinfachte Spanne: zulässig, wenn der Unterschied höchstens 3 kg beträgt
const pruefeSpanne = (liste) => {
    const g = liste.map(t => Number(t.gewicht));
    return { zulaessig: g.every(x => Number.isFinite(x) && x > 0) && Math.max(...g) - Math.min(...g) <= 3 };
};
const waehleSystem = (n) => {
    if (n < 2) return 'Nicht startbereit';
    if (n <= 5) return 'Jeder-gegen-Jeden';
    if (n === 6) return 'Gruppen-Überkreuz';
    if (n <= 8) return 'Doppel-KO-8';
    if (n <= 16) return 'Doppel-KO-16';
    if (n <= 32) return 'Doppel-KO-32';
    throw new Error('zu groß');
};
const optionen = { pruefeSpanne, waehleSystem };
const pool = (id, extra = {}) => ({
    id, bezeichnung: `Pool ${id}`, altersklasse: 'U11', geschlecht: 'männlich', gewichtsklasse: '-30',
    kampfflaeche_id: 2, teilnehmer: [{ gewicht: 28 }, { gewicht: 29 }, { gewicht: 30 }], ...extra
});
const nz = { id: 1, altersklasse: 'U11', geschlecht: 'männlich', gewicht: 29.5, gewichtsklasse: '-30' };

test('schlägt den passenden offenen Pool samt neuem System vor', () => {
    const v = berechneVorschlag(nz, [pool(10)], optionen);
    assert.deepEqual(v, { poolId: 10, bezeichnung: 'Pool 10', teilnehmerNachher: 4, systemNachher: 'Jeder-gegen-Jeden', matteId: 2 });
});

test('Pool mit zu großer Gewichtsspanne wird nicht vorgeschlagen', () => {
    const schwer = pool(11, { teilnehmer: [{ gewicht: 36 }, { gewicht: 37 }] });
    assert.equal(berechneVorschlag(nz, [schwer], optionen), null);
});

test('anderes Geschlecht passt nicht, ein Mixed-Pool schon', () => {
    const weiblich = pool(12, { geschlecht: 'weiblich' });
    const mixed = pool(13, { geschlecht: 'mixed' });
    assert.equal(berechneVorschlag(nz, [weiblich], optionen), null);
    assert.equal(berechneVorschlag(nz, [weiblich, mixed], optionen).poolId, 13);
});

test('andere Altersklasse passt nicht', () => {
    assert.equal(berechneVorschlag(nz, [pool(14, { altersklasse: 'U13' })], optionen), null);
});

test('Systemgrenze: ein 5er-Pool wird mit dem Nachzügler zum Gruppen-Überkreuz', () => {
    const fuenf = pool(15, { teilnehmer: [28, 28.5, 29, 29.5, 30].map(g => ({ gewicht: g })) });
    assert.equal(berechneVorschlag(nz, [fuenf], optionen).systemNachher, 'Gruppen-Überkreuz');
});

test('ein 32er-Pool wird nicht mehr angeboten (kein System für 33)', () => {
    const voll = pool(16, { teilnehmer: Array.from({ length: 32 }, () => ({ gewicht: 29 })) });
    assert.equal(berechneVorschlag(nz, [voll], optionen), null);
});

test('Teilnehmer ohne Gewicht: kein Vorschlag, kein Absturz', () => {
    assert.equal(berechneVorschlag({ ...nz, gewicht: null }, [pool(17)], optionen), null);
    assert.equal(berechneVorschlag({ ...nz, gewicht: 0 }, [pool(17)], optionen), null);
});

test('bevorzugt den Pool mit gleicher Gewichtsklasse, dann den mit geringerem Abstand', () => {
    const a = pool(20, { gewichtsklasse: '-34', teilnehmer: [{ gewicht: 29 }, { gewicht: 29.6 }] });
    const b = pool(21, { gewichtsklasse: '-30', teilnehmer: [{ gewicht: 27.5 }, { gewicht: 28.5 }] });
    assert.equal(berechneVorschlag(nz, [a, b], optionen).poolId, 21);
    const c = pool(22, { gewichtsklasse: '-30', teilnehmer: [{ gewicht: 27.4 }, { gewicht: 27.6 }] });
    assert.equal(berechneVorschlag(nz, [c, b], optionen).poolId, 21);
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag prüfen**

Run: `npm run test:unit -- tests/unit/nachzuegler.test.js`
Expected: FAIL (Modul fehlt)

- [ ] **Step 3: Implementierung**

`src/services/nachzuegler.js`:

```js
// Nachzügler-Vorschlag (Spec docs/specs/2026-10-10-nachzuegler-pool-design.md): reine Funktion ohne DB.
// pruefeSpanne und waehleSystem übergibt der Aufrufer (poolController), damit hier kein Controller-Import nötig ist.

function gewichtsAbstand(gewicht, teilnehmer) {
    const gewichte = teilnehmer.map(t => Number.parseFloat(t.gewicht)).filter(Number.isFinite);
    if (!Number.isFinite(gewicht) || gewichte.length === 0) return Number.POSITIVE_INFINITY;
    const leicht = Math.min(...gewichte);
    const schwer = Math.max(...gewichte);
    if (gewicht >= leicht && gewicht <= schwer) return 0;
    return Math.min(Math.abs(gewicht - leicht), Math.abs(gewicht - schwer));
}

export function berechneVorschlag(nachzuegler, offenePools, { pruefeSpanne, waehleSystem }) {
    const gewicht = Number.parseFloat(nachzuegler.gewicht);
    if (!Number.isFinite(gewicht) || gewicht <= 0) return null;

    const kandidaten = [];
    for (const pool of offenePools) {
        if (pool.altersklasse !== nachzuegler.altersklasse) continue;
        if (pool.geschlecht !== 'mixed' && pool.geschlecht !== nachzuegler.geschlecht) continue;
        const nachher = pool.teilnehmer.length + 1;
        let systemNachher;
        try {
            systemNachher = waehleSystem(nachher);
        } catch {
            continue; // größer als das größte Wettkampfsystem
        }
        if (!pruefeSpanne([...pool.teilnehmer, { gewicht }], pool.altersklasse).zulaessig) continue;
        kandidaten.push({
            poolId: pool.id,
            bezeichnung: pool.bezeichnung,
            teilnehmerNachher: nachher,
            systemNachher,
            matteId: pool.kampfflaeche_id ?? null,
            klasseGleich: pool.gewichtsklasse != null && pool.gewichtsklasse === nachzuegler.gewichtsklasse ? 0 : 1,
            abstand: gewichtsAbstand(gewicht, pool.teilnehmer),
            groesse: pool.teilnehmer.length
        });
    }
    if (kandidaten.length === 0) return null;
    kandidaten.sort((a, b) => a.klasseGleich - b.klasseGleich || a.abstand - b.abstand || a.groesse - b.groesse || a.poolId - b.poolId);
    const { klasseGleich, abstand, groesse, ...vorschlag } = kandidaten[0];
    return vorschlag;
}
```

Und in `poolController.js` `function waehleWettkampfsystem` und `function pruefeGewichtsspanne` mit `export` versehen.

- [ ] **Step 4: Tests laufen lassen**

Run: `npm run test:unit -- tests/unit/nachzuegler.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/nachzuegler.js src/controllers/poolController.js tests/unit/nachzuegler.test.js
git commit -m "feat: Vorschlagsberechnung für Nachzügler"
```

---

### Task 5: Nachzügler-API (Liste, Einsortieren, Sammeln), Verschieben und Matten-Neuplanung

**Files:**
- Modify: `src/controllers/poolController.js` (neue Funktionen nach `verschiebeTeilnehmer`; `verschiebeTeilnehmer` selbst; Export `initialisiereKaempfeFuerPool` nicht nötig)
- Modify: `src/routes/poolRoutes.js`
- Create: `tests/e2e/nachzuegler-pool.spec.js`

**Interfaces:**
- Consumes: `berechneVorschlag` (Task 4), `ermittleAltersklassenPoolZustand` (Task 1), Spalte `pools.verspaetet` (Task 3)
- Produces:
  - `GET /api/pools/nachzuegler?turnierId=` → `{ success: true, nachzuegler: [{ teilnehmerId, name, verein, altersklasse, geschlecht, gewicht, vorschlag }], imSammelpool: number }` (`vorschlag` = Objekt oder `null`)
  - `POST /api/pools/nachzuegler/:teilnehmerId/einsortieren` Body `{ turnierId, poolId }` → `{ success: true, poolId, modus }`, Fehler 404/409
  - `POST /api/pools/nachzuegler/sammeln` Body `{ turnierId }` → `{ success: true, anzahl }`

- [ ] **Step 1: E2E-Spec schreiben (Failing test)**

`tests/e2e/nachzuegler-pool.spec.js`:

```js
// End-to-End: Nachzügler in ausgeloste Altersklassen (docs/specs/2026-10-10-nachzuegler-pool-design.md).
import { test, expect } from '@playwright/test';

test.describe.serial('Nachzügler', () => {
    let turnierId;
    let poolId;
    const ids = {};

    async function legeAn(request, name, gewicht, extra = {}) {
        const resp = await request.post('/api/teilnehmer', {
            data: {
                turnier_id: turnierId, vorname: name, nachname: 'Test', verein: 'JC Nachzug',
                geburtsjahr: 2016, geschlecht: 'männlich', gewicht, altersklasse: 'U11', gewichtsklasse: '-30',
                lizenz_ablauf: '2099-12-31', gewogen: true, ...extra
            }
        });
        const body = await resp.json();
        expect(resp.ok(), JSON.stringify(body)).toBeTruthy();
        return body.teilnehmerId;
    }
    const holePools = async (request, mit = false) =>
        (await (await request.get(`/api/pools/details?turnierId=${turnierId}${mit ? '&mitVerspaetet=1' : ''}`)).json());
    const holeNachzuegler = async (request) => (await (await request.get(`/api/pools/nachzuegler?turnierId=${turnierId}`)).json());
    const sammeln = (request) => request.post('/api/pools/nachzuegler/sammeln', { data: { turnierId } });

    test('Turnier, U11-Pool mit vier Teilnehmern ausgelost und auf der Matte', async ({ request }) => {
        const resp = await request.post('/api/turniere', {
            data: { bezeichnung: `E2E Nachzügler ${Date.now()}`, ort: 'Halle', datum: '2027-06-12', ausrichter: 'JC Nachzug', anzahl_kampfflaechen: 1 }
        });
        turnierId = (await resp.json()).turnierId;
        for (const [i, g] of [28, 29, 29.5, 30].entries()) ids[`t${i}`] = await legeAn(request, `Stamm${i}`, g);
        const gen = await request.post('/api/pools/generieren', { data: { turnierId, altersklassen: ['U11'] } });
        expect(gen.ok(), await gen.text()).toBeTruthy();
        const verteilt = await request.post('/api/pools/aufteilen', { data: { turnierId } });
        expect(verteilt.ok(), await verteilt.text()).toBeTruthy();
        poolId = (await holePools(request))[0].id;
    });

    test('Nachzügler erscheint mit Vorschlag auf den offenen Pool', async ({ request }) => {
        ids.spaet = await legeAn(request, 'Spaet', 29.2);
        const { nachzuegler } = await holeNachzuegler(request);
        const eintrag = nachzuegler.find(n => n.teilnehmerId === ids.spaet);
        expect(eintrag, JSON.stringify(nachzuegler)).toBeTruthy();
        expect(eintrag.vorschlag).toMatchObject({ poolId, teilnehmerNachher: 5, systemNachher: 'Jeder-gegen-Jeden' });
        expect(eintrag.vorschlag.matteId).not.toBeNull();
    });

    test('Einsortieren baut den Pool neu auf, die Matte plant neu', async ({ request }) => {
        const resp = await request.post(`/api/pools/nachzuegler/${ids.spaet}/einsortieren`, { data: { turnierId, poolId } });
        expect(resp.ok(), await resp.text()).toBeTruthy();

        const nachher = (await holePools(request)).find(p => p.id === poolId);
        expect(nachher.anzahl_teilnehmer).toBe(5);
        expect(nachher.kaempfe.filter(k => k.status !== 'freilos')).toHaveLength(10); // 5er Jeder-gegen-Jeden
        expect(nachher.kaempfe.every(k => k.matten_reihenfolge != null)).toBeTruthy();
        expect((await holeNachzuegler(request)).nachzuegler.some(n => n.teilnehmerId === ids.spaet)).toBe(false);
    });

    test('Nach dem ersten echten Kampf ist der Pool zu: Einsortieren → 409, Sammeln → Sammelpool', async ({ request }) => {
        const kampf = (await (await request.get(`/api/kaempfe?poolId=${poolId}`)).json()).find(k => k.status === 'bereit');
        const beendet = await request.put(`/api/kaempfe/${kampf.id}`, {
            data: { status: 'beendet', sieger_id: kampf.kaempfer1_id, unterbewertung_kaempfer1: 10, unterbewertung_kaempfer2: 0, kampfzeit_in_sekunden: 60 }
        });
        expect(beendet.ok(), await beendet.text()).toBeTruthy();

        ids.zuSpaet = await legeAn(request, 'ZuSpaet', 29.4);
        const resp = await request.post(`/api/pools/nachzuegler/${ids.zuSpaet}/einsortieren`, { data: { turnierId, poolId } });
        expect(resp.status()).toBe(409);

        const eintrag = (await holeNachzuegler(request)).nachzuegler.find(n => n.teilnehmerId === ids.zuSpaet);
        expect(eintrag.vorschlag).toBeNull();

        const gesammelt = await sammeln(request);
        expect((await gesammelt.json()).anzahl).toBe(1);
        const alle = await (await request.get(`/api/teilnehmer?turnierId=${turnierId}`)).json();
        const sammelpool = (await holePools(request, true)).find(p => p.verspaetet);
        expect(sammelpool).toMatchObject({ bezeichnung: 'Verspätet', anzahl_teilnehmer: 1, modus: 'Nicht startbereit' });
        expect(sammelpool.kampfflaeche_id).toBeNull();
        expect(sammelpool.kaempfe).toHaveLength(0);
        expect(alle.find(t => t.id === ids.zuSpaet).pool_id).toBe(sammelpool.id);

        // idempotent: nichts mehr zu sammeln, kein zweiter Sammelpool
        expect((await (await sammeln(request)).json()).anzahl).toBe(0);
        expect((await holePools(request, true)).filter(p => p.verspaetet)).toHaveLength(1);
    });

    test('Sammelpool fehlt in allen Anzeigen außer der Pool-Verwaltung', async ({ request }) => {
        expect((await holePools(request)).some(p => p.verspaetet)).toBe(false);
        const matten = await (await request.get(`/api/pools/kampfflaechen?turnierId=${turnierId}`)).json();
        expect(matten.pools.some(p => p.verspaetet)).toBe(false);
        const urkunden = await (await request.get(`/api/urkunden/uebersicht?turnierId=${turnierId}`)).json();
        expect(JSON.stringify(urkunden)).not.toContain('Verspätet');
        const vorhanden = await (await request.get(`/api/pools/vorhanden?turnierId=${turnierId}`)).json();
        expect(vorhanden.ausgelosteAltersklassen).not.toContain('Verspätet');
        const aufteilen = await request.post('/api/pools/aufteilen', { data: { turnierId } });
        expect(aufteilen.status()).toBe(400); // nichts zu verteilen: der Sammelpool wird nie verteilt
    });

    test('Drag&Drop aus dem Sammelpool in einen offenen Pool', async ({ request }) => {
        // zweiter, noch offener Pool derselben Klasse
        for (const [i, g] of [40, 41, 42].entries()) ids[`s${i}`] = await legeAn(request, `Schwer${i}`, g, { gewichtsklasse: '-45' });
        const gen = await request.post('/api/pools/generieren', { data: { turnierId, altersklassen: ['U11'], neuGenerieren: true } });
        expect(gen.status()).toBe(409); // U11 hat schon einen echten Kampf: kein Neu-Generieren
        const offenerPool = await request.post('/api/pools', {
            data: { turnier_id: turnierId, bezeichnung: 'U11 m -45kg', altersklasse: 'U11', geschlecht: 'männlich', gewichtsklasse: '-45' }
        });
        const offenerPoolId = (await offenerPool.json()).poolId;
        const sammelpool = (await holePools(request, true)).find(p => p.verspaetet);

        const verschoben = await request.post('/api/pools/verschieben', {
            data: { teilnehmerId: ids.zuSpaet, zielPoolId: offenerPoolId, turnierId }
        });
        expect(verschoben.ok(), await verschoben.text()).toBeTruthy();
        const nachher = await holePools(request, true);
        expect(nachher.find(p => p.id === sammelpool.id).kaempfe).toHaveLength(0); // kein Kampfplan für den Sammelpool
        expect(nachher.find(p => p.id === offenerPoolId).anzahl_teilnehmer).toBe(1);

        // in den Pool mit begonnenen Kämpfen geht es nicht
        const zu = await request.post('/api/pools/verschieben', { data: { teilnehmerId: ids.zuSpaet, zielPoolId: poolId, turnierId } });
        expect(zu.status()).toBe(409);
    });
});
```

(Den Endpunkt der Urkunden-Übersicht vor dem Schreiben mit `grep -n "uebersicht" src/routes/urkundenRoutes.js` prüfen und den Pfad im Test anpassen. Der Aufruf von `/api/pools/aufteilen` erwartet 400 „keine weiteren Pools“; ist durch den neu angelegten Pool anderes Verhalten möglich, die Prüfung nach dem Drag&Drop-Test verschieben oder weglassen, wenn nur der Sammelpool ausgeschlossen werden soll.)

- [ ] **Step 2: Test laufen lassen, Fehlschlag prüfen**

Run: `npx playwright test tests/e2e/nachzuegler-pool.spec.js`
Expected: FAIL (404 auf `/api/pools/nachzuegler`)

- [ ] **Step 3: Controller-Funktionen**

Import am Dateianfang von `poolController.js` ergänzen: `import { berechneVorschlag } from '../services/nachzuegler.js';`. Nach `verschiebeTeilnehmer` einfügen:

```js
// ---------- Nachzügler (Spec 2026-10-10-nachzuegler-pool-design.md) ----------

const NACHZUEGLER_FEHLER_KEIN_NACHZUEGLER = 'Der Teilnehmer ist kein Nachzügler (bereits einem Pool zugeordnet oder nicht kampfbereit).';

// Offene Einzel-Pools des Turniers (ohne gestartete/beendete Kämpfe, ohne Sammelpool) samt Teilnehmern.
async function ladeOffeneEinzelPools(knex, turnierId) {
    const { gesperrtePoolIds } = await ermittleAltersklassenPoolZustand(knex, turnierId);
    const gesperrt = new Set(gesperrtePoolIds);
    const pools = (await knex('pools').where({ turnier_id: turnierId, verspaetet: false }).andWhereNot({ typ: 'mannschaft' }))
        .filter(p => !gesperrt.has(p.id));
    const teilnehmer = pools.length === 0 ? [] : await knex('turnier_teilnehmer').whereIn('pool_id', pools.map(p => p.id));
    return pools.map(p => ({ ...p, teilnehmer: teilnehmer.filter(t => t.pool_id === p.id) }));
}

// Nachzügler: kampfbereit, ohne Pool, Altersklasse bereits ausgelost, kein reines Mannschaftsmitglied.
async function ladeNachzuegler(knex, turnierId) {
    const { ausgelosteAltersklassen } = await ermittleAltersklassenPoolZustand(knex, turnierId);
    if (ausgelosteAltersklassen.length === 0) return [];
    const mannschaftsMitgliedIds = new Set(
        await knex('mannschaft_mitglieder')
            .join('mannschaften', 'mannschaft_mitglieder.mannschaft_id', 'mannschaften.id')
            .where('mannschaften.turnier_id', turnierId)
            .pluck('mannschaft_mitglieder.turnier_teilnehmer_id')
    );
    return (await knex('turnier_teilnehmer')
        .where({ turnier_id: turnierId, status: 'kampfbereit' })
        .whereNull('pool_id')
        .whereIn('altersklasse', ausgelosteAltersklassen))
        .filter(t => !mannschaftsMitgliedIds.has(t.id) || t.auch_einzelwettkampf);
}

export async function getNachzuegler(knex, req, res) {
    try {
        const { turnierId } = req.query;
        if (!turnierId) return res.status(400).json({ success: false, error: 'turnierId ist erforderlich.' });
        const nachzuegler = await ladeNachzuegler(knex, turnierId);
        const offenePools = nachzuegler.length === 0 ? [] : await ladeOffeneEinzelPools(knex, turnierId);
        const liste = nachzuegler.map(t => ({
            teilnehmerId: t.id,
            name: `${t.vorname} ${t.nachname}`.trim(),
            verein: t.verein,
            altersklasse: t.altersklasse,
            geschlecht: t.geschlecht,
            gewicht: t.gewicht,
            vorschlag: berechneVorschlag(t, offenePools, { pruefeSpanne: pruefeGewichtsspanne, waehleSystem: waehleWettkampfsystem })
        }));
        const sammelpool = await knex('pools').where({ turnier_id: turnierId, verspaetet: true }).first();
        const imSammelpool = sammelpool
            ? parseInt((await knex('turnier_teilnehmer').where({ pool_id: sammelpool.id }).count('* as n').first()).n, 10)
            : 0;
        return res.json({ success: true, nachzuegler: liste, imSammelpool });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}

// Matte des Pools neu planen (die Kämpfe eines neu aufgebauten Pools haben keine Mattenreihenfolge).
async function aktualisiereMatteNachPoolAenderung(knex, poolId) {
    const pool = await knex('pools').where({ id: poolId }).first();
    if (pool && pool.kampfflaeche_id) {
        await planeKaempfeFuerKampfflaeche(knex, pool.kampfflaeche_id);
        await synchronisiereMattenStatus(knex, pool.kampfflaeche_id);
    }
}

export async function sortiereNachzuegler(knex, req, res) {
    try {
        const teilnehmerId = parseInt(req.params.teilnehmerId, 10);
        const poolId = parseInt(req.body.poolId, 10);
        if (!poolId) return res.status(400).json({ success: false, error: 'poolId ist erforderlich.' });

        const athlet = await knex('turnier_teilnehmer').where({ id: teilnehmerId }).first();
        if (!athlet) return res.status(404).json({ success: false, error: 'Teilnehmer nicht gefunden.' });
        if (athlet.pool_id != null || athlet.status !== 'kampfbereit') {
            return res.status(409).json({ success: false, error: NACHZUEGLER_FEHLER_KEIN_NACHZUEGLER });
        }
        const pool = await knex('pools').where({ id: poolId }).first();
        if (!pool || Number(pool.turnier_id) !== Number(athlet.turnier_id) || pool.typ === 'mannschaft' || pool.verspaetet) {
            return res.status(404).json({ success: false, error: 'Pool nicht gefunden.' });
        }

        // Prüfung und Zuordnung in einer Transaktion unter Zeilensperre auf den Kämpfen: beginnt parallel
        // ein Kampf, wird der Teilnehmer nicht mehr eingefügt.
        let ergebnis;
        await knex.transaction(async (trx) => {
            const kaempfe = await trx('kaempfe').where({ pool_id: poolId }).forUpdate().select('status');
            if (kaempfe.some(k => k.status === 'gestartet' || k.status === 'beendet')) {
                throw new FachFehler(409, 'In diesem Pool haben die Kämpfe bereits begonnen.');
            }
            await trx('turnier_teilnehmer').where({ id: teilnehmerId }).update({ pool_id: poolId });
            ergebnis = await regeneriereKampfplanFuerPool(trx, poolId);
        });

        await aktualisiereMatteNachPoolAenderung(knex, poolId);
        return res.json({ success: true, poolId, modus: ergebnis.modus });
    } catch (error) {
        return res.status(error.statusCode || 500).json({ success: false, error: error.message });
    }
}

// Sammelpool "Verspätet" des Turniers (wird beim ersten Bedarf angelegt).
async function holeOderErzeugeSammelpool(knex, turnierId) {
    const vorhanden = await knex('pools').where({ turnier_id: turnierId, verspaetet: true }).first();
    if (vorhanden) return vorhanden;
    const [idObj] = await knex('pools').insert({
        turnier_id: turnierId,
        bezeichnung: 'Verspätet',
        modus: 'Nicht startbereit',
        altersklasse: 'Verspätet',
        geschlecht: 'mixed',
        gewichtsklasse: '-',
        status: 'teilnehmer_zugewiesen',
        verspaetet: true
    }).returning('id');
    const id = typeof idObj === 'object' ? idObj.id : idObj;
    return knex('pools').where({ id }).first();
}

// Nachzügler ohne passenden offenen Pool in den Sammelpool legen (idempotent).
export async function sammleVerspaetete(knex, req, res) {
    try {
        const turnierId = parseInt(req.body.turnierId, 10);
        if (!turnierId) return res.status(400).json({ success: false, error: 'turnierId ist erforderlich.' });

        const nachzuegler = await ladeNachzuegler(knex, turnierId);
        const offenePools = nachzuegler.length === 0 ? [] : await ladeOffeneEinzelPools(knex, turnierId);
        const ohneVorschlag = nachzuegler.filter(t =>
            !berechneVorschlag(t, offenePools, { pruefeSpanne: pruefeGewichtsspanne, waehleSystem: waehleWettkampfsystem }));
        if (ohneVorschlag.length === 0) return res.json({ success: true, anzahl: 0 });

        const sammelpool = await holeOderErzeugeSammelpool(knex, turnierId);
        await knex('turnier_teilnehmer').whereIn('id', ohneVorschlag.map(t => t.id)).update({ pool_id: sammelpool.id });
        return res.json({ success: true, anzahl: ohneVorschlag.length, poolId: sammelpool.id });
    } catch (error) {
        return res.status(error.statusCode || 500).json({ success: false, error: error.message });
    }
}
```

`FachFehler` ist in `poolController.js` bereits importiert (wird in `schliessePool` genutzt).

- [ ] **Step 4: `verschiebeTeilnehmer` — Sammelpool und Matten-Neuplanung**

In `verschiebeTeilnehmer` (`poolController.js` ~1121) die Transaktion und das Ende ändern. Vor der Transaktion Sammelpools bestimmen:

```js
        const betroffenePools = await knex('pools').whereIn('id', betroffenePoolIds).select('id', 'verspaetet');
        const sammelpoolIds = new Set(betroffenePools.filter(p => p.verspaetet).map(p => p.id));
```

In der Schleife der Transaktion nur Pools mit Kampfplan neu aufbauen:

```js
            for (const poolId of betroffenePoolIds) {
                if (sammelpoolIds.has(poolId)) continue; // der Sammelpool hat nie Kämpfe
                const ergebnis = await regeneriereKampfplanFuerPool(trx, poolId);
                if (ergebnis) ergebnisse.push(ergebnis);
            }
```

Nach der Transaktion, vor `return res.json({ success: true, aktualisiertePools })`:

```js
        for (const poolId of betroffenePoolIds) {
            if (!sammelpoolIds.has(poolId)) await aktualisiereMatteNachPoolAenderung(knex, poolId);
        }
```

- [ ] **Step 5: Routen**

In `src/routes/poolRoutes.js` Import erweitern (`getNachzuegler, sortiereNachzuegler, sammleVerspaetete`) und vor dem `// Kampfflächen`-Block:

```js
    router.get('/nachzuegler', requireTournamentEditAccess(knex), (req, res) => getNachzuegler(knex, req, res));
    router.post('/nachzuegler/sammeln', requireTournamentEditAccess(knex), aktiv, (req, res) => sammleVerspaetete(knex, req, res));
    router.post('/nachzuegler/:teilnehmerId/einsortieren', requireTournamentEditAccess(knex), aktiv, (req, res) => sortiereNachzuegler(knex, req, res));
```

Hinweis: `requireTournamentEditAccess` ermittelt die Turnier-ID aus Query/Body/Params; vor dem Test in `src/middleware/auth.js` prüfen, wie genau (Zeilen ~80-110: über `req.params.id`, Kampf oder `poolId`), und die Requests (`turnierId` im Body ist vorgesehen) bei Bedarf anpassen. `/nachzuegler/sammeln` muss vor `/:id`-Routen stehen (steht davor).

- [ ] **Step 6: Tests laufen lassen**

Run: `npx playwright test tests/e2e/nachzuegler-pool.spec.js tests/e2e/waage-runden.spec.js tests/e2e/teilnehmer-pools-verteilung.spec.js`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/controllers/poolController.js src/routes/poolRoutes.js tests/e2e/nachzuegler-pool.spec.js
git commit -m "feat: Nachzügler-API mit Vorschlag, Einsortieren und Sammelpool, Matten-Neuplanung beim Verschieben"
```

---

### Task 6: Frontend — Pool-Sperre in der Teilnehmerliste, Nachzügler-Bereich, Sammelpool-Zeile, Menü-Zähler

**Files:**
- Modify: `public/js/teilnehmer.js:66-110`
- Modify: `public/pools.html` (Container oberhalb `#poolsContainer`)
- Modify: `public/js/pools.js` (`ladeNachzuegler`, Sammelpool-Zeile in `renderPoolRow`, Aufruf in `ladePools`)
- Modify: `public/js/menu.js` (Zähler am Menüpunkt „Pools“)
- Test: `tests/e2e/nachzuegler-pool.spec.js` (UI-Test ergänzen)

**Interfaces:**
- Consumes: `GET /api/pools/vorhanden` (`gesperrtePoolIds`), `GET /api/pools/nachzuegler`, `POST …/einsortieren`, `POST …/sammeln` (Task 5), `GET /api/pools/details?mitVerspaetet=1` (Task 3)

- [ ] **Step 1: Sperre je Pool in `teilnehmer.js`**

Block 66-110 anpassen:

```js
    let gesperrtePoolIds = new Set();
    const istTeilnehmerGesperrt = (athlet) => (athlet.pool_id != null && gesperrtePoolIds.has(Number(athlet.pool_id)))
        || (mannschaftenGesperrt && !athlet.auch_einzelwettkampf && teamInfoByTeilnehmerId.has(athlet.id));
```

In `pruefeTeilnehmerlisteSperre` nach der Zeile mit `gesperrteAltersklassen = new Set(...)`:

```js
            gesperrtePoolIds = new Set(Array.isArray(data.gesperrtePoolIds) ? data.gesperrtePoolIds.map(Number) : []);
```

und `teilnehmerlisteGesperrt = gesperrtePoolIds.size > 0 || !!data.gesperrt || mannschaftenGesperrt;`. Bannertext: `Gesperrt (Pools mit begonnenen Kämpfen in: ${[...gesperrteAltersklassen].join(', ')}).`; der Folgesatz „Die übrigen Teilnehmer lassen sich weiter bearbeiten.“ bleibt. Den Kommentar „Anmelden/Import/Scan bleiben sichtbar: nur bereits ausgeloste Altersklassen weist der Server ab“ in „… (auch für ausgeloste Altersklassen: Nachzügler)“ ändern. Weitere Stellen mit `gesperrteAltersklassen.has(...)` per `grep -n gesperrteAltersklassen public/js/teilnehmer.js` finden und auf `istTeilnehmerGesperrt` umstellen. Die Teilnehmerzeilen enthalten `pool_id` (GET `/api/teilnehmer` liefert die Tabellenzeile); im Test verifizieren.

- [ ] **Step 2: Container in `pools.html`**

Direkt vor `<div id="poolsContainer">` einfügen:

```html
    <section id="nachzueglerBereich" class="nachzuegler-bereich" style="display: none;" aria-live="polite">
        <h2 class="nachzuegler-titel">Nachzügler (nach der Auslosung eingewogen)</h2>
        <div id="nachzueglerListe"></div>
    </section>
```

- [ ] **Step 3: Nachzügler-Bereich in `pools.js`**

Innerhalb des `DOMContentLoaded`-Handlers (neben `ladePools`) ergänzen:

```js
    // --- NACHZÜGLER (nach der Auslosung eingewogen): Vorschlag bestätigen; ohne Vorschlag landet der
    // Teilnehmer automatisch im Sammelpool "Verspätet" und wird dort per Drag&Drop verschoben ---
    const nachzueglerBereich = document.getElementById('nachzueglerBereich');
    const nachzueglerListe = document.getElementById('nachzueglerListe');
    let sammelnLaeuft = false;

    async function postJson(url, body) {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ turnierId, ...body })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || result.success === false) throw new Error(result.error || 'Aktion fehlgeschlagen.');
        return result;
    }

    function erzeugeNachzueglerZeile(n) {
        const zeile = document.createElement('div');
        zeile.className = 'nachzuegler-zeile';
        zeile.dataset.teilnehmerId = String(n.teilnehmerId);

        const info = document.createElement('div');
        info.className = 'nachzuegler-info';
        info.textContent = `${n.name} · ${n.altersklasse} · ${n.gewicht ?? '–'} kg · ${n.verein || ''}`;

        const hinweis = document.createElement('div');
        hinweis.className = 'nachzuegler-vorschlag';
        const v = n.vorschlag;
        hinweis.textContent = `Vorschlag: ${v.bezeichnung} (${v.teilnehmerNachher - 1} → ${v.teilnehmerNachher} Teilnehmer, ${v.systemNachher}${v.matteId ? '' : ', noch ohne Matte'})`;

        const uebernehmen = document.createElement('button');
        uebernehmen.type = 'button';
        uebernehmen.className = 'btn btn-raised nachzuegler-uebernehmen';
        uebernehmen.textContent = 'Übernehmen';
        uebernehmen.addEventListener('click', async () => {
            try {
                await postJson(`/api/pools/nachzuegler/${n.teilnehmerId}/einsortieren`, { poolId: v.poolId });
                zeigeNotification('Nachzügler eingeordnet.', 'success');
            } catch (err) {
                zeigeNotification(err.message, 'error');
            }
            await ladePools();
        });

        zeile.append(info, hinweis, uebernehmen);
        return zeile;
    }

    async function ladeNachzuegler() {
        if (!nachzueglerBereich || !nachzueglerListe) return;
        try {
            const response = await fetch(`/api/pools/nachzuegler?turnierId=${encodeURIComponent(turnierId)}`);
            if (!response.ok) { nachzueglerBereich.style.display = 'none'; return; }
            const { nachzuegler, imSammelpool } = await response.json();

            // Ohne Vorschlag: automatisch in den Sammelpool, danach Pools neu laden (die Liste ist dann leer).
            if (!sammelnLaeuft && nachzuegler.some(n => !n.vorschlag)) {
                sammelnLaeuft = true;
                try {
                    await postJson('/api/pools/nachzuegler/sammeln', {});
                    await ladePools();
                } finally {
                    sammelnLaeuft = false;
                }
                return;
            }

            const mitVorschlag = nachzuegler.filter(n => n.vorschlag);
            nachzueglerListe.replaceChildren(...mitVorschlag.map(erzeugeNachzueglerZeile));
            nachzueglerBereich.style.display = mitVorschlag.length > 0 ? '' : 'none';
            window.hajimeNachzueglerZaehler = mitVorschlag.length + (imSammelpool || 0);
            if (window.hajimeAktualisiereNachzuegler) window.hajimeAktualisiereNachzuegler();
        } catch (err) {
            console.error('[Pools] Nachzügler konnten nicht geladen werden:', err);
        }
    }
```

In `ladePools()` nach `renderPoolsHTML(sortierteNachAK);` sowie im Zweig `pools.length === 0` (vor dem `return`) `ladeNachzuegler();` aufrufen (nicht awaiten). Hinweis: Der Sammelpool kommt wegen `mitVerspaetet=1` im `details`-Ergebnis; der Zweig `pools.length === 0` greift nur, wenn es wirklich keinen Pool gibt.

- [ ] **Step 4: Sammelpool-Zeile in `renderPoolRow`**

Am Anfang von `renderPoolRow(pool)` einen eigenen Rückgabezweig einfügen (der Sammelpool braucht weder System noch Kampfzeit noch Kampfplan):

```js
        if (pool.verspaetet) {
            return `
                <tr class="pool-section pool-sammelpool" data-pool-id="${pool.id}">
                    <td class="pool-cell pool-name-cell">
                        <strong>Verspätet</strong>
                        <div class="pool-einstellung-label">Nachzügler ohne passenden Pool. Per Drag&amp;Drop in einen noch nicht begonnenen Pool ziehen.</div>
                    </td>
                    <td class="pool-cell pool-align-top"><span class="pool-status-badge vorbereitung">Wartet auf Zuordnung</span></td>
                    <td class="pool-cell pool-number-cell pool-stat-cell"><span class="pool-system-text">${pool.anzahl_teilnehmer}</span></td>
                    <td class="pool-cell pool-number-cell pool-stat-cell"><span class="pool-system-text">–</span></td>
                    <td class="pool-cell pool-number-cell pool-stat-cell"><span class="pool-system-text">–</span></td>
                    <td class="pool-cell pool-athletes-cell pool-align-top">
                        <div class="drop-zone" data-pool-id="${pool.id}" data-locked="false">
                            ${pool.teilnehmer.map(t => `
                                <div class="draggable-athlete" draggable="true" data-athlete-id="${t.id}" data-current-pool="${pool.id}">
                                    <div class="athlete-info-wrapper">
                                        <span class="material-icons athlete-drag-icon">drag_indicator</span>
                                        <span class="athlete-name">${escapeHtml(t.nachname)}, ${escapeHtml(t.vorname)}</span>
                                        <span class="athlete-pass-id">(${escapeHtml(t.altersklasse)})</span>
                                    </div>
                                    <div class="athlete-weight">${parseFloat(t.gewicht).toFixed(2)} kg</div>
                                </div>`).join('')}
                        </div>
                    </td>
                    <td class="pool-cell pool-action-cell pool-align-top"></td>
                </tr>
            `;
        }
```

Der Sammelpool soll in der Tabelle ganz oben stehen: in `ladePools()` `const sortierteNachAK = [...pools].sort(vergleichePools);` ersetzen durch `...sort((a, b) => (b.verspaetet ? 1 : 0) - (a.verspaetet ? 1 : 0) || vergleichePools(a, b))`. Zusätzlich das Pool-Zeilen-Neuladen in `aktualisierePoolZeilen` (Zeile ~627) nutzt `renderPoolRow` und bekommt den Zweig automatisch.

Styles in der von `pools.html` eingebundenen CSS-Datei (`.nachzuegler-bereich`, `.nachzuegler-zeile`, `.pool-sammelpool` mit abgesetzter Hintergrundfarbe) mit den vorhandenen Variablen der Pools-Seite ergänzen.

- [ ] **Step 5: Menü-Zähler**

In `public/js/menu.js` am Menüpunkt „Pools“ (per `grep -n "pools.html" public/js/menu.js` finden; Muster Badge siehe Zeilen 210-213 und 717-739) `<span class="menu-item-badge" id="nav-pools-badge" style="display: none;"></span>` ergänzen und:

```js
        const poolsBadge = document.getElementById('nav-pools-badge');
        window.hajimeAktualisiereNachzuegler = () => {
            if (!poolsBadge) return;
            const anzahl = window.hajimeNachzueglerZaehler || 0;
            poolsBadge.textContent = String(anzahl);
            poolsBadge.style.display = anzahl > 0 ? 'inline-block' : 'none';
            poolsBadge.title = anzahl > 0 ? `${anzahl} Nachzügler warten auf einen Pool` : '';
        };
```

(Der Zähler wird nur gesetzt, solange `pools.html` offen ist; auf anderen Seiten bleibt das Badge verborgen — bewusst einfach, kein Polling.)

- [ ] **Step 6: UI-Test ergänzen**

In `tests/e2e/nachzuegler-pool.spec.js` am Ende einen `describe` mit eigenem Mini-Setup (Turnier, ein ausgeloster Pool, ein Nachzügler mit Vorschlag): `page.goto('/pools.html?id=' + turnierId)`, `.nachzuegler-zeile` sichtbar, `.nachzuegler-uebernehmen` klicken, `await expect(page.locator('.nachzuegler-zeile')).toHaveCount(0)`; zweiter Nachzügler ohne Vorschlag (Gewicht weit entfernt): nach dem Laden `await expect(page.locator('.pool-sammelpool')).toBeVisible()` und `.pool-sammelpool .draggable-athlete` zählt 1.

- [ ] **Step 7: Tests laufen lassen**

Run: `npx playwright test tests/e2e/nachzuegler-pool.spec.js tests/e2e/teilnehmer-import-email.spec.js`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add public/js/teilnehmer.js public/pools.html public/js/pools.js public/js/menu.js public/css tests/e2e/nachzuegler-pool.spec.js
git commit -m "feat: Nachzügler-Bereich und Sammelpool auf der Pools-Seite, Pool-Sperre in der Teilnehmerliste"
```

---

### Task 7: Mattenleitung erfährt von Pool-Änderungen

**Files:**
- Modify: `public/js/scoreboard.js:2548-2561` (`ladeMattenUebersicht`)
- Test: `tests/e2e/steuerung-pool-geaendert.spec.js` (neu, Muster `tests/e2e/steuerung-pool-beginn-meldung.spec.js`)

**Interfaces:**
- Consumes: `window.Datenzugriff.ladeKaempfeDerMatte(matId)` (liefert die Kämpfe der Matte mit `pool_id`, `pool_bezeichnung`, `status`)

- [ ] **Step 1: Failing E2E-Test schreiben**

Nach dem Muster von `steuerung-pool-beginn-meldung.spec.js` (Turnier mit Matte, Steuerung öffnen, `schliesseOverlayAutomatisch` aus `tests/e2e/helpers/pool-beginn-overlay.js`): Steuerung öffnen und Matte wählen, über die API einen Nachzügler per `einsortieren` in einen Pool der Matte aufnehmen, dann erwarten, dass eine Notification mit dem Text „wurde geändert“ erscheint (Selektor der Notification aus der Muster-Spec übernehmen).

- [ ] **Step 2: Test laufen lassen, Fehlschlag prüfen**

Run: `npx playwright test tests/e2e/steuerung-pool-geaendert.spec.js`
Expected: FAIL (keine Meldung)

- [ ] **Step 3: Erkennung implementieren**

In `scoreboard.js` oberhalb von `ladeMattenUebersicht` ergänzen:

```js
// Pool-Änderung (z.B. Nachzügler eingefügt): Die Kämpfe eines noch nicht begonnenen Pools werden neu erzeugt.
// Wir merken uns je Pool die Kampf-IDs der Matte; ändert sich die Menge ohne begonnenen Kampf, bekommt die
// Mattenleitung einen Hinweis.
let poolKampfIdsMerker = null; // Map<poolId, string>
let poolKampfIdsMatte = null;

function pruefePoolAenderung(kaempfe) {
    const proPool = new Map();
    kaempfe.forEach(k => {
        if (!proPool.has(k.pool_id)) proPool.set(k.pool_id, { ids: [], begonnen: false, name: k.pool_bezeichnung });
        const eintrag = proPool.get(k.pool_id);
        eintrag.ids.push(k.id);
        if (k.status === 'gestartet' || k.status === 'beendet') eintrag.begonnen = true;
    });
    const aktuell = new Map([...proPool].map(([id, e]) => [id, [...e.ids].sort((a, b) => a - b).join(',')]));
    if (poolKampfIdsMerker && poolKampfIdsMatte === selectedMatId) {
        proPool.forEach((e, poolId) => {
            if (!e.begonnen && poolKampfIdsMerker.has(poolId) && poolKampfIdsMerker.get(poolId) !== aktuell.get(poolId)) {
                zeigeNotification(`Pool ${e.name || ''} wurde geändert: Kämpfe neu aufgebaut.`, 'info');
            }
        });
    }
    poolKampfIdsMerker = aktuell;
    poolKampfIdsMatte = selectedMatId;
}
```

In `ladeMattenUebersicht` direkt nach `renderePoolAnsichtSteuerung(kaempfe);`:

```js
        pruefePoolAenderung(kaempfe);

        // Der geladene Kampf gehört zu einem neu aufgebauten Pool und existiert nicht mehr.
        if (currentFightId && !isRunning && !ergebnisWirdGesendet
            && !kaempfe.some(k => Number(k.id) === Number(currentFightId))) {
            gibGeladenenKampfFrei();
            zeigeNotification('Der geladene Kampf gehört zu einem geänderten Pool und wurde verworfen. Bitte den nächsten Kampf laden.', 'error');
        }
```

- [ ] **Step 4: Tests laufen lassen**

Run: `npx playwright test tests/e2e/steuerung-pool-geaendert.spec.js tests/e2e/steuerung-pool-beginn-meldung.spec.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add public/js/scoreboard.js tests/e2e/steuerung-pool-geaendert.spec.js
git commit -m "feat: Mattenleitung meldet geänderte Pools und verwirft ungültigen geladenen Kampf"
```

---

### Task 8: Sync-Suite, Dokumentation, Gesamtlauf

**Files:**
- Modify: `tests/e2e-sync/` (passende vorhandene Spec; Nachmeldung am Client in ausgeloste Klasse)
- Modify: `CLAUDE.md` (Abschnitt „Waage in Runden“)
- Modify: `docs/specs/2026-10-08-waage-runden-design.md` (Abschnitt „Nicht im Umfang“, Verweis auf neue Spec)

- [ ] **Step 1: Sync-Spec prüfen und anpassen**

`grep -rn "bereits ausgelost\|409" tests/e2e-sync` ausführen. Eine bestehende Spec, die eine abgelehnte Nachmeldung in ausgeloste Klassen erwartet, auf das neue Verhalten umstellen (Nachmeldung wird angenommen, Teilnehmer ohne Pool, `GET /api/pools/nachzuegler` am Server führt ihn auf). Gibt es keine, in der Waage-Spec des Shards `server` einen kurzen Test ergänzen; neue Specs müssen in `tests/e2e-sync/shards.js` genau einmal stehen.

- [ ] **Step 2: Dokumentation**

In `CLAUDE.md` im Absatz „Waage in Runden“ ergänzen: Sperre je Pool (`gesperrtePoolIds`), Nachzügler-Ablauf (`/api/pools/nachzuegler`, Vorschlag mit Bestätigung auf `pools.html`, sonst Sammelpool „Verspätet“ mit `pools.verspaetet`, nur mit `mitVerspaetet=1` sichtbar), Verweis auf `docs/specs/2026-10-10-nachzuegler-pool-design.md`. In der Waage-Runden-Spec den Punkt „Nachzügler in eine bereits ausgeloste Altersklasse: gibt es fachlich nicht“ mit dem Hinweis „abgelöst durch 2026-10-10-nachzuegler-pool-design.md“ versehen. Im Domänenmodell von `CLAUDE.md` bei `pools` das Kennzeichen `verspaetet` nennen.

- [ ] **Step 3: Gesamtlauf**

Run: `npm run test:unit` und `npm run test:e2e` und `npm run test:e2e:sync`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add tests/e2e-sync CLAUDE.md docs/specs/2026-10-08-waage-runden-design.md
git commit -m "docs: Nachzügler in CLAUDE.md und Waage-Runden-Spec, Sync-Spec angepasst"
```

---

## Self-Review (Spec-Abdeckung)

- Sperre je Pool (Spec §1): Task 1 (Zustand, Client), Task 2 (Server, Altersklassenwechsel), Task 6 Step 1 (Teilnehmerliste).
- Anmeldung in ausgeloste Klasse ohne Pool: Task 2.
- Vorschlag + Bestätigung, Sammelpool bei „kein passender Pool“ (Spec §2): Task 4 (Berechnung), Task 5 (API), Task 6 (UI).
- Drag&Drop aus dem Sammelpool, kein Kampfplan für den Sammelpool: Task 5 Step 4, Test in Task 5.
- Matte plant neu, Mattenleitung informiert (Spec §3): Task 5 Step 3/4, Task 7.
- Sammelpool nur auf `pools.html` (Spec §4): Task 3 (details, Matten, Dashboard, Übersicht, „aufteilen“, Urkunden, Altersklassenzustand), Test in Task 5.
- Siegerliste: nutzt `/api/pools/details` ohne `mitVerspaetet` und blendet den Sammelpool damit aus (Task 3, kein Frontend-Eingriff nötig).
- Menü-Zähler: Task 6 Step 5.
- Tests (Spec „Tests“): Unit Task 1/3/4, E2E Task 2/5/6/7, Sync Task 8.
- Hinweis zur Reihenfolge: Task 1 Step 4 setzt `verspaetet: false` im Pool-Zustand erst in Task 3 (die Spalte existiert vorher nicht); die Zeile wird in Task 3 Step 4 ergänzt.

## Hinweise für die Ausführung

- Der Ort der Turnier-ID für `requireTournamentEditAccess` bei den POST-Routen (Task 5 Step 5) muss vor dem Test geprüft werden.
- Der Sammelpool hat Status `teilnehmer_zugewiesen` und wird von `aktualisierePoolStatusNachAuslosung` nur auf `angelegt`/`teilnehmer_zugewiesen` gesetzt; da er nie eine Matte hat, bleibt `teilnehmer_zugewiesen` korrekt.
