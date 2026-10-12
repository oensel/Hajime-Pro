# Teilnehmer-App Phase 1: Live-Prozess auf dem Slave — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein eigener Prozess liest die Turnierdaten nur lesend aus dem PostgreSQL (Standby oder Primary), berechnet je Teilnehmer den Kachelzustand und sendet freigegebene Turniere als Snapshot ausgehend per HTTPS an die Cloud.

**Architecture:** Schema `live` mit Views und Rolle `live_ro` (nur SELECT auf die Views). Ein reines Modul `src/shared/liveKachel.js` berechnet Zustand und Abstand; `src/live/` baut Snapshots, sendet sie nur bei Änderung (Hash) und hält Lebenszeichen/Backoff. Der Schalter „Live freigeben" liegt am Turnier (Spalte `live_freigabe`, API + Checkbox in `turnier.html`).

**Tech Stack:** Node.js (ES-Module), Knex/`pg`, `node:test` für Unit-Tests, Playwright für den API-E2E-Test, systemd/nftables für den Betrieb.

**Spec:** `docs/specs/2026-10-12-teilnehmer-app-design.md` (Abschnitte 4, 5, 10, 13 Phase 1)

## Global Constraints

- Abfrageintervall **5 Sekunden** (`LIVE_INTERVALL_MS`, Standard 5000).
- Rolle `live_ro`: nur `SELECT` auf Schema `live`, `default_transaction_read_only = on`, `statement_timeout = '3s'`.
- **Nicht** in den Views: Geburtsdatum/-jahr, Gewicht, Passnummer im Klartext, Zahlungsdaten, E-Mail. Nur `passnummer_hash`.
- Uplink wertet Antworten **nur nach HTTP-Statuscode** aus; kein Antwortinhalt wird gelesen oder verwendet.
- Snapshot wird bei Änderung gesendet, spätestens alle **60 s** als Lebenszeichen; nach Fehlern Backoff 2 s, verdoppelnd, höchstens 60 s.
- Nur Turniere mit `live_freigabe = true` **und** `urspruengliche_id IS NOT NULL` werden gesendet.
- Nur Einzelpools (`pools.typ = 'einzel'`); Mannschaftsteilnehmer erscheinen nicht im Snapshot.
- Offene Kämpfe sind Status `bereit`, `vorbereiten`, `gestartet`; `angelegt` hat keine Matten-Position; `beendet`/`freilos` sind erledigt.
- Platz nur 1–3, nur bei `pools.status = 'abgeschlossen'`; Quelle `src/shared/platzierungen.js`.
- Texte, Kommentare und Commit-Nachrichten auf Deutsch, Stil der vorhandenen Module (kurze Kopfkommentare mit Begründung).
- Commit-Nachrichten enden mit `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Turnier ohne `urspruengliche_id`** (am Hallen-Server neu angelegt): Freigabe wird mit Klartext abgelehnt, der Prozess sendet es nie (Task 9, Task 5).
2. **Teilnehmer ohne Pool, `nicht_erschienen`, `zurueckgezogen`**: kein Absturz, richtiger Zustand bzw. nicht im Snapshot (Task 2, Task 5).
3. **Kampf mit `matten_reihenfolge = NULL`** (bereit, aber ohne Position): zählt ans Ende der Warteschlange, kein Absturz (Task 2).
4. **Freigabe zurückgenommen**: einmalige Rücknahme-Nachricht, danach nichts mehr (Task 6).
5. **Cloud nicht erreichbar / 5xx**: Backoff, kein Verlust des zuletzt erfolgreich gesendeten Hash, kein Absturz der Schleife (Task 6, Task 7).

---

## File Structure

| Datei | Verantwortung |
|---|---|
| `src/shared/liveKachel.js` (neu) | Reine Berechnung Zustand/Abstand/Platz je Teilnehmer, kein DB-/DOM-Zugriff |
| `src/live/schluessel.js` (neu) | Teilnehmerschlüssel (HMAC), Vereins-Normalisierung und -Anzeigename |
| `migrations/20261012100000_live_freigabe_und_views.js` (neu) | Spalte `turniere.live_freigabe`, Schema `live`, Views |
| `src/live/rolle.js` (neu) + `scripts/live-rolle.mjs` (neu) | Rolle `live_ro` idempotent anlegen und berechtigen |
| `src/live/snapshot.js` (neu) | Rohdaten aus den Views laden und Snapshot bauen |
| `src/live/uplink.js` (neu) | Senden, Delta über Hash, Lebenszeichen, Backoff, Rücknahme |
| `src/live/konfig.js` (neu) | Umgebungsvariablen lesen und prüfen |
| `src/live/dienst.js` (neu) + `src/live/main.js` (neu) | 5-s-Schleife und Prozess-Einstieg |
| `src/controllers/turnierController.js`, `src/routes/turnierRoutes.js` | API `GET/PUT /api/turniere/:id/live-freigabe` |
| `public/turnier.html`, `public/js/turnier.js` | Checkbox „Live freigeben" |
| `deploy/linux/systemd/hajime-live.service`, `deploy/linux/live/nftables-live.conf`, `deploy/linux/install-live.sh`, `docs/live-uplink.md` (neu) | Betrieb |
| `tests/unit/liveKachel.test.js`, `liveSchluessel.test.js`, `liveViews.test.js`, `liveSnapshot.test.js`, `liveUplink.test.js`, `liveKonfig.test.js`, `liveDienst.test.js` (neu) | Unit-Tests |
| `tests/e2e/live-freigabe.spec.js` (neu) | API-/E2E-Test der Freigabe |

---

### Task 1: Kachel-Berechnung (`liveKachel.js`)

**Files:**
- Create: `src/shared/liveKachel.js`
- Test: `tests/unit/liveKachel.test.js`

**Interfaces:**
- Produces: `berechneKacheln({ pools, teilnehmer, kaempfe, platzierungen }) → Map<teilnehmerId, { zustand, abstand, naechsterKampfId, platz }>`
  - `pools`: `[{ id, kampfflaeche_id, status, typ, verspaetet }]`
  - `teilnehmer`: `[{ id, pool_id, status }]`
  - `kaempfe`: `[{ id, pool_id, status, matten_reihenfolge, kaempfer1_id, kaempfer2_id }]`
  - `platzierungen`: `{ [poolId]: { [teilnehmerId]: platzOderNull } }`
  - `zustand` ∈ `nicht_ausgelost | ohne_matte | verspaetet | nicht_erschienen | laeuft | als_naechstes | in_n | wartet_auf_gegner | keine_weiteren | abgeschlossen`
  - `abstand` ist nur bei `in_n` eine Zahl ≥ 1, sonst `null`; `platz` nur 1–3 oder `null`
  - Teilnehmer in Mannschafts-Pools erscheinen **nicht** im Ergebnis.

- [ ] **Step 1: Failing test schreiben**

`tests/unit/liveKachel.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { berechneKacheln } from '../../src/shared/liveKachel.js';

const pool = (id, extra = {}) => ({ id, kampfflaeche_id: 1, status: 'matte_zugewiesen', typ: 'einzel', verspaetet: false, ...extra });
const tn = (id, poolId, status = 'kampfbereit') => ({ id, pool_id: poolId, status });
const kampf = (id, poolId, k1, k2, extra = {}) =>
    ({ id, pool_id: poolId, status: 'bereit', matten_reihenfolge: id, kaempfer1_id: k1, kaempfer2_id: k2, ...extra });
const k = (daten) => berechneKacheln({ pools: [], teilnehmer: [], kaempfe: [], platzierungen: {}, ...daten });

test('ohne Pool: nicht_ausgelost', () => {
    const r = k({ teilnehmer: [tn(1, null, 'angemeldet')] });
    assert.equal(r.get(1).zustand, 'nicht_ausgelost');
});

test('Pool ohne Matte: ohne_matte', () => {
    const r = k({ pools: [pool(1, { kampfflaeche_id: null })], teilnehmer: [tn(1, 1)] });
    assert.equal(r.get(1).zustand, 'ohne_matte');
});

test('Sammelpool Verspätet: verspaetet', () => {
    const r = k({ pools: [pool(1, { verspaetet: true, kampfflaeche_id: null })], teilnehmer: [tn(1, 1)] });
    assert.equal(r.get(1).zustand, 'verspaetet');
});

test('nicht_erschienen hat Vorrang vor allem anderen', () => {
    const r = k({ pools: [pool(1)], teilnehmer: [tn(1, 1, 'nicht_erschienen')], kaempfe: [kampf(1, 1, 1, 2)] });
    assert.equal(r.get(1).zustand, 'nicht_erschienen');
});

test('Abstand zählt offene Kämpfe der ganzen Matte, auch aus anderen Pools', () => {
    const r = k({
        pools: [pool(1), pool(2)],
        teilnehmer: [tn(1, 1), tn(2, 1), tn(3, 2), tn(4, 2), tn(5, 1), tn(6, 1)],
        kaempfe: [kampf(1, 1, 1, 2), kampf(2, 2, 3, 4), kampf(3, 1, 5, 6)]
    });
    assert.equal(r.get(1).zustand, 'als_naechstes');
    assert.equal(r.get(3).zustand, 'in_n');
    assert.equal(r.get(3).abstand, 1);
    assert.equal(r.get(5).abstand, 2);
    assert.equal(r.get(5).naechsterKampfId, 3);
});

test('laufender Kampf: laeuft; der folgende Kampf hat Abstand 1', () => {
    const r = k({
        pools: [pool(1)],
        teilnehmer: [tn(1, 1), tn(2, 1), tn(3, 1), tn(4, 1)],
        kaempfe: [kampf(1, 1, 1, 2, { status: 'gestartet' }), kampf(2, 1, 3, 4)]
    });
    assert.equal(r.get(1).zustand, 'laeuft');
    assert.equal(r.get(3).zustand, 'in_n');
    assert.equal(r.get(3).abstand, 1);
});

test('beendete und Freilos-Kämpfe zählen nicht', () => {
    const r = k({
        pools: [pool(1)],
        teilnehmer: [tn(1, 1), tn(2, 1), tn(3, 1), tn(4, 1)],
        kaempfe: [kampf(1, 1, 1, 2, { status: 'beendet' }), kampf(2, 1, 3, null, { status: 'freilos' }), kampf(3, 1, 3, 4)]
    });
    assert.equal(r.get(3).zustand, 'als_naechstes');
});

test('Kampf ohne Position wird ans Ende gestellt, ohne Absturz', () => {
    const r = k({
        pools: [pool(1)],
        teilnehmer: [tn(1, 1), tn(2, 1), tn(3, 1), tn(4, 1)],
        kaempfe: [kampf(1, 1, 1, 2, { matten_reihenfolge: null }), kampf(2, 1, 3, 4, { matten_reihenfolge: 5 })]
    });
    assert.equal(r.get(3).zustand, 'als_naechstes');
    assert.equal(r.get(1).zustand, 'in_n');
    assert.equal(r.get(1).abstand, 1);
});

test('Folgekampf mit offenem Gegner: wartet_auf_gegner', () => {
    const r = k({
        pools: [pool(1)],
        teilnehmer: [tn(1, 1), tn(2, 1)],
        kaempfe: [kampf(1, 1, 1, null, { status: 'angelegt', matten_reihenfolge: null })]
    });
    assert.equal(r.get(1).zustand, 'wartet_auf_gegner');
    assert.equal(r.get(2).zustand, 'keine_weiteren');
});

test('keine offenen Kämpfe, Pool läuft: keine_weiteren', () => {
    const r = k({
        pools: [pool(1, { status: 'gestartet' })],
        teilnehmer: [tn(1, 1), tn(2, 1)],
        kaempfe: [kampf(1, 1, 1, 2, { status: 'beendet' })]
    });
    assert.equal(r.get(1).zustand, 'keine_weiteren');
});

test('Pool abgeschlossen: abgeschlossen mit Platz nur bei 1 bis 3', () => {
    const r = k({
        pools: [pool(1, { status: 'abgeschlossen' })],
        teilnehmer: [tn(1, 1), tn(2, 1), tn(3, 1), tn(4, 1), tn(5, 1)],
        platzierungen: { 1: { 1: 1, 2: 2, 3: 3, 4: 5, 5: null } }
    });
    assert.deepEqual([1, 2, 3].map(i => r.get(i).platz), [1, 2, 3]);
    assert.equal(r.get(4).platz, null);
    assert.equal(r.get(5).platz, null);
    assert.equal(r.get(1).zustand, 'abgeschlossen');
});

test('Mannschafts-Pool: Teilnehmer erscheint nicht', () => {
    const r = k({ pools: [pool(1, { typ: 'mannschaft' })], teilnehmer: [tn(1, 1)] });
    assert.equal(r.has(1), false);
});

test('Mannschafts-Einzelkämpfe auf derselben Matte zählen in die Warteschlange', () => {
    const r = k({
        pools: [pool(1), pool(2, { typ: 'mannschaft' })],
        teilnehmer: [tn(1, 1), tn(2, 1)],
        kaempfe: [kampf(1, 2, 90, 91), kampf(2, 1, 1, 2)]
    });
    assert.equal(r.get(1).abstand, 1);
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag prüfen**

Run: `node --test tests/unit/liveKachel.test.js`
Expected: FAIL (`Cannot find module '../../src/shared/liveKachel.js'`)

- [ ] **Step 3: Implementierung**

`src/shared/liveKachel.js`:

```js
// Kachelzustand je Teilnehmer für die Teilnehmer-App (Spec docs/specs/2026-10-12-teilnehmer-app-design.md, Abschnitt 4).
// Rein und DB-/DOM-frei wie die übrigen Module in src/shared/: der Live-Prozess füttert sie mit Zeilen aus den
// Views des Schemas "live", die Cloud kann dieselbe Funktion für Tests nutzen.
//
// Abstand n = Zahl noch nicht beendeter Kämpfe (bereit/vorbereiten/gestartet) vor dem nächsten eigenen Kampf auf
// derselben Matte, sortiert wie die Mattenansicht (matten_reihenfolge, ohne Position zuletzt, dann id). Nur
// 'bereit'-Kämpfe bekommen von der Matten-Planung eine Position; 'angelegt' (Gegner offen) hat keine.
const OFFEN = new Set(['bereit', 'vorbereiten', 'gestartet']);

function sortiereWarteschlange(kaempfe) {
    return [...kaempfe].sort((a, b) => {
        const ra = a.matten_reihenfolge == null ? Infinity : Number(a.matten_reihenfolge);
        const rb = b.matten_reihenfolge == null ? Infinity : Number(b.matten_reihenfolge);
        return ra !== rb ? ra - rb : Number(a.id) - Number(b.id);
    });
}

const beteiligt = (kampf, id) => kampf.kaempfer1_id === id || kampf.kaempfer2_id === id;

export function berechneKacheln({ pools = [], teilnehmer = [], kaempfe = [], platzierungen = {} }) {
    const poolById = new Map(pools.map(p => [p.id, p]));

    // Warteschlange je Matte über alle Pools der Matte (auch Mannschafts-Einzelkämpfe: sie belegen die Matte).
    const queueJeMatte = new Map();
    for (const kampf of kaempfe) {
        if (!OFFEN.has(kampf.status)) continue;
        const pool = poolById.get(kampf.pool_id);
        if (!pool || pool.kampfflaeche_id == null) continue;
        if (!queueJeMatte.has(pool.kampfflaeche_id)) queueJeMatte.set(pool.kampfflaeche_id, []);
        queueJeMatte.get(pool.kampfflaeche_id).push(kampf);
    }
    for (const [matte, liste] of queueJeMatte) queueJeMatte.set(matte, sortiereWarteschlange(liste));

    const angelegtJePool = new Map();
    for (const kampf of kaempfe) {
        if (kampf.status !== 'angelegt') continue;
        if (!angelegtJePool.has(kampf.pool_id)) angelegtJePool.set(kampf.pool_id, []);
        angelegtJePool.get(kampf.pool_id).push(kampf);
    }

    const ergebnis = new Map();
    const setze = (t, zustand, extra = {}) =>
        ergebnis.set(t.id, { zustand, abstand: null, naechsterKampfId: null, platz: null, ...extra });

    for (const t of teilnehmer) {
        const pool = t.pool_id != null ? poolById.get(t.pool_id) : null;
        if (pool && pool.typ === 'mannschaft') continue;
        if (t.status === 'nicht_erschienen') { setze(t, 'nicht_erschienen'); continue; }
        if (!pool) { setze(t, 'nicht_ausgelost'); continue; }
        if (pool.verspaetet) { setze(t, 'verspaetet'); continue; }
        if (pool.status === 'abgeschlossen') {
            const platz = platzierungen[pool.id] ? platzierungen[pool.id][t.id] : null;
            setze(t, 'abgeschlossen', { platz: platz >= 1 && platz <= 3 ? platz : null });
            continue;
        }
        if (pool.kampfflaeche_id == null) { setze(t, 'ohne_matte'); continue; }

        const queue = queueJeMatte.get(pool.kampfflaeche_id) || [];
        const index = queue.findIndex(kampf => beteiligt(kampf, t.id));
        if (index >= 0) {
            const kampf = queue[index];
            if (kampf.status === 'gestartet') setze(t, 'laeuft', { naechsterKampfId: kampf.id });
            else if (index === 0) setze(t, 'als_naechstes', { naechsterKampfId: kampf.id });
            else setze(t, 'in_n', { abstand: index, naechsterKampfId: kampf.id });
            continue;
        }
        const wartet = (angelegtJePool.get(pool.id) || []).some(kampf => beteiligt(kampf, t.id));
        setze(t, wartet ? 'wartet_auf_gegner' : 'keine_weiteren');
    }
    return ergebnis;
}
```

- [ ] **Step 4: Test grün**

Run: `node --test tests/unit/liveKachel.test.js`
Expected: PASS (12 Tests)

- [ ] **Step 5: Commit**

```bash
git add src/shared/liveKachel.js tests/unit/liveKachel.test.js
git commit -m "feat: Kachelzustand und Abstand je Teilnehmer für die Teilnehmer-App" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Schlüssel und Vereins-Normalisierung (`schluessel.js`)

**Files:**
- Create: `src/live/schluessel.js`
- Test: `tests/unit/liveSchluessel.test.js`

**Interfaces:**
- Produces:
  - `teilnehmerSchluessel(geheimnis: string, passnummerHash: string) → string` (24 Hex-Zeichen, HMAC-SHA256 gekürzt)
  - `normalisiereVerein(name: string) → string`
  - `vereinSchluessel(name: string) → string` (kurzer Hash der normalisierten Form, 12 Hex)
  - `waehleAnzeigename(namen: string[]) → string` (häufigste Schreibweise, bei Gleichstand die alphabetisch erste)

- [ ] **Step 1: Failing test**

`tests/unit/liveSchluessel.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { teilnehmerSchluessel, normalisiereVerein, vereinSchluessel, waehleAnzeigename } from '../../src/live/schluessel.js';

test('teilnehmerSchluessel ist stabil, 24 Hex lang und hängt vom Geheimnis ab', () => {
    const a = teilnehmerSchluessel('geheim', 'abc123');
    assert.equal(a, teilnehmerSchluessel('geheim', 'abc123'));
    assert.match(a, /^[0-9a-f]{24}$/);
    assert.notEqual(a, teilnehmerSchluessel('anders', 'abc123'));
    assert.notEqual(a, teilnehmerSchluessel('geheim', 'abc124'));
});

test('normalisiereVerein vereinheitlicht Schreibvarianten', () => {
    const varianten = ['JC Musterstadt', 'Judoclub Musterstadt e.V.', 'Judo Club Musterstadt e. V.', 'jc  musterstadt eV'];
    const normal = varianten.map(normalisiereVerein);
    assert.equal(new Set(normal).size, 1, JSON.stringify(normal));
    assert.equal(normal[0], 'jc musterstadt');
});

test('normalisiereVerein: Umlaute, Bindestriche und Leerraum', () => {
    assert.equal(normalisiereVerein('  TSV  Köln-Süd e.V. '), 'tsv koeln sued');
    assert.equal(normalisiereVerein('SV Großhausen'), 'sv grosshausen');
});

test('normalisiereVerein: leere Eingabe ergibt leeren String', () => {
    assert.equal(normalisiereVerein(''), '');
    assert.equal(normalisiereVerein(null), '');
});

test('vereinSchluessel gleich für Varianten, verschieden für andere Vereine', () => {
    assert.equal(vereinSchluessel('JC Musterstadt'), vereinSchluessel('Judoclub Musterstadt e.V.'));
    assert.notEqual(vereinSchluessel('JC Musterstadt'), vereinSchluessel('JC Beispielhausen'));
    assert.match(vereinSchluessel('JC Musterstadt'), /^[0-9a-f]{12}$/);
});

test('waehleAnzeigename: häufigste Schreibweise, sonst alphabetisch', () => {
    assert.equal(waehleAnzeigename(['JC Muster', 'Judoclub Muster e.V.', 'JC Muster']), 'JC Muster');
    assert.equal(waehleAnzeigename(['B-Verein', 'A-Verein']), 'A-Verein');
});
```

- [ ] **Step 2: Fehlschlag prüfen**

Run: `node --test tests/unit/liveSchluessel.test.js`
Expected: FAIL (Modul fehlt)

- [ ] **Step 3: Implementierung**

`src/live/schluessel.js`:

```js
// Schlüssel und Vereins-Normalisierung für den Live-Snapshot (Spec Abschnitt 5.2).
// turnier_teilnehmer.verein ist Freitext; ohne Normalisierung zerfällt "JC Musterstadt" und "Judoclub Musterstadt e.V."
// in zwei Vereine. Die Abkürzungsliste ist bewusst klein und wird bei Bedarf erweitert.
import crypto from 'node:crypto';

export function teilnehmerSchluessel(geheimnis, passnummerHash) {
    return crypto.createHmac('sha256', String(geheimnis)).update(String(passnummerHash)).digest('hex').slice(0, 24);
}

const ABKUERZUNGEN = [
    [/\bjudo\s*club\b/g, 'jc'],
    [/\bjudoclub\b/g, 'jc'],
    [/\bturnverein\b/g, 'tv'],
    [/\bsportverein\b/g, 'sv'],
    [/\bsportgemeinschaft\b/g, 'sg']
];

export function normalisiereVerein(name) {
    if (name == null) return '';
    let text = String(name).toLowerCase()
        .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
    text = text.normalize('NFKD').replace(/[̀-ͯ]/g, '');
    text = text.replace(/[.,;:\-_/()]+/g, ' ');
    text = text.replace(/\be\s*v\b/g, ' ');
    for (const [muster, ersatz] of ABKUERZUNGEN) text = text.replace(muster, ersatz);
    return text.replace(/\s+/g, ' ').trim();
}

export function vereinSchluessel(name) {
    return crypto.createHash('sha256').update(normalisiereVerein(name)).digest('hex').slice(0, 12);
}

export function waehleAnzeigename(namen) {
    const zaehler = new Map();
    for (const n of namen) {
        const bereinigt = String(n || '').trim();
        if (bereinigt) zaehler.set(bereinigt, (zaehler.get(bereinigt) || 0) + 1);
    }
    const sortiert = [...zaehler.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    return sortiert.length ? sortiert[0][0] : '';
}
```

- [ ] **Step 4: Test grün**

Run: `node --test tests/unit/liveSchluessel.test.js`
Expected: PASS (6 Tests). Schlägt `normalisiereVerein('jc  musterstadt eV')` fehl, die Regex `\be\s*v\b` prüfen (muss „eV" und „e v" abdecken).

- [ ] **Step 5: Commit**

```bash
git add src/live/schluessel.js tests/unit/liveSchluessel.test.js
git commit -m "feat: Teilnehmerschlüssel und Vereins-Normalisierung für den Live-Snapshot" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Migration — `live_freigabe`, Schema `live`, Views

**Files:**
- Create: `migrations/20261012100000_live_freigabe_und_views.js`
- Test: `tests/unit/liveViews.test.js`

**Interfaces:**
- Produces (Views im Schema `live`, alle ohne Klartext-Passnummer):
  - `live.turniere(id, urspruengliche_id, bezeichnung, datum, status, live_freigabe)`
  - `live.kampfflaechen(id, turnier_id, bezeichnung)`
  - `live.pools(id, turnier_id, kampfflaeche_id, bezeichnung, modus, typ, status, verspaetet, altersklasse, geschlecht, gewichtsklasse, matte_reihenfolge)`
  - `live.teilnehmer(id, turnier_id, pool_id, vorname, nachname, verein, geschlecht, altersklasse, gewichtsklasse, status, passnummer_hash)` mit `passnummer_hash = sha256(turnier_id || ':' || judopass_id)` als Hex
  - `live.kaempfe(id, pool_id, status, matten_reihenfolge, reihenfolge_nummer, kaempfer1_id, kaempfer2_id, sieger_id, unterbewertung_kaempfer1, unterbewertung_kaempfer2, mannschaftskampf_id)`

- [ ] **Step 1: Failing test**

`tests/unit/liveViews.test.js` (die Rolle kommt in Task 4, hier nur Views und Spalte):

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { starteTestPostgres } from '../helpers/testPostgres.js';

test('Migration: live_freigabe-Spalte und Views im Schema live', async () => {
    const db = await starteTestPostgres();
    const { knex } = db;
    try {
        assert.equal(await knex.schema.hasColumn('turniere', 'live_freigabe'), true);
        const [turnierId] = await knex('turniere').insert({
            bezeichnung: 'T', ort: 'O', datum: '2026-10-12', ausrichter: 'A'
        }).returning('id').then(r => r.map(x => x.id ?? x));
        const t = await knex('turniere').where({ id: turnierId }).first();
        assert.equal(t.live_freigabe, false);

        await knex('turnier_teilnehmer').insert({
            turnier_id: turnierId, judopass_id: 'P-1', vorname: 'Anna', nachname: 'Muster',
            geschlecht: 'w', verein: 'JC Muster', gewicht: 40, altersklasse: 'U15', gewichtsklasse: '-44'
        });

        const zeilen = await knex.raw('select * from live.teilnehmer');
        assert.equal(zeilen.rows.length, 1);
        const z = zeilen.rows[0];
        assert.equal(z.vorname, 'Anna');
        assert.match(z.passnummer_hash, /^[0-9a-f]{64}$/);
        for (const verboten of ['judopass_id', 'gewicht', 'geburtsjahr', 'geburtsdatum', 'iban', 'email']) {
            assert.equal(verboten in z, false, `Spalte ${verboten} darf nicht in live.teilnehmer stehen`);
        }
        for (const view of ['turniere', 'kampfflaechen', 'pools', 'kaempfe']) {
            const r = await knex.raw(`select * from live.${view} limit 0`);
            assert.ok(Array.isArray(r.fields), view);
        }
    } finally {
        await db.stoppe();
    }
});
```

Hinweis: Falls `turnier_teilnehmer` weitere NOT-NULL-Spalten ohne Default hat (Pflichtfelder wie `lizenz_ablauf`/`geburtsjahr`), im Test ergänzen; fehlende Spalten nennt die Fehlermeldung des Inserts.

- [ ] **Step 2: Fehlschlag prüfen**

Run: `node --test tests/unit/liveViews.test.js`
Expected: FAIL (`live_freigabe` fehlt / Schema `live` nicht vorhanden)

- [ ] **Step 3: Migration**

`migrations/20261012100000_live_freigabe_und_views.js`:

```js
// Teilnehmer-App Phase 1 (docs/specs/2026-10-12-teilnehmer-app-design.md):
//  - turniere.live_freigabe: Opt-in des Veranstalters am Hallen-Server. Ohne Freigabe sendet der Live-Prozess nichts.
//  - Schema "live" mit Views: die einzige Sicht des Live-Prozesses auf die Daten. Er verbindet sich mit der Rolle
//    live_ro, die nur diese Views lesen darf; die Views laufen mit den Rechten des Eigentümers, die Basistabellen
//    bleiben für live_ro gesperrt. Nicht enthalten: Geburtsjahr, Gewicht, Passnummer (nur passnummer_hash),
//    Zahlungs- und Anmeldedaten.
export async function up(knex) {
    await knex.schema.alterTable('turniere', (table) => {
        table.boolean('live_freigabe').notNullable().defaultTo(false);
    });

    await knex.raw('CREATE SCHEMA IF NOT EXISTS live');
    await knex.raw('REVOKE ALL ON SCHEMA live FROM PUBLIC');

    await knex.raw(`CREATE OR REPLACE VIEW live.turniere AS
        SELECT id, urspruengliche_id, bezeichnung, datum, status, live_freigabe
        FROM public.turniere`);
    await knex.raw(`CREATE OR REPLACE VIEW live.kampfflaechen AS
        SELECT id, turnier_id, bezeichnung
        FROM public.kampfflaechen`);
    await knex.raw(`CREATE OR REPLACE VIEW live.pools AS
        SELECT id, turnier_id, kampfflaeche_id, bezeichnung, modus, typ, status, verspaetet,
               altersklasse, geschlecht, gewichtsklasse, matte_reihenfolge
        FROM public.pools`);
    await knex.raw(`CREATE OR REPLACE VIEW live.teilnehmer AS
        SELECT id, turnier_id, pool_id, vorname, nachname, verein, geschlecht, altersklasse, gewichtsklasse, status,
               encode(sha256(convert_to(turnier_id::text || ':' || judopass_id, 'UTF8')), 'hex') AS passnummer_hash
        FROM public.turnier_teilnehmer`);
    await knex.raw(`CREATE OR REPLACE VIEW live.kaempfe AS
        SELECT id, pool_id, status, matten_reihenfolge, reihenfolge_nummer, kaempfer1_id, kaempfer2_id, sieger_id,
               unterbewertung_kaempfer1, unterbewertung_kaempfer2, mannschaftskampf_id
        FROM public.kaempfe`);
}

export async function down(knex) {
    await knex.raw('DROP SCHEMA IF EXISTS live CASCADE');
    await knex.schema.alterTable('turniere', (table) => {
        table.dropColumn('live_freigabe');
    });
}
```

- [ ] **Step 4: Test grün**

Run: `node --test tests/unit/liveViews.test.js`
Expected: PASS. Meldet PostgreSQL eine fehlende Spalte (z. B. in `kampfflaechen`), die Spaltennamen mit `\d`-äquivalent prüfen: `node -e` mit knex oder die Migrationsdateien (`20260701095409_init_turnier_schema.js`) und die View anpassen.

- [ ] **Step 5: Commit**

```bash
git add migrations/20261012100000_live_freigabe_und_views.js tests/unit/liveViews.test.js
git commit -m "feat: Spalte live_freigabe und Views im Schema live" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Rolle `live_ro` (`rolle.js`, `scripts/live-rolle.mjs`)

**Files:**
- Create: `src/live/rolle.js`, `scripts/live-rolle.mjs`
- Modify: `package.json` (Scripts `live:rolle`, `live:start`)
- Test: `tests/unit/liveRolle.test.js`

**Interfaces:**
- Consumes: Views aus Task 3.
- Produces: `legeLiveRolleAn(knex, { passwort, rolle = 'live_ro', datenbank }) → Promise<void>`; idempotent (zweiter Aufruf setzt nur das Passwort neu). `knex` muss mit einem Benutzer verbunden sein, der Rollen anlegen darf (Superuser oder `CREATEROLE`).

- [ ] **Step 1: Failing test**

`tests/unit/liveRolle.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import knexLib from 'knex';
import { starteTestPostgres } from '../helpers/testPostgres.js';
import { legeLiveRolleAn } from '../../src/live/rolle.js';

test('Rolle live_ro: liest nur die Views, schreibt nichts, sieht keine Basistabellen', async () => {
    const db = await starteTestPostgres();
    const { knex, verbindung } = db;
    let live;
    try {
        await knex('turniere').insert({ bezeichnung: 'T', ort: 'O', datum: '2026-10-12', ausrichter: 'A' });
        await legeLiveRolleAn(knex, { passwort: 'pw\'mit"Zeichen', datenbank: verbindung.database });
        await legeLiveRolleAn(knex, { passwort: 'zweiterLauf', datenbank: verbindung.database }); // idempotent

        live = knexLib({ client: 'pg', connection: { ...verbindung, user: 'live_ro', password: 'zweiterLauf' } });
        const turniere = await live.raw('select id, live_freigabe from live.turniere');
        assert.equal(turniere.rows.length, 1);

        await assert.rejects(live.raw('select * from public.turniere'), /permission denied/);
        await assert.rejects(live.raw('select * from public.turnier_teilnehmer'), /permission denied/);
        await assert.rejects(live.raw('update live.turniere set live_freigabe = true'), /read-only|permission denied|cannot/i);
        await assert.rejects(live.raw('delete from live.kaempfe'), /read-only|permission denied|cannot/i);

        const t = await live.raw('show statement_timeout');
        assert.equal(t.rows[0].statement_timeout, '3s');
        const ro = await live.raw('show default_transaction_read_only');
        assert.equal(ro.rows[0].default_transaction_read_only, 'on');
    } finally {
        if (live) await live.destroy();
        await db.stoppe();
    }
});

test('legeLiveRolleAn lehnt ungültige Rollennamen ab', async () => {
    await assert.rejects(legeLiveRolleAn({}, { passwort: 'x', rolle: 'a; drop table x', datenbank: 'd' }), /Rollenname/);
});
```

- [ ] **Step 2: Fehlschlag prüfen**

Run: `node --test tests/unit/liveRolle.test.js`
Expected: FAIL (Modul fehlt)

- [ ] **Step 3: Implementierung**

`src/live/rolle.js`:

```js
// Legt die Datenbank-Rolle des Live-Prozesses an (Spec Abschnitt 5.1): nur SELECT auf die Views des Schemas "live",
// Schreiben gesperrt (default_transaction_read_only), Abfragen auf 3 s begrenzt. Idempotent; gedacht für das
// Installationsskript (deploy/linux/install-live.sh) und scripts/live-rolle.mjs, nicht für den laufenden Betrieb.
// Auf einem Cluster genügt der Aufruf am Master: Rollen und ihre Einstellungen replizieren zum Standby.
const ROLLENNAME = /^[a-z_][a-z0-9_]{0,62}$/;

function literal(text) {
    return `'${String(text).replace(/'/g, "''")}'`;
}

function bezeichner(text) {
    return `"${String(text).replace(/"/g, '""')}"`;
}

export async function legeLiveRolleAn(knex, { passwort, rolle = 'live_ro', datenbank }) {
    if (!ROLLENNAME.test(rolle)) throw new Error(`Ungültiger Rollenname: ${rolle}`);
    if (!passwort) throw new Error('Passwort für die Live-Rolle fehlt.');
    if (!datenbank) throw new Error('Name der Datenbank fehlt.');

    await knex.raw(`DO $$
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${literal(rolle)}) THEN
            CREATE ROLE ${rolle} LOGIN PASSWORD ${literal(passwort)};
        ELSE
            ALTER ROLE ${rolle} WITH LOGIN PASSWORD ${literal(passwort)};
        END IF;
    END $$;`);
    await knex.raw(`ALTER ROLE ${rolle} SET default_transaction_read_only = on`);
    await knex.raw(`ALTER ROLE ${rolle} SET statement_timeout = '3s'`);
    await knex.raw(`GRANT CONNECT ON DATABASE ${bezeichner(datenbank)} TO ${rolle}`);
    await knex.raw(`GRANT USAGE ON SCHEMA live TO ${rolle}`);
    await knex.raw(`GRANT SELECT ON ALL TABLES IN SCHEMA live TO ${rolle}`);
}
```

`scripts/live-rolle.mjs`:

```js
// Legt die Rolle live_ro an: node scripts/live-rolle.mjs
// Liest die Verbindung des Hallen-Servers aus .env (DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME) und das Passwort der
// neuen Rolle aus LIVE_DB_PASSWORD. Muss mit einem Benutzer laufen, der Rollen anlegen darf (z. B. postgres).
import dotenv from 'dotenv';
import knexLib from 'knex';
import { legeLiveRolleAn } from '../src/live/rolle.js';

dotenv.config({ quiet: true });
const passwort = process.env.LIVE_DB_PASSWORD;
if (!passwort) {
    console.error('LIVE_DB_PASSWORD ist nicht gesetzt.');
    process.exit(1);
}
const datenbank = process.env.DB_NAME || 'hajime';
const knex = knexLib({
    client: 'pg',
    connection: {
        host: process.env.DB_HOST || '127.0.0.1',
        port: Number(process.env.DB_PORT || 5432),
        user: process.env.DB_ADMIN_USER || process.env.DB_USER,
        password: process.env.DB_ADMIN_PASSWORD || process.env.DB_PASSWORD,
        database: datenbank
    }
});
try {
    await legeLiveRolleAn(knex, { passwort, datenbank });
    console.log('Rolle live_ro angelegt/aktualisiert.');
} finally {
    await knex.destroy();
}
```

`package.json` unter `scripts` ergänzen (nach `pg:status`):

```json
    "live:rolle": "node scripts/live-rolle.mjs",
    "live:start": "node src/live/main.js",
```

- [ ] **Step 4: Test grün**

Run: `node --test tests/unit/liveRolle.test.js`
Expected: PASS (2 Tests). Erlaubt die Fehlermeldung für `update live.turniere` einen anderen Text, die Regex im Test um den tatsächlichen PostgreSQL-Text ergänzen (Ziel: Schreiben ist abgelehnt).

- [ ] **Step 5: Commit**

```bash
git add src/live/rolle.js scripts/live-rolle.mjs package.json tests/unit/liveRolle.test.js
git commit -m "feat: Rolle live_ro mit reinem Lesezugriff auf die Live-Views" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Snapshot-Builder (`snapshot.js`)

**Files:**
- Create: `src/live/snapshot.js`
- Test: `tests/unit/liveSnapshot.test.js`

**Interfaces:**
- Consumes: Views (Task 3), `berechneKacheln` (Task 1), `teilnehmerSchluessel`/`vereinSchluessel`/`waehleAnzeigename` (Task 2), `berechnePlatzierungen` aus `src/shared/platzierungen.js`.
- Produces:
  - `baueSnapshot(roh, { geheimnis }) → Snapshot` (rein)
    - `roh = { turnier, kampfflaechen, pools, teilnehmer, kaempfe }` (Zeilen der Views)
  - `ladeSnapshots(knexLive, { geheimnis }) → Promise<Snapshot[]>` (freigegebene Turniere mit `urspruengliche_id`)
  - `Snapshot = { version: 1, turnierKey: string, name: string, datum: string, vereine: [{key, name}], matten: [{id, bezeichnung}], teilnehmer: [{ key, vorname, nachname, vereinKey, verein, altersklasse, gewichtsklasse, geschlecht, poolId, poolBezeichnung, matteId, matteBezeichnung, zustand, abstand, naechsterKampfId, platz }], warteschlangen: [{ matteId, kaempfe: [{ id, status, position, teilnehmerKeys: [string|null, string|null] }] }] }`
  - `turnierKey` = `String(urspruengliche_id)`; **kein** Zeitstempel im Snapshot (Delta über Hash, Zeitstempel ergänzt der Uplink).

- [ ] **Step 1: Failing test**

`tests/unit/liveSnapshot.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import knexLib from 'knex';
import { starteTestPostgres } from '../helpers/testPostgres.js';
import { legeLiveRolleAn } from '../../src/live/rolle.js';
import { baueSnapshot, ladeSnapshots } from '../../src/live/snapshot.js';

const turnier = { id: 7, urspruengliche_id: 42, bezeichnung: 'Sommerturnier', datum: '2026-10-12', status: 'veroeffentlicht', live_freigabe: true };
const matten = [{ id: 1, turnier_id: 7, bezeichnung: 'Matte 1' }];
const pool = (extra = {}) => ({ id: 10, turnier_id: 7, kampfflaeche_id: 1, bezeichnung: 'U15 w -44', modus: 'Jeder-gegen-Jeden', typ: 'einzel', status: 'matte_zugewiesen', verspaetet: false, altersklasse: 'U15', geschlecht: 'w', gewichtsklasse: '-44', matte_reihenfolge: 1, ...extra });
const teil = (id, extra = {}) => ({ id, turnier_id: 7, pool_id: 10, vorname: `V${id}`, nachname: `N${id}`, verein: 'JC Muster', geschlecht: 'w', altersklasse: 'U15', gewichtsklasse: '-44', status: 'kampfbereit', passnummer_hash: `hash${id}`, ...extra });
const kampf = (id, k1, k2, extra = {}) => ({ id, pool_id: 10, status: 'bereit', matten_reihenfolge: id, reihenfolge_nummer: `R${id}`, kaempfer1_id: k1, kaempfer2_id: k2, sieger_id: null, unterbewertung_kaempfer1: 0, unterbewertung_kaempfer2: 0, mannschaftskampf_id: null, ...extra });

test('baueSnapshot: Teilnehmer mit Matte, Abstand und stabilen Schlüsseln', () => {
    const roh = { turnier, kampfflaechen: matten, pools: [pool()], teilnehmer: [teil(1), teil(2), teil(3), teil(4)], kaempfe: [kampf(1, 1, 2), kampf(2, 3, 4)] };
    const s = baueSnapshot(roh, { geheimnis: 'g' });
    assert.equal(s.version, 1);
    assert.equal(s.turnierKey, '42');
    assert.equal(s.name, 'Sommerturnier');
    const t3 = s.teilnehmer.find(t => t.vorname === 'V3');
    assert.equal(t3.zustand, 'in_n');
    assert.equal(t3.abstand, 1);
    assert.equal(t3.matteBezeichnung, 'Matte 1');
    assert.equal(t3.poolBezeichnung, 'U15 w -44');
    assert.match(t3.key, /^[0-9a-f]{24}$/);
    assert.equal('judopass_id' in t3, false);
    assert.equal('passnummer_hash' in t3, false);
    assert.equal(s.warteschlangen[0].kaempfe.length, 2);
    assert.deepEqual(s.warteschlangen[0].kaempfe[1].teilnehmerKeys, [t3.key, s.teilnehmer.find(t => t.vorname === 'V4').key]);
    // gleicher Eingang, gleicher Snapshot
    assert.deepEqual(baueSnapshot(roh, { geheimnis: 'g' }), s);
});

test('baueSnapshot: zurückgezogene Teilnehmer fehlen, Vereine zusammengefasst', () => {
    const roh = {
        turnier, kampfflaechen: matten, pools: [pool()],
        teilnehmer: [teil(1, { verein: 'JC Musterstadt' }), teil(2, { verein: 'Judoclub Musterstadt e.V.' }), teil(3, { status: 'zurueckgezogen' })],
        kaempfe: []
    };
    const s = baueSnapshot(roh, { geheimnis: 'g' });
    assert.equal(s.teilnehmer.length, 2);
    assert.equal(s.vereine.length, 1);
    assert.equal(s.teilnehmer[0].vereinKey, s.teilnehmer[1].vereinKey);
});

test('baueSnapshot: abgeschlossener Pool liefert Platz 1 bis 3', () => {
    const roh = {
        turnier, kampfflaechen: matten, pools: [pool({ status: 'abgeschlossen' })],
        teilnehmer: [teil(1), teil(2), teil(3)],
        kaempfe: [
            kampf(1, 1, 2, { status: 'beendet', sieger_id: 1 }),
            kampf(2, 1, 3, { status: 'beendet', sieger_id: 1 }),
            kampf(3, 2, 3, { status: 'beendet', sieger_id: 2 })
        ]
    };
    const s = baueSnapshot(roh, { geheimnis: 'g' });
    const platzVon = vorname => s.teilnehmer.find(t => t.vorname === vorname).platz;
    assert.deepEqual([platzVon('V1'), platzVon('V2'), platzVon('V3')], [1, 2, 3]);
    assert.ok(s.teilnehmer.every(t => t.zustand === 'abgeschlossen'));
});

test('baueSnapshot: Mannschaftsteilnehmer und Mannschafts-Pools erscheinen nicht', () => {
    const roh = {
        turnier, kampfflaechen: matten,
        pools: [pool(), pool({ id: 11, typ: 'mannschaft', bezeichnung: 'Team' })],
        teilnehmer: [teil(1), teil(2, { pool_id: 11 })],
        kaempfe: []
    };
    const s = baueSnapshot(roh, { geheimnis: 'g' });
    assert.equal(s.teilnehmer.length, 1);
});

test('ladeSnapshots: nur freigegebene Turniere mit urspruengliche_id, über die Rolle live_ro', async () => {
    const db = await starteTestPostgres();
    const { knex, verbindung } = db;
    let live;
    try {
        const neu = async (extra) => (await knex('turniere').insert({ bezeichnung: 'T', ort: 'O', datum: '2026-10-12', ausrichter: 'A', ...extra }).returning('id'))[0].id;
        const frei = await neu({ live_freigabe: true, urspruengliche_id: 100 });
        await neu({ live_freigabe: true, urspruengliche_id: null });
        await neu({ live_freigabe: false, urspruengliche_id: 101 });
        const [matte] = await knex('kampfflaechen').insert({ turnier_id: frei, bezeichnung: 'Matte 1' }).returning('id');
        const [p] = await knex('pools').insert({ turnier_id: frei, kampfflaeche_id: matte.id, bezeichnung: 'P', altersklasse: 'U15', geschlecht: 'w', gewichtsklasse: '-44' }).returning('id');
        await knex('turnier_teilnehmer').insert({ turnier_id: frei, pool_id: p.id, judopass_id: 'P-1', vorname: 'Anna', nachname: 'Muster', geschlecht: 'w', verein: 'JC', gewicht: 40, altersklasse: 'U15', gewichtsklasse: '-44' });

        await legeLiveRolleAn(knex, { passwort: 'pw', datenbank: verbindung.database });
        live = knexLib({ client: 'pg', connection: { ...verbindung, user: 'live_ro', password: 'pw' } });
        const snapshots = await ladeSnapshots(live, { geheimnis: 'g' });
        assert.equal(snapshots.length, 1);
        assert.equal(snapshots[0].turnierKey, '100');
        assert.equal(snapshots[0].teilnehmer.length, 1);
        assert.equal(snapshots[0].teilnehmer[0].vorname, 'Anna');
    } finally {
        if (live) await live.destroy();
        await db.stoppe();
    }
});
```

Hinweis: Die Pflichtspalten von `pools` (z. B. `modus`-Default) und `turnier_teilnehmer` im Insert so ergänzen, wie die Fehlermeldung es verlangt (Defaults aus den Migrationen gelten).

- [ ] **Step 2: Fehlschlag prüfen**

Run: `node --test tests/unit/liveSnapshot.test.js`
Expected: FAIL (Modul fehlt)

- [ ] **Step 3: Implementierung**

`src/live/snapshot.js`:

```js
// Baut aus den Views des Schemas "live" den Snapshot, den der Uplink an die Cloud sendet
// (Spec Abschnitt 5.2). baueSnapshot ist rein und deterministisch (gleicher Eingang → gleiche Ausgabe), damit der
// Uplink Änderungen über einen Hash erkennen kann; ladeSnapshots liest nur über die schreibgeschützte Rolle live_ro.
import { berechneKacheln } from '../shared/liveKachel.js';
import { berechnePlatzierungen } from '../shared/platzierungen.js';
import { teilnehmerSchluessel, vereinSchluessel, waehleAnzeigename } from './schluessel.js';

const OFFEN = new Set(['bereit', 'vorbereiten', 'gestartet']);

function platzierungenJePool(pools, teilnehmer, kaempfe) {
    const ergebnis = {};
    for (const pool of pools) {
        if (pool.typ === 'mannschaft' || pool.status !== 'abgeschlossen') continue;
        const mitglieder = teilnehmer.filter(t => t.pool_id === pool.id).map(t => ({ id: t.id, gewicht: 0 }));
        const poolKaempfe = kaempfe.filter(k => k.pool_id === pool.id);
        const r = berechnePlatzierungen(pool, poolKaempfe, mitglieder);
        ergebnis[pool.id] = Object.fromEntries(r.eintraege.map(e => [e.teilnehmer.id, e.platz]));
    }
    return ergebnis;
}

export function baueSnapshot({ turnier, kampfflaechen, pools, teilnehmer, kaempfe }, { geheimnis }) {
    const sichtbar = teilnehmer.filter(t => t.status !== 'zurueckgezogen');
    const kacheln = berechneKacheln({
        pools, teilnehmer: sichtbar, kaempfe, platzierungen: platzierungenJePool(pools, sichtbar, kaempfe)
    });
    const poolById = new Map(pools.map(p => [p.id, p]));
    const matteById = new Map(kampfflaechen.map(m => [m.id, m]));
    const keyVonId = new Map(sichtbar.map(t => [t.id, teilnehmerSchluessel(geheimnis, t.passnummer_hash)]));

    const eintraege = [];
    const vereinNamen = new Map();
    for (const t of sichtbar) {
        const kachel = kacheln.get(t.id);
        if (!kachel) continue; // Mannschaftsteilnehmer
        const pool = t.pool_id != null ? poolById.get(t.pool_id) : null;
        const matte = pool && pool.kampfflaeche_id != null ? matteById.get(pool.kampfflaeche_id) : null;
        const vereinKey = vereinSchluessel(t.verein);
        if (!vereinNamen.has(vereinKey)) vereinNamen.set(vereinKey, []);
        vereinNamen.get(vereinKey).push(t.verein);
        eintraege.push({
            key: keyVonId.get(t.id),
            vorname: t.vorname, nachname: t.nachname,
            vereinKey, verein: t.verein,
            altersklasse: t.altersklasse, gewichtsklasse: t.gewichtsklasse, geschlecht: t.geschlecht,
            poolId: pool ? pool.id : null, poolBezeichnung: pool ? pool.bezeichnung : null,
            matteId: matte ? matte.id : null, matteBezeichnung: matte ? matte.bezeichnung : null,
            zustand: kachel.zustand, abstand: kachel.abstand, naechsterKampfId: kachel.naechsterKampfId, platz: kachel.platz
        });
    }
    eintraege.sort((a, b) => a.key.localeCompare(b.key));

    const vereine = [...vereinNamen.entries()]
        .map(([key, namen]) => ({ key, name: waehleAnzeigename(namen) }))
        .sort((a, b) => a.key.localeCompare(b.key));

    const warteschlangen = kampfflaechen
        .map(m => {
            const poolIds = new Set(pools.filter(p => p.kampfflaeche_id === m.id).map(p => p.id));
            const offen = kaempfe
                .filter(k => poolIds.has(k.pool_id) && OFFEN.has(k.status))
                .sort((a, b) => {
                    const ra = a.matten_reihenfolge == null ? Infinity : Number(a.matten_reihenfolge);
                    const rb = b.matten_reihenfolge == null ? Infinity : Number(b.matten_reihenfolge);
                    return ra !== rb ? ra - rb : a.id - b.id;
                });
            return {
                matteId: m.id,
                kaempfe: offen.map((k, i) => ({
                    id: k.id, status: k.status, position: i,
                    teilnehmerKeys: [keyVonId.get(k.kaempfer1_id) ?? null, keyVonId.get(k.kaempfer2_id) ?? null]
                }))
            };
        })
        .sort((a, b) => a.matteId - b.matteId);

    return {
        version: 1,
        turnierKey: String(turnier.urspruengliche_id),
        name: turnier.bezeichnung,
        datum: String(turnier.datum).slice(0, 10),
        vereine,
        matten: kampfflaechen.map(m => ({ id: m.id, bezeichnung: m.bezeichnung })).sort((a, b) => a.id - b.id),
        teilnehmer: eintraege,
        warteschlangen
    };
}

export async function ladeSnapshots(knexLive, { geheimnis }) {
    const turniere = await knexLive('live.turniere')
        .where({ live_freigabe: true })
        .whereNotNull('urspruengliche_id')
        .orderBy('id');
    const snapshots = [];
    for (const turnier of turniere) {
        const [kampfflaechen, pools, teilnehmer] = await Promise.all([
            knexLive('live.kampfflaechen').where({ turnier_id: turnier.id }),
            knexLive('live.pools').where({ turnier_id: turnier.id }),
            knexLive('live.teilnehmer').where({ turnier_id: turnier.id })
        ]);
        const poolIds = pools.map(p => p.id);
        const kaempfe = poolIds.length ? await knexLive('live.kaempfe').whereIn('pool_id', poolIds) : [];
        snapshots.push(baueSnapshot({ turnier, kampfflaechen, pools, teilnehmer, kaempfe }, { geheimnis }));
    }
    return snapshots;
}
```

- [ ] **Step 4: Test grün**

Run: `node --test tests/unit/liveSnapshot.test.js`
Expected: PASS (5 Tests). Im JgJ-Platz-Test hängt das Ergebnis von `berechneJgj` ab (alle Kämpfe `beendet`, Rangfolge nach Siegen): V1 2 Siege → 1, V2 1 Sieg → 2, V3 → 3.

- [ ] **Step 5: Commit**

```bash
git add src/live/snapshot.js tests/unit/liveSnapshot.test.js
git commit -m "feat: Snapshot-Builder für die Teilnehmer-App liest über die Rolle live_ro" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Uplink (`uplink.js`)

**Files:**
- Create: `src/live/uplink.js`
- Test: `tests/unit/liveUplink.test.js`

**Interfaces:**
- Consumes: `Snapshot` aus Task 5.
- Produces: `erzeugeUplink({ url, token, fetchFn = fetch, jetzt = Date.now, lebenszeichenMs = 60000, backoffStartMs = 2000, backoffMaxMs = 60000, timeoutMs = 10000, log = console }) → { sende(snapshots: Snapshot[]): Promise<{ gesendet: number, zurueckgezogen: number, fehler: number }>, zustand(): { letzterErfolg: number|null, letzterFehler: string|null, naechsterVersuch: number } }`
  - Nutzlast je Turnier: `{ ...snapshot, stand: <ISO>, sequenz: <jetzt()> }`, gzip-komprimiert, Header `Authorization: Bearer <token>`, `Content-Type: application/json`, `Content-Encoding: gzip`.
  - Rücknahme: `{ version: 1, turnierKey, zurueckgezogen: true, stand, sequenz }`.

- [ ] **Step 1: Failing test**

`tests/unit/liveUplink.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { erzeugeUplink } from '../../src/live/uplink.js';

const snap = (key, extra = {}) => ({ version: 1, turnierKey: key, name: 'T', datum: '2026-10-12', vereine: [], matten: [], teilnehmer: [], warteschlangen: [], ...extra });

function werkzeug({ antworten = [] } = {}) {
    const aufrufe = [];
    let i = 0;
    const fetchFn = async (url, opts) => {
        const body = JSON.parse(zlib.gunzipSync(opts.body).toString('utf8'));
        aufrufe.push({ url, opts, body });
        const a = antworten[i++] ?? { status: 204 };
        if (a.fehler) throw new Error(a.fehler);
        return { ok: a.status >= 200 && a.status < 300, status: a.status, body: { cancel() {} } };
    };
    let t = 1_000_000;
    return { aufrufe, fetchFn, jetzt: () => t, vor: ms => { t += ms; } };
}

test('sendet neu, dann nicht erneut ohne Änderung', async () => {
    const w = werkzeug();
    const u = erzeugeUplink({ url: 'https://cloud/api/live/ingest', token: 'tok', fetchFn: w.fetchFn, jetzt: w.jetzt, log: { warn() {}, log() {} } });
    assert.deepEqual(await u.sende([snap('1')]), { gesendet: 1, zurueckgezogen: 0, fehler: 0 });
    w.vor(5000);
    assert.deepEqual(await u.sende([snap('1')]), { gesendet: 0, zurueckgezogen: 0, fehler: 0 });
    assert.equal(w.aufrufe.length, 1);
    assert.equal(w.aufrufe[0].opts.headers.Authorization, 'Bearer tok');
    assert.equal(w.aufrufe[0].opts.headers['Content-Encoding'], 'gzip');
    assert.equal(w.aufrufe[0].body.turnierKey, '1');
    assert.ok(w.aufrufe[0].body.stand);
    assert.ok(w.aufrufe[0].body.sequenz);
});

test('sendet bei Änderung und als Lebenszeichen nach 60 s', async () => {
    const w = werkzeug();
    const u = erzeugeUplink({ url: 'u', token: 't', fetchFn: w.fetchFn, jetzt: w.jetzt, log: { warn() {}, log() {} } });
    await u.sende([snap('1')]);
    w.vor(5000);
    await u.sende([snap('1', { name: 'Neu' })]);
    assert.equal(w.aufrufe.length, 2);
    w.vor(30_000);
    await u.sende([snap('1', { name: 'Neu' })]);
    assert.equal(w.aufrufe.length, 2);
    w.vor(31_000);
    await u.sende([snap('1', { name: 'Neu' })]);
    assert.equal(w.aufrufe.length, 3);
});

test('Fehler: Backoff, Hash bleibt, nächster Versuch nach der Wartezeit sendet erneut', async () => {
    const w = werkzeug({ antworten: [{ status: 503 }, { status: 204 }] });
    const u = erzeugeUplink({ url: 'u', token: 't', fetchFn: w.fetchFn, jetzt: w.jetzt, backoffStartMs: 2000, log: { warn() {}, log() {} } });
    assert.deepEqual(await u.sende([snap('1')]), { gesendet: 0, zurueckgezogen: 0, fehler: 1 });
    w.vor(1000);
    assert.deepEqual(await u.sende([snap('1')]), { gesendet: 0, zurueckgezogen: 0, fehler: 0 }); // noch im Backoff
    assert.equal(w.aufrufe.length, 1);
    w.vor(1500);
    assert.deepEqual(await u.sende([snap('1')]), { gesendet: 1, zurueckgezogen: 0, fehler: 0 });
    assert.equal(w.aufrufe.length, 2);
});

test('Netzwerkfehler (Ausnahme) bricht nicht ab', async () => {
    const w = werkzeug({ antworten: [{ fehler: 'ECONNREFUSED' }] });
    const u = erzeugeUplink({ url: 'u', token: 't', fetchFn: w.fetchFn, jetzt: w.jetzt, log: { warn() {}, log() {} } });
    assert.deepEqual(await u.sende([snap('1')]), { gesendet: 0, zurueckgezogen: 0, fehler: 1 });
    assert.match(u.zustand().letzterFehler, /ECONNREFUSED/);
});

test('Rücknahme genau einmal, wenn ein Turnier aus der Auswahl verschwindet', async () => {
    const w = werkzeug();
    const u = erzeugeUplink({ url: 'u', token: 't', fetchFn: w.fetchFn, jetzt: w.jetzt, log: { warn() {}, log() {} } });
    await u.sende([snap('1'), snap('2')]);
    w.vor(5000);
    const r = await u.sende([snap('2')]);
    assert.equal(r.zurueckgezogen, 1);
    const letzte = w.aufrufe.at(-1).body;
    assert.deepEqual([letzte.turnierKey, letzte.zurueckgezogen], ['1', true]);
    w.vor(5000);
    assert.deepEqual(await u.sende([snap('2')]), { gesendet: 0, zurueckgezogen: 0, fehler: 0 });
});

test('Antwortinhalt wird nicht gelesen, nur der Statuscode zählt', async () => {
    let gelesen = false;
    const fetchFn = async () => ({ ok: true, status: 200, body: { cancel() {} }, json: async () => { gelesen = true; return {}; }, text: async () => { gelesen = true; return ''; } });
    const u = erzeugeUplink({ url: 'u', token: 't', fetchFn, log: { warn() {}, log() {} } });
    await u.sende([snap('1')]);
    assert.equal(gelesen, false);
});
```

- [ ] **Step 2: Fehlschlag prüfen**

Run: `node --test tests/unit/liveUplink.test.js`
Expected: FAIL (Modul fehlt)

- [ ] **Step 3: Implementierung**

`src/live/uplink.js`:

```js
// Sendet Snapshots ausgehend an die Cloud (Spec Abschnitt 5.3). Nur Statuscodes zählen: die Antwort wird weder
// gelesen noch ausgewertet, es gibt keinen Rückkanal. Gesendet wird bei Änderung (Hash ohne Zeitstempel), spätestens
// alle 60 s als Lebenszeichen; Fehler führen zu Backoff, der letzte erfolgreich gesendete Hash bleibt unverändert.
import crypto from 'node:crypto';
import zlib from 'node:zlib';

export function erzeugeUplink({
    url, token, fetchFn = fetch, jetzt = Date.now,
    lebenszeichenMs = 60_000, backoffStartMs = 2000, backoffMaxMs = 60_000, timeoutMs = 10_000,
    log = console
}) {
    const gesendet = new Map(); // turnierKey -> { hash, zeit }
    let backoffMs = 0;
    let naechsterVersuch = 0;
    let letzterErfolg = null;
    let letzterFehler = null;

    const hashVon = (snapshot) => crypto.createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');

    async function poste(nutzlast) {
        const zeit = jetzt();
        const koerper = zlib.gzipSync(Buffer.from(JSON.stringify({
            ...nutzlast, stand: new Date(zeit).toISOString(), sequenz: zeit
        }), 'utf8'));
        const antwort = await fetchFn(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Encoding': 'gzip',
                Authorization: `Bearer ${token}`
            },
            body: koerper,
            signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined
        });
        try { await antwort.body?.cancel(); } catch { /* Antwort wird bewusst nicht gelesen */ }
        if (!antwort.ok) throw new Error(`Cloud antwortete mit Status ${antwort.status}`);
    }

    async function sende(snapshots) {
        const ergebnis = { gesendet: 0, zurueckgezogen: 0, fehler: 0 };
        const jetztMs = jetzt();
        if (jetztMs < naechsterVersuch) return ergebnis;

        const aktuelle = new Set(snapshots.map(s => s.turnierKey));
        const auftraege = [];
        for (const snapshot of snapshots) {
            const hash = hashVon(snapshot);
            const bisher = gesendet.get(snapshot.turnierKey);
            const faellig = !bisher || bisher.hash !== hash || jetztMs - bisher.zeit >= lebenszeichenMs;
            if (faellig) auftraege.push({ art: 'snapshot', key: snapshot.turnierKey, hash, nutzlast: snapshot });
        }
        for (const key of gesendet.keys()) {
            if (!aktuelle.has(key)) auftraege.push({ art: 'rueck', key, nutzlast: { version: 1, turnierKey: key, zurueckgezogen: true } });
        }

        for (const auftrag of auftraege) {
            try {
                await poste(auftrag.nutzlast);
                if (auftrag.art === 'snapshot') {
                    gesendet.set(auftrag.key, { hash: auftrag.hash, zeit: jetzt() });
                    ergebnis.gesendet += 1;
                } else {
                    gesendet.delete(auftrag.key);
                    ergebnis.zurueckgezogen += 1;
                }
                letzterErfolg = jetzt();
                letzterFehler = null;
                backoffMs = 0;
                naechsterVersuch = 0;
            } catch (fehler) {
                ergebnis.fehler += 1;
                letzterFehler = String(fehler && fehler.message ? fehler.message : fehler);
                backoffMs = backoffMs ? Math.min(backoffMs * 2, backoffMaxMs) : backoffStartMs;
                naechsterVersuch = jetzt() + backoffMs;
                log.warn(`[Live] Uplink fehlgeschlagen (${letzterFehler}), nächster Versuch in ${Math.round(backoffMs / 1000)} s`);
                break; // weitere Turniere im Backoff nicht überrollen
            }
        }
        return ergebnis;
    }

    return {
        sende,
        zustand: () => ({ letzterErfolg, letzterFehler, naechsterVersuch })
    };
}
```

- [ ] **Step 4: Test grün**

Run: `node --test tests/unit/liveUplink.test.js`
Expected: PASS (6 Tests)

- [ ] **Step 5: Commit**

```bash
git add src/live/uplink.js tests/unit/liveUplink.test.js
git commit -m "feat: Live-Uplink sendet Snapshots bei Änderung mit Lebenszeichen und Backoff" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Konfiguration und Dienstschleife (`konfig.js`, `dienst.js`, `main.js`)

**Files:**
- Create: `src/live/konfig.js`, `src/live/dienst.js`, `src/live/main.js`
- Test: `tests/unit/liveKonfig.test.js`, `tests/unit/liveDienst.test.js`

**Interfaces:**
- Consumes: `ladeSnapshots` (Task 5), `erzeugeUplink` (Task 6).
- Produces:
  - `liesLiveKonfig(env) → { db: { host, port, user, password, database }, uplinkUrl, token, geheimnis, intervallMs }`; wirft `Error` mit Klartext bei fehlenden Pflichtwerten.
  - `starteLiveDienst({ ladeSnapshots: () => Promise<Snapshot[]>, uplink, intervallMs = 5000, log = console, setzeTimer = setTimeout, loescheTimer = clearTimeout }) → { tick(): Promise<void>, stoppe(): void }`; ein fehlgeschlagener Tick (Datenbank-/Uplinkfehler) wird protokolliert, die Schleife läuft weiter.

- [ ] **Step 1: Failing tests**

`tests/unit/liveKonfig.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { liesLiveKonfig } from '../../src/live/konfig.js';

const basis = {
    LIVE_DB_PASSWORD: 'pw', LIVE_UPLINK_URL: 'https://cloud.example/api/live/ingest',
    LIVE_UPLINK_TOKEN: 'tok', LIVE_SCHLUESSEL: 'geheim'
};

test('Standardwerte', () => {
    const k = liesLiveKonfig(basis);
    assert.deepEqual(k.db, { host: '127.0.0.1', port: 5432, user: 'live_ro', password: 'pw', database: 'hajime' });
    assert.equal(k.intervallMs, 5000);
    assert.equal(k.uplinkUrl, basis.LIVE_UPLINK_URL);
});

test('überschreibbare Werte', () => {
    const k = liesLiveKonfig({ ...basis, LIVE_DB_HOST: 'db', LIVE_DB_PORT: '5433', LIVE_DB_NAME: 'x', LIVE_DB_USER: 'u', LIVE_INTERVALL_MS: '2000' });
    assert.equal(k.db.host, 'db');
    assert.equal(k.db.port, 5433);
    assert.equal(k.db.database, 'x');
    assert.equal(k.db.user, 'u');
    assert.equal(k.intervallMs, 2000);
});

test('fehlende Pflichtwerte werden benannt', () => {
    for (const name of ['LIVE_DB_PASSWORD', 'LIVE_UPLINK_URL', 'LIVE_UPLINK_TOKEN', 'LIVE_SCHLUESSEL']) {
        const env = { ...basis };
        delete env[name];
        assert.throws(() => liesLiveKonfig(env), new RegExp(name));
    }
});

test('Uplink-URL muss https sein (außer localhost)', () => {
    assert.throws(() => liesLiveKonfig({ ...basis, LIVE_UPLINK_URL: 'http://cloud.example/x' }), /https/);
    assert.doesNotThrow(() => liesLiveKonfig({ ...basis, LIVE_UPLINK_URL: 'http://127.0.0.1:3000/x' }));
});

test('Intervall unter 1 s wird abgelehnt', () => {
    assert.throws(() => liesLiveKonfig({ ...basis, LIVE_INTERVALL_MS: '200' }), /LIVE_INTERVALL_MS/);
});
```

`tests/unit/liveDienst.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { starteLiveDienst } from '../../src/live/dienst.js';

const stilles = { log() {}, warn() {}, error() {} };

test('tick lädt Snapshots und übergibt sie dem Uplink', async () => {
    const gesendet = [];
    const dienst = starteLiveDienst({
        ladeSnapshots: async () => [{ turnierKey: '1' }],
        uplink: { sende: async (s) => { gesendet.push(s); return { gesendet: 1, zurueckgezogen: 0, fehler: 0 }; } },
        log: stilles, setzeTimer: () => 0, loescheTimer: () => {}
    });
    await dienst.tick();
    assert.deepEqual(gesendet, [[{ turnierKey: '1' }]]);
    dienst.stoppe();
});

test('Datenbankfehler im Tick beenden die Schleife nicht', async () => {
    let n = 0;
    const dienst = starteLiveDienst({
        ladeSnapshots: async () => { n += 1; if (n === 1) throw new Error('db weg'); return []; },
        uplink: { sende: async () => ({ gesendet: 0, zurueckgezogen: 0, fehler: 0 }) },
        log: stilles, setzeTimer: () => 0, loescheTimer: () => {}
    });
    await dienst.tick();
    await dienst.tick();
    assert.equal(n, 2);
    dienst.stoppe();
});

test('keine freigegebenen Turniere: leere Liste wird gesendet (löst Rücknahmen aus)', async () => {
    const gesehen = [];
    const dienst = starteLiveDienst({
        ladeSnapshots: async () => [],
        uplink: { sende: async (s) => { gesehen.push(s.length); return {}; } },
        log: stilles, setzeTimer: () => 0, loescheTimer: () => {}
    });
    await dienst.tick();
    assert.deepEqual(gesehen, [0]);
    dienst.stoppe();
});

test('Schleife plant den nächsten Tick nach dem Intervall', async () => {
    const geplant = [];
    const dienst = starteLiveDienst({
        ladeSnapshots: async () => [], uplink: { sende: async () => ({}) }, intervallMs: 5000,
        log: stilles, setzeTimer: (fn, ms) => { geplant.push(ms); return 1; }, loescheTimer: () => {}
    });
    await dienst.tick();
    assert.ok(geplant.includes(5000));
    dienst.stoppe();
});
```

- [ ] **Step 2: Fehlschlag prüfen**

Run: `node --test tests/unit/liveKonfig.test.js tests/unit/liveDienst.test.js`
Expected: FAIL (Module fehlen)

- [ ] **Step 3: Implementierung**

`src/live/konfig.js`:

```js
// Liest die Umgebungsvariablen des Live-Prozesses (Datei /opt/hajime-pro/live.env unter systemd).
// Alles Pflichtige wird beim Start geprüft, damit ein Fehler sofort und mit Klartext sichtbar wird.
const PFLICHT = ['LIVE_DB_PASSWORD', 'LIVE_UPLINK_URL', 'LIVE_UPLINK_TOKEN', 'LIVE_SCHLUESSEL'];

export function liesLiveKonfig(env = process.env) {
    for (const name of PFLICHT) {
        if (!env[name]) throw new Error(`${name} ist nicht gesetzt.`);
    }
    const url = new URL(env.LIVE_UPLINK_URL);
    const lokal = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.protocol !== 'https:' && !lokal) {
        throw new Error('LIVE_UPLINK_URL muss https verwenden.');
    }
    const intervallMs = Number(env.LIVE_INTERVALL_MS || 5000);
    if (!Number.isFinite(intervallMs) || intervallMs < 1000) {
        throw new Error('LIVE_INTERVALL_MS muss mindestens 1000 sein.');
    }
    return {
        db: {
            host: env.LIVE_DB_HOST || '127.0.0.1',
            port: Number(env.LIVE_DB_PORT || 5432),
            user: env.LIVE_DB_USER || 'live_ro',
            password: env.LIVE_DB_PASSWORD,
            database: env.LIVE_DB_NAME || 'hajime'
        },
        uplinkUrl: env.LIVE_UPLINK_URL,
        token: env.LIVE_UPLINK_TOKEN,
        geheimnis: env.LIVE_SCHLUESSEL,
        intervallMs
    };
}
```

`src/live/dienst.js`:

```js
// Schleife des Live-Prozesses: alle intervallMs Snapshots laden und dem Uplink übergeben. Ein fehlgeschlagener Tick
// (Datenbank kurz weg, Cloud nicht erreichbar) wird protokolliert, der nächste läuft planmäßig.
// Die nächste Runde wird erst nach Abschluss der vorigen geplant, damit sich Abfragen nie überlappen.
export function starteLiveDienst({
    ladeSnapshots, uplink, intervallMs = 5000, log = console,
    setzeTimer = setTimeout, loescheTimer = clearTimeout
}) {
    let timer = null;
    let gestoppt = false;

    async function tick() {
        try {
            const snapshots = await ladeSnapshots();
            await uplink.sende(snapshots);
        } catch (fehler) {
            log.error(`[Live] Durchlauf fehlgeschlagen: ${fehler && fehler.message ? fehler.message : fehler}`);
        } finally {
            if (!gestoppt) timer = setzeTimer(tick, intervallMs);
        }
    }

    function stoppe() {
        gestoppt = true;
        if (timer != null) loescheTimer(timer);
    }

    return { tick, stoppe };
}
```

`src/live/main.js`:

```js
// Einstieg des Live-Prozesses: node src/live/main.js (systemd-Dienst hajime-live auf dem Slave).
// Verbindet sich nur mit der Rolle live_ro (nur Views), baut Snapshots und sendet sie ausgehend an die Cloud.
import dotenv from 'dotenv';
import knexLib from 'knex';
import { liesLiveKonfig } from './konfig.js';
import { ladeSnapshots } from './snapshot.js';
import { erzeugeUplink } from './uplink.js';
import { starteLiveDienst } from './dienst.js';

dotenv.config({ quiet: true });

let konfig;
try {
    konfig = liesLiveKonfig(process.env);
} catch (fehler) {
    console.error(`[Live] Konfiguration unvollständig: ${fehler.message}`);
    process.exit(1);
}

const knex = knexLib({ client: 'pg', connection: konfig.db, pool: { min: 0, max: 2 } });
const uplink = erzeugeUplink({ url: konfig.uplinkUrl, token: konfig.token });
const dienst = starteLiveDienst({
    ladeSnapshots: () => ladeSnapshots(knex, { geheimnis: konfig.geheimnis }),
    uplink,
    intervallMs: konfig.intervallMs
});

console.log(`[Live] gestartet, Intervall ${konfig.intervallMs} ms, Ziel ${new URL(konfig.uplinkUrl).host}`);
dienst.tick();

async function beende() {
    dienst.stoppe();
    await knex.destroy().catch(() => {});
    process.exit(0);
}
process.on('SIGTERM', beende);
process.on('SIGINT', beende);
```

- [ ] **Step 4: Tests grün**

Run: `node --test tests/unit/liveKonfig.test.js tests/unit/liveDienst.test.js`
Expected: PASS (5 + 4 Tests)

- [ ] **Step 5: Commit**

```bash
git add src/live/konfig.js src/live/dienst.js src/live/main.js tests/unit/liveKonfig.test.js tests/unit/liveDienst.test.js
git commit -m "feat: Live-Prozess mit Konfigurationsprüfung und Dienstschleife" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Ende-zu-Ende-Rauchtest des Prozesses gegen ein lokales Ziel

**Files:**
- Test: `tests/unit/liveEndeZuEnde.test.js`

**Interfaces:**
- Consumes: alle Bausteine aus Task 3–7 (echtes eingebettetes PostgreSQL, echte Rolle, lokaler HTTP-Server als „Cloud").

- [ ] **Step 1: Test schreiben**

`tests/unit/liveEndeZuEnde.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import zlib from 'node:zlib';
import knexLib from 'knex';
import { starteTestPostgres } from '../helpers/testPostgres.js';
import { legeLiveRolleAn } from '../../src/live/rolle.js';
import { ladeSnapshots } from '../../src/live/snapshot.js';
import { erzeugeUplink } from '../../src/live/uplink.js';
import { starteLiveDienst } from '../../src/live/dienst.js';

test('Prozesskette: Freigabe → Snapshot an lokales Ziel → Rücknahme bei Widerruf', async () => {
    const db = await starteTestPostgres();
    const { knex, verbindung } = db;
    const empfangen = [];
    const server = http.createServer((req, res) => {
        const teile = [];
        req.on('data', d => teile.push(d));
        req.on('end', () => {
            empfangen.push({ auth: req.headers.authorization, body: JSON.parse(zlib.gunzipSync(Buffer.concat(teile)).toString('utf8')) });
            res.statusCode = 204;
            res.end();
        });
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${server.address().port}/api/live/ingest`;
    let live;
    let dienst;
    try {
        const [{ id: turnierId }] = await knex('turniere').insert({
            bezeichnung: 'Live', ort: 'O', datum: '2026-10-12', ausrichter: 'A', urspruengliche_id: 77, live_freigabe: true
        }).returning('id');
        await legeLiveRolleAn(knex, { passwort: 'pw', datenbank: verbindung.database });
        live = knexLib({ client: 'pg', connection: { ...verbindung, user: 'live_ro', password: 'pw' } });

        const uplink = erzeugeUplink({ url, token: 'tok', log: { warn() {}, log() {} } });
        dienst = starteLiveDienst({
            ladeSnapshots: () => ladeSnapshots(live, { geheimnis: 'g' }),
            uplink, log: { log() {}, warn() {}, error() {} }, setzeTimer: () => 0, loescheTimer: () => {}
        });

        await dienst.tick();
        assert.equal(empfangen.length, 1);
        assert.equal(empfangen[0].auth, 'Bearer tok');
        assert.equal(empfangen[0].body.turnierKey, '77');
        assert.equal(empfangen[0].body.name, 'Live');

        await knex('turniere').where({ id: turnierId }).update({ live_freigabe: false });
        await dienst.tick();
        assert.equal(empfangen.length, 2);
        assert.equal(empfangen[1].body.zurueckgezogen, true);

        await dienst.tick();
        assert.equal(empfangen.length, 2);
    } finally {
        if (dienst) dienst.stoppe();
        if (live) await live.destroy();
        await new Promise(r => server.close(r));
        await db.stoppe();
    }
});
```

- [ ] **Step 2: Test laufen lassen**

Run: `node --test tests/unit/liveEndeZuEnde.test.js`
Expected: PASS (der Code aus Task 3–7 reicht aus; schlägt er fehl, ist das ein Integrationsfehler und vor dem Weiterarbeiten zu beheben)

- [ ] **Step 3: Gesamte Unit-Suite**

Run: `npm run test:unit`
Expected: PASS, keine Regression in vorhandenen Tests

- [ ] **Step 4: Commit**

```bash
git add tests/unit/liveEndeZuEnde.test.js
git commit -m "test: Ende-zu-Ende-Prüfung der Live-Prozesskette gegen ein lokales Ziel" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Freigabe am Turnier (API und Checkbox)

**Files:**
- Modify: `src/controllers/turnierController.js` (neue Exporte `leseLiveFreigabe`, `setzeLiveFreigabe`)
- Modify: `src/routes/turnierRoutes.js` (Import und zwei Routen vor `/:id`)
- Modify: `public/turnier.html` (Checkbox im Kopfbereich), `public/js/turnier.js` (laden und speichern)
- Test: `tests/e2e/live-freigabe.spec.js`

**Interfaces:**
- Produces:
  - `GET /api/turniere/:id/live-freigabe` → `{ freigegeben: boolean, moeglich: boolean }` (`moeglich = urspruengliche_id != null`)
  - `PUT /api/turniere/:id/live-freigabe` mit `{ freigegeben: boolean }` → `{ success: true, freigegeben }`; 400 bei Nicht-Boolean, 404 bei unbekanntem Turnier, 409 mit Klartext, wenn `freigegeben = true` und `urspruengliche_id` fehlt, 403 beim Aktivieren eines abgeschlossenen Turniers.

- [ ] **Step 1: Failing E2E-Test**

`tests/e2e/live-freigabe.spec.js`:

```js
// End-to-End: Live-Freigabe am Turnier (Teilnehmer-App Phase 1, Spec Abschnitt 5/10).
import { test, expect } from '@playwright/test';
import knexLib from 'knex';
import { testDbVerbindung } from './test-env.js';

async function neuesTurnier(request, name) {
    const r = await request.post('/api/turniere', {
        data: { bezeichnung: name, ort: 'Senden', datum: '2026-10-12', ausrichter: 'Test', anzahl_kampfflaechen: 1 }
    });
    expect(r.ok(), await r.text()).toBeTruthy();
    return (await r.json()).turnierId;
}

test('Freigabe: Standard aus, ohne Cloud-Herkunft gesperrt, mit Herkunft schaltbar', async ({ request }) => {
    const id = await neuesTurnier(request, 'Live-Freigabe');

    let r = await request.get(`/api/turniere/${id}/live-freigabe`);
    expect(await r.json()).toEqual({ freigegeben: false, moeglich: false });

    r = await request.put(`/api/turniere/${id}/live-freigabe`, { data: { freigegeben: true } });
    expect(r.status()).toBe(409);
    expect((await r.json()).error).toMatch(/Cloud/);

    r = await request.put(`/api/turniere/${id}/live-freigabe`, { data: { freigegeben: 'ja' } });
    expect(r.status()).toBe(400);

    const db = knexLib({ client: 'pg', connection: testDbVerbindung });
    try {
        await db('turniere').where({ id }).update({ urspruengliche_id: 4711 });
    } finally {
        await db.destroy();
    }

    r = await request.get(`/api/turniere/${id}/live-freigabe`);
    expect(await r.json()).toEqual({ freigegeben: false, moeglich: true });

    r = await request.put(`/api/turniere/${id}/live-freigabe`, { data: { freigegeben: true } });
    expect(r.ok(), await r.text()).toBeTruthy();
    expect((await (await request.get(`/api/turniere/${id}/live-freigabe`)).json()).freigegeben).toBe(true);

    r = await request.put(`/api/turniere/${id}/live-freigabe`, { data: { freigegeben: false } });
    expect(r.ok()).toBeTruthy();
    expect((await (await request.get(`/api/turniere/${id}/live-freigabe`)).json()).freigegeben).toBe(false);
});

test('Freigabe: unbekanntes Turnier ergibt 404', async ({ request }) => {
    const r = await request.put('/api/turniere/999999/live-freigabe', { data: { freigegeben: false } });
    expect(r.status()).toBe(404);
});

test('Export/Import übernimmt die Freigabe nicht', async ({ request }) => {
    const id = await neuesTurnier(request, 'Live-Export');
    const db = knexLib({ client: 'pg', connection: testDbVerbindung });
    try {
        await db('turniere').where({ id }).update({ urspruengliche_id: 5000, live_freigabe: true });
    } finally {
        await db.destroy();
    }
    const export_ = await (await request.get(`/api/turniere/${id}/export`)).json();
    const importiert = await request.post('/api/turniere/import', { data: export_ });
    expect(importiert.ok(), await importiert.text()).toBeTruthy();
    const neueId = (await importiert.json()).turnierId;
    const r = await request.get(`/api/turniere/${neueId}/live-freigabe`);
    expect((await r.json()).freigegeben).toBe(false);
});
```

Hinweis: Das Importformat und die Antwort (`turnierId`) mit `importTurnier` in `turnierController.js` abgleichen; weicht die Antwort ab, den Test an die tatsächliche Antwort anpassen. Ist `startdatum`/Export nur in bestimmten Statuswerten erlaubt, vor dem Export den Status per DB-Update passend setzen.

- [ ] **Step 2: Fehlschlag prüfen**

Run: `npx playwright test tests/e2e/live-freigabe.spec.js`
Expected: FAIL (Route nicht vorhanden → 404 bzw. `live_freigabe` nicht lesbar)

- [ ] **Step 3: Controller**

In `src/controllers/turnierController.js` (am Ende der Datei, im Stil der übrigen Exporte):

```js
// Live-Freigabe (Teilnehmer-App, docs/specs/2026-10-12-teilnehmer-app-design.md): Opt-in des Veranstalters. Ein Turnier
// ohne urspruengliche_id stammt nicht aus der Cloud und ist ihr unbekannt, die Freigabe ist dafür gesperrt.
export async function leseLiveFreigabe(knex, req, res) {
    try {
        const turnier = await knex('turniere').where({ id: req.params.id }).first('live_freigabe', 'urspruengliche_id');
        if (!turnier) return res.status(404).json({ success: false, error: 'Turnier nicht gefunden.' });
        res.json({ freigegeben: !!turnier.live_freigabe, moeglich: turnier.urspruengliche_id != null });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}

export async function setzeLiveFreigabe(knex, req, res) {
    try {
        const { freigegeben } = req.body || {};
        if (typeof freigegeben !== 'boolean') {
            return res.status(400).json({ success: false, error: 'Feld "freigegeben" muss true oder false sein.' });
        }
        const turnier = await knex('turniere').where({ id: req.params.id }).first('id', 'status', 'urspruengliche_id');
        if (!turnier) return res.status(404).json({ success: false, error: 'Turnier nicht gefunden.' });
        if (freigegeben) {
            if (turnier.urspruengliche_id == null) {
                return res.status(409).json({ success: false, error: 'Dieses Turnier stammt nicht aus der Cloud und kann nicht live freigegeben werden.' });
            }
            if (turnier.status === 'abgeschlossen') {
                return res.status(403).json({ success: false, error: 'Ein abgeschlossenes Turnier kann nicht live freigegeben werden.' });
            }
        }
        await knex('turniere').where({ id: turnier.id }).update({ live_freigabe: freigegeben });
        res.json({ success: true, freigegeben });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}
```

- [ ] **Step 4: Routen**

In `src/routes/turnierRoutes.js` den Import um `leseLiveFreigabe, setzeLiveFreigabe` erweitern und **vor** `router.get('/:id', …)` einfügen:

```js
    // Live-Freigabe für die Teilnehmer-App (Hallen-Server, Opt-in des Veranstalters)
    router.get('/:id/live-freigabe', (req, res) => leseLiveFreigabe(knex, req, res));
    router.put('/:id/live-freigabe', requireTournamentEditAccess(knex), requireVereinFreigabe(knex), (req, res) => setzeLiveFreigabe(knex, req, res));
```

- [ ] **Step 5: Test grün**

Run: `npx playwright test tests/e2e/live-freigabe.spec.js`
Expected: PASS (3 Tests). Schlägt „Export/Import übernimmt die Freigabe nicht" fehl, weil `importTurnier` die Spalten aus der Export-Datei durchreicht: dort in `importTurnier` das Feld `live_freigabe` (und `urspruengliche_id` bleibt wie bisher) aus den übernommenen Turnierfeldern entfernen und den Test erneut laufen lassen.

- [ ] **Step 6: Checkbox in der Oberfläche**

In `public/turnier.html` innerhalb von `.turnier-page-header-actions`, nach dem `loeschenBtn`-Button:

```html
            <label class="turnier-header-btn" id="liveFreigabeGroup" style="display: none; align-items: center; gap: 6px; cursor: pointer;" title="Teilnehmer-App: Matte, Position und Push für dieses Turnier aus der Cloud anbieten">
                <input type="checkbox" id="liveFreigabeBox">
                <span class="material-icons">sensors</span>
                Live freigeben
            </label>
```

In `public/js/turnier.js` am Ende der Funktion `pruefeUndZeigeLebenszyklusButtons` direkt nach der `loeschenBtn`-Anzeige (innerhalb des `try`, nach den bestehenden `if`-Blöcken) einfügen:

```js
            const liveGruppe = document.getElementById('liveFreigabeGroup');
            const liveBox = document.getElementById('liveFreigabeBox');
            if (liveGruppe && liveBox && istOffline) {
                const liveResp = await fetch(`/api/turniere/${turnierId}/live-freigabe`);
                if (liveResp.ok) {
                    const live = await liveResp.json();
                    liveBox.checked = !!live.freigegeben;
                    liveBox.disabled = !live.moeglich;
                    liveGruppe.title = live.moeglich
                        ? liveGruppe.title
                        : 'Nicht möglich: Dieses Turnier stammt nicht aus der Cloud.';
                    liveGruppe.style.display = 'inline-flex';
                    liveBox.addEventListener('change', async () => {
                        const antwort = await fetch(`/api/turniere/${turnierId}/live-freigabe`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ freigegeben: liveBox.checked })
                        });
                        const daten = await antwort.json();
                        if (!antwort.ok) {
                            liveBox.checked = !liveBox.checked;
                            if (window.zeigeNotification) window.zeigeNotification(daten.error || 'Speichern fehlgeschlagen.', 'error');
                        } else if (window.zeigeNotification) {
                            window.zeigeNotification(daten.freigegeben ? 'Live-Freigabe aktiviert.' : 'Live-Freigabe beendet.', 'success');
                        }
                    });
                }
            }
```

- [ ] **Step 7: Bestehende Turnier-Spec und neue Spec laufen lassen**

Run: `npx playwright test tests/e2e/turnier-anlegen.spec.js tests/e2e/live-freigabe.spec.js`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/controllers/turnierController.js src/routes/turnierRoutes.js public/turnier.html public/js/turnier.js tests/e2e/live-freigabe.spec.js
git commit -m "feat: Live-Freigabe am Turnier (API und Checkbox)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Betrieb — systemd, Firewall, Installationsskript, Anleitung

**Files:**
- Create: `deploy/linux/systemd/hajime-live.service`, `deploy/linux/live/nftables-live.conf`, `deploy/linux/install-live.sh`, `docs/live-uplink.md`
- Test: `tests/unit/installLive.test.js`

- [ ] **Step 1: Failing test**

`tests/unit/installLive.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const lies = (p) => fs.readFileSync(p, 'utf8');

test('systemd-Unit startet den Live-Prozess ohne Netzwerk-Rechte', () => {
    const unit = lies('deploy/linux/systemd/hajime-live.service');
    assert.match(unit, /ExecStart=\/usr\/bin\/node src\/live\/main\.js/);
    assert.match(unit, /EnvironmentFile=\/opt\/hajime-pro\/live\.env/);
    assert.match(unit, /User=hajime/);
    assert.match(unit, /NoNewPrivileges=true/);
    assert.doesNotMatch(unit, /CAP_NET_BIND_SERVICE/);
});

test('nftables: ausgehend nur Cloud-HTTPS, DNS und NTP; eingehend verworfen', () => {
    const regeln = lies('deploy/linux/live/nftables-live.conf');
    assert.match(regeln, /policy drop/);
    assert.match(regeln, /tcp dport 443/);
    assert.match(regeln, /udp dport 123/);
    assert.match(regeln, /udp dport 53/);
    assert.doesNotMatch(regeln, /tcp dport 22 accept/);
});

test('install-live.sh hat gültige Bash-Syntax', { skip: spawnSync('bash', ['--version']).status !== 0 }, () => {
    const r = spawnSync('bash', ['-n', 'deploy/linux/install-live.sh'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
});

test('Anleitung nennt Tethering, Weiterleitung aus und die Firewall', () => {
    const doku = lies('docs/live-uplink.md');
    for (const text of ['ip_forward', 'nftables', 'USB', 'live.env', 'LIVE_SCHLUESSEL']) {
        assert.match(doku, new RegExp(text));
    }
});
```

- [ ] **Step 2: Fehlschlag prüfen**

Run: `node --test tests/unit/installLive.test.js`
Expected: FAIL (Dateien fehlen)

- [ ] **Step 3: Dateien anlegen**

`deploy/linux/systemd/hajime-live.service`:

```ini
[Unit]
Description=Hajime Pro Live-Uplink (Teilnehmer-App, nur lesend, nur ausgehend)
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
Type=simple
User=hajime
WorkingDirectory=/opt/hajime-pro
EnvironmentFile=/opt/hajime-pro/live.env
ExecStart=/usr/bin/node src/live/main.js
Restart=always
RestartSec=5
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

`deploy/linux/live/nftables-live.conf` (Platzhalter `CLOUD_IP`/`USB_IF` werden vom Installationsskript ersetzt):

```
#!/usr/sbin/nft -f
# Live-Uplink: Internet nur über die USB-/Starlink-Schnittstelle, nur ausgehend zum Cloud-Host.
# Platzhalter: @USB_IF@ (z. B. usb0/enx...), @CLOUD_IP@ (IPv4 des Cloud-Servers), @DNS_IP@ (DNS-Server).
table inet hajime_live {
    chain eingehend {
        type filter hook input priority 0; policy accept;
        iifname "@USB_IF@" ct state established,related accept
        iifname "@USB_IF@" drop
    }
    chain weiterleiten {
        type filter hook forward priority 0; policy drop;
    }
    chain ausgehend {
        type filter hook output priority 0; policy accept;
        oifname "@USB_IF@" ip daddr @CLOUD_IP@ tcp dport 443 accept
        oifname "@USB_IF@" ip daddr @DNS_IP@ udp dport 53 accept
        oifname "@USB_IF@" ip daddr @DNS_IP@ tcp dport 53 accept
        oifname "@USB_IF@" udp dport 123 accept
        oifname "@USB_IF@" ct state established,related accept
        oifname "@USB_IF@" drop
    }
}
```

`deploy/linux/install-live.sh`:

```bash
#!/usr/bin/env bash
# Installiert den Live-Uplink auf dem Slave (Teilnehmer-App Phase 1). Als root ausführen.
#   sudo bash deploy/linux/install-live.sh --cloud-url https://... --cloud-ip 1.2.3.4 --usb-if usb0 [--dns-ip 192.168.178.1]
# Voraussetzung: Hajime Pro liegt unter /opt/hajime-pro, die Migration (Schema "live") ist am Master gelaufen.
set -euo pipefail

CLOUD_URL=""; CLOUD_IP=""; USB_IF=""; DNS_IP="192.168.178.1"
while [ $# -gt 0 ]; do
    case "$1" in
        --cloud-url) CLOUD_URL="$2"; shift 2 ;;
        --cloud-ip)  CLOUD_IP="$2";  shift 2 ;;
        --usb-if)    USB_IF="$2";    shift 2 ;;
        --dns-ip)    DNS_IP="$2";    shift 2 ;;
        *) echo "Unbekannte Option: $1" >&2; exit 2 ;;
    esac
done
[ -n "$CLOUD_URL" ] && [ -n "$CLOUD_IP" ] && [ -n "$USB_IF" ] || { echo "Pflicht: --cloud-url --cloud-ip --usb-if" >&2; exit 2; }
[ "$(id -u)" -eq 0 ] || { echo "Bitte als root ausführen." >&2; exit 1; }

BASIS=/opt/hajime-pro
ENV_DATEI="$BASIS/live.env"

if [ ! -f "$ENV_DATEI" ]; then
    DB_PASSWORT="$(openssl rand -hex 16)"
    SCHLUESSEL="$(openssl rand -hex 32)"
    TOKEN="$(openssl rand -hex 32)"
    umask 077
    cat > "$ENV_DATEI" <<EOF
LIVE_DB_HOST=127.0.0.1
LIVE_DB_PORT=5432
LIVE_DB_NAME=hajime
LIVE_DB_USER=live_ro
LIVE_DB_PASSWORD=$DB_PASSWORT
LIVE_UPLINK_URL=$CLOUD_URL
LIVE_UPLINK_TOKEN=$TOKEN
LIVE_SCHLUESSEL=$SCHLUESSEL
LIVE_INTERVALL_MS=5000
EOF
    chown hajime:hajime "$ENV_DATEI"
    echo "live.env angelegt. LIVE_UPLINK_TOKEN in der Cloud hinterlegen: $TOKEN"
fi

# Die Rolle live_ro entsteht NICHT hier: der Standby ist schreibgeschützt. Sie wird am Master angelegt und
# repliziert zum Slave (Rollen und ihre Einstellungen liegen in den replizierten Systemkatalogen).
. "$ENV_DATEI"
echo "Am MASTER ausführen (mit Administrator-Zugang, z. B. postgres):"
echo "  cd $BASIS && DB_ADMIN_USER=postgres DB_ADMIN_PASSWORD=... LIVE_DB_PASSWORD='$LIVE_DB_PASSWORD' npm run live:rolle"

# Keine Weiterleitung zwischen den Netzen.
echo "net.ipv4.ip_forward=0" > /etc/sysctl.d/90-hajime-live.conf
sysctl -p /etc/sysctl.d/90-hajime-live.conf

# Firewall nur für die Internet-Schnittstelle.
install -d /etc/nftables.d
sed -e "s|@USB_IF@|$USB_IF|g" -e "s|@CLOUD_IP@|$CLOUD_IP|g" -e "s|@DNS_IP@|$DNS_IP|g" \
    "$BASIS/deploy/linux/live/nftables-live.conf" > /etc/nftables.d/hajime-live.conf
nft -f /etc/nftables.d/hajime-live.conf

install -m 0644 "$BASIS/deploy/linux/systemd/hajime-live.service" /etc/systemd/system/hajime-live.service
systemctl daemon-reload
systemctl enable --now hajime-live.service
echo "Live-Uplink läuft: journalctl -u hajime-live -f"
```

`docs/live-uplink.md`:

```markdown
# Live-Uplink für die Teilnehmer-App (Slave)

Der Live-Prozess läuft **nur auf dem Slave** (Secondary). Er liest den PostgreSQL-Standby mit der Rolle `live_ro`
(nur Views im Schema `live`) und sendet freigegebene Turniere **ausgehend** per HTTPS an die Cloud. Es gibt keinen Rückkanal.

## Netz
- Internet per **USB-Tethering** (Android) oder Starlink direkt am Slave; die Fritz!Box hat keinen Internetzugang.
- `net.ipv4.ip_forward=0`, damit der Slave nie als Router dient (setzt `install-live.sh`).
- **nftables:** auf der Internet-Schnittstelle ausgehend nur HTTPS zum Cloud-Host, DNS und NTP; eingehend alles verworfen
  (`deploy/linux/live/nftables-live.conf`).
- Automatische OS-Updates laufen über diese Schnittstelle nicht; Updates im Hallennetz oder in einem Wartungsfenster einspielen.

## Installation
1. Die Migration läuft mit dem normalen App-Start am Master und repliziert zum Slave (Schema `live`).
2. Am Slave: `sudo bash deploy/linux/install-live.sh --cloud-url https://<cloud>/api/live/ingest --cloud-ip <IP> --usb-if <Schnittstelle>`.
   Das Skript legt `live.env` an und gibt den Befehl für Schritt 3 aus.
3. **Am Master** die Rolle anlegen (der Standby ist schreibgeschützt; die Rolle repliziert zum Slave):
   `DB_ADMIN_USER=postgres DB_ADMIN_PASSWORD=... LIVE_DB_PASSWORD=<aus live.env> npm run live:rolle`.
4. Den ausgegebenen `LIVE_UPLINK_TOKEN` in der Cloud hinterlegen.
5. Im Turnier die Checkbox „Live freigeben" setzen (nur Turniere aus der Cloud).

## Konfiguration (`/opt/hajime-pro/live.env`)
| Variable | Bedeutung |
|---|---|
| `LIVE_DB_HOST/PORT/NAME/USER/PASSWORD` | Verbindung zur Datenbank mit der Rolle `live_ro` |
| `LIVE_UPLINK_URL` | Ingest-Endpunkt der Cloud (https) |
| `LIVE_UPLINK_TOKEN` | Token, in der Cloud sperrbar |
| `LIVE_SCHLUESSEL` | Geheimnis für die Teilnehmerschlüssel (nicht ändern, sonst ändern sich alle Schlüssel) |
| `LIVE_INTERVALL_MS` | Abfrageintervall, Standard 5000, mindestens 1000 |

## Betrieb
- Status: `systemctl status hajime-live`, Log: `journalctl -u hajime-live -f`.
- Fällt der Slave aus, läuft das Turnier weiter; die Live-Anzeige friert ein und zeigt den Stand von zuletzt.
- Wird der Slave zum Master, liest der Prozess den Primary mit derselben Rolle weiter.
```

- [ ] **Step 4: Test grün**

Run: `node --test tests/unit/installLive.test.js`
Expected: PASS (4 Tests, der Syntaxtest wird ohne `bash` übersprungen)

- [ ] **Step 5: Gesamtprüfung**

Run: `npm run test:unit`
Expected: PASS

Run: `npx playwright test tests/e2e/live-freigabe.spec.js tests/e2e/turnier-anlegen.spec.js`
Expected: PASS

- [ ] **Step 6: CLAUDE.md ergänzen**

In `CLAUDE.md` unter „Zentrale Architekturkonzepte" einen Eintrag **Live-Uplink (`src/live/`)** ergänzen (zwei bis vier Sätze): Zweck, Rolle `live_ro`/Views, Uplink nur ausgehend, `LIVE_*`-Variablen, Verweis auf `docs/specs/2026-10-12-teilnehmer-app-design.md` und `docs/live-uplink.md`, Tests `tests/unit/live*.test.js`, `tests/e2e/live-freigabe.spec.js`.

- [ ] **Step 7: Commit**

```bash
git add deploy/linux/systemd/hajime-live.service deploy/linux/live/nftables-live.conf deploy/linux/install-live.sh docs/live-uplink.md tests/unit/installLive.test.js CLAUDE.md
git commit -m "feat: Betrieb des Live-Uplinks (systemd, nftables, Installationsskript, Anleitung)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Self-Review (Abdeckung der Spec, Phase 1)

| Spec | Task |
|---|---|
| 4 Kachel, Abstand, Zustände, Platz | 1 |
| 5.1 Views, Rolle, Intervall, kurze Abfragen | 3, 4, 5, 7 |
| 5.2 Snapshot, stabile Schlüssel, Vereine, nur freigegebene Turniere mit `urspruengliche_id` | 2, 5 |
| 5.3 Uplink: HTTPS, Token, gzip, nur Statuscode, Backoff, Lebenszeichen, Rücknahme | 6, 7, 8 |
| 5.4 Netzwerk (Tethering, `ip_forward`, nftables) | 10 |
| 10 Opt-in `live_freigabe`, minimale Felder | 3, 9 |
| 13 Phase 1: Freigabeschalter am Turnier | 9 |

Bewusst nicht in Phase 1 (laut Spec Phase 2+): Cloud-Ingest und -Lesemodell, App, Push, Livestream. Für die Tests dient ein lokaler HTTP-Server als Ziel (Task 8).

**Offene Annahmen, die beim Ausführen zu prüfen sind:** Pflichtspalten von `turnier_teilnehmer`/`pools` in den Testinserts (Task 3, 5), Antwortformat von `importTurnier` (Task 9), PostgreSQL-Fehlertext für Schreibversuche auf Views (Task 4), Name der Konfig-Datei und Pfade des Servers `/opt/hajime-pro` (Task 10).
