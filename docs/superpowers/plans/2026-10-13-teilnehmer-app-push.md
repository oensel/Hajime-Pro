# Teilnehmer-App Phase 3: Push-Nachrichten — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Geräte mit gesetzter Glocke bekommen eine Web-Push-Nachricht 3 Kämpfe vor dem Pool-Start und 3 Kämpfe vor dem Kampf eines Gefolgten (Android, Desktop, iPhone ab iOS 16.4 mit Home-Bildschirm-App).

**Architecture:** Die Cloud speichert je Gerät Push-Anmeldung und Glockenliste (Tabellen `live_push_*`, 3 Tage nach dem Turnier-Datum gelöscht). Nach jedem übernommenen Snapshot wertet `pruefeUndSende` alle Anmeldungen des Turniers aus (Pool-Beginn über `poolStarts`, Kampfabstand aus `live_teilnehmer`), trägt neue Treffer in `live_push_gesendet` ein (genau einmal) und sendet über `web-push`. Die PWA meldet das Gerät per `push.js` an und zeigt die Nachricht im Service Worker.

**Tech Stack:** Node/Express/Knex (PostgreSQL), `web-push` (VAPID), Service Worker + Push API, `node:test`, Playwright.

**Spec:** `docs/specs/2026-10-13-teilnehmer-app-push-design.md`

## Global Constraints

- Schwelle: `PUSH_SCHWELLE = 3` (Pool-Start `poolStartetIn ≤ 3`, Kampf `abstand ≤ 3`, `als_naechstes` = 0; läuft der Kampf, keine Nachricht).
- Aufbewahrung: `LIVE_PUSH_AUFBEWAHRUNG_TAGE`, Standard 3, ab Turnier-Datum.
- Endpunkte nur `https:` von bekannten Push-Diensten (`fcm.googleapis.com`, `*.push.services.mozilla.com`, `*.notify.windows.com`, `web.push.apple.com`, `*.push.apple.com`), höchstens 500 Zeichen.
- Listen: höchstens 200 Schlüssel je Liste (`teilnehmer`, `vereine`, `ausnahmen`), Schlüssel `^[A-Za-z0-9_-]{1,64}$`; höchstens 5000 Anmeldungen je Turnier.
- Ohne `LIVE_PUSH_VAPID_PUBLIC`/`LIVE_PUSH_VAPID_PRIVATE`/`LIVE_PUSH_BETREFF` ist Push aus (503), alles andere bleibt unverändert.
- Deutsch in Texten, Kommentaren und Commits; Commit-Trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Der Ingest antwortet weiterhin nur mit Statuscodes; ein Push-Fehler darf ihn nie scheitern lassen.
- `.claude/launch.json` nie committen.

## Review Focus

- Doppelte Nachrichten bei zwei gleichzeitigen Ingests (Advisory-Lock, Unique-Constraint).
- Anmeldung mit bereits erfüllter Bedingung darf nicht sofort senden.
- Ein später gemeldetes Vereinsmitglied (Glocke für alle) wird erfasst; ein abgewähltes nicht.
- Die Endpunkt-Prüfung darf keine fremden Hosts, keine `http:`-URLs und keine Zeichenketten wie `https://fcm.googleapis.com.evil.com` durchlassen.
- Rücknahme eines Turniers und Ablauf löschen alle zugehörigen Anmeldungen.

---

### Task 1: Abhängigkeit, Konfiguration, Endpunkt-Prüfung, Migration

**Files:**
- Modify: `package.json` (Abhängigkeit `web-push`)
- Create: `src/liveCloud/pushKonfig.js`
- Create: `migrations/20261013120000_live_push.js`
- Test: `tests/unit/liveCloudPushKonfig.test.js`

**Interfaces:**
- Produces: `liesPushKonfig(env) → { aktiv, publicKey, privateKey, betreff, tage, maxAbos }`, `istErlaubterEndpunkt(url) → boolean`, `PUSH_SCHWELLE`.

- [ ] **Step 1: Test schreiben**

```js
// tests/unit/liveCloudPushKonfig.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { liesPushKonfig, istErlaubterEndpunkt, PUSH_SCHWELLE } from '../../src/liveCloud/pushKonfig.js';

test('Push-Konfiguration: aktiv nur mit Schlüsselpaar und Betreff, Standard 3 Tage', () => {
    assert.equal(liesPushKonfig({}).aktiv, false);
    const k = liesPushKonfig({ LIVE_PUSH_VAPID_PUBLIC: 'pub', LIVE_PUSH_VAPID_PRIVATE: 'priv', LIVE_PUSH_BETREFF: 'mailto:a@b.de' });
    assert.equal(k.aktiv, true);
    assert.equal(k.tage, 3);
    assert.equal(k.maxAbos, 5000);
    assert.equal(liesPushKonfig({ LIVE_PUSH_VAPID_PUBLIC: 'pub', LIVE_PUSH_VAPID_PRIVATE: 'priv', LIVE_PUSH_BETREFF: 'mailto:a@b.de', LIVE_PUSH_AUFBEWAHRUNG_TAGE: '5' }).tage, 5);
    assert.equal(PUSH_SCHWELLE, 3);
});

test('Endpunkt-Prüfung: nur https und bekannte Push-Dienste', () => {
    for (const ok of [
        'https://fcm.googleapis.com/fcm/send/abc', 'https://updates.push.services.mozilla.com/wpush/v2/abc',
        'https://wns2-par02p.notify.windows.com/w/?token=x', 'https://web.push.apple.com/QGx', 'https://api.push.apple.com/3/device/x'
    ]) assert.equal(istErlaubterEndpunkt(ok), true, ok);
    for (const nein of [
        'http://fcm.googleapis.com/x', 'https://fcm.googleapis.com.evil.com/x', 'https://evil.com/fcm.googleapis.com',
        'https://localhost/x', 'https://127.0.0.1/x', 'ftp://web.push.apple.com/x', '', null, 42, `https://fcm.googleapis.com/${'a'.repeat(500)}`
    ]) assert.equal(istErlaubterEndpunkt(nein), false, String(nein));
});
```

- [ ] **Step 2: Test laufen lassen, muss scheitern**

Run: `node --test tests/unit/liveCloudPushKonfig.test.js`
Expected: FAIL, `Cannot find module` (pushKonfig.js fehlt)

- [ ] **Step 3: Abhängigkeit, Modul und Migration anlegen**

Run: `npm install web-push@^3.6.7`

```js
// src/liveCloud/pushKonfig.js
// Konfiguration und Eingabeprüfung der Push-Nachrichten (Spec Phase 3). Ohne VAPID-Schlüsselpaar ist Push aus.
export const PUSH_SCHWELLE = 3;
const MAX_ENDPUNKT = 500;
const ERLAUBTE_HOSTS = [
    /^fcm\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)notify\.windows\.com$/,
    /^web\.push\.apple\.com$/, /(^|\.)push\.apple\.com$/
];

export function liesPushKonfig(env = process.env) {
    const publicKey = String(env.LIVE_PUSH_VAPID_PUBLIC || '');
    const privateKey = String(env.LIVE_PUSH_VAPID_PRIVATE || '');
    const betreff = String(env.LIVE_PUSH_BETREFF || '');
    return {
        aktiv: !!(publicKey && privateKey && betreff),
        publicKey, privateKey, betreff,
        tage: Number(env.LIVE_PUSH_AUFBEWAHRUNG_TAGE) || 3,
        maxAbos: Number(env.LIVE_PUSH_MAX_ABOS) || 5000
    };
}

export function istErlaubterEndpunkt(url) {
    if (typeof url !== 'string' || url.length === 0 || url.length > MAX_ENDPUNKT) return false;
    let u;
    try { u = new URL(url); } catch { return false; }
    if (u.protocol !== 'https:' || u.username || u.password) return false;
    return ERLAUBTE_HOSTS.some(muster => muster.test(u.hostname));
}
```

```js
// migrations/20261013120000_live_push.js
// Teilnehmer-App Phase 3: Push-Anmeldungen je Gerät und Turnier, Glockenliste, bereits gesendete Nachrichten.
export async function up(knex) {
    await knex.schema.createTable('live_push_abos', (t) => {
        t.increments('id');
        t.text('turnier_key').notNullable().references('turnier_key').inTable('live_turniere').onDelete('CASCADE');
        t.text('endpoint').notNullable();
        t.text('p256dh').notNullable();
        t.text('auth').notNullable();
        t.timestamp('erstellt_am', { useTz: true }).notNullable().defaultTo(knex.fn.now());
        t.timestamp('aktualisiert_am', { useTz: true }).notNullable().defaultTo(knex.fn.now());
        t.timestamp('laeuft_ab_am', { useTz: true }).notNullable();
        t.unique(['turnier_key', 'endpoint']);
        t.index(['laeuft_ab_am']);
    });
    await knex.schema.createTable('live_push_glocken', (t) => {
        t.integer('abo_id').notNullable().references('id').inTable('live_push_abos').onDelete('CASCADE');
        t.text('art').notNullable();
        t.text('schluessel').notNullable();
        t.primary(['abo_id', 'art', 'schluessel']);
    });
    await knex.schema.createTable('live_push_gesendet', (t) => {
        t.integer('abo_id').notNullable().references('id').inTable('live_push_abos').onDelete('CASCADE');
        t.text('teilnehmer_key').notNullable();
        t.text('art').notNullable();
        t.integer('bezug_id').notNullable();
        t.timestamp('gesendet_am', { useTz: true }).notNullable().defaultTo(knex.fn.now());
        t.primary(['abo_id', 'teilnehmer_key', 'art', 'bezug_id']);
    });
}

export async function down(knex) {
    await knex.schema.dropTableIfExists('live_push_gesendet');
    await knex.schema.dropTableIfExists('live_push_glocken');
    await knex.schema.dropTableIfExists('live_push_abos');
}
```

- [ ] **Step 4: Test laufen lassen, muss bestehen**

Run: `node --test tests/unit/liveCloudPushKonfig.test.js`
Expected: PASS (2 Tests)

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/liveCloud/pushKonfig.js migrations/20261013120000_live_push.js tests/unit/liveCloudPushKonfig.test.js
git commit -m "feat: Push-Konfiguration, Endpunkt-Prüfung und Tabellen der Teilnehmer-App"
```

---

### Task 2: Nachrichtentexte

**Files:**
- Create: `src/liveCloud/pushText.js`
- Test: `tests/unit/liveCloudPushText.test.js`

**Interfaces:**
- Produces: `baueNachricht({ turnierKey, turnierName, name, poolBezeichnung, matte, pool, kampf }) → { titel, text, url, tag }`; `pool`/`kampf` sind `null` oder `{ abstand }`.

- [ ] **Step 1: Test schreiben**

```js
// tests/unit/liveCloudPushText.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { baueNachricht } from '../../src/liveCloud/pushText.js';

const basis = { turnierKey: 'demo-2026', turnierName: 'Demo-Turnier', name: 'Mia Mustermann', poolBezeichnung: 'U15 w -44', matte: 'Matte 2' };

test('Nachricht: Pool-Start, Kampf und beides zusammen', () => {
    const pool = baueNachricht({ ...basis, pool: { abstand: 3 }, kampf: null });
    assert.equal(pool.titel, 'Hajime Live · Demo-Turnier');
    assert.equal(pool.text, 'Mia Mustermann: Pool U15 w -44 startet in 3 Kämpfen (Matte 2)');
    assert.equal(baueNachricht({ ...basis, pool: { abstand: 0 }, kampf: null }).text, 'Mia Mustermann: Pool U15 w -44 startet als Nächstes (Matte 2)');
    assert.equal(baueNachricht({ ...basis, pool: { abstand: 1 }, kampf: null }).text, 'Mia Mustermann: Pool U15 w -44 startet in 1 Kampf (Matte 2)');
    assert.equal(baueNachricht({ ...basis, pool: null, kampf: { abstand: 3 } }).text, 'Mia Mustermann: Kampf in 3 Kämpfen (Matte 2)');
    assert.equal(baueNachricht({ ...basis, pool: null, kampf: { abstand: 0 } }).text, 'Mia Mustermann: Kampf als Nächstes (Matte 2)');
    const beides = baueNachricht({ ...basis, pool: { abstand: 3 }, kampf: { abstand: 3 } });
    assert.equal(beides.text, 'Mia Mustermann: Pool U15 w -44 startet in 3 Kämpfen, Kampf in 3 Kämpfen (Matte 2)');
});

test('Nachricht: Ziel-URL, Tag und fehlende Matte', () => {
    const n = baueNachricht({ ...basis, matte: '', pool: null, kampf: { abstand: 2 } });
    assert.equal(n.url, '/live/#/t/demo-2026/uebersicht');
    assert.equal(n.tag, 'hajime-demo-2026');
    assert.equal(n.text, 'Mia Mustermann: Kampf in 2 Kämpfen');
});
```

- [ ] **Step 2: Test laufen lassen, muss scheitern**

Run: `node --test tests/unit/liveCloudPushText.test.js`
Expected: FAIL, Modul fehlt

- [ ] **Step 3: Implementierung**

```js
// src/liveCloud/pushText.js
// Wortlaut der Push-Nachrichten (Spec Phase 3, Entscheidung 7). Rein, ohne Datenbank.
const inKaempfen = (abstand) => {
    if (abstand === 0) return 'als Nächstes';
    return abstand === 1 ? 'in 1 Kampf' : `in ${abstand} Kämpfen`;
};

export function baueNachricht({ turnierKey, turnierName, name, poolBezeichnung, matte, pool, kampf }) {
    const teile = [];
    if (pool) teile.push(`Pool ${poolBezeichnung} startet ${inKaempfen(pool.abstand)}`);
    if (kampf) teile.push(`Kampf ${inKaempfen(kampf.abstand)}`);
    const text = `${name}: ${teile.join(', ')}${matte ? ` (${matte})` : ''}`;
    return {
        titel: `Hajime Live · ${turnierName}`,
        text,
        url: `/live/#/t/${encodeURIComponent(turnierKey)}/uebersicht`,
        tag: `hajime-${turnierKey}`
    };
}
```

- [ ] **Step 4: Test laufen lassen, muss bestehen**

Run: `node --test tests/unit/liveCloudPushText.test.js`
Expected: PASS (2 Tests)

- [ ] **Step 5: Commit**

```bash
git add src/liveCloud/pushText.js tests/unit/liveCloudPushText.test.js
git commit -m "feat: Wortlaut der Push-Nachrichten"
```

---

### Task 3: Auswertung und Anmeldung (Datenhaltung)

**Files:**
- Modify: `src/liveCloud/abfrage.js` (`poolStarts` exportieren)
- Create: `src/liveCloud/push.js`
- Test: `tests/unit/liveCloudPush.test.js`

**Interfaces:**
- Consumes: `poolStarts(knex, turnierKey) → Map<poolId, {begonnen, startetIn}>` (Task: Export), `PUSH_SCHWELLE`, `istErlaubterEndpunkt`.
- Produces:
  - `meldeAn(knex, turnierKey, { abo, glocken }, { konfig, jetzt }) → { status: 'ok'|'geloescht'|'unbekannt' }` (ersetzt vollständig, leere Liste löscht, vermerkt erfüllte Bedingungen als gesendet; wirft `Error` mit `code: 'UNGUELTIG'|'ZU_VIELE'`)
  - `meldeAb(knex, turnierKey, endpoint) → boolean`
  - `pruefeUndSende(knex, turnierKey, { sender, konfig, jetzt, log }) → { gesendet }`
  - `loescheAbgelaufeneAbos(knex, { jetzt }) → Anzahl`

- [ ] **Step 1: Tests schreiben**

```js
// tests/unit/liveCloudPush.test.js
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { starteTestPostgres } from '../helpers/testPostgres.js';
import { uebernimmPaket } from '../../src/liveCloud/ingest.js';
import { meldeAn, meldeAb, pruefeUndSende, loescheAbgelaufeneAbos } from '../../src/liveCloud/push.js';
import { liesPushKonfig } from '../../src/liveCloud/pushKonfig.js';

const konfig = liesPushKonfig({ LIVE_PUSH_VAPID_PUBLIC: 'p', LIVE_PUSH_VAPID_PRIVATE: 'q', LIVE_PUSH_BETREFF: 'mailto:a@b.de' });
const ENDPUNKT = 'https://fcm.googleapis.com/fcm/send/geraet-1';
const abo = (endpoint = ENDPUNKT) => ({ endpoint, keys: { p256dh: 'pk', auth: 'ak' } });
const glocken = (extra = {}) => ({ teilnehmer: [], vereine: [], ausnahmen: [], ...extra });
const t = (key, vorname, extra = {}) => ({
    key, vorname, nachname: 'Test', vereinKey: 'v1', verein: 'JC Muster', altersklasse: 'U15', gewichtsklasse: '-44', geschlecht: 'w',
    poolId: 10, poolBezeichnung: 'U15 w -44', matteId: 1, matteBezeichnung: 'Matte 1', zustand: 'wartet_auf_gegner', abstand: null,
    naechsterKampfId: null, platz: null, ...extra
});
let sequenz = 1000;
const paket = (teilnehmer, kaempfe, pools, extra = {}) => ({
    version: 1, turnierKey: 'P', name: 'Push-Turnier', datum: '2026-10-13', stand: '2026-10-13T10:00:00.000Z', sequenz: sequenz++,
    vereine: [{ key: 'v1', name: 'JC Muster' }], matten: [{ id: 1, bezeichnung: 'Matte 1' }],
    teilnehmer, warteschlangen: [], pools, kaempfe, ...extra
});
const pool = (id, extra = {}) => ({ id, bezeichnung: `Pool ${id}`, modus: 'Jeder-gegen-Jeden', status: 'matte_zugewiesen', matteId: 1, altersklasse: 'U15', geschlecht: 'w', gewichtsklasse: '-44', farbe2: 'blau', ...extra });
const kampf = (id, poolId, extra = {}) => ({ id, poolId, nr: `R${id}`, status: 'bereit', reihenfolge: id, k1: null, k2: null, sieger: null, p1: 0, p2: 0, ...extra });

let db;
const jetzt = () => new Date('2026-10-13T12:00:00Z');
const gesendet = [];
const sender = async (aboDaten, nachricht) => { gesendet.push({ endpoint: aboDaten.endpoint, ...nachricht }); };

before(async () => { db = await starteTestPostgres(); });
after(async () => { if (db) await db.stoppe(); });
beforeEach(async () => {
    gesendet.length = 0;
    await db.knex('live_turniere').del();
});

// Warteschlange der Matte 1: Kämpfe 1..6; Pool 10 hat 1 und 2 (Teilnehmer a, b), Pool 11 hat 3..6 (c, d).
async function aufbau(zustaende = {}) {
    const teilnehmer = [
        t('a', 'Anna', { zustand: 'als_naechstes', naechsterKampfId: 1, ...zustaende.a }),
        t('b', 'Bea', { zustand: 'in_n', abstand: 1, naechsterKampfId: 2, ...zustaende.b }),
        t('c', 'Clara', { poolId: 11, poolBezeichnung: 'Pool 11', zustand: 'in_n', abstand: 5, naechsterKampfId: 5, ...zustaende.c }),
        t('d', 'Dora', { poolId: 11, poolBezeichnung: 'Pool 11', zustand: 'in_n', abstand: 4, naechsterKampfId: 4, vereinKey: 'v2', verein: 'TV Test', ...zustaende.d })
    ];
    const kaempfe = [1, 2, 3, 4, 5, 6].map(id => kampf(id, id <= 2 ? 10 : 11));
    await uebernimmPaket(db.knex, paket(teilnehmer, kaempfe, [pool(10), pool(11)], { vereine: [{ key: 'v1', name: 'JC Muster' }, { key: 'v2', name: 'TV Test' }] }));
}

test('Anmeldung: leere Glockenliste löscht, ungültiger Endpunkt wird abgelehnt', async () => {
    await aufbau();
    await assert.rejects(meldeAn(db.knex, 'P', { abo: abo('https://evil.example/x'), glocken: glocken({ teilnehmer: ['a'] }) }, { konfig, jetzt }), { code: 'UNGUELTIG' });
    assert.deepEqual(await meldeAn(db.knex, 'P', { abo: abo(), glocken: glocken({ teilnehmer: ['a'] }) }, { konfig, jetzt }), { status: 'ok' });
    assert.equal((await db.knex('live_push_abos')).length, 1);
    assert.deepEqual(await meldeAn(db.knex, 'P', { abo: abo(), glocken: glocken() }, { konfig, jetzt }), { status: 'geloescht' });
    assert.equal((await db.knex('live_push_abos')).length, 0);
    assert.deepEqual(await meldeAn(db.knex, 'gibtsnicht', { abo: abo(), glocken: glocken({ teilnehmer: ['a'] }) }, { konfig, jetzt }), { status: 'unbekannt' });
});

test('Anmeldung: bereits erfüllte Bedingungen lösen nichts aus, spätere schon', async () => {
    await aufbau();
    await meldeAn(db.knex, 'P', { abo: abo(), glocken: glocken({ teilnehmer: ['a', 'b'] }) }, { konfig, jetzt });
    assert.deepEqual(await pruefeUndSende(db.knex, 'P', { sender, konfig, jetzt }), { gesendet: 0 });
    // Kampf 2 rückt vor? Nein: Pool 10 läuft los, Kampf 1 beendet, Bea ist als Nächstes (neuer Bezug: Kampf 2 war schon vermerkt).
    // Neuer Kampf 7 für Anna in Pool 10: abstand 2 → neuer Bezug → Nachricht.
    const teilnehmer = [
        t('a', 'Anna', { zustand: 'in_n', abstand: 2, naechsterKampfId: 7 }), t('b', 'Bea', { zustand: 'in_n', abstand: 1, naechsterKampfId: 2 }),
        t('c', 'Clara', { poolId: 11, zustand: 'in_n', abstand: 5, naechsterKampfId: 5 }), t('d', 'Dora', { poolId: 11, zustand: 'in_n', abstand: 4, naechsterKampfId: 4 })
    ];
    const kaempfe = [1, 2, 3, 4, 5, 6, 7].map(id => kampf(id, id <= 2 || id === 7 ? 10 : 11, id === 1 ? { status: 'beendet' } : {}));
    await uebernimmPaket(db.knex, paket(teilnehmer, kaempfe, [pool(10), pool(11)]));
    const r = await pruefeUndSende(db.knex, 'P', { sender, konfig, jetzt });
    assert.equal(r.gesendet, 1);
    assert.match(gesendet[0].text, /^Anna Test: Kampf in 2 Kämpfen \(Matte 1\)$/);
    // dieselbe Lage nochmals: nichts mehr
    assert.deepEqual(await pruefeUndSende(db.knex, 'P', { sender, konfig, jetzt }), { gesendet: 0 });
});

test('Pool-Start und Kampf zusammen ergeben eine Nachricht; Schwelle 4 löst nicht aus', async () => {
    // Pool 11 ist noch nicht begonnen: erster offener Kampf 3 steht an Position 2 der Matte. Clara kämpft in 5 (außerhalb), Dora in 4.
    await aufbau();
    await meldeAn(db.knex, 'P', { abo: abo(), glocken: glocken({ teilnehmer: ['c'] }) }, { konfig, jetzt });
    // Kampf 1 und 2 (Pool 10) werden beendet → Pool 11 rückt an die Spitze, Clara in 3.
    const teilnehmer = [
        t('a', 'Anna', { zustand: 'keine_weiteren' }), t('b', 'Bea', { zustand: 'keine_weiteren' }),
        t('c', 'Clara', { poolId: 11, zustand: 'in_n', abstand: 3, naechsterKampfId: 5 }), t('d', 'Dora', { poolId: 11, zustand: 'in_n', abstand: 4, naechsterKampfId: 4 })
    ];
    const kaempfe = [1, 2, 3, 4, 5, 6].map(id => kampf(id, id <= 2 ? 10 : 11, id <= 2 ? { status: 'beendet' } : {}));
    await uebernimmPaket(db.knex, paket(teilnehmer, kaempfe, [pool(10), pool(11)]));
    const r = await pruefeUndSende(db.knex, 'P', { sender, konfig, jetzt });
    assert.equal(r.gesendet, 1);
    assert.equal(gesendet[0].text, 'Clara Test: Pool Pool 11 startet als Nächstes, Kampf in 3 Kämpfen (Matte 1)');
});

test('Glocke für alle: später gemeldete Vereinsmitglieder zählen, Ausnahmen nicht', async () => {
    await aufbau();
    await meldeAn(db.knex, 'P', { abo: abo(), glocken: glocken({ vereine: ['v1'], ausnahmen: ['b'] }) }, { konfig, jetzt });
    // neues Mitglied e (v1) mit Kampf in 1; b (Ausnahme) hat einen neuen Kampf in 1
    const teilnehmer = [
        t('a', 'Anna', { zustand: 'als_naechstes', naechsterKampfId: 1 }), t('b', 'Bea', { zustand: 'in_n', abstand: 1, naechsterKampfId: 8 }),
        t('c', 'Clara', { poolId: 11, zustand: 'in_n', abstand: 5, naechsterKampfId: 5 }),
        t('e', 'Eva', { zustand: 'in_n', abstand: 1, naechsterKampfId: 9 })
    ];
    const kaempfe = [1, 2, 3, 4, 5, 6, 8, 9].map(id => kampf(id, id <= 2 || id >= 8 ? 10 : 11));
    await uebernimmPaket(db.knex, paket(teilnehmer, kaempfe, [pool(10), pool(11)]));
    await pruefeUndSende(db.knex, 'P', { sender, konfig, jetzt });
    const namen = gesendet.map(g => g.text.split(':')[0]).sort();
    assert.deepEqual(namen, ['Eva Test']);
});

test('Push-Dienst meldet 410: Anmeldung wird gelöscht; andere Fehler brechen nichts ab', async () => {
    await aufbau({ a: { zustand: 'in_n', abstand: 9, naechsterKampfId: 1 } });
    await meldeAn(db.knex, 'P', { abo: abo(), glocken: glocken({ teilnehmer: ['a'] }) }, { konfig, jetzt });
    const teilnehmer = [t('a', 'Anna', { zustand: 'als_naechstes', naechsterKampfId: 1 })];
    await uebernimmPaket(db.knex, paket(teilnehmer, [kampf(1, 10)], [pool(10)]));
    const log = { warn: () => {}, log: () => {} };
    const weg = async () => { throw Object.assign(new Error('weg'), { statusCode: 410 }); };
    await pruefeUndSende(db.knex, 'P', { sender: weg, konfig, jetzt, log });
    assert.equal((await db.knex('live_push_abos')).length, 0);
});

test('Abmelden, Ablauf nach 3 Tagen und Rücknahme des Turniers räumen auf', async () => {
    await aufbau();
    await meldeAn(db.knex, 'P', { abo: abo(), glocken: glocken({ teilnehmer: ['a'] }) }, { konfig, jetzt });
    assert.equal(await meldeAb(db.knex, 'P', ENDPUNKT), true);
    assert.equal(await meldeAb(db.knex, 'P', ENDPUNKT), false);
    await meldeAn(db.knex, 'P', { abo: abo(), glocken: glocken({ teilnehmer: ['a'] }) }, { konfig, jetzt });
    assert.equal(await loescheAbgelaufeneAbos(db.knex, { jetzt: () => new Date('2026-10-16T11:59:00Z') }), 0);
    assert.equal(await loescheAbgelaufeneAbos(db.knex, { jetzt: () => new Date('2026-10-16T12:01:00Z') }), 1);
    await meldeAn(db.knex, 'P', { abo: abo(), glocken: glocken({ teilnehmer: ['a'] }) }, { konfig, jetzt });
    await uebernimmPaket(db.knex, { version: 1, turnierKey: 'P', zurueckgezogen: true, stand: '2026-10-13T13:00:00.000Z', sequenz: sequenz++ });
    assert.equal((await db.knex('live_push_abos')).length, 0);
});

test('Begrenzung: höchstens maxAbos Anmeldungen je Turnier', async () => {
    await aufbau();
    const klein = { ...konfig, maxAbos: 1 };
    await meldeAn(db.knex, 'P', { abo: abo(), glocken: glocken({ teilnehmer: ['a'] }) }, { konfig: klein, jetzt });
    await assert.rejects(meldeAn(db.knex, 'P', { abo: abo('https://fcm.googleapis.com/fcm/send/geraet-2'), glocken: glocken({ teilnehmer: ['a'] }) }, { konfig: klein, jetzt }), { code: 'ZU_VIELE' });
    // dieselbe Anmeldung erneut (Ersetzen) bleibt erlaubt
    assert.deepEqual(await meldeAn(db.knex, 'P', { abo: abo(), glocken: glocken({ teilnehmer: ['a', 'b'] }) }, { konfig: klein, jetzt }), { status: 'ok' });
});
```

- [ ] **Step 2: Tests laufen lassen, müssen scheitern**

Run: `node --test tests/unit/liveCloudPush.test.js`
Expected: FAIL, Modul `push.js` fehlt

- [ ] **Step 3: Implementierung**

In `src/liveCloud/abfrage.js` die Funktion `poolStarts` exportieren (`export async function poolStarts(...)`).

```js
// src/liveCloud/push.js
// Push-Nachrichten der Teilnehmer-App (Spec Phase 3): Anmeldungen, Auswertung nach jedem Snapshot, Versand.
import { poolStarts } from './abfrage.js';
import { baueNachricht } from './pushText.js';
import { istErlaubterEndpunkt, PUSH_SCHWELLE } from './pushKonfig.js';

const SCHLUESSEL = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_LISTE = 200;
const TAG_MS = 86_400_000;

const fehler = (code, text) => Object.assign(new Error(text), { code });
const liste = (wert) => (Array.isArray(wert)
    ? [...new Set(wert.filter(k => typeof k === 'string' && SCHLUESSEL.test(k)))].slice(0, MAX_LISTE) : []);

// Bedingungen eines Teilnehmers (Spec Entscheidung 3 und 4).
export function bedingungenFuer(t, poolInfo, schwelle = PUSH_SCHWELLE) {
    const treffer = [];
    if (t.pool_id != null && poolInfo && !poolInfo.begonnen && Number.isInteger(poolInfo.startetIn) && poolInfo.startetIn <= schwelle) {
        treffer.push({ art: 'pool', bezug: t.pool_id, abstand: poolInfo.startetIn });
    }
    const abstand = t.zustand === 'als_naechstes' ? 0 : (t.zustand === 'in_n' && Number.isInteger(t.abstand) ? t.abstand : null);
    if (abstand != null && abstand <= schwelle && t.naechster_kampf_id != null) {
        treffer.push({ art: 'kampf', bezug: t.naechster_kampf_id, abstand });
    }
    return treffer;
}

async function ladeStand(knex, turnierKey) {
    const [kopf, teilnehmer, pools, starts] = await Promise.all([
        knex('live_turniere').where({ turnier_key: turnierKey, zurueckgezogen: false }).first(),
        knex('live_teilnehmer').where({ turnier_key: turnierKey }),
        knex('live_pools').where({ turnier_key: turnierKey }).select('pool_id', 'bezeichnung'),
        poolStarts(knex, turnierKey)
    ]);
    if (!kopf) return null;
    return {
        kopf, starts,
        teilnehmer: new Map(teilnehmer.map(t => [t.key, t])),
        poolNamen: new Map(pools.map(p => [p.pool_id, p.bezeichnung])),
        matten: new Map((Array.isArray(kopf.matten) ? kopf.matten : []).map(m => [m.id, m.bezeichnung]))
    };
}

// Glockenliste → Menge der betroffenen Teilnehmer (Vereinsmitglieder zählen zur Laufzeit, Ausnahmen werden abgezogen).
function loeseAuf(stand, g) {
    const ergebnis = new Set(g.teilnehmer);
    const vereine = new Set(g.vereine);
    const ausnahmen = new Set(g.ausnahmen);
    for (const t of stand.teilnehmer.values()) {
        if (vereine.has(t.verein_key) && !ausnahmen.has(t.key)) ergebnis.add(t.key);
    }
    return [...ergebnis].filter(k => stand.teilnehmer.has(k));
}

async function ladeGlocken(knex, aboId) {
    const zeilen = await knex('live_push_glocken').where({ abo_id: aboId });
    const nach = (art) => zeilen.filter(z => z.art === art).map(z => z.schluessel);
    return { teilnehmer: nach('teilnehmer'), vereine: nach('verein'), ausnahmen: nach('ausnahme') };
}

export async function meldeAn(knex, turnierKey, { abo, glocken } = {}, { konfig, jetzt = () => new Date() } = {}) {
    if (!abo || !istErlaubterEndpunkt(abo.endpoint) || typeof abo.keys?.p256dh !== 'string' || typeof abo.keys?.auth !== 'string'
        || abo.keys.p256dh.length > 200 || abo.keys.auth.length > 100) {
        throw fehler('UNGUELTIG', 'Anmeldung ungültig');
    }
    const g = { teilnehmer: liste(glocken?.teilnehmer), vereine: liste(glocken?.vereine), ausnahmen: liste(glocken?.ausnahmen) };
    const leer = !g.teilnehmer.length && !g.vereine.length;

    return knex.transaction(async (trx) => {
        await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?))', [`livepush:${turnierKey}`]);
        const turnier = await trx('live_turniere').where({ turnier_key: turnierKey, zurueckgezogen: false }).first();
        if (!turnier) return { status: 'unbekannt' };
        const bestehend = await trx('live_push_abos').where({ turnier_key: turnierKey, endpoint: abo.endpoint }).first();
        if (leer) {
            if (bestehend) await trx('live_push_abos').where({ id: bestehend.id }).del();
            return { status: 'geloescht' };
        }
        if (!bestehend) {
            const [{ anzahl }] = await trx('live_push_abos').where({ turnier_key: turnierKey }).count('* as anzahl');
            if (Number(anzahl) >= konfig.maxAbos) throw fehler('ZU_VIELE', 'Zu viele Anmeldungen');
        }
        const basis = turnier.datum ? new Date(`${turnier.datum}T12:00:00Z`) : jetzt();
        const laeuftAb = new Date(basis.getTime() + konfig.tage * TAG_MS);
        let aboId;
        if (bestehend) {
            aboId = bestehend.id;
            await trx('live_push_abos').where({ id: aboId }).update({
                p256dh: abo.keys.p256dh, auth: abo.keys.auth, aktualisiert_am: jetzt(), laeuft_ab_am: laeuftAb
            });
            await trx('live_push_glocken').where({ abo_id: aboId }).del();
        } else {
            [{ id: aboId }] = await trx('live_push_abos').insert({
                turnier_key: turnierKey, endpoint: abo.endpoint, p256dh: abo.keys.p256dh, auth: abo.keys.auth,
                erstellt_am: jetzt(), aktualisiert_am: jetzt(), laeuft_ab_am: laeuftAb
            }).returning('id');
        }
        const zeilen = [
            ...g.teilnehmer.map(k => ({ abo_id: aboId, art: 'teilnehmer', schluessel: k })),
            ...g.vereine.map(k => ({ abo_id: aboId, art: 'verein', schluessel: k })),
            ...g.ausnahmen.map(k => ({ abo_id: aboId, art: 'ausnahme', schluessel: k }))
        ];
        if (zeilen.length) await trx('live_push_glocken').insert(zeilen);

        // Bereits erfüllte Bedingungen gelten als gesendet (Spec Entscheidung 5).
        const stand = await ladeStand(trx, turnierKey);
        if (stand) {
            const vermerke = [];
            for (const key of loeseAuf(stand, g)) {
                const t = stand.teilnehmer.get(key);
                for (const b of bedingungenFuer(t, stand.starts.get(t.pool_id))) {
                    vermerke.push({ abo_id: aboId, teilnehmer_key: key, art: b.art, bezug_id: b.bezug });
                }
            }
            if (vermerke.length) await trx('live_push_gesendet').insert(vermerke).onConflict(['abo_id', 'teilnehmer_key', 'art', 'bezug_id']).ignore();
        }
        return { status: 'ok' };
    });
}

export async function meldeAb(knex, turnierKey, endpoint) {
    if (typeof endpoint !== 'string') return false;
    return (await knex('live_push_abos').where({ turnier_key: turnierKey, endpoint }).del()) > 0;
}

export async function loescheAbgelaufeneAbos(knex, { jetzt = () => new Date() } = {}) {
    return knex('live_push_abos').where('laeuft_ab_am', '<', jetzt()).del();
}

// Nach jedem übernommenen Snapshot: neue Treffer ermitteln, eintragen (genau einmal) und senden.
export async function pruefeUndSende(knex, turnierKey, { sender, konfig, jetzt = () => new Date(), log = console } = {}) {
    const nachrichten = await knex.transaction(async (trx) => {
        await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?))', [`livepush:${turnierKey}`]);
        const abos = await trx('live_push_abos').where({ turnier_key: turnierKey }).where('laeuft_ab_am', '>=', jetzt());
        if (!abos.length) return [];
        const stand = await ladeStand(trx, turnierKey);
        if (!stand) return [];
        const aus = [];
        for (const a of abos) {
            const g = await ladeGlocken(trx, a.id);
            for (const key of loeseAuf(stand, g)) {
                const t = stand.teilnehmer.get(key);
                const neu = [];
                for (const b of bedingungenFuer(t, stand.starts.get(t.pool_id))) {
                    const eingetragen = await trx('live_push_gesendet')
                        .insert({ abo_id: a.id, teilnehmer_key: key, art: b.art, bezug_id: b.bezug })
                        .onConflict(['abo_id', 'teilnehmer_key', 'art', 'bezug_id']).ignore().returning('abo_id');
                    if (eingetragen.length) neu.push(b);
                }
                if (!neu.length) continue;
                aus.push({
                    abo: { id: a.id, endpoint: a.endpoint, keys: { p256dh: a.p256dh, auth: a.auth } },
                    nachricht: baueNachricht({
                        turnierKey, turnierName: stand.kopf.name, name: `${t.vorname} ${t.nachname}`.trim(),
                        poolBezeichnung: stand.poolNamen.get(t.pool_id) || t.pool_bezeichnung,
                        matte: stand.matten.get(t.matte_id) || t.matte_bezeichnung || '',
                        pool: neu.find(b => b.art === 'pool') || null, kampf: neu.find(b => b.art === 'kampf') || null
                    })
                });
            }
        }
        return aus;
    });

    let gesendet = 0;
    for (const { abo, nachricht } of nachrichten) {
        try {
            await sender(abo, nachricht);
            gesendet += 1;
        } catch (f) {
            if (f && (f.statusCode === 404 || f.statusCode === 410)) await knex('live_push_abos').where({ id: abo.id }).del();
            else log.warn(`[LivePush] Senden fehlgeschlagen: ${f && f.message}`);
        }
    }
    return { gesendet };
}
```

- [ ] **Step 4: Tests laufen lassen, müssen bestehen**

Run: `node --test tests/unit/liveCloudPush.test.js`
Expected: PASS (7 Tests). Schlägt „Pool-Start und Kampf zusammen“ fehl, zuerst die Annahme zu `poolStartetIn` mit `poolStarts` ausgeben (Warteschlange der Matte), nicht die Erwartung anpassen.

- [ ] **Step 5: Commit**

```bash
git add src/liveCloud/abfrage.js src/liveCloud/push.js tests/unit/liveCloudPush.test.js
git commit -m "feat: Push-Anmeldung, Auswertung und Versand der Teilnehmer-App"
```

---

### Task 4: Routen, Ingest-Anbindung, Aufbewahrung, Schlüssel-Skript

**Files:**
- Modify: `src/routes/liveRoutes.js`
- Modify: `src/liveCloud/aufbewahrung.js`
- Modify: `src/app.js` (Push-Konfiguration an `getLiveRoutes` und `starteAufbewahrung` übergeben)
- Create: `src/liveCloud/pushSender.js`
- Create: `scripts/live-push-schluessel.mjs`
- Test: `tests/unit/liveCloudRoutes.test.js` (ergänzen)

**Interfaces:**
- Consumes: `liesPushKonfig`, `meldeAn`, `meldeAb`, `pruefeUndSende`, `loescheAbgelaufeneAbos`.
- Produces: `getLiveRoutes(knex, { ..., push: { konfig, sender } })`, `erzeugeSender(konfig) → async (abo, nachricht)`.

- [ ] **Step 1: Tests ergänzen** (am Ende von `tests/unit/liveCloudRoutes.test.js`; vorhandene Hilfen der Datei zum Starten des Express-Servers weiterverwenden — erst die Datei lesen und deren Muster übernehmen)

Zu prüfen sind:
1. `GET /api/live/push/schluessel` → 503 ohne Konfiguration, 200 `{ schluessel }` mit Konfiguration.
2. `PUT /api/live/turniere/:key/push` → 400 bei fremdem Host, 404 bei unbekanntem Turnier, 204 bei Erfolg, 204 bei leerer Liste (löscht), 503 ohne Konfiguration, 429 nach Überschreiten der Rate.
3. `DELETE /api/live/turniere/:key/push` → 204.
4. Ein Ingest-Paket mit erfüllter Bedingung ruft den injizierten `sender` genau einmal auf; ein Sender, der wirft, lässt den Ingest mit 204 antworten.

- [ ] **Step 2: Tests laufen lassen, müssen scheitern**

Run: `node --test tests/unit/liveCloudRoutes.test.js`
Expected: FAIL (Routen fehlen)

- [ ] **Step 3: Implementierung**

```js
// src/liveCloud/pushSender.js
// Echter Versand über web-push (VAPID). Im Test wird stattdessen ein Sender injiziert.
import webpush from 'web-push';

export function erzeugeSender(konfig) {
    webpush.setVapidDetails(konfig.betreff, konfig.publicKey, konfig.privateKey);
    return async (abo, nachricht) => {
        await webpush.sendNotification(
            { endpoint: abo.endpoint, keys: abo.keys },
            JSON.stringify(nachricht),
            { TTL: 600, urgency: 'high' }
        );
    };
}
```

In `src/routes/liveRoutes.js`:
- Import `liesPushKonfig`, `meldeAn`, `meldeAb`, `pruefeUndSende`; Optionen `push = { konfig: liesPushKonfig(env), sender: null }`.
- Nach erfolgreichem `uebernimmPaket` mit Ergebnis `'uebernommen'` (nicht bei `'zurueckgezogen'`): wenn `push.konfig.aktiv && push.sender`, `pruefeUndSende(knex, paket.turnierKey, { sender: push.sender, konfig: push.konfig, jetzt }).catch(f => console.error('[LivePush]', f.message));` ohne `await`.
- In der App-API (hinter der Ratenbegrenzung) die drei Routen aus Spec Abschnitt 5; `PUT`/`DELETE` brauchen `express.json` (ist global; Body-Größe prüfen, 413 nicht nötig); Antworten: 204, 400 bei `UNGUELTIG`, 404 bei `unbekannt`, 429 bei `ZU_VIELE`, 503 ohne aktive Konfiguration.

In `src/app.js`: `const pushKonfig = liesPushKonfig(); getLiveRoutes(knex, { push: { konfig: pushKonfig, sender: pushKonfig.aktiv ? erzeugeSender(pushKonfig) : null } })`.

In `src/liveCloud/aufbewahrung.js`: `starteAufbewahrung` ruft zusätzlich `loescheAbgelaufeneAbos(knex)` im stündlichen Lauf auf.

```js
// scripts/live-push-schluessel.mjs
// Erzeugt ein VAPID-Schlüsselpaar für die Push-Nachrichten: node scripts/live-push-schluessel.mjs
import webpush from 'web-push';

const { publicKey, privateKey } = webpush.generateVAPIDKeys();
console.log('LIVE_PUSH_VAPID_PUBLIC=' + publicKey);
console.log('LIVE_PUSH_VAPID_PRIVATE=' + privateKey);
console.log('LIVE_PUSH_BETREFF=mailto:<Kontaktadresse>');
console.log('Der private Schlüssel gehört nur in die Cloud-Umgebung (.env), nie ins Repository.');
```

- [ ] **Step 4: Tests laufen lassen, müssen bestehen**

Run: `node --test tests/unit/liveCloudRoutes.test.js tests/unit/liveCloudPush.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/routes/liveRoutes.js src/liveCloud/aufbewahrung.js src/liveCloud/pushSender.js src/app.js scripts/live-push-schluessel.mjs tests/unit/liveCloudRoutes.test.js
git commit -m "feat: Push-Routen, Anbindung an den Ingest und Aufbewahrung"
```

---

### Task 5: PWA — Glockenliste, Anmeldung, Service Worker

**Files:**
- Modify: `teilnehmer-app/js/speicher.js` (`glockenliste()`, `beiAenderung`)
- Create: `teilnehmer-app/js/push.js`
- Modify: `teilnehmer-app/js/api.js` (`pushSchluessel`, `pushAnmelden`, `pushAbmelden`)
- Modify: `teilnehmer-app/js/ui.js` (`speicherFuer` verbindet `beiAenderung` mit `planeAbgleich`)
- Modify: `teilnehmer-app/js/ansicht-uebersicht.js` und `ansicht-verein.js` (Hinweiszeile)
- Modify: `teilnehmer-app/sw.js` (Handler, Cache-Version, `push.js` in die Hülle)
- Modify: `teilnehmer-app/css/app.css` (Hinweiszeile)
- Test: `tests/unit/liveApp.test.js` (ergänzen), `tests/unit/liveAppPush.test.js`

**Interfaces:**
- Produces: `speicher.glockenliste() → { teilnehmer: [], vereine: [], ausnahmen: [] }`; `pushHinweis(umgebung) → string|null`; `planeAbgleich(turnierKey, speicher)`.

- [ ] **Step 1: Tests schreiben**

In `tests/unit/liveApp.test.js` ergänzen:

```js
test('Glockenliste: einzelne Glocken, Vereine mit Glocke für alle, Ausnahmen und Abgewählte', () => {
    const s = erzeugeSpeicher(speicherAttrappe(), 'T1');
    s.stern('a1', true);                      // Stern mit Glocke
    s.glocke('a2', false);                    // gesternt, ohne Glocke
    s.vereinStern('v1', true);
    s.vereinGlockeAlle('v1', true);
    s.vereinAusnahme('v1', 'x1', false);      // Glocke aus für x1
    s.stern('x2', false, 'v1');               // abgewählt
    s.vereinStern('v2', true);
    s.vereinAusnahme('v2', 'y1', true);       // einzelne Glocke im Verein ohne "für alle"
    const g = s.glockenliste();
    assert.deepEqual(g.teilnehmer.sort(), ['a1', 'y1']);
    assert.deepEqual(g.vereine, ['v1']);
    assert.deepEqual(g.ausnahmen.sort(), ['x1', 'x2']);
});

test('Speicher: beiAenderung meldet jede Änderung', () => {
    let anzahl = 0;
    const s = erzeugeSpeicher(speicherAttrappe(), 'T1', { beiAenderung: () => { anzahl += 1; } });
    s.stern('a1', true);
    s.glocke('a1', false);
    s.vereinStern('v1', true);
    assert.equal(anzahl, 3);
});
```

```js
// tests/unit/liveAppPush.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { pushStatus, pushHinweis } from '../../teilnehmer-app/js/push.js';

const umgebung = (extra = {}) => ({ hatServiceWorker: true, hatPushManager: true, hatNotification: true, berechtigung: 'default', istIos: false, istInstalliert: false, ...extra });

test('Push-Status: unterstützt, blockiert, aktiv, iPhone ohne Installation, nicht unterstützt', () => {
    assert.equal(pushStatus(umgebung()), 'bereit');
    assert.equal(pushStatus(umgebung({ berechtigung: 'granted' })), 'aktiv');
    assert.equal(pushStatus(umgebung({ berechtigung: 'denied' })), 'blockiert');
    assert.equal(pushStatus(umgebung({ hatPushManager: false, istIos: true })), 'ios_installieren');
    assert.equal(pushStatus(umgebung({ hatPushManager: false })), 'nicht_unterstuetzt');
    assert.equal(pushStatus(umgebung({ hatServiceWorker: false })), 'nicht_unterstuetzt');
});

test('Push-Hinweis: Text nur, wenn etwas zu tun oder zu wissen ist', () => {
    assert.equal(pushHinweis('aktiv'), null);
    assert.match(pushHinweis('blockiert'), /blockiert/);
    assert.match(pushHinweis('ios_installieren'), /Home-Bildschirm/);
    assert.match(pushHinweis('nicht_unterstuetzt'), /nicht/);
    assert.equal(pushHinweis('bereit'), null);
});
```

- [ ] **Step 2: Tests laufen lassen, müssen scheitern**

Run: `node --test tests/unit/liveApp.test.js tests/unit/liveAppPush.test.js`
Expected: FAIL (`glockenliste`/`push.js` fehlen)

- [ ] **Step 3: Implementierung**

`speicher.js`: `erzeugeSpeicher(storage, turnierKey, { beiAenderung = null } = {})`; in `sichere()` nach dem Speichern `if (beiAenderung) beiAenderung();`; neue Methode:

```js
glockenliste() {
    const teilnehmer = new Set();
    const vereine = [];
    const ausnahmen = new Set();
    for (const [key, w] of Object.entries(zustand.teilnehmer)) if (w && w.glocke) teilnehmer.add(key);
    for (const [vereinKey, v] of Object.entries(zustand.vereine)) {
        if (v.glockeAlle) vereine.push(vereinKey);
        for (const [key, an] of Object.entries(v.ausnahmen || {})) {
            if (an) teilnehmer.add(key); else ausnahmen.add(key);
        }
        for (const [key, weg] of Object.entries(v.abgewaehlt || {})) if (weg) ausnahmen.add(key);
    }
    for (const key of teilnehmer) ausnahmen.delete(key);
    return { teilnehmer: [...teilnehmer], vereine, ausnahmen: [...ausnahmen] };
}
```

`push.js` (neu):

```js
// Web-Push der Teilnehmer-App: Unterstützung erkennen, Berechtigung erfragen, Gerät anmelden, Glockenliste übertragen.
import { api } from './api.js';

export function umgebungLesen() {
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
    return {
        hatServiceWorker: typeof navigator !== 'undefined' && 'serviceWorker' in navigator,
        hatPushManager: typeof window !== 'undefined' && 'PushManager' in window,
        hatNotification: typeof Notification !== 'undefined',
        berechtigung: typeof Notification !== 'undefined' ? Notification.permission : 'denied',
        istIos: /iPad|iPhone|iPod/.test(ua) || (typeof navigator !== 'undefined' && navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1),
        istInstalliert: typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true)
    };
}

export function pushStatus(u) {
    if (!u.hatServiceWorker) return 'nicht_unterstuetzt';
    if (!u.hatPushManager || !u.hatNotification) return u.istIos && !u.istInstalliert ? 'ios_installieren' : 'nicht_unterstuetzt';
    if (u.berechtigung === 'denied') return 'blockiert';
    return u.berechtigung === 'granted' ? 'aktiv' : 'bereit';
}

export function pushHinweis(status) {
    if (status === 'blockiert') return 'Benachrichtigungen sind in den Einstellungen deines Geräts blockiert.';
    if (status === 'ios_installieren') return 'Für Benachrichtigungen auf dem iPhone die App zuerst über „Teilen“ zum Home-Bildschirm hinzufügen und von dort öffnen.';
    if (status === 'nicht_unterstuetzt') return 'Dieses Gerät oder dieser Browser unterstützt keine Benachrichtigungen.';
    return null;
}

const base64ZuBytes = (b64) => {
    const roh = atob(b64.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(b64.length / 4) * 4, '='));
    return Uint8Array.from(roh, c => c.charCodeAt(0));
};

let zeitgeber = null;
const sichereAbgleich = async (turnierKey, speicher) => {
    const u = umgebungLesen();
    if (pushStatus(u) !== 'aktiv') return;
    const reg = await navigator.serviceWorker.ready;
    const liste = speicher.glockenliste();
    const leer = !liste.teilnehmer.length && !liste.vereine.length;
    let abo = await reg.pushManager.getSubscription();
    if (leer) {
        if (abo) await api.pushAbmelden(turnierKey, abo.endpoint).catch(() => {});
        return;
    }
    if (!abo) {
        const { schluessel } = await api.pushSchluessel();
        abo = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64ZuBytes(schluessel) });
    }
    await api.pushAnmelden(turnierKey, { abo: abo.toJSON(), glocken: liste });
};

// Wird bei jeder Änderung von Stern/Glocke/Verein aufgerufen (im Antippen-Ereignis: die Berechtigungsfrage braucht eine Nutzeraktion).
export function planeAbgleich(turnierKey, speicher) {
    try {
        const liste = speicher.glockenliste();
        const hatGlocken = liste.teilnehmer.length > 0 || liste.vereine.length > 0;
        const u = umgebungLesen();
        if (hatGlocken && pushStatus(u) === 'bereit') {
            Notification.requestPermission().then(() => sichereAbgleich(turnierKey, speicher)).catch(() => {});
            return;
        }
    } catch { /* ohne Push weiter */ }
    clearTimeout(zeitgeber);
    zeitgeber = setTimeout(() => { sichereAbgleich(turnierKey, speicher).catch(() => {}); }, 800);
}
```

`api.js` ergänzen:

```js
    pushSchluessel: () => hole('/push/schluessel'),
    pushAnmelden: (key, daten) => hole(`${t(key)}/push`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(daten) }),
    pushAbmelden: (key, endpoint) => hole(`${t(key)}/push`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint }) })
```

(`hole` verarbeitet 204 ohne Body: dafür `antwort.status === 204 ? null : antwort.json()` ergänzen.)

`ui.js`: `speicherFuer` übergibt `{ beiAenderung: () => planeAbgleich(turnierKey, speicher) }` (Speicher-Variable vor dem Aufruf deklarieren). Importiert `planeAbgleich` aus `./push.js`.

`ansicht-uebersicht.js` und `ansicht-verein.js`: unter der Überschrift `pushHinweis(pushStatus(umgebungLesen()))` als `<p class="hinweis" data-testid="push-hinweis">`, nur wenn nicht `null` und mindestens eine Glocke gesetzt ist (`glockenliste()` nicht leer).

`sw.js`: Cache-Version erhöhen, `./js/push.js` in `HUELLE`, und:

```js
self.addEventListener('push', (e) => {
    let daten = {};
    try { daten = e.data ? e.data.json() : {}; } catch { daten = { titel: 'Hajime Live', text: e.data ? e.data.text() : '' }; }
    e.waitUntil(self.registration.showNotification(daten.titel || 'Hajime Live', {
        body: daten.text || '', tag: daten.tag || 'hajime-live', renotify: true,
        icon: './icons/icon-192.png', data: { url: daten.url || '/live/' }
    }));
});
self.addEventListener('notificationclick', (e) => {
    e.notification.close();
    const ziel = (e.notification.data && e.notification.data.url) || '/live/';
    e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((fenster) => {
        for (const f of fenster) {
            if (f.url.includes('/live/') && 'focus' in f) { f.navigate(ziel).catch(() => {}); return f.focus(); }
        }
        return self.clients.openWindow(ziel);
    }));
});
```

- [ ] **Step 4: Tests laufen lassen, müssen bestehen**

Run: `node --test tests/unit/liveApp.test.js tests/unit/liveAppPush.test.js tests/unit/liveAppKontrast.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add teilnehmer-app tests/unit
git commit -m "feat: Teilnehmer-App meldet Geräte für Push an und zeigt Nachrichten"
```

---

### Task 6: E2E, Dokumentation, Abschluss

**Files:**
- Modify: `tests/e2e/live-app.spec.js` (neuer Test)
- Modify: `docs/live-uplink.md`, `CLAUDE.md`

- [ ] **Step 1: E2E-Test**

Ein Test „Glocke meldet das Gerät für Push an“: Berechtigung `notifications` per `context.grantPermissions`; per `page.addInitScript` `PushManager.prototype.subscribe`/`getSubscription` und `ServiceWorkerRegistration` so stubben, dass eine Anmeldung mit `endpoint: 'https://fcm.googleapis.com/fcm/send/e2e'` und `toJSON()` zurückkommt; `page.route('**/api/live/push/schluessel', …)` liefert `{ schluessel: '<87 Zeichen base64url>' }`, `page.route('**/api/live/turniere/*/push', …)` fängt den `PUT` ab und merkt sich den Body. Ablauf: Paket senden (wie die anderen Tests), Suche, Stern setzen, Glocke antippen → erwartet wird ein `PUT` mit `glocken.teilnehmer` = `['a1']` und dem Endpunkt. Danach Glocke aus → `DELETE`.

- [ ] **Step 2: Test laufen lassen**

Run: `npx playwright test tests/e2e/live-app.spec.js`
Expected: PASS (alle, inklusive des neuen)

- [ ] **Step 3: Dokumentation**

`docs/live-uplink.md`: Abschnitt „Push-Nachrichten (Phase 3)“ mit den vier Variablen, dem Skript `node scripts/live-push-schluessel.mjs`, HTTPS-Voraussetzung, Datenschutz (3 Tage), manueller Prüfliste (Android Chrome, iPhone mit Home-Bildschirm-App, Desktop). `CLAUDE.md`: Eintrag „Phase 3“ im Absatz zum Live-Uplink (Dateien `src/liveCloud/push*.js`, Tabellen `live_push_*`, `teilnehmer-app/js/push.js`).

- [ ] **Step 4: Gesamtlauf**

Run: `npm run test:unit` und `npx playwright test tests/e2e/live-app.spec.js tests/e2e/live-freigabe.spec.js`
Expected: alles grün

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/live-app.spec.js docs/live-uplink.md CLAUDE.md
git commit -m "docs: Push-Nachrichten der Teilnehmer-App (Betrieb, Tests)"
```
