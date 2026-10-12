# Teilnehmer-App Phase 2 (Cloud-Ingest, App-API, PWA) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die Cloud nimmt die Snapshots des Live-Prozesses (Phase 1) entgegen, hält sie als Lesemodell und liefert sie über eine öffentliche, ratenbegrenzte App-API an die PWA „Hajime Live“ aus (Suche, Pool-Ansicht, Stern/Glocke, Übersicht).

**Architecture:** Neues Modulverzeichnis `src/liveCloud/` (Ingest, Token, Abfragen, Ratenbegrenzung, Aufbewahrung) hinter einem Express-Router `src/routes/liveRoutes.js`, der in `src/app.js` nur im Modus `cloud` (oder mit `LIVE_API_AKTIV=true`, nur für Tests) unter `/api/live` hängt. Die PWA liegt in `teilnehmer-app/` (statisch, `/live/`), ihre Logik (Anzeigetexte, Stern-/Glockenspeicher) steckt in reinen ES-Modulen, die in Node getestet werden. Die Geräte sind zustandslos: Sterne und Glocken liegen im Gerät und werden mit jeder Übersicht-Anfrage als Schlüsselliste mitgeschickt.

**Tech Stack:** Node.js (ESM), Express 5, Knex/PostgreSQL, `node:test`, Playwright, Vanilla-JS-PWA (Service Worker, Web-Manifest), kein neues npm-Paket.

**Spec:** `docs/specs/2026-10-12-teilnehmer-app-design.md` (Abschnitt 6 „Phase 2“, Abschnitt 4 für die Kachel, Abschnitt 10 Datenschutz, 11 Fehlerfälle)

## Global Constraints

- Antworten, Kommentare und Commit-Texte auf Deutsch; Commits enden mit `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Datenfluss nur Richtung Cloud: der Ingest antwortet ausschließlich mit Statuscode (`204`, `400`, `401`, `403`, `429`, `500`), nie mit Daten oder Befehlen (Spec Entscheidung 5).
- Keine Konten, nur anonyme Geräte; Verfolgen gilt je Turnier (Entscheidung 3/4).
- Keine Aufzählung ohne Suchbegriff: Suche ab **2 Zeichen**; Teilnehmerlisten nur je Pool oder je Verein (Spec 6.1).
- Nicht in der Cloud speichern: Geburtsdatum, Gewicht, Passnummer (die Snapshots enthalten sie nicht; die Cloud-Tabellen haben dafür keine Spalten).
- Aufbewahrung: Live-Daten werden **7 Tage nach dem Turnierdatum** gelöscht (konfigurierbar `LIVE_AUFBEWAHRUNG_TAGE`, Spec 14 Vorschlag).
- Keine externen Ressourcen in der PWA (keine CDN-Schriften/-Skripte); Anzeige aller Namen nur über `textContent`, nie `innerHTML`.
- Mannschaftskämpfe sind nicht Teil dieser Phase (Spec 1).
- Push, Glocken-Synchronisation zur Cloud und `live_verfolgungen`/`push_*`-Tabellen sind **Phase 3**, nicht hier.
- Zustandswerte der Kachel (aus `src/shared/liveKachel.js`): `nicht_ausgelost`, `ohne_matte`, `verspaetet`, `nicht_erschienen`, `laeuft`, `als_naechstes`, `in_n` (mit `abstand`), `wartet_auf_gegner`, `keine_weiteren`, `abgeschlossen` (mit `platz`).
- Gewichtsklasse steht als `-44` / `+63` in den Daten; angezeigt wird `−44 kg` (Minuszeichen U+2212) bzw. `+63 kg`.

## Entscheidungen dieses Plans (Rulings, vom Spec nicht festgelegt)

| # | Entscheidung | Begründung |
|---|---|---|
| R1 | API-Präfix `/api/live`, PWA unter `/live/`; Routen nur im Modus `cloud` oder mit `LIVE_API_AKTIV=true` | Hallen-Server dürfen keinen offenen Ingest anbieten (Entscheidung 5); die Test-Suite fährt im Modus `server`, braucht die Routen aber |
| R2 | Ingest-Token in Tabelle `live_ingest_tokens` (nur SHA-256 gespeichert), Verwaltung per `scripts/live-token.mjs`; optional an einen `turnier_key` gebunden | Spec 5.3 „sperrbar, an das Turnier gebunden“; ein Token des Slaves ist meist ungebunden, weil er mehrere Turniere sendet |
| R3 | Veraltete Pakete (`sequenz` ≤ gespeicherte) werden mit `204` quittiert und ignoriert | Der Uplink soll bei einem Überholer nicht in den Backoff laufen |
| R4 | Eine Rücknahme bleibt als Grabstein (`zurueckgezogen = true`, Sequenz behalten) stehen, bis die Aufbewahrung sie löscht | Ein verspätetes älteres Paket darf ein zurückgezogenes Turnier nicht wieder beleben |
| R5 | Glocke an ⇒ Stern an; Stern aus ⇒ Glocke weg. Stern auf Teilnehmer: Glocke an; Stern auf Verein: Glocke aus, „Glocke für alle“ und Ausnahmen je Teilnehmer | Spec 6.2; die Regel „Glocke ohne Stern“ ist dort offen |
| R6 | Rate-Limit 300 Anfragen/Minute je IP (Festfenster); Fehlversuche am Ingest 30/Minute je IP. Hinter einem Proxy zählt `X-Forwarded-For` nur mit `LIVE_PROXY_VERTRAUEN=true` | Mobilfunk-Carrier-NAT bündelt viele Handys auf eine IP; 300 statt 120 vermeidet falsche Sperren in der Halle |
| R7 | Verbindungszustand der App wird aus `serverzeit − empfangenAm` der Cloud berechnet (Schwelle 180 s), nicht aus der Geräteuhr | Geräteuhren gehen falsch; der Uplink sendet spätestens alle 60 s ein Lebenszeichen |

## Review Focus

Eingaben und Fehlerfälle, die der Spec nur andeutet und die einem Nutzer am ehesten wehtun; jede Zeile hat einen Test in dem genannten Task:

1. **Verspätetes Paket nach Rücknahme** darf das Turnier nicht wieder erscheinen lassen; ein neueres Paket schon (Task 1).
2. **Doppelte Teilnehmerschlüssel** im Snapshot (gleicher Judopass zweimal) dürfen den Ingest nicht mit 500 abbrechen lassen, sonst bleibt der Slave dauerhaft im Backoff (Task 1).
3. **Suchtext mit `%`, `_`, Sonderzeichen, 1 Zeichen oder nur Leerzeichen** liefert nie die ganze Liste (Task 3).
4. **Übersicht mit unbekannten Schlüsseln, leerer Liste, mehr als 200 Schlüsseln, zurückgezogenem Turnier** antwortet sauber (leer bzw. 404), nie mit 500 (Task 3, 5).
5. **„Halle nicht verbunden“** erscheint, sobald seit mehr als 3 Minuten kein Paket ankam, und die App zeigt ohne Netz den zuletzt geladenen Stand mit Hinweis (Task 6, 7).

---

### Task 1: Cloud-Lesemodell und Ingest

**Files:**
- Create: `migrations/20261012110000_live_cloud_lesemodell.js`
- Create: `src/liveCloud/suchtext.js`
- Create: `src/liveCloud/ingest.js`
- Test: `tests/unit/liveCloudIngest.test.js`

**Interfaces:**
- Produces:
  - Tabellen `live_turniere(turnier_key PK, name, datum, stand, sequenz, empfangen_am, zurueckgezogen, vereine jsonb, matten jsonb)`, `live_teilnehmer(turnier_key, key; PK beide)`, `live_kampf_positionen(turnier_key, kampf_id; PK beide)`, `live_ingest_tokens(id, name, token_hash, turnier_key, erzeugt_am, gesperrt_am, zuletzt_genutzt)`
  - `suchtext.js`: `normalisiereSuche(text: string): string`, `suchtextFuer(vorname, nachname): string`, `suchbegriffe(text: string): string[]` (leeres Array bei weniger als 2 Zeichen, höchstens 5 Begriffe)
  - `ingest.js`: `pruefePaket(paket): string | null` (Fehlertext oder `null`), `uebernimmPaket(knex, paket, { jetzt? }): Promise<'uebernommen' | 'veraltet' | 'zurueckgezogen'>` (wirft `Error` mit `code === 'UNGUELTIG'`)

- [ ] **Step 1: Failing test schreiben**

`tests/unit/liveCloudIngest.test.js`:

```js
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { starteTestPostgres } from '../helpers/testPostgres.js';
import { pruefePaket, uebernimmPaket } from '../../src/liveCloud/ingest.js';
import { normalisiereSuche, suchtextFuer, suchbegriffe } from '../../src/liveCloud/suchtext.js';

const teilnehmer = (key, extra = {}) => ({
    key, vorname: 'Anna', nachname: 'Muster', vereinKey: 'v1', verein: 'JC Muster',
    altersklasse: 'U15', gewichtsklasse: '-44', geschlecht: 'w', poolId: 10, poolBezeichnung: 'U15 w -44',
    matteId: 1, matteBezeichnung: 'Matte 1', zustand: 'in_n', abstand: 3, naechsterKampfId: 5, platz: null, ...extra
});
const paket = (extra = {}) => ({
    version: 1, turnierKey: '77', name: 'Herbstturnier', datum: '2026-10-12', stand: '2026-10-12T10:00:00.000Z', sequenz: 1000,
    vereine: [{ key: 'v1', name: 'JC Muster' }], matten: [{ id: 1, bezeichnung: 'Matte 1' }],
    teilnehmer: [teilnehmer('a1')],
    warteschlangen: [{ matteId: 1, kaempfe: [{ id: 5, status: 'bereit', position: 0, teilnehmerKeys: ['a1', null] }] }],
    ...extra
});
const rueck = (turnierKey, sequenz) => ({ version: 1, turnierKey, zurueckgezogen: true, stand: '2026-10-12T11:00:00.000Z', sequenz });

let db;
before(async () => { db = await starteTestPostgres(); });
after(async () => { if (db) await db.stoppe(); });

test('Suchtext: Umlaute, Sonderzeichen und Mindestlänge', () => {
    assert.equal(normalisiereSuche('Müller-Lüdenscheidt'), 'mueller luedenscheidt');
    assert.match(suchtextFuer('Jörg', 'Müller'), /joerg mueller/);
    assert.match(suchtextFuer('Jörg', 'Müller'), /jorg muller/);
    assert.deepEqual(suchbegriffe('a'), []);
    assert.deepEqual(suchbegriffe('  '), []);
    assert.deepEqual(suchbegriffe('%_'), []);
    assert.deepEqual(suchbegriffe('Mus Ann'), ['mus', 'ann']);
    assert.equal(suchbegriffe('a b c d e f g').length <= 5, true);
});

test('pruefePaket: gültiges Paket und typische Fehler', () => {
    assert.equal(pruefePaket(paket()), null);
    assert.equal(pruefePaket(rueck('77', 5)), null);
    assert.match(pruefePaket(null), /Objekt/);
    assert.match(pruefePaket(paket({ version: 2 })), /Version/);
    assert.match(pruefePaket(paket({ turnierKey: '' })), /turnierKey/);
    assert.match(pruefePaket(paket({ sequenz: 'x' })), /sequenz/);
    assert.match(pruefePaket(paket({ datum: '12.10.2026' })), /datum/);
    assert.match(pruefePaket(paket({ teilnehmer: 'x' })), /teilnehmer/);
    assert.match(pruefePaket(paket({ teilnehmer: [{ key: '', zustand: 'x' }] })), /Teilnehmer/);
});

test('Snapshot wird übernommen, ein neueres ersetzt, ein älteres wird ignoriert', async () => {
    const { knex } = db;
    assert.equal(await uebernimmPaket(knex, paket({ turnierKey: 'T1' })), 'uebernommen');
    assert.equal((await knex('live_teilnehmer').where({ turnier_key: 'T1' })).length, 1);
    const kopf = await knex('live_turniere').where({ turnier_key: 'T1' }).first();
    assert.equal(kopf.name, 'Herbstturnier');
    assert.equal(kopf.datum, '2026-10-12');
    assert.equal((await knex('live_kampf_positionen').where({ turnier_key: 'T1' })).length, 1);

    const neuer = paket({ turnierKey: 'T1', sequenz: 2000, teilnehmer: [teilnehmer('b1', { vorname: 'Max' }), teilnehmer('b2')] });
    assert.equal(await uebernimmPaket(knex, neuer), 'uebernommen');
    assert.deepEqual((await knex('live_teilnehmer').where({ turnier_key: 'T1' }).orderBy('key')).map(z => z.key), ['b1', 'b2']);

    assert.equal(await uebernimmPaket(knex, paket({ turnierKey: 'T1', sequenz: 1500 })), 'veraltet');
    assert.equal((await knex('live_teilnehmer').where({ turnier_key: 'T1' })).length, 2);
});

test('Rücknahme entfernt den Stand; ein verspätetes älteres Paket belebt ihn nicht, ein neueres schon', async () => {
    const { knex } = db;
    await uebernimmPaket(knex, paket({ turnierKey: 'T2', sequenz: 100 }));
    assert.equal(await uebernimmPaket(knex, rueck('T2', 200)), 'zurueckgezogen');
    assert.equal((await knex('live_teilnehmer').where({ turnier_key: 'T2' })).length, 0);
    assert.equal((await knex('live_turniere').where({ turnier_key: 'T2' }).first()).zurueckgezogen, true);

    assert.equal(await uebernimmPaket(knex, paket({ turnierKey: 'T2', sequenz: 150 })), 'veraltet');
    assert.equal((await knex('live_turniere').where({ turnier_key: 'T2' }).first()).zurueckgezogen, true);

    assert.equal(await uebernimmPaket(knex, paket({ turnierKey: 'T2', sequenz: 300 })), 'uebernommen');
    assert.equal((await knex('live_turniere').where({ turnier_key: 'T2' }).first()).zurueckgezogen, false);
});

test('Rücknahme eines unbekannten Turniers legt einen Grabstein an', async () => {
    const { knex } = db;
    assert.equal(await uebernimmPaket(knex, rueck('T3', 50)), 'zurueckgezogen');
    assert.equal(await uebernimmPaket(knex, paket({ turnierKey: 'T3', sequenz: 40 })), 'veraltet');
});

test('doppelte Teilnehmer- und Kampfschlüssel brechen den Ingest nicht ab', async () => {
    const { knex } = db;
    const p = paket({
        turnierKey: 'T4',
        teilnehmer: [teilnehmer('d1'), teilnehmer('d1', { vorname: 'Zweite' })],
        warteschlangen: [{ matteId: 1, kaempfe: [
            { id: 9, status: 'bereit', position: 0, teilnehmerKeys: ['d1', null] },
            { id: 9, status: 'bereit', position: 1, teilnehmerKeys: ['d1', null] }
        ] }]
    });
    assert.equal(await uebernimmPaket(knex, p), 'uebernommen');
    assert.equal((await knex('live_teilnehmer').where({ turnier_key: 'T4' })).length, 1);
    assert.equal((await knex('live_kampf_positionen').where({ turnier_key: 'T4' })).length, 1);
});

test('ungültiges Paket wirft UNGUELTIG und ändert nichts', async () => {
    const { knex } = db;
    await assert.rejects(() => uebernimmPaket(knex, paket({ turnierKey: 'T5', datum: 'kaputt' })), { code: 'UNGUELTIG' });
    assert.equal(await knex('live_turniere').where({ turnier_key: 'T5' }).first(), undefined);
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag prüfen**

Run: `node --test tests/unit/liveCloudIngest.test.js`
Expected: FAIL mit `Cannot find module '../../src/liveCloud/ingest.js'`.

- [ ] **Step 3: Migration schreiben**

`migrations/20261012110000_live_cloud_lesemodell.js`:

```js
// Teilnehmer-App Phase 2 (docs/specs/2026-10-12-teilnehmer-app-design.md, Abschnitt 6.1): Lesemodell der Cloud.
// Eigene Tabellen, getrennt von den operativen. Sie entstehen in jeder Datenbank (auch am Hallen-Server, dort bleiben sie
// leer), damit es nur eine Migrationsreihe gibt.
export async function up(knex) {
    await knex.schema.createTable('live_turniere', (t) => {
        t.text('turnier_key').primary();
        t.text('name').notNullable().defaultTo('');
        t.string('datum', 10); // YYYY-MM-DD; Grabsteine haben keins
        t.timestamp('stand', { useTz: true }).notNullable();
        t.bigInteger('sequenz').notNullable();
        t.timestamp('empfangen_am', { useTz: true }).notNullable().defaultTo(knex.fn.now());
        t.boolean('zurueckgezogen').notNullable().defaultTo(false);
        t.jsonb('vereine').notNullable().defaultTo('[]');
        t.jsonb('matten').notNullable().defaultTo('[]');
    });

    await knex.schema.createTable('live_teilnehmer', (t) => {
        t.text('turnier_key').notNullable().references('turnier_key').inTable('live_turniere').onDelete('CASCADE');
        t.text('key').notNullable();
        t.text('vorname').notNullable().defaultTo('');
        t.text('nachname').notNullable().defaultTo('');
        t.text('suche').notNullable().defaultTo('');
        t.text('verein_key').notNullable().defaultTo('');
        t.text('verein').notNullable().defaultTo('');
        t.text('altersklasse').notNullable().defaultTo('');
        t.text('gewichtsklasse').notNullable().defaultTo('');
        t.text('geschlecht').notNullable().defaultTo('');
        t.integer('pool_id');
        t.text('pool_bezeichnung').notNullable().defaultTo('');
        t.integer('matte_id');
        t.text('matte_bezeichnung').notNullable().defaultTo('');
        t.text('zustand').notNullable();
        t.integer('abstand');
        t.integer('naechster_kampf_id');
        t.integer('platz');
        t.primary(['turnier_key', 'key']);
        t.index(['turnier_key', 'verein_key']);
        t.index(['turnier_key', 'pool_id']);
    });

    await knex.schema.createTable('live_kampf_positionen', (t) => {
        t.text('turnier_key').notNullable().references('turnier_key').inTable('live_turniere').onDelete('CASCADE');
        t.integer('kampf_id').notNullable();
        t.integer('matte_id');
        t.text('status').notNullable().defaultTo('');
        t.integer('position').notNullable();
        t.text('teilnehmer_key_1');
        t.text('teilnehmer_key_2');
        t.primary(['turnier_key', 'kampf_id']);
    });

    await knex.schema.createTable('live_ingest_tokens', (t) => {
        t.increments('id');
        t.text('name').notNullable().defaultTo('');
        t.text('token_hash').notNullable().unique();
        t.text('turnier_key'); // gesetzt = Token gilt nur für dieses Turnier
        t.timestamp('erzeugt_am', { useTz: true }).notNullable().defaultTo(knex.fn.now());
        t.timestamp('gesperrt_am', { useTz: true });
        t.timestamp('zuletzt_genutzt', { useTz: true });
    });
}

export async function down(knex) {
    await knex.schema.dropTableIfExists('live_ingest_tokens');
    await knex.schema.dropTableIfExists('live_kampf_positionen');
    await knex.schema.dropTableIfExists('live_teilnehmer');
    await knex.schema.dropTableIfExists('live_turniere');
}
```

- [ ] **Step 4: `suchtext.js` schreiben**

`src/liveCloud/suchtext.js`:

```js
// Suchtext der Teilnehmer-App. Alles wird auf [a-z0-9] und Leerzeichen reduziert: damit kann ein Suchbegriff nie
// LIKE-Platzhalter (% _) enthalten, und "Müller" wird sowohl über "mueller" als auch über "muller" gefunden.
const UMLAUTE = [[/ä/g, 'ae'], [/ö/g, 'oe'], [/ü/g, 'ue'], [/ß/g, 'ss']];
const AKZENTE = /[\u0300-\u036f]/g;

export function normalisiereSuche(text) {
    let t = String(text ?? '').toLowerCase().normalize('NFC');
    for (const [muster, ersatz] of UMLAUTE) t = t.replace(muster, ersatz);
    t = t.normalize('NFKD').replace(AKZENTE, '');
    return t.replace(/[^a-z0-9]+/g, ' ').trim();
}

function ohneUmlautAufloesung(text) {
    return String(text ?? '').toLowerCase().replace(/ß/g, 'ss').normalize('NFKD').replace(AKZENTE, '')
        .replace(/[^a-z0-9]+/g, ' ').trim();
}

export function suchtextFuer(vorname, nachname) {
    const roh = `${vorname ?? ''} ${nachname ?? ''}`;
    return `${normalisiereSuche(roh)} ${ohneUmlautAufloesung(roh)}`.trim();
}

export function suchbegriffe(text) {
    const normalisiert = normalisiereSuche(text);
    if (normalisiert.replace(/ /g, '').length < 2) return [];
    return normalisiert.split(' ').filter(Boolean).slice(0, 5).map(b => b.slice(0, 30));
}
```

- [ ] **Step 5: `ingest.js` schreiben**

`src/liveCloud/ingest.js`:

```js
// Nimmt die Pakete des Live-Prozesses (src/live/uplink.js) entgegen und hält je Turnier den aktuellen Stand
// (Spec 6.1: "Ingest ersetzt den Stand des Turniers atomar, ältere Pakete werden verworfen").
import { suchtextFuer } from './suchtext.js';

const MAX_TEILNEHMER = 5000;
const ISO_DATUM = /^\d{4}-\d{2}-\d{2}$/;
const BLOCK = 500;

const text = (wert, max = 120) => (wert == null ? '' : String(wert).slice(0, max));
const ganzzahl = (wert) => (Number.isInteger(wert) ? wert : null);

export function pruefePaket(paket) {
    if (!paket || typeof paket !== 'object' || Array.isArray(paket)) return 'Paket ist kein Objekt';
    if (paket.version !== 1) return 'Version nicht unterstützt';
    if (typeof paket.turnierKey !== 'string' || !paket.turnierKey || paket.turnierKey.length > 64) return 'turnierKey fehlt';
    if (!Number.isFinite(paket.sequenz)) return 'sequenz fehlt';
    if (paket.zurueckgezogen === true) return null;
    if (typeof paket.name !== 'string') return 'name fehlt';
    if (typeof paket.datum !== 'string' || !ISO_DATUM.test(paket.datum)) return 'datum fehlt';
    if (Number.isNaN(Date.parse(paket.stand))) return 'stand fehlt';
    for (const feld of ['vereine', 'matten', 'teilnehmer', 'warteschlangen']) {
        if (!Array.isArray(paket[feld])) return `${feld} fehlt`;
    }
    if (paket.teilnehmer.length > MAX_TEILNEHMER) return 'zu viele Teilnehmer';
    for (const t of paket.teilnehmer) {
        if (!t || typeof t.key !== 'string' || !t.key || typeof t.zustand !== 'string') return 'Teilnehmer ungültig';
    }
    return null;
}

function teilnehmerZeilen(turnierKey, liste) {
    const gesehen = new Set();
    const zeilen = [];
    for (const t of liste) {
        const key = text(t.key, 64);
        if (gesehen.has(key)) continue;
        gesehen.add(key);
        zeilen.push({
            turnier_key: turnierKey, key,
            vorname: text(t.vorname), nachname: text(t.nachname), suche: suchtextFuer(t.vorname, t.nachname),
            verein_key: text(t.vereinKey, 64), verein: text(t.verein, 200),
            altersklasse: text(t.altersklasse, 20), gewichtsklasse: text(t.gewichtsklasse, 20), geschlecht: text(t.geschlecht, 5),
            pool_id: ganzzahl(t.poolId), pool_bezeichnung: text(t.poolBezeichnung, 200),
            matte_id: ganzzahl(t.matteId), matte_bezeichnung: text(t.matteBezeichnung, 100),
            zustand: text(t.zustand, 40), abstand: ganzzahl(t.abstand),
            naechster_kampf_id: ganzzahl(t.naechsterKampfId), platz: ganzzahl(t.platz)
        });
    }
    return zeilen;
}

function positionsZeilen(turnierKey, warteschlangen) {
    const gesehen = new Set();
    const zeilen = [];
    for (const schlange of warteschlangen) {
        for (const k of Array.isArray(schlange?.kaempfe) ? schlange.kaempfe : []) {
            if (!Number.isInteger(k?.id) || gesehen.has(k.id)) continue;
            gesehen.add(k.id);
            const keys = Array.isArray(k.teilnehmerKeys) ? k.teilnehmerKeys : [];
            zeilen.push({
                turnier_key: turnierKey, kampf_id: k.id, matte_id: ganzzahl(schlange.matteId),
                status: text(k.status, 30), position: Number.isInteger(k.position) ? k.position : 0,
                teilnehmer_key_1: keys[0] ? text(keys[0], 64) : null, teilnehmer_key_2: keys[1] ? text(keys[1], 64) : null
            });
        }
    }
    return zeilen;
}

async function fuegeEin(trx, tabelle, zeilen) {
    for (let i = 0; i < zeilen.length; i += BLOCK) await trx(tabelle).insert(zeilen.slice(i, i + BLOCK));
}

export async function uebernimmPaket(knex, paket, { jetzt = () => new Date() } = {}) {
    const fehler = pruefePaket(paket);
    if (fehler) throw Object.assign(new Error(fehler), { code: 'UNGUELTIG' });
    const key = paket.turnierKey;

    return knex.transaction(async (trx) => {
        // Gleichzeitige Pakete desselben Turniers laufen nacheinander (auch das allererste Anlegen).
        await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?))', [`live:${key}`]);
        const bestehend = await trx('live_turniere').where({ turnier_key: key }).first();
        if (bestehend && Number(bestehend.sequenz) >= paket.sequenz) return 'veraltet';

        if (paket.zurueckgezogen === true) {
            if (bestehend) {
                await trx('live_teilnehmer').where({ turnier_key: key }).del();
                await trx('live_kampf_positionen').where({ turnier_key: key }).del();
                await trx('live_turniere').where({ turnier_key: key })
                    .update({ zurueckgezogen: true, sequenz: paket.sequenz, empfangen_am: jetzt() });
            } else {
                await trx('live_turniere').insert({
                    turnier_key: key, name: '', datum: null, stand: jetzt(), sequenz: paket.sequenz,
                    empfangen_am: jetzt(), zurueckgezogen: true
                });
            }
            return 'zurueckgezogen';
        }

        const kopf = {
            name: text(paket.name, 200), datum: paket.datum, stand: new Date(paket.stand), sequenz: paket.sequenz,
            empfangen_am: jetzt(), zurueckgezogen: false,
            vereine: JSON.stringify(paket.vereine.map(v => ({ key: text(v?.key, 64), name: text(v?.name, 200) }))),
            matten: JSON.stringify(paket.matten.map(m => ({ id: ganzzahl(m?.id), bezeichnung: text(m?.bezeichnung, 100) })))
        };
        if (bestehend) {
            await trx('live_turniere').where({ turnier_key: key }).update(kopf);
            await trx('live_teilnehmer').where({ turnier_key: key }).del();
            await trx('live_kampf_positionen').where({ turnier_key: key }).del();
        } else {
            await trx('live_turniere').insert({ turnier_key: key, ...kopf });
        }
        await fuegeEin(trx, 'live_teilnehmer', teilnehmerZeilen(key, paket.teilnehmer));
        await fuegeEin(trx, 'live_kampf_positionen', positionsZeilen(key, paket.warteschlangen));
        return 'uebernommen';
    });
}
```

- [ ] **Step 6: Tests laufen lassen**

Run: `node --test tests/unit/liveCloudIngest.test.js`
Expected: PASS, 7 Tests.

- [ ] **Step 7: Commit**

```bash
git add migrations/20261012110000_live_cloud_lesemodell.js src/liveCloud/suchtext.js src/liveCloud/ingest.js tests/unit/liveCloudIngest.test.js
git commit -m "feat: Cloud-Lesemodell und Ingest für die Teilnehmer-App (Phase 2)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Ingest-Token

**Files:**
- Create: `src/liveCloud/token.js`
- Create: `scripts/live-token.mjs`
- Test: `tests/unit/liveCloudToken.test.js`

**Interfaces:**
- Consumes: Tabelle `live_ingest_tokens` aus Task 1.
- Produces: `erzeugeToken(knex, { name, turnierKey? }): Promise<{ id, token }>`, `pruefeToken(knex, token, { jetzt? }): Promise<{ id, turnierKey } | null>`, `sperreToken(knex, id): Promise<boolean>`, `listeTokens(knex): Promise<Array<{ id, name, turnierKey, erzeugtAm, gesperrtAm, zuletztGenutzt }>>`, `fuehreTokenBefehlAus(knex, argv: string[]): Promise<string[]>` (Ausgabezeilen; wirft `Error` bei unbekanntem Befehl)

- [ ] **Step 1: Failing test schreiben**

`tests/unit/liveCloudToken.test.js`:

```js
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { starteTestPostgres } from '../helpers/testPostgres.js';
import { erzeugeToken, pruefeToken, sperreToken, listeTokens, fuehreTokenBefehlAus } from '../../src/liveCloud/token.js';

let db;
before(async () => { db = await starteTestPostgres(); });
after(async () => { if (db) await db.stoppe(); });

test('Token: erzeugen, prüfen, nur der Hash liegt in der Datenbank', async () => {
    const { knex } = db;
    const { id, token } = await erzeugeToken(knex, { name: 'Slave Halle 1' });
    assert.match(token, /^hjl_[0-9a-f]{64}$/);
    const zeile = await knex('live_ingest_tokens').where({ id }).first();
    assert.notEqual(zeile.token_hash, token);
    assert.equal(zeile.token_hash.length, 64);
    assert.deepEqual(await pruefeToken(knex, token), { id, turnierKey: null });
    assert.equal(await pruefeToken(knex, 'hjl_falsch'), null);
    assert.equal(await pruefeToken(knex, undefined), null);
});

test('Token: Sperren wirkt sofort, Bindung an ein Turnier wird geliefert', async () => {
    const { knex } = db;
    const { id, token } = await erzeugeToken(knex, { name: 'gebunden', turnierKey: '77' });
    assert.deepEqual(await pruefeToken(knex, token), { id, turnierKey: '77' });
    assert.equal(await sperreToken(knex, id), true);
    assert.equal(await pruefeToken(knex, token), null);
    assert.equal(await sperreToken(knex, 99999), false);
});

test('Token: zuletzt_genutzt wird höchstens einmal je Minute geschrieben', async () => {
    const { knex } = db;
    const { id, token } = await erzeugeToken(knex, { name: 'zeit' });
    const t0 = new Date('2026-10-12T10:00:00Z');
    await pruefeToken(knex, token, { jetzt: () => t0 });
    await pruefeToken(knex, token, { jetzt: () => new Date(t0.getTime() + 20_000) });
    assert.equal(new Date((await knex('live_ingest_tokens').where({ id }).first()).zuletzt_genutzt).getTime(), t0.getTime());
    await pruefeToken(knex, token, { jetzt: () => new Date(t0.getTime() + 90_000) });
    assert.equal(new Date((await knex('live_ingest_tokens').where({ id }).first()).zuletzt_genutzt).getTime(), t0.getTime() + 90_000);
});

test('Befehle des Skripts: erzeugen, liste, sperren', async () => {
    const { knex } = db;
    const ausgabe = await fuehreTokenBefehlAus(knex, ['erzeugen', '--name', 'Befehl']);
    assert.match(ausgabe.join('\n'), /hjl_[0-9a-f]{64}/);
    const liste = await fuehreTokenBefehlAus(knex, ['liste']);
    assert.match(liste.join('\n'), /Befehl/);
    const eintraege = await listeTokens(knex);
    const id = eintraege.find(e => e.name === 'Befehl').id;
    assert.match((await fuehreTokenBefehlAus(knex, ['sperren', String(id)])).join('\n'), /gesperrt/);
    await assert.rejects(() => fuehreTokenBefehlAus(knex, ['unbekannt']), /Befehl/);
});
```

- [ ] **Step 2: Fehlschlag prüfen**

Run: `node --test tests/unit/liveCloudToken.test.js`
Expected: FAIL mit `Cannot find module '../../src/liveCloud/token.js'`.

- [ ] **Step 3: `token.js` schreiben**

`src/liveCloud/token.js`:

```js
// Ingest-Token des Live-Prozesses (Spec 5.3: in der Cloud sperrbar, optional an ein Turnier gebunden).
// Gespeichert wird nur der SHA-256; das Token selbst wird einmalig beim Erzeugen angezeigt.
import crypto from 'node:crypto';

const hash = (token) => crypto.createHash('sha256').update(token).digest('hex');

export async function erzeugeToken(knex, { name, turnierKey = null }) {
    const token = `hjl_${crypto.randomBytes(32).toString('hex')}`;
    const [{ id }] = await knex('live_ingest_tokens')
        .insert({ name: String(name || ''), token_hash: hash(token), turnier_key: turnierKey })
        .returning('id');
    return { id, token };
}

export async function pruefeToken(knex, token, { jetzt = () => new Date() } = {}) {
    if (typeof token !== 'string' || token.length < 10 || token.length > 200) return null;
    const zeile = await knex('live_ingest_tokens').where({ token_hash: hash(token) }).whereNull('gesperrt_am').first();
    if (!zeile) return null;
    const jetztZeit = jetzt();
    const grenze = new Date(jetztZeit.getTime() - 60_000);
    await knex('live_ingest_tokens').where({ id: zeile.id })
        .where(function () { this.whereNull('zuletzt_genutzt').orWhere('zuletzt_genutzt', '<', grenze); })
        .update({ zuletzt_genutzt: jetztZeit });
    return { id: zeile.id, turnierKey: zeile.turnier_key };
}

export async function sperreToken(knex, id) {
    const geaendert = await knex('live_ingest_tokens').where({ id }).whereNull('gesperrt_am').update({ gesperrt_am: knex.fn.now() });
    return geaendert > 0;
}

export async function listeTokens(knex) {
    const zeilen = await knex('live_ingest_tokens').orderBy('id');
    return zeilen.map(z => ({
        id: z.id, name: z.name, turnierKey: z.turnier_key,
        erzeugtAm: z.erzeugt_am, gesperrtAm: z.gesperrt_am, zuletztGenutzt: z.zuletzt_genutzt
    }));
}

function option(argv, name) {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
}

export async function fuehreTokenBefehlAus(knex, argv) {
    const [befehl, ...rest] = argv;
    if (befehl === 'erzeugen') {
        const { id, token } = await erzeugeToken(knex, { name: option(rest, '--name'), turnierKey: option(rest, '--turnier') || null });
        return [`Token ${id} erzeugt (wird nur jetzt angezeigt):`, token];
    }
    if (befehl === 'liste') {
        const eintraege = await listeTokens(knex);
        if (!eintraege.length) return ['Keine Token vorhanden.'];
        return eintraege.map(e => `${e.id}\t${e.name}\t${e.turnierKey || 'alle Turniere'}\t${e.gesperrtAm ? 'gesperrt' : 'aktiv'}`);
    }
    if (befehl === 'sperren') {
        const id = Number(rest[0]);
        if (!Number.isInteger(id)) throw new Error('Befehl "sperren" braucht die Token-ID.');
        return [(await sperreToken(knex, id)) ? `Token ${id} gesperrt.` : `Token ${id} nicht gefunden oder schon gesperrt.`];
    }
    throw new Error('Unbekannter Befehl. Verwendung: erzeugen [--name X] [--turnier KEY] | liste | sperren ID');
}
```

- [ ] **Step 4: Skript schreiben**

`scripts/live-token.mjs`:

```js
// Verwaltet die Ingest-Token der Cloud: node scripts/live-token.mjs erzeugen --name "Halle" [--turnier KEY] | liste | sperren ID
// Verbindet sich mit der Datenbank der Cloud (DB_URL bzw. DB_HOST/DB_USER/DB_PASSWORD/DB_NAME aus .env).
import dotenv from 'dotenv';
import knexLib from 'knex';
import dbVerbindung from '../src/config/dbVerbindung.cjs';
import { fuehreTokenBefehlAus } from '../src/liveCloud/token.js';

dotenv.config({ quiet: true });
const knex = knexLib({ client: 'pg', connection: dbVerbindung.baueVerbindung(process.env, { migration: false }), pool: { min: 0, max: 1 } });
try {
    for (const zeile of await fuehreTokenBefehlAus(knex, process.argv.slice(2))) console.log(zeile);
} catch (fehler) {
    console.error(fehler.message);
    process.exitCode = 1;
} finally {
    await knex.destroy();
}
```

- [ ] **Step 5: Tests laufen lassen**

Run: `node --test tests/unit/liveCloudToken.test.js`
Expected: PASS, 4 Tests.

- [ ] **Step 6: Commit**

```bash
git add src/liveCloud/token.js scripts/live-token.mjs tests/unit/liveCloudToken.test.js
git commit -m "feat: Ingest-Token der Cloud (erzeugen, prüfen, sperren) mit Verwaltungsskript" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Abfragen der App-API

**Files:**
- Create: `src/liveCloud/abfrage.js`
- Test: `tests/unit/liveCloudAbfrage.test.js`

**Interfaces:**
- Consumes: `uebernimmPaket` (Task 1) zum Befüllen im Test; `suchbegriffe` aus `suchtext.js`.
- Produces (alle `async`, `knex` zuerst):
  - `listeTurniere(knex, { jetzt? }): Promise<Array<{ key, name, datum, stand, empfangenAm }>>` – ohne zurückgezogene; heutiges (Europe/Berlin) zuerst, dann Datum absteigend
  - `ladeTurnier(knex, turnierKey): Promise<{ key, name, datum, stand, empfangenAm, matten, vereine: Array<{ key, name, anzahl }> } | null>`
  - `suche(knex, turnierKey, text): Promise<TeilnehmerDto[]>` – höchstens 20
  - `ladePool(knex, turnierKey, poolId): Promise<{ pool: { id, bezeichnung, matteBezeichnung }, teilnehmer: TeilnehmerDto[] } | null>`
  - `ladeVerein(knex, turnierKey, vereinKey): Promise<TeilnehmerDto[]>`
  - `uebersicht(knex, turnierKey, { teilnehmer, vereine }): Promise<TeilnehmerDto[]>`
  - `TeilnehmerDto = { key, vorname, nachname, verein, vereinKey, altersklasse, gewichtsklasse, geschlecht, poolId, poolBezeichnung, matteId, matteBezeichnung, zustand, abstand, platz }`
  - Konstanten `MAX_TREFFER = 20`, `MAX_SCHLUESSEL = 200`

- [ ] **Step 1: Failing test schreiben**

`tests/unit/liveCloudAbfrage.test.js`:

```js
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { starteTestPostgres } from '../helpers/testPostgres.js';
import { uebernimmPaket } from '../../src/liveCloud/ingest.js';
import { listeTurniere, ladeTurnier, suche, ladePool, ladeVerein, uebersicht, MAX_SCHLUESSEL } from '../../src/liveCloud/abfrage.js';

const t = (key, vorname, nachname, extra = {}) => ({
    key, vorname, nachname, vereinKey: 'v1', verein: 'JC Muster', altersklasse: 'U15', gewichtsklasse: '-44', geschlecht: 'w',
    poolId: 10, poolBezeichnung: 'U15 w -44', matteId: 1, matteBezeichnung: 'Matte 1', zustand: 'in_n', abstand: 3,
    naechsterKampfId: 5, platz: null, ...extra
});
const paket = (turnierKey, datum, teilnehmer, extra = {}) => ({
    version: 1, turnierKey, name: `Turnier ${turnierKey}`, datum, stand: '2026-10-12T10:00:00.000Z', sequenz: 1000,
    vereine: [{ key: 'v1', name: 'JC Muster' }, { key: 'v2', name: 'TV Beispiel' }], matten: [{ id: 1, bezeichnung: 'Matte 1' }],
    teilnehmer, warteschlangen: [], ...extra
});

let db;
before(async () => {
    db = await starteTestPostgres();
    await uebernimmPaket(db.knex, paket('A', '2026-10-12', [
        t('a1', 'Anna', 'Muster'),
        t('a2', 'Max', 'Müller', { poolId: 11, poolBezeichnung: 'U15 m -50', geschlecht: 'm', gewichtsklasse: '-50', zustand: 'laeuft', abstand: null }),
        t('a3', 'Lena', 'Beispiel', { vereinKey: 'v2', verein: 'TV Beispiel', poolId: null, poolBezeichnung: '', matteId: null, matteBezeichnung: '', zustand: 'nicht_ausgelost', abstand: null }),
        t('a4', 'Tom', 'Abschluss', { poolId: 11, poolBezeichnung: 'U15 m -50', zustand: 'abgeschlossen', abstand: null, platz: 2 })
    ]));
    await uebernimmPaket(db.knex, paket('B', '2026-10-05', [t('b1', 'Alt', 'Turnier')]));
    await uebernimmPaket(db.knex, paket('C', '2026-10-12', [t('c1', 'Weg', 'Genommen')]));
    await uebernimmPaket(db.knex, { version: 1, turnierKey: 'C', zurueckgezogen: true, stand: '2026-10-12T12:00:00.000Z', sequenz: 2000 });
});
after(async () => { if (db) await db.stoppe(); });

test('listeTurniere: heutiges zuerst, zurückgezogene fehlen', async () => {
    const liste = await listeTurniere(db.knex, { jetzt: () => new Date('2026-10-12T09:00:00Z') });
    assert.deepEqual(liste.map(x => x.key), ['A', 'B']);
    const spaeter = await listeTurniere(db.knex, { jetzt: () => new Date('2026-10-05T09:00:00Z') });
    assert.deepEqual(spaeter.map(x => x.key), ['B', 'A']);
    assert.equal(liste[0].name, 'Turnier A');
});

test('ladeTurnier: Vereine mit Anzahl, unbekannte und zurückgezogene Turniere sind null', async () => {
    const turnier = await ladeTurnier(db.knex, 'A');
    assert.equal(turnier.name, 'Turnier A');
    assert.deepEqual(turnier.vereine, [{ key: 'v1', name: 'JC Muster', anzahl: 3 }, { key: 'v2', name: 'TV Beispiel', anzahl: 1 }]);
    assert.equal(await ladeTurnier(db.knex, 'gibtsnicht'), null);
    assert.equal(await ladeTurnier(db.knex, 'C'), null);
});

test('suche: Teiltreffer, Umlaute, mehrere Begriffe, Obergrenze', async () => {
    assert.deepEqual((await suche(db.knex, 'A', 'mus')).map(x => x.key), ['a1']);
    assert.deepEqual((await suche(db.knex, 'A', 'mueller')).map(x => x.key), ['a2']);
    assert.deepEqual((await suche(db.knex, 'A', 'muller')).map(x => x.key), ['a2']);
    assert.deepEqual((await suche(db.knex, 'A', 'anna mus')).map(x => x.key), ['a1']);
    assert.deepEqual((await suche(db.knex, 'A', 'max anna')).map(x => x.key), []);
});

test('suche: Platzhalter, ein Zeichen und leerer Text liefern nie die Liste', async () => {
    for (const eingabe of ['%', '_', '%%', 'a', '', '   ', "' OR 1=1 --"]) {
        assert.deepEqual(await suche(db.knex, 'A', eingabe), [], `Eingabe ${JSON.stringify(eingabe)}`);
    }
});

test('suche: DTO enthält Pool, Matte, Zustand, aber keine Interna', async () => {
    const [treffer] = await suche(db.knex, 'A', 'anna');
    assert.deepEqual(treffer, {
        key: 'a1', vorname: 'Anna', nachname: 'Muster', verein: 'JC Muster', vereinKey: 'v1', altersklasse: 'U15',
        gewichtsklasse: '-44', geschlecht: 'w', poolId: 10, poolBezeichnung: 'U15 w -44', matteId: 1, matteBezeichnung: 'Matte 1',
        zustand: 'in_n', abstand: 3, platz: null
    });
});

test('ladePool und ladeVerein', async () => {
    const pool = await ladePool(db.knex, 'A', 11);
    assert.equal(pool.pool.bezeichnung, 'U15 m -50');
    assert.deepEqual(pool.teilnehmer.map(x => x.key), ['a4', 'a2']);
    assert.equal(await ladePool(db.knex, 'A', 999), null);
    assert.deepEqual((await ladeVerein(db.knex, 'A', 'v2')).map(x => x.key), ['a3']);
    assert.deepEqual(await ladeVerein(db.knex, 'A', 'gibtsnicht'), []);
});

test('uebersicht: Teilnehmer und Vereinsregel, Dubletten, unbekannte Schlüssel, leer', async () => {
    const r = await uebersicht(db.knex, 'A', { teilnehmer: ['a2', 'a2', 'unbekannt'], vereine: ['v2'] });
    assert.deepEqual(r.map(x => x.key).sort(), ['a2', 'a3']);
    assert.deepEqual(await uebersicht(db.knex, 'A', { teilnehmer: [], vereine: [] }), []);
    assert.deepEqual(await uebersicht(db.knex, 'A', {}), []);
    assert.deepEqual(await uebersicht(db.knex, 'A', { teilnehmer: 'a1', vereine: 7 }), []);
    assert.deepEqual(await uebersicht(db.knex, 'A', { teilnehmer: [1, null, {}] }), []);
    assert.deepEqual(await uebersicht(db.knex, 'C', { teilnehmer: ['c1'] }), []);
});

test('uebersicht: mehr als MAX_SCHLUESSEL Schlüssel werden abgeschnitten, nicht abgelehnt', async () => {
    const viele = Array.from({ length: MAX_SCHLUESSEL + 50 }, (_, i) => `k${i}`);
    viele[0] = 'a1';
    const r = await uebersicht(db.knex, 'A', { teilnehmer: viele });
    assert.deepEqual(r.map(x => x.key), ['a1']);
});
```

- [ ] **Step 2: Fehlschlag prüfen**

Run: `node --test tests/unit/liveCloudAbfrage.test.js`
Expected: FAIL mit `Cannot find module '../../src/liveCloud/abfrage.js'`.

- [ ] **Step 3: `abfrage.js` schreiben**

`src/liveCloud/abfrage.js`:

```js
// Lesende Abfragen der öffentlichen App-API (Spec 6.1). Alle Antworten sind auf die Felder der Kachel beschränkt;
// Aufzählungen ohne Suchbegriff gibt es nur je Pool oder je Verein.
import { suchbegriffe } from './suchtext.js';

export const MAX_TREFFER = 20;
export const MAX_SCHLUESSEL = 200;
const MAX_UEBERSICHT_ZEILEN = 1000;

export function teilnehmerDto(z) {
    return {
        key: z.key, vorname: z.vorname, nachname: z.nachname, verein: z.verein, vereinKey: z.verein_key,
        altersklasse: z.altersklasse, gewichtsklasse: z.gewichtsklasse, geschlecht: z.geschlecht,
        poolId: z.pool_id, poolBezeichnung: z.pool_bezeichnung, matteId: z.matte_id, matteBezeichnung: z.matte_bezeichnung,
        zustand: z.zustand, abstand: z.abstand, platz: z.platz
    };
}

function berlinDatum(datum) {
    return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(datum);
}

function sortiert(abfrage) {
    return abfrage.orderBy([{ column: 'nachname' }, { column: 'vorname' }, { column: 'key' }]);
}

const schluesselliste = (wert) => (Array.isArray(wert)
    ? [...new Set(wert.filter(k => typeof k === 'string' && k.length > 0 && k.length <= 64))].slice(0, MAX_SCHLUESSEL)
    : []);

export async function listeTurniere(knex, { jetzt = () => new Date() } = {}) {
    const heute = berlinDatum(jetzt());
    const zeilen = await knex('live_turniere').where({ zurueckgezogen: false })
        .select('turnier_key', 'name', 'datum', 'stand', 'empfangen_am');
    return zeilen
        .map(z => ({ key: z.turnier_key, name: z.name, datum: z.datum, stand: z.stand, empfangenAm: z.empfangen_am }))
        .sort((a, b) => {
            const ah = a.datum === heute ? 0 : 1;
            const bh = b.datum === heute ? 0 : 1;
            if (ah !== bh) return ah - bh;
            return String(b.datum).localeCompare(String(a.datum)) || a.name.localeCompare(b.name);
        });
}

export async function ladeTurnier(knex, turnierKey) {
    const kopf = await knex('live_turniere').where({ turnier_key: turnierKey, zurueckgezogen: false }).first();
    if (!kopf) return null;
    const zaehler = await knex('live_teilnehmer').where({ turnier_key: turnierKey })
        .select('verein_key').count('* as anzahl').groupBy('verein_key');
    const anzahl = new Map(zaehler.map(z => [z.verein_key, Number(z.anzahl)]));
    const vereine = (Array.isArray(kopf.vereine) ? kopf.vereine : [])
        .map(v => ({ key: v.key, name: v.name, anzahl: anzahl.get(v.key) || 0 }))
        .filter(v => v.anzahl > 0)
        .sort((a, b) => a.name.localeCompare(b.name));
    return {
        key: kopf.turnier_key, name: kopf.name, datum: kopf.datum, stand: kopf.stand, empfangenAm: kopf.empfangen_am,
        matten: Array.isArray(kopf.matten) ? kopf.matten : [], vereine
    };
}

export async function suche(knex, turnierKey, text) {
    const begriffe = suchbegriffe(text);
    if (!begriffe.length) return [];
    const abfrage = knex('live_teilnehmer').where({ turnier_key: turnierKey });
    for (const begriff of begriffe) abfrage.where('suche', 'like', `%${begriff}%`);
    const zeilen = await sortiert(abfrage).limit(MAX_TREFFER);
    return zeilen.map(teilnehmerDto);
}

export async function ladePool(knex, turnierKey, poolId) {
    const zeilen = await sortiert(knex('live_teilnehmer').where({ turnier_key: turnierKey, pool_id: poolId }));
    if (!zeilen.length) return null;
    return {
        pool: { id: poolId, bezeichnung: zeilen[0].pool_bezeichnung, matteBezeichnung: zeilen[0].matte_bezeichnung },
        teilnehmer: zeilen.map(teilnehmerDto)
    };
}

export async function ladeVerein(knex, turnierKey, vereinKey) {
    const zeilen = await sortiert(knex('live_teilnehmer').where({ turnier_key: turnierKey, verein_key: vereinKey }));
    return zeilen.map(teilnehmerDto);
}

export async function uebersicht(knex, turnierKey, { teilnehmer, vereine } = {}) {
    const keys = schluesselliste(teilnehmer);
    const vereinKeys = schluesselliste(vereine);
    if (!keys.length && !vereinKeys.length) return [];
    const abfrage = knex('live_teilnehmer').where({ turnier_key: turnierKey }).where(function () {
        if (keys.length) this.whereIn('key', keys);
        if (vereinKeys.length) this.orWhereIn('verein_key', vereinKeys);
    });
    const zeilen = await sortiert(abfrage).limit(MAX_UEBERSICHT_ZEILEN);
    return zeilen.map(teilnehmerDto);
}
```

- [ ] **Step 4: Tests laufen lassen**

Run: `node --test tests/unit/liveCloudAbfrage.test.js`
Expected: PASS, 8 Tests. Schlägt `listeTurniere` wegen der Sortierung fehl, ist die Reihenfolge `['A','B']` (heute zuerst) bzw. `['B','A']` am 05.10. das Soll.

- [ ] **Step 5: Commit**

```bash
git add src/liveCloud/abfrage.js tests/unit/liveCloudAbfrage.test.js
git commit -m "feat: Abfragen der Teilnehmer-App-API (Turniere, Suche, Pool, Verein, Übersicht)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Ratenbegrenzung

**Files:**
- Create: `src/liveCloud/ratenbegrenzung.js`
- Test: `tests/unit/liveCloudRatenbegrenzung.test.js`

**Interfaces:**
- Produces: `erzeugeRatenbegrenzung({ fensterMs?: 60000, max?: 300, jetzt? }): { erlaube(schluessel: string): boolean }`, `clientIp(req, env?): string`

- [ ] **Step 1: Failing test schreiben**

`tests/unit/liveCloudRatenbegrenzung.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { erzeugeRatenbegrenzung, clientIp } from '../../src/liveCloud/ratenbegrenzung.js';

test('Festfenster: bis max erlaubt, danach gesperrt, im neuen Fenster wieder erlaubt', () => {
    let jetzt = 0;
    const b = erzeugeRatenbegrenzung({ fensterMs: 1000, max: 3, jetzt: () => jetzt });
    assert.deepEqual([1, 2, 3, 4].map(() => b.erlaube('ip1')), [true, true, true, false]);
    assert.equal(b.erlaube('ip2'), true);
    jetzt = 1000;
    assert.equal(b.erlaube('ip1'), true);
});

test('clientIp: X-Forwarded-For nur mit LIVE_PROXY_VERTRAUEN=true', () => {
    const req = { headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }, socket: { remoteAddress: '10.0.0.1' } };
    assert.equal(clientIp(req, {}), '10.0.0.1');
    assert.equal(clientIp(req, { LIVE_PROXY_VERTRAUEN: 'true' }), '203.0.113.7');
    assert.equal(clientIp({ headers: {}, socket: {} }, {}), 'unbekannt');
});

test('der Speicher wächst nicht unbegrenzt: abgelaufene Einträge werden entfernt', () => {
    let jetzt = 0;
    const b = erzeugeRatenbegrenzung({ fensterMs: 1000, max: 5, jetzt: () => jetzt, maxEintraege: 10 });
    for (let i = 0; i < 10; i++) b.erlaube(`ip${i}`);
    jetzt = 5000;
    b.erlaube('neu');
    assert.equal(b.groesse(), 1);
});
```

- [ ] **Step 2: Fehlschlag prüfen**

Run: `node --test tests/unit/liveCloudRatenbegrenzung.test.js`
Expected: FAIL mit `Cannot find module`.

- [ ] **Step 3: Implementieren**

`src/liveCloud/ratenbegrenzung.js`:

```js
// Einfache Ratenbegrenzung je Absender (Festfenster, im Speicher). Eine Cloud-Instanz reicht für den Zweck; hinter
// mehreren Instanzen würde jede für sich zählen.
export function erzeugeRatenbegrenzung({ fensterMs = 60_000, max = 300, jetzt = Date.now, maxEintraege = 10_000 } = {}) {
    const eintraege = new Map();

    function bereinige(zeit) {
        for (const [schluessel, e] of eintraege) {
            if (zeit - e.start >= fensterMs) eintraege.delete(schluessel);
        }
    }

    return {
        erlaube(schluessel) {
            const zeit = jetzt();
            let e = eintraege.get(schluessel);
            if (!e || zeit - e.start >= fensterMs) {
                if (eintraege.size >= maxEintraege) bereinige(zeit);
                e = { start: zeit, anzahl: 0 };
                eintraege.set(schluessel, e);
            }
            e.anzahl += 1;
            return e.anzahl <= max;
        },
        groesse: () => eintraege.size
    };
}

export function clientIp(req, env = process.env) {
    if (env.LIVE_PROXY_VERTRAUEN === 'true') {
        const weitergeleitet = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
        if (weitergeleitet) return weitergeleitet;
    }
    return req.socket?.remoteAddress || 'unbekannt';
}
```

- [ ] **Step 4: Tests laufen lassen**

Run: `node --test tests/unit/liveCloudRatenbegrenzung.test.js`
Expected: PASS, 3 Tests.

- [ ] **Step 5: Commit**

```bash
git add src/liveCloud/ratenbegrenzung.js tests/unit/liveCloudRatenbegrenzung.test.js
git commit -m "feat: Ratenbegrenzung der Teilnehmer-App-API" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Routen, Aufbewahrung und Einbindung in die App

**Files:**
- Create: `src/liveCloud/aufbewahrung.js`
- Create: `src/routes/liveRoutes.js`
- Modify: `src/app.js` (Import oben bei den Routen, Einbindung im Nicht-Client-Zweig nach `app.use('/api/urkunden', …)`)
- Test: `tests/unit/liveCloudRoutes.test.js`

**Interfaces:**
- Consumes: `uebernimmPaket` (T1), `pruefeToken`/`erzeugeToken` (T2), alle Abfragen (T3), `erzeugeRatenbegrenzung`/`clientIp` (T4).
- Produces:
  - `getLiveRoutes(knex, { begrenzung?, fehlerBegrenzung?, jetzt?, env? }): express.Router` mit
    `POST /ingest`, `GET /turniere`, `GET /turniere/:key`, `GET /turniere/:key/suche?q=`, `GET /turniere/:key/pools/:poolId`, `GET /turniere/:key/vereine/:vereinKey`, `POST /turniere/:key/uebersicht` (Body `{ teilnehmer: string[], vereine: string[] }`)
  - Antwortformen: `GET /turniere` → `{ serverzeit, turniere }`; `GET /turniere/:key` → Turnier-Objekt aus `ladeTurnier` plus `serverzeit`; `suche` → `{ treffer }`; `pools` → `{ pool, teilnehmer }`; `vereine` → `{ teilnehmer }`; `uebersicht` → `{ serverzeit, stand, empfangenAm, teilnehmer }`
  - `loescheAlteLiveDaten(knex, { tage?: 7, jetzt? }): Promise<number>`, `starteAufbewahrung(knex, { tage?, intervallMs?, log? }): { stoppe(): void }`

- [ ] **Step 1: Failing test schreiben**

`tests/unit/liveCloudRoutes.test.js`:

```js
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import zlib from 'node:zlib';
import express from 'express';
import { starteTestPostgres } from '../helpers/testPostgres.js';
import { getLiveRoutes } from '../../src/routes/liveRoutes.js';
import { loescheAlteLiveDaten } from '../../src/liveCloud/aufbewahrung.js';
import { erzeugeToken } from '../../src/liveCloud/token.js';
import { erzeugeRatenbegrenzung } from '../../src/liveCloud/ratenbegrenzung.js';
import { uebernimmPaket } from '../../src/liveCloud/ingest.js';

const t = (key, vorname, nachname, extra = {}) => ({
    key, vorname, nachname, vereinKey: 'v1', verein: 'JC Muster', altersklasse: 'U15', gewichtsklasse: '-44', geschlecht: 'w',
    poolId: 10, poolBezeichnung: 'U15 w -44', matteId: 1, matteBezeichnung: 'Matte 1', zustand: 'in_n', abstand: 3,
    naechsterKampfId: 5, platz: null, ...extra
});
const paket = (turnierKey, extra = {}) => ({
    version: 1, turnierKey, name: `Turnier ${turnierKey}`, datum: '2026-10-12', stand: '2026-10-12T10:00:00.000Z', sequenz: 1000,
    vereine: [{ key: 'v1', name: 'JC Muster' }], matten: [{ id: 1, bezeichnung: 'Matte 1' }],
    teilnehmer: [t('a1', 'Anna', 'Muster'), t('a2', 'Max', 'Müller')], warteschlangen: [], ...extra
});

let db, server, basis, token, gebundenerToken;
const sende = (pfad, { methode = 'GET', header = {}, body, gzip = false } = {}) => {
    const daten = body === undefined ? undefined : (gzip ? zlib.gzipSync(JSON.stringify(body)) : JSON.stringify(body));
    return fetch(`${basis}${pfad}`, {
        method: methode, body: daten,
        headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(gzip ? { 'Content-Encoding': 'gzip' } : {}), ...header }
    });
};
const mitToken = (extra = {}) => ({ header: { Authorization: `Bearer ${token}` }, ...extra });

before(async () => {
    db = await starteTestPostgres();
    ({ token } = await erzeugeToken(db.knex, { name: 'test' }));
    ({ token: gebundenerToken } = await erzeugeToken(db.knex, { name: 'gebunden', turnierKey: 'GEBUNDEN' }));
    const app = express();
    app.use(express.json({ limit: '5mb' }));
    app.use('/api/live', getLiveRoutes(db.knex, {
        begrenzung: erzeugeRatenbegrenzung({ max: 40 }), fehlerBegrenzung: erzeugeRatenbegrenzung({ max: 3 }),
        jetzt: () => new Date('2026-10-12T10:01:00Z'), env: {}
    }));
    app.use((fehler, req, res, next) => res.status(fehler.status || 500).json({ error: fehler.message }));
    server = http.createServer(app);
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    basis = `http://127.0.0.1:${server.address().port}/api/live`;
});
after(async () => {
    if (server) await new Promise(r => server.close(r));
    if (db) await db.stoppe();
});

test('Ingest: ohne und mit falschem Token 401, mit Token 204 (auch gzip), Daten sind danach abrufbar', async () => {
    assert.equal((await sende('/ingest', { methode: 'POST', body: paket('R1') })).status, 401);
    assert.equal((await sende('/ingest', { methode: 'POST', body: paket('R1'), header: { Authorization: 'Bearer hjl_falsch' } })).status, 401);
    const r = await sende('/ingest', { methode: 'POST', body: paket('R1'), ...mitToken({ gzip: true }) });
    assert.equal(r.status, 204);
    assert.equal(await r.text(), '');
    const liste = await (await sende('/turniere')).json();
    assert.ok(liste.turniere.some(x => x.key === 'R1'));
    assert.equal(liste.serverzeit, '2026-10-12T10:01:00.000Z');
});

test('Ingest: ungültiges Paket 400, veraltetes Paket 204 ohne Änderung, gebundenes Token nur für sein Turnier', async () => {
    assert.equal((await sende('/ingest', { methode: 'POST', body: { version: 1 }, ...mitToken() })).status, 400);
    await sende('/ingest', { methode: 'POST', body: paket('R2', { sequenz: 500, name: 'Neu' }), ...mitToken() });
    const alt = await sende('/ingest', { methode: 'POST', body: paket('R2', { sequenz: 100, name: 'Alt' }), ...mitToken() });
    assert.equal(alt.status, 204);
    assert.equal((await (await sende('/turniere/R2')).json()).name, 'Neu');

    const fremd = await sende('/ingest', { methode: 'POST', body: paket('R3'), header: { Authorization: `Bearer ${gebundenerToken}` } });
    assert.equal(fremd.status, 403);
    const eigen = await sende('/ingest', { methode: 'POST', body: paket('GEBUNDEN'), header: { Authorization: `Bearer ${gebundenerToken}` } });
    assert.equal(eigen.status, 204);
});

test('Ingest: wiederholt falsche Token werden begrenzt (429), das gültige Token bleibt nutzbar', async () => {
    const falsch = { methode: 'POST', body: paket('R4'), header: { Authorization: 'Bearer hjl_nochfalsch' } };
    const stati = [];
    for (let i = 0; i < 5; i++) stati.push((await sende('/ingest', falsch)).status);
    assert.ok(stati.includes(429), `Stati ${stati}`);
    assert.equal((await sende('/ingest', { methode: 'POST', body: paket('R4'), ...mitToken() })).status, 204);
});

test('Rücknahme über den Ingest: Turnier verschwindet aus der Liste', async () => {
    await sende('/ingest', { methode: 'POST', body: paket('R5', { sequenz: 10 }), ...mitToken() });
    const rueck = { version: 1, turnierKey: 'R5', zurueckgezogen: true, stand: '2026-10-12T10:00:00.000Z', sequenz: 20 };
    assert.equal((await sende('/ingest', { methode: 'POST', body: rueck, ...mitToken() })).status, 204);
    assert.equal((await sende('/turniere/R5')).status, 404);
    assert.ok(!(await (await sende('/turniere')).json()).turniere.some(x => x.key === 'R5'));
});

test('App-API: Turnier, Suche, Pool, Verein', async () => {
    const turnier = await (await sende('/turniere/R1')).json();
    assert.equal(turnier.name, 'Turnier R1');
    assert.deepEqual(turnier.vereine, [{ key: 'v1', name: 'JC Muster', anzahl: 2 }]);
    assert.ok(turnier.serverzeit);

    assert.deepEqual((await (await sende('/turniere/R1/suche?q=mus')).json()).treffer.map(x => x.key), ['a1']);
    assert.deepEqual((await (await sende('/turniere/R1/suche?q=%25')).json()).treffer, []);
    assert.deepEqual((await (await sende('/turniere/R1/suche')).json()).treffer, []);

    const pool = await (await sende('/turniere/R1/pools/10')).json();
    assert.equal(pool.pool.bezeichnung, 'U15 w -44');
    assert.equal(pool.teilnehmer.length, 2);
    assert.equal((await sende('/turniere/R1/pools/abc')).status, 400);
    assert.equal((await sende('/turniere/R1/pools/999')).status, 404);

    assert.equal((await (await sende('/turniere/R1/vereine/v1')).json()).teilnehmer.length, 2);
    assert.equal((await sende('/turniere/gibtsnicht')).status, 404);
});

test('App-API: Übersicht mit Schlüsseln, unbekannt/leer/zurückgezogen', async () => {
    const r = await (await sende('/turniere/R1/uebersicht', { methode: 'POST', body: { teilnehmer: ['a1', 'x'], vereine: [] } })).json();
    assert.deepEqual(r.teilnehmer.map(x => x.key), ['a1']);
    assert.equal(r.stand, '2026-10-12T10:00:00.000Z');
    assert.ok(r.empfangenAm);

    const leer = await sende('/turniere/R1/uebersicht', { methode: 'POST', body: {} });
    assert.equal(leer.status, 200);
    assert.deepEqual((await leer.json()).teilnehmer, []);
    assert.equal((await sende('/turniere/R5/uebersicht', { methode: 'POST', body: { teilnehmer: ['a1'] } })).status, 404);
    assert.equal((await sende('/turniere/R1/uebersicht', { methode: 'POST', body: 'kaputt' })).status, 400);
});

test('App-API ist ratenbegrenzt (429), der Ingest nicht', async () => {
    let stati = [];
    for (let i = 0; i < 60; i++) stati.push((await sende('/turniere')).status);
    assert.ok(stati.includes(429));
    assert.equal((await sende('/ingest', { methode: 'POST', body: paket('R6'), ...mitToken() })).status, 204);
});

test('Aufbewahrung: Turniere älter als 7 Tage und alte Grabsteine werden gelöscht', async () => {
    const { knex } = db;
    await uebernimmPaket(knex, paket('ALT', { datum: '2026-10-01', sequenz: 1 }));
    await uebernimmPaket(knex, paket('FRISCH', { datum: '2026-10-10', sequenz: 1 }));
    await uebernimmPaket(knex, { version: 1, turnierKey: 'GRAB', zurueckgezogen: true, stand: '2026-10-01T00:00:00Z', sequenz: 1 },
        { jetzt: () => new Date('2026-10-01T00:00:00Z') });
    const geloescht = await loescheAlteLiveDaten(knex, { tage: 7, jetzt: () => new Date('2026-10-12T00:00:00Z') });
    assert.ok(geloescht >= 2);
    assert.equal(await knex('live_turniere').where({ turnier_key: 'ALT' }).first(), undefined);
    assert.equal(await knex('live_teilnehmer').where({ turnier_key: 'ALT' }).first(), undefined);
    assert.equal(await knex('live_turniere').where({ turnier_key: 'GRAB' }).first(), undefined);
    assert.ok(await knex('live_turniere').where({ turnier_key: 'FRISCH' }).first());
});
```

- [ ] **Step 2: Fehlschlag prüfen**

Run: `node --test tests/unit/liveCloudRoutes.test.js`
Expected: FAIL mit `Cannot find module '../../src/routes/liveRoutes.js'`.

- [ ] **Step 3: `aufbewahrung.js` schreiben**

`src/liveCloud/aufbewahrung.js`:

```js
// Löscht Live-Daten nach dem Turnier (Spec 6.1/10: Aufbewahrung 7 Tage). Die Kindtabellen folgen per ON DELETE CASCADE.
export async function loescheAlteLiveDaten(knex, { tage = 7, jetzt = () => new Date() } = {}) {
    const grenze = new Date(jetzt().getTime() - tage * 86_400_000);
    const grenzDatum = grenze.toISOString().slice(0, 10);
    return knex('live_turniere').where(function () {
        this.where('datum', '<', grenzDatum).orWhere(function () {
            this.where('zurueckgezogen', true).andWhere('empfangen_am', '<', grenze);
        });
    }).del();
}

export function starteAufbewahrung(knex, { tage = 7, intervallMs = 3_600_000, log = console } = {}) {
    const lauf = () => loescheAlteLiveDaten(knex, { tage }).then(
        (anzahl) => { if (anzahl) log.log(`[LiveCloud] ${anzahl} abgelaufene(s) Turnier(e) gelöscht`); },
        (fehler) => log.warn(`[LiveCloud] Aufbewahrung fehlgeschlagen: ${fehler.message}`)
    );
    lauf();
    const timer = setInterval(lauf, intervallMs);
    timer.unref?.();
    return { stoppe: () => clearInterval(timer) };
}
```

- [ ] **Step 4: `liveRoutes.js` schreiben**

`src/routes/liveRoutes.js`:

```js
// Öffentliche Teilnehmer-App-API und Ingest des Live-Prozesses (Spec Abschnitt 6.1). Nur im Modus cloud eingehängt.
// Der Ingest antwortet nur mit Statuscodes; die App-API ist lesend, ratenbegrenzt und liefert nie mehr als die Kachel.
import express from 'express';
import { uebernimmPaket } from '../liveCloud/ingest.js';
import { pruefeToken } from '../liveCloud/token.js';
import { listeTurniere, ladeTurnier, suche, ladePool, ladeVerein, uebersicht } from '../liveCloud/abfrage.js';
import { erzeugeRatenbegrenzung, clientIp } from '../liveCloud/ratenbegrenzung.js';

const SCHLUESSEL = /^[A-Za-z0-9_-]{1,64}$/;
const POOL_ID = /^\d{1,9}$/;

export function getLiveRoutes(knex, {
    begrenzung = erzeugeRatenbegrenzung({ max: 300 }),
    fehlerBegrenzung = erzeugeRatenbegrenzung({ max: 30 }),
    jetzt = () => new Date(),
    env = process.env
} = {}) {
    const router = express.Router();
    router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

    router.post('/ingest', async (req, res) => {
        try {
            const auth = /^Bearer (.+)$/.exec(req.get('authorization') || '');
            const token = auth ? await pruefeToken(knex, auth[1], { jetzt }) : null;
            if (!token) {
                return res.status(fehlerBegrenzung.erlaube(clientIp(req, env)) ? 401 : 429).end();
            }
            const paket = req.body;
            if (token.turnierKey && paket?.turnierKey !== token.turnierKey) return res.status(403).end();
            await uebernimmPaket(knex, paket, { jetzt });
            return res.status(204).end();
        } catch (fehler) {
            if (fehler.code === 'UNGUELTIG') return res.status(400).json({ error: fehler.message });
            console.error('[LiveCloud] Ingest fehlgeschlagen:', fehler.message);
            return res.status(500).end();
        }
    });

    // Ab hier die öffentliche App-API.
    router.use((req, res, next) => {
        if (!begrenzung.erlaube(clientIp(req, env))) return res.status(429).json({ error: 'Zu viele Anfragen' });
        next();
    });

    const schluesselPruefen = (req, res, next) => {
        if (!SCHLUESSEL.test(req.params.key)) return res.status(400).json({ error: 'Ungültiger Turnierschlüssel' });
        next();
    };
    const fehler500 = (res, fehler) => {
        console.error('[LiveCloud] Abfrage fehlgeschlagen:', fehler.message);
        res.status(500).json({ error: 'Abfrage fehlgeschlagen' });
    };

    router.get('/turniere', async (req, res) => {
        try {
            res.json({ serverzeit: jetzt().toISOString(), turniere: await listeTurniere(knex, { jetzt }) });
        } catch (f) { fehler500(res, f); }
    });

    router.get('/turniere/:key', schluesselPruefen, async (req, res) => {
        try {
            const turnier = await ladeTurnier(knex, req.params.key);
            if (!turnier) return res.status(404).json({ error: 'Turnier nicht gefunden' });
            res.json({ ...turnier, serverzeit: jetzt().toISOString() });
        } catch (f) { fehler500(res, f); }
    });

    router.get('/turniere/:key/suche', schluesselPruefen, async (req, res) => {
        try {
            res.json({ treffer: await suche(knex, req.params.key, String(req.query.q ?? '').slice(0, 100)) });
        } catch (f) { fehler500(res, f); }
    });

    router.get('/turniere/:key/pools/:poolId', schluesselPruefen, async (req, res) => {
        if (!POOL_ID.test(req.params.poolId)) return res.status(400).json({ error: 'Ungültige Pool-ID' });
        try {
            const pool = await ladePool(knex, req.params.key, Number(req.params.poolId));
            if (!pool) return res.status(404).json({ error: 'Pool nicht gefunden' });
            res.json(pool);
        } catch (f) { fehler500(res, f); }
    });

    router.get('/turniere/:key/vereine/:vereinKey', schluesselPruefen, async (req, res) => {
        if (!SCHLUESSEL.test(req.params.vereinKey)) return res.status(400).json({ error: 'Ungültiger Vereinsschlüssel' });
        try {
            res.json({ teilnehmer: await ladeVerein(knex, req.params.key, req.params.vereinKey) });
        } catch (f) { fehler500(res, f); }
    });

    router.post('/turniere/:key/uebersicht', schluesselPruefen, async (req, res) => {
        try {
            const turnier = await ladeTurnier(knex, req.params.key);
            if (!turnier) return res.status(404).json({ error: 'Turnier nicht gefunden' });
            const body = req.body && typeof req.body === 'object' ? req.body : {};
            res.json({
                serverzeit: jetzt().toISOString(), stand: turnier.stand, empfangenAm: turnier.empfangenAm,
                teilnehmer: await uebersicht(knex, req.params.key, body)
            });
        } catch (f) { fehler500(res, f); }
    });

    return router;
}
```

Hinweis: Der Test sendet `body: 'kaputt'` als JSON-String `"kaputt"`; `express.json()` (strict) lehnt Nicht-Objekte mit 400 ab, noch bevor der Router läuft. Damit die Test-App das als `400` antwortet, hängt `before` hinter den Router einen Fehler-Handler (Zeile unten im Test-Code, Step 1); in `src/app.js` übernimmt das der vorhandene Express-Standard (Status 400 aus dem Body-Parser).

- [ ] **Step 5: In `src/app.js` einbinden**

Import ergänzen (bei den anderen Routen-Importen, Zeile ~24):

```js
import { getLiveRoutes } from './routes/liveRoutes.js';
import { starteAufbewahrung } from './liveCloud/aufbewahrung.js';
```

Im Nicht-Client-Zweig direkt nach `app.use('/api/sync', getSyncRoutes(() => app.get('sync')));` (vor der schließenden `}` des `else`, Zeile ~303) einfügen:

```js
    // Teilnehmer-App (Phase 2): Ingest des Live-Prozesses und öffentliche App-API. Nur in der Cloud — ein Hallen-Server
    // darf keinen offenen Ingest anbieten. LIVE_API_AKTIV=true schaltet es für die Test-Suite im Modus server ein.
    if (bm.istCloud || process.env.LIVE_API_AKTIV === 'true') {
        app.use('/api/live', getLiveRoutes(knex));
        app.use('/live', express.static(path.join(__dirname, '../teilnehmer-app')));
        starteAufbewahrung(knex, { tage: Number(process.env.LIVE_AUFBEWAHRUNG_TAGE) || 7 });
    }
```

- [ ] **Step 6: Tests laufen lassen**

Run: `node --test tests/unit/liveCloudRoutes.test.js`
Expected: PASS, 8 Tests. Danach `npm run test:unit` (alle Unit-Tests): Expected: 0 fail.

- [ ] **Step 7: Commit**

```bash
git add src/liveCloud/aufbewahrung.js src/routes/liveRoutes.js src/app.js tests/unit/liveCloudRoutes.test.js
git commit -m "feat: Ingest-Endpunkt, App-API und Aufbewahrung der Teilnehmer-App (nur Cloud)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Logik der PWA (reine Module)

**Files:**
- Create: `teilnehmer-app/js/anzeige.js`
- Create: `teilnehmer-app/js/speicher.js`
- Test: `tests/unit/liveApp.test.js`

**Interfaces:**
- Produces:
  - `anzeige.js`: `klasseText({ altersklasse, geschlecht, gewichtsklasse }): string`, `matteText(bezeichnung): string`, `kachelZeilen(t): { titel, zeile1, zeile2, zeile3, art }` (`art` ∈ `'info' | 'laeuft' | 'bald' | 'fertig'`), `verbindung({ empfangenAm, serverzeit, stand }, schwelleSekunden = 180): { verbunden: boolean, text: string }`
  - `speicher.js`: `erzeugeSpeicher(storage, turnierKey): Speicher` mit `istGesternt(key)`, `stern(key, an)`, `glocke(key, an)`, `hatGlocke(key, vereinKey?)`, `vereinGesternt(vereinKey)`, `vereinStern(vereinKey, an)`, `vereinGlockeAlle(vereinKey, an)`, `vereinAusnahme(vereinKey, key, an)`, `anfrage(): { teilnehmer: string[], vereine: string[] }`, `exportiere(): object`; `bereinigeAlte(storage, behalteTurnierKeys: string[]): number`

- [ ] **Step 1: Failing test schreiben**

`tests/unit/liveApp.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { klasseText, matteText, kachelZeilen, verbindung } from '../../teilnehmer-app/js/anzeige.js';
import { erzeugeSpeicher, bereinigeAlte } from '../../teilnehmer-app/js/speicher.js';

const basis = { vorname: 'Anna', nachname: 'Muster', altersklasse: 'U15', geschlecht: 'w', gewichtsklasse: '-44', matteBezeichnung: 'Matte 2', abstand: null, platz: null };

test('klasseText und matteText', () => {
    assert.equal(klasseText(basis), 'U15 w −44 kg');
    assert.equal(klasseText({ ...basis, gewichtsklasse: '+63' }), 'U15 w +63 kg');
    assert.equal(klasseText({ ...basis, gewichtsklasse: '' }), 'U15 w');
    assert.equal(matteText('2'), 'Matte 2');
    assert.equal(matteText('Matte 2'), 'Matte 2');
    assert.equal(matteText(''), '');
});

test('Kachel: alle Zustände nach Spec Abschnitt 4', () => {
    const z = (zustand, extra = {}) => kachelZeilen({ ...basis, zustand, ...extra });
    assert.equal(z('in_n', { abstand: 3 }).zeile2, 'nächster Kampf: in 3 Kämpfen');
    assert.equal(z('in_n', { abstand: 1 }).zeile2, 'nächster Kampf: in 1 Kampf');
    assert.equal(z('als_naechstes').zeile2, 'nächster Kampf: als Nächstes');
    assert.equal(z('laeuft').zeile2, 'nächster Kampf: läuft jetzt');
    assert.equal(z('keine_weiteren').zeile2, 'nächster Kampf: keine weiteren Kämpfe');
    assert.equal(z('wartet_auf_gegner').zeile2, 'nächster Kampf: wartet auf Gegner');
    assert.equal(z('nicht_erschienen').zeile2, 'nicht erschienen');
    assert.equal(z('nicht_ausgelost').zeile2, 'noch nicht ausgelost');
    assert.equal(z('ohne_matte').zeile2, 'noch keine Matte zugeteilt');
    assert.equal(z('verspaetet').zeile2, 'nachgemeldet, Einteilung folgt');
    const fertig = z('abgeschlossen', { platz: 3 });
    assert.equal(fertig.zeile2, null);
    assert.equal(fertig.zeile3, 'Abgeschlossen · Platz 3');
    assert.equal(z('abgeschlossen', { platz: 5 }).zeile3, 'Abgeschlossen');
    assert.equal(z('abgeschlossen').zeile3, 'Abgeschlossen');
    assert.equal(z('unbekannt_neu').zeile2, null);
});

test('Kachel: Titelzeile mit Klasse und Matte, ohne Matte keine leere Angabe', () => {
    const k = kachelZeilen({ ...basis, zustand: 'in_n', abstand: 3 });
    assert.equal(k.titel, 'Anna Muster');
    assert.equal(k.zeile1, 'U15 w −44 kg · Matte 2');
    assert.equal(kachelZeilen({ ...basis, matteBezeichnung: '', zustand: 'nicht_ausgelost' }).zeile1, 'U15 w −44 kg');
});

test('Verbindungszustand aus Cloud-Zeiten, Schwelle 180 s', () => {
    const serverzeit = '2026-10-12T10:10:00.000Z';
    const frisch = verbindung({ empfangenAm: '2026-10-12T10:08:30.000Z', serverzeit, stand: '2026-10-12T10:08:30.000Z' });
    assert.equal(frisch.verbunden, true);
    assert.match(frisch.text, /^Stand von \d\d:\d\d$/);
    const alt = verbindung({ empfangenAm: '2026-10-12T10:05:00.000Z', serverzeit, stand: '2026-10-12T10:05:00.000Z' });
    assert.equal(alt.verbunden, false);
    assert.match(alt.text, /Halle nicht verbunden/);
    assert.equal(verbindung({}).verbunden, false);
});

function speicherAttrappe() {
    const daten = new Map();
    return {
        getItem: (k) => (daten.has(k) ? daten.get(k) : null),
        setItem: (k, v) => { daten.set(k, String(v)); },
        removeItem: (k) => { daten.delete(k); },
        key: (i) => [...daten.keys()][i] ?? null,
        get length() { return daten.size; }
    };
}

test('Speicher: Stern setzt die Glocke an, Glocke setzt den Stern, Stern aus entfernt beides', () => {
    const s = erzeugeSpeicher(speicherAttrappe(), 'T1');
    s.stern('a1', true);
    assert.equal(s.istGesternt('a1'), true);
    assert.equal(s.hatGlocke('a1'), true);
    s.glocke('a1', false);
    assert.equal(s.istGesternt('a1'), true);
    assert.equal(s.hatGlocke('a1'), false);
    s.glocke('a2', true);
    assert.equal(s.istGesternt('a2'), true);
    s.stern('a2', false);
    assert.equal(s.hatGlocke('a2'), false);
    assert.deepEqual(s.anfrage().teilnehmer, ['a1']);
});

test('Speicher: Vereinsstern, Glocke für alle und Ausnahmen je Teilnehmer', () => {
    const s = erzeugeSpeicher(speicherAttrappe(), 'T1');
    s.vereinStern('v1', true);
    assert.equal(s.vereinGesternt('v1'), true);
    assert.equal(s.hatGlocke('x1', 'v1'), false);
    s.vereinGlockeAlle('v1', true);
    assert.equal(s.hatGlocke('x1', 'v1'), true);
    s.vereinAusnahme('v1', 'x1', false);
    assert.equal(s.hatGlocke('x1', 'v1'), false);
    assert.equal(s.hatGlocke('x2', 'v1'), true);
    assert.deepEqual(s.anfrage().vereine, ['v1']);
    s.vereinStern('v1', false);
    assert.deepEqual(s.anfrage().vereine, []);
});

test('Speicher: je Turnier getrennt, übersteht Neuerzeugung, kaputte Daten und werfender Speicher', () => {
    const storage = speicherAttrappe();
    erzeugeSpeicher(storage, 'T1').stern('a1', true);
    assert.equal(erzeugeSpeicher(storage, 'T1').istGesternt('a1'), true);
    assert.equal(erzeugeSpeicher(storage, 'T2').istGesternt('a1'), false);

    storage.setItem('hajime-live:T3', '{kaputt');
    assert.deepEqual(erzeugeSpeicher(storage, 'T3').anfrage(), { teilnehmer: [], vereine: [] });

    const werfend = { getItem() { throw new Error('gesperrt'); }, setItem() { throw new Error('gesperrt'); }, key() { return null; }, length: 0 };
    const s = erzeugeSpeicher(werfend, 'T4');
    s.stern('a1', true);
    assert.equal(s.istGesternt('a1'), true);
});

test('bereinigeAlte entfernt Turniere, die es nicht mehr gibt', () => {
    const storage = speicherAttrappe();
    erzeugeSpeicher(storage, 'T1').stern('a1', true);
    erzeugeSpeicher(storage, 'ALT').stern('a1', true);
    storage.setItem('fremd', 'bleibt');
    assert.equal(bereinigeAlte(storage, ['T1']), 1);
    assert.equal(storage.getItem('hajime-live:ALT'), null);
    assert.notEqual(storage.getItem('hajime-live:T1'), null);
    assert.equal(storage.getItem('fremd'), 'bleibt');
});
```

- [ ] **Step 2: Fehlschlag prüfen**

Run: `node --test tests/unit/liveApp.test.js`
Expected: FAIL mit `Cannot find module '../../teilnehmer-app/js/anzeige.js'`.

- [ ] **Step 3: `anzeige.js` schreiben**

`teilnehmer-app/js/anzeige.js`:

```js
// Anzeigetexte der Teilnehmer-App (Spec Abschnitt 4). Rein, ohne DOM: läuft im Browser und in den Unit-Tests.
export function klasseText({ altersklasse, geschlecht, gewichtsklasse }) {
    const gewicht = gewichtsklasse ? `${String(gewichtsklasse).replace(/^-/, '−')} kg` : '';
    return [altersklasse, geschlecht, gewicht].filter(Boolean).join(' ');
}

export function matteText(bezeichnung) {
    const b = String(bezeichnung ?? '').trim();
    if (!b) return '';
    return /^\d+$/.test(b) ? `Matte ${b}` : b;
}

const HINWEIS = {
    nicht_ausgelost: 'noch nicht ausgelost',
    ohne_matte: 'noch keine Matte zugeteilt',
    verspaetet: 'nachgemeldet, Einteilung folgt',
    nicht_erschienen: 'nicht erschienen'
};

function kampfText(t) {
    switch (t.zustand) {
        case 'laeuft': return { text: 'läuft jetzt', art: 'laeuft' };
        case 'als_naechstes': return { text: 'als Nächstes', art: 'bald' };
        case 'in_n': return { text: t.abstand === 1 ? 'in 1 Kampf' : `in ${t.abstand} Kämpfen`, art: 'bald' };
        case 'wartet_auf_gegner': return { text: 'wartet auf Gegner', art: 'info' };
        case 'keine_weiteren': return { text: 'keine weiteren Kämpfe', art: 'info' };
        default: return null;
    }
}

export function kachelZeilen(t) {
    const titel = `${t.vorname ?? ''} ${t.nachname ?? ''}`.trim();
    const zeile1 = [klasseText(t), matteText(t.matteBezeichnung)].filter(Boolean).join(' · ');
    if (t.zustand === 'abgeschlossen') {
        const platz = Number.isInteger(t.platz) && t.platz >= 1 && t.platz <= 3 ? ` · Platz ${t.platz}` : '';
        return { titel, zeile1, zeile2: null, zeile3: `Abgeschlossen${platz}`, art: 'fertig' };
    }
    const kampf = kampfText(t);
    if (kampf) return { titel, zeile1, zeile2: `nächster Kampf: ${kampf.text}`, zeile3: null, art: kampf.art };
    return { titel, zeile1, zeile2: HINWEIS[t.zustand] ?? null, zeile3: null, art: 'info' };
}

// Alter aus den Zeiten der Cloud (nicht der Geräteuhr): der Uplink sendet spätestens alle 60 s ein Lebenszeichen.
export function verbindung({ empfangenAm, serverzeit, stand } = {}, schwelleSekunden = 180) {
    const empfangen = Date.parse(empfangenAm);
    const jetzt = Date.parse(serverzeit);
    if (Number.isNaN(empfangen) || Number.isNaN(jetzt)) return { verbunden: false, text: 'Kein Stand bekannt' };
    const uhrzeit = new Date(Date.parse(stand) || empfangen).toLocaleTimeString('de-DE', {
        hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin'
    });
    const verbunden = (jetzt - empfangen) / 1000 <= schwelleSekunden;
    return { verbunden, text: verbunden ? `Stand von ${uhrzeit}` : `Stand von ${uhrzeit} · Halle nicht verbunden` };
}
```

- [ ] **Step 4: `speicher.js` schreiben**

`teilnehmer-app/js/speicher.js`:

```js
// Sterne und Glocken liegen im Gerät, je Turnier (Spec 6.2, Entscheidung 3/4). Regeln (Plan R5):
// Glocke an => Stern an; Stern aus => Glocke weg. Stern auf einen Teilnehmer: Glocke an. Stern auf einen Verein:
// Glocke aus, "Glocke für alle" und Ausnahmen je Teilnehmer.
const PRAEFIX = 'hajime-live:';

export function erzeugeSpeicher(storage, turnierKey) {
    const name = `${PRAEFIX}${turnierKey}`;
    let zustand = { teilnehmer: {}, vereine: {} };
    try {
        const roh = storage.getItem(name);
        if (roh) {
            const gelesen = JSON.parse(roh);
            if (gelesen && typeof gelesen === 'object') {
                zustand = { teilnehmer: gelesen.teilnehmer || {}, vereine: gelesen.vereine || {} };
            }
        }
    } catch { /* leerer Zustand */ }

    const sichere = () => { try { storage.setItem(name, JSON.stringify(zustand)); } catch { /* nur im Speicher */ } };
    const verein = (v) => zustand.vereine[v] || (zustand.vereine[v] = { glockeAlle: false, ausnahmen: {} });

    return {
        istGesternt: (key) => Object.hasOwn(zustand.teilnehmer, key),
        stern(key, an) {
            if (an) { if (!Object.hasOwn(zustand.teilnehmer, key)) zustand.teilnehmer[key] = { glocke: true }; }
            else delete zustand.teilnehmer[key];
            sichere();
        },
        glocke(key, an) {
            zustand.teilnehmer[key] = { glocke: !!an };
            sichere();
        },
        hatGlocke(key, vereinKey) {
            if (Object.hasOwn(zustand.teilnehmer, key)) return !!zustand.teilnehmer[key].glocke;
            const v = vereinKey ? zustand.vereine[vereinKey] : null;
            if (!v) return false;
            return Object.hasOwn(v.ausnahmen, key) ? !!v.ausnahmen[key] : !!v.glockeAlle;
        },
        vereinGesternt: (vereinKey) => Object.hasOwn(zustand.vereine, vereinKey),
        vereinStern(vereinKey, an) {
            if (an) verein(vereinKey); else delete zustand.vereine[vereinKey];
            sichere();
        },
        vereinGlockeAlle(vereinKey, an) {
            const v = verein(vereinKey);
            v.glockeAlle = !!an;
            v.ausnahmen = {};
            sichere();
        },
        vereinAusnahme(vereinKey, key, an) {
            verein(vereinKey).ausnahmen[key] = !!an;
            sichere();
        },
        anfrage: () => ({ teilnehmer: Object.keys(zustand.teilnehmer), vereine: Object.keys(zustand.vereine) }),
        exportiere: () => JSON.parse(JSON.stringify(zustand))
    };
}

// Entfernt Daten von Turnieren, die die Cloud nicht mehr kennt (kein turnierübergreifender Personenbezug).
export function bereinigeAlte(storage, behalteTurnierKeys) {
    const behalten = new Set(behalteTurnierKeys.map(k => `${PRAEFIX}${k}`));
    const zuLoeschen = [];
    try {
        for (let i = 0; i < storage.length; i++) {
            const k = storage.key(i);
            if (k && k.startsWith(PRAEFIX) && !k.startsWith(`${PRAEFIX}cache:`) && !behalten.has(k)) zuLoeschen.push(k);
        }
        for (const k of zuLoeschen) storage.removeItem(k);
    } catch { /* Speicher nicht verfügbar */ }
    return zuLoeschen.length;
}
```

- [ ] **Step 5: Tests laufen lassen**

Run: `node --test tests/unit/liveApp.test.js`
Expected: PASS, 8 Tests.

- [ ] **Step 6: Commit**

```bash
git add teilnehmer-app/js/anzeige.js teilnehmer-app/js/speicher.js tests/unit/liveApp.test.js
git commit -m "feat: Anzeige- und Speicherlogik der Teilnehmer-App (Kachel, Stern, Glocke)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: PWA-Oberfläche und E2E

**Files:**
- Create: `teilnehmer-app/index.html`
- Create: `teilnehmer-app/css/app.css`
- Create: `teilnehmer-app/js/api.js`
- Create: `teilnehmer-app/js/app.js`
- Create: `teilnehmer-app/manifest.webmanifest`
- Create: `teilnehmer-app/sw.js`
- Create: `scripts/erzeuge-live-icons.mjs` (erzeugt `teilnehmer-app/icons/icon-192.png`, `icon-512.png`, `apple-touch-icon.png`)
- Modify: `tests/e2e/test-env.js` (in `testServerEnv` den Eintrag `LIVE_API_AKTIV: 'true'` ergänzen; Datei vorher lesen, der Eintrag gehört in das Env-Objekt, das der Testserver bekommt)
- Test: `tests/e2e/live-app.spec.js`

**Interfaces:**
- Consumes: `/api/live/*` (Task 5), `kachelZeilen`/`verbindung` (Task 6), `erzeugeSpeicher`/`bereinigeAlte` (Task 6).
- Produces: erreichbar unter `/live/` (Hash-Routen `#/`, `#/t/<key>`, `#/t/<key>/pool/<id>`, `#/t/<key>/verein/<vereinKey>`, `#/t/<key>/uebersicht`); `data-testid`s: `turnier-<key>`, `suchfeld`, `treffer-<key>`, `stern-<key>`, `glocke-<key>`, `vereinsauswahl`, `kachel-<key>`, `statuszeile`, `menue-uebersicht`.

- [ ] **Step 1: Icon-Skript und Icons**

`scripts/erzeuge-live-icons.mjs`:

```js
// Erzeugt die PWA-Icons der Teilnehmer-App (ohne Abhängigkeiten): node scripts/erzeuge-live-icons.mjs
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ziel = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../teilnehmer-app/icons');
const HINTERGRUND = [13, 71, 161, 255];
const VORDERGRUND = [255, 255, 255, 255];

const crcTabelle = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
});
function crc32(buf) {
    let c = 0xffffffff;
    for (const b of buf) c = crcTabelle[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}
function chunk(typ, daten) {
    const laenge = Buffer.alloc(4); laenge.writeUInt32BE(daten.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(typ), daten])));
    return Buffer.concat([laenge, Buffer.from(typ), daten, crc]);
}
function png(groesse) {
    const rand = Math.round(groesse * 0.22);
    const balken = Math.round(groesse * 0.12);
    const links = Math.round(groesse * 0.3);
    const rechts = groesse - links - balken;
    const mitteY = Math.round(groesse / 2);
    const zeilen = [];
    for (let y = 0; y < groesse; y++) {
        const zeile = Buffer.alloc(1 + groesse * 4);
        for (let x = 0; x < groesse; x++) {
            const imH = y >= rand && y < groesse - rand &&
                ((x >= links && x < links + balken) || (x >= rechts && x < rechts + balken) ||
                 (Math.abs(y - mitteY) < balken / 2 && x >= links && x < rechts + balken));
            zeile.set(imH ? VORDERGRUND : HINTERGRUND, 1 + x * 4);
        }
        zeilen.push(zeile);
    }
    const kopf = Buffer.alloc(13);
    kopf.writeUInt32BE(groesse, 0); kopf.writeUInt32BE(groesse, 4);
    kopf[8] = 8; kopf[9] = 6;
    return Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        chunk('IHDR', kopf), chunk('IDAT', zlib.deflateSync(Buffer.concat(zeilen))), chunk('IEND', Buffer.alloc(0))
    ]);
}

fs.mkdirSync(ziel, { recursive: true });
for (const [datei, groesse] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
    fs.writeFileSync(path.join(ziel, datei), png(groesse));
    console.log(`geschrieben: ${datei}`);
}
```

Run: `node scripts/erzeuge-live-icons.mjs`
Expected: drei Zeilen `geschrieben: …`; die PNGs liegen in `teilnehmer-app/icons/` und werden eingecheckt.

- [ ] **Step 2: Manifest und Service-Worker**

`teilnehmer-app/manifest.webmanifest`:

```json
{
  "name": "Hajime Live",
  "short_name": "Hajime Live",
  "description": "Verfolge Teilnehmer und Vereine am Wettkampftag.",
  "start_url": "./",
  "scope": "./",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#0d47a1",
  "lang": "de",
  "icons": [
    { "src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

`teilnehmer-app/sw.js`:

```js
// Service Worker der Teilnehmer-App: hält nur die App-Hülle vor. Die API wird nie zwischengespeichert (veraltete
// Kampfstände wären schlimmer als keine); die App merkt sich den letzten Stand selbst.
const CACHE = 'hajime-live-v1';
const HUELLE = ['./', './index.html', './css/app.css', './js/app.js', './js/api.js', './js/anzeige.js', './js/speicher.js',
    './manifest.webmanifest', './icons/icon-192.png'];

self.addEventListener('install', (e) => {
    e.waitUntil(caches.open(CACHE).then(c => c.addAll(HUELLE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
    e.waitUntil(caches.keys()
        .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
        .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
    const url = new URL(e.request.url);
    if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
    e.respondWith(
        fetch(e.request).then((antwort) => {
            const kopie = antwort.clone();
            caches.open(CACHE).then(c => c.put(e.request, kopie));
            return antwort;
        }).catch(() => caches.match(e.request))
    );
});
```

- [ ] **Step 3: HTML und CSS**

`teilnehmer-app/index.html`:

```html
<!doctype html>
<html lang="de">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="theme-color" content="#0d47a1">
    <title>Hajime Live</title>
    <link rel="manifest" href="manifest.webmanifest">
    <link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
    <link rel="stylesheet" href="css/app.css">
</head>
<body>
    <header class="kopf">
        <a class="titel" href="#/">Hajime Live</a>
        <nav id="menue" hidden>
            <a data-testid="menue-suche" id="menueSuche" href="#/">Suche</a>
            <a data-testid="menue-uebersicht" id="menueUebersicht" href="#/">Übersicht</a>
        </nav>
    </header>
    <main id="inhalt" aria-live="polite"></main>
    <footer id="statuszeile" data-testid="statuszeile" class="status"></footer>
    <script type="module" src="js/app.js"></script>
</body>
</html>
```

`teilnehmer-app/css/app.css`:

```css
:root {
    --farbe-primaer: #0d47a1; --farbe-text: #1c1b1f; --farbe-flaeche: #ffffff; --farbe-karte: #f3f4f8;
    --farbe-rand: #d0d4de; --farbe-laeuft: #b3261e; --farbe-bald: #8a5a00; --farbe-fertig: #1b6e2b; --farbe-grau: #5f6368;
}
@media (prefers-color-scheme: dark) {
    :root {
        --farbe-primaer: #90b4ff; --farbe-text: #e6e1e5; --farbe-flaeche: #121317; --farbe-karte: #1d1f26;
        --farbe-rand: #3a3d48; --farbe-laeuft: #ff8a80; --farbe-bald: #ffcc66; --farbe-fertig: #7edc8a; --farbe-grau: #a0a4ad;
    }
}
* { box-sizing: border-box; }
body { margin: 0; font: 16px/1.4 system-ui, sans-serif; background: var(--farbe-flaeche); color: var(--farbe-text); padding-bottom: 3rem; }
.kopf { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: .75rem 1rem; border-bottom: 1px solid var(--farbe-rand); }
.titel { font-weight: 700; color: var(--farbe-primaer); text-decoration: none; }
nav a { margin-left: 1rem; color: var(--farbe-primaer); }
main { padding: 1rem; max-width: 40rem; margin: 0 auto; }
h1 { font-size: 1.25rem; margin: 0 0 .75rem; }
.knopf-liste { display: grid; gap: .5rem; padding: 0; list-style: none; margin: 0; }
.knopf-liste button, .knopf-liste a { width: 100%; text-align: left; padding: .75rem 1rem; border: 1px solid var(--farbe-rand); border-radius: .5rem; background: var(--farbe-karte); color: inherit; font: inherit; text-decoration: none; display: block; }
input[type="search"], select { width: 100%; padding: .75rem; font: inherit; border: 1px solid var(--farbe-rand); border-radius: .5rem; background: var(--farbe-flaeche); color: inherit; margin-bottom: .5rem; }
.kachel { display: grid; grid-template-columns: 1fr auto; gap: .25rem .75rem; padding: .75rem 1rem; border: 1px solid var(--farbe-rand); border-radius: .5rem; background: var(--farbe-karte); margin-bottom: .5rem; }
.kachel .name { font-weight: 600; }
.kachel .zeile { color: var(--farbe-grau); font-size: .9rem; grid-column: 1; }
.kachel .zeile.laeuft { color: var(--farbe-laeuft); font-weight: 600; }
.kachel .zeile.bald { color: var(--farbe-bald); font-weight: 600; }
.kachel .zeile.fertig { color: var(--farbe-fertig); font-weight: 600; }
.kachel .aktionen { grid-column: 2; grid-row: 1 / span 3; display: flex; gap: .25rem; align-items: center; }
.icon-knopf { min-width: 2.75rem; min-height: 2.75rem; border: 0; background: transparent; font-size: 1.4rem; cursor: pointer; color: var(--farbe-grau); }
.icon-knopf[aria-pressed="true"] { color: var(--farbe-bald); }
.hinweis { padding: .75rem 1rem; border-radius: .5rem; background: var(--farbe-karte); color: var(--farbe-grau); }
.status { position: fixed; left: 0; right: 0; bottom: 0; padding: .5rem 1rem; background: var(--farbe-karte); border-top: 1px solid var(--farbe-rand); font-size: .85rem; color: var(--farbe-grau); }
.status.getrennt { color: var(--farbe-laeuft); }
.verein-leiste { display: flex; gap: .5rem; align-items: center; margin: .5rem 0 1rem; flex-wrap: wrap; }
.verein-leiste label { display: flex; gap: .25rem; align-items: center; }
```

- [ ] **Step 4: `api.js` schreiben**

`teilnehmer-app/js/api.js`:

```js
// Dünne Schicht über die App-API der Cloud (/api/live). Wirft bei Netzfehlern und Nicht-2xx; die Oberfläche fällt dann
// auf den zuletzt gespeicherten Stand zurück.
const BASIS = '/api/live';

async function hole(pfad, optionen = {}) {
    const antwort = await fetch(BASIS + pfad, { cache: 'no-store', ...optionen });
    if (!antwort.ok) throw Object.assign(new Error(`HTTP ${antwort.status}`), { status: antwort.status });
    return antwort.json();
}

const t = (key) => `/turniere/${encodeURIComponent(key)}`;

export const api = {
    turniere: () => hole('/turniere'),
    turnier: (key) => hole(t(key)),
    suche: (key, q) => hole(`${t(key)}/suche?q=${encodeURIComponent(q)}`),
    pool: (key, poolId) => hole(`${t(key)}/pools/${encodeURIComponent(poolId)}`),
    verein: (key, vereinKey) => hole(`${t(key)}/vereine/${encodeURIComponent(vereinKey)}`),
    uebersicht: (key, anfrage) => hole(`${t(key)}/uebersicht`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(anfrage)
    })
};
```

- [ ] **Step 5: `app.js` schreiben**

`teilnehmer-app/js/app.js`:

```js
// Hajime Live: Startbildschirm (Turnier, Suche mit Autovervollständigung, Verein), Pool-Ansicht, Übersicht.
// Alle Namen werden ausschließlich über textContent in die Seite gesetzt.
import { api } from './api.js';
import { kachelZeilen, verbindung } from './anzeige.js';
import { erzeugeSpeicher, bereinigeAlte } from './speicher.js';

const inhalt = document.getElementById('inhalt');
const statuszeile = document.getElementById('statuszeile');
const menue = document.getElementById('menue');
let aktualisierer = null;
let suchTimer = null;

function h(tag, attribute = {}, ...kinder) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attribute)) {
        if (k === 'class') el.className = v;
        else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
        else if (v === true) el.setAttribute(k, '');
        else if (v !== false && v != null) el.setAttribute(k, v);
    }
    for (const kind of kinder.flat()) el.append(kind instanceof Node ? kind : document.createTextNode(String(kind)));
    return el;
}

function speicherFuer(turnierKey) {
    let storage = null;
    try { storage = window.localStorage; } catch { /* privater Modus */ }
    return erzeugeSpeicher(storage || { getItem: () => null, setItem() {} }, turnierKey);
}

function setzeStatus(text, getrennt = false) {
    statuszeile.textContent = text;
    statuszeile.classList.toggle('getrennt', getrennt);
}

function kachel(t, speicher, neuZeichnen) {
    const z = kachelZeilen(t);
    const gesternt = speicher.istGesternt(t.key);
    const glocke = speicher.hatGlocke(t.key, t.vereinKey);
    return h('div', { class: 'kachel', 'data-testid': `kachel-${t.key}` },
        h('div', { class: 'name' }, z.titel),
        h('div', { class: 'aktionen' },
            h('button', {
                class: 'icon-knopf', 'data-testid': `stern-${t.key}`, 'aria-pressed': String(gesternt),
                'aria-label': gesternt ? 'Nicht mehr verfolgen' : 'Verfolgen',
                onclick: () => { speicher.stern(t.key, !gesternt); neuZeichnen(); }
            }, gesternt ? '★' : '☆'),
            h('button', {
                class: 'icon-knopf', 'data-testid': `glocke-${t.key}`, 'aria-pressed': String(glocke),
                'aria-label': glocke ? 'Benachrichtigung aus' : 'Benachrichtigung an',
                onclick: () => { speicher.glocke(t.key, !glocke); neuZeichnen(); }
            }, glocke ? '🔔' : '🔕')),
        z.zeile1 ? h('div', { class: 'zeile' }, z.zeile1) : null,
        z.zeile2 ? h('div', { class: `zeile ${z.art}` }, z.zeile2) : null,
        z.zeile3 ? h('div', { class: `zeile ${z.art}` }, z.zeile3) : null);
}

function stoppeAktualisierung() {
    if (aktualisierer) { clearInterval(aktualisierer); aktualisierer = null; }
}

async function zeigeStart() {
    stoppeAktualisierung();
    menue.hidden = true;
    setzeStatus('');
    inhalt.replaceChildren(h('h1', {}, 'Turnier wählen'), h('p', { class: 'hinweis' }, 'Lade …'));
    try {
        const { turniere } = await api.turniere();
        try { bereinigeAlte(window.localStorage, turniere.map(x => x.key)); } catch { /* ohne Speicher */ }
        if (!turniere.length) {
            inhalt.replaceChildren(h('h1', {}, 'Turnier wählen'), h('p', { class: 'hinweis' }, 'Zurzeit ist kein Turnier freigegeben.'));
            return;
        }
        inhalt.replaceChildren(h('h1', {}, 'Turnier wählen'),
            h('ul', { class: 'knopf-liste' }, turniere.map(x => h('li', {},
                h('a', { href: `#/t/${encodeURIComponent(x.key)}`, 'data-testid': `turnier-${x.key}` }, `${x.name} · ${x.datum}`)))));
    } catch {
        inhalt.replaceChildren(h('h1', {}, 'Turnier wählen'), h('p', { class: 'hinweis' }, 'Keine Verbindung. Bitte später erneut versuchen.'));
    }
}

async function zeigeTurnier(key) {
    stoppeAktualisierung();
    const speicher = speicherFuer(key);
    menue.hidden = false;
    document.getElementById('menueUebersicht').href = `#/t/${encodeURIComponent(key)}/uebersicht`;
    document.getElementById('menueSuche').href = `#/t/${encodeURIComponent(key)}`;
    let turnier;
    try { turnier = await api.turnier(key); } catch {
        inhalt.replaceChildren(h('p', { class: 'hinweis' }, 'Das Turnier ist nicht (mehr) verfügbar.'));
        return;
    }
    setzeStatus(verbindung(turnier).text, !verbindung(turnier).verbunden);

    const trefferListe = h('div', { 'data-testid': 'treffer' });
    const suchfeld = h('input', {
        type: 'search', placeholder: 'Name oder Vorname', 'aria-label': 'Teilnehmer suchen', 'data-testid': 'suchfeld',
        autocomplete: 'off',
        oninput: () => {
            clearTimeout(suchTimer);
            const q = suchfeld.value.trim();
            if (q.length < 2) { trefferListe.replaceChildren(); return; }
            suchTimer = setTimeout(async () => {
                try {
                    const { treffer } = await api.suche(key, q);
                    trefferListe.replaceChildren(...(treffer.length ? treffer.map(t => treffer_(t)) : [h('p', { class: 'hinweis' }, 'Keine Treffer.')]));
                } catch { trefferListe.replaceChildren(h('p', { class: 'hinweis' }, 'Keine Verbindung.')); }
            }, 250);
        }
    });
    function treffer_(t) {
        const z = kachelZeilen(t);
        const ziel = t.poolId != null ? `#/t/${encodeURIComponent(key)}/pool/${t.poolId}` : null;
        const text = `${z.titel} · ${[z.zeile1, z.zeile2].filter(Boolean).join(' · ')}`;
        return h('ul', { class: 'knopf-liste' }, h('li', {},
            ziel ? h('a', { href: ziel, 'data-testid': `treffer-${t.key}` }, text)
                : h('div', { class: 'hinweis', 'data-testid': `treffer-${t.key}` }, text)));
    }

    const vereinsauswahl = h('select', {
        'data-testid': 'vereinsauswahl', 'aria-label': 'Verein wählen',
        onchange: () => { if (vereinsauswahl.value) location.hash = `#/t/${encodeURIComponent(key)}/verein/${encodeURIComponent(vereinsauswahl.value)}`; }
    }, h('option', { value: '' }, 'Verein wählen …'),
        turnier.vereine.map(v => h('option', { value: v.key }, `${v.name} (${v.anzahl})`)));

    inhalt.replaceChildren(h('h1', {}, turnier.name), suchfeld, trefferListe, vereinsauswahl);
}

async function zeigeListe(key, ladeFunktion, titel, vereinKey = null) {
    stoppeAktualisierung();
    const speicher = speicherFuer(key);
    menue.hidden = false;
    document.getElementById('menueUebersicht').href = `#/t/${encodeURIComponent(key)}/uebersicht`;
    document.getElementById('menueSuche').href = `#/t/${encodeURIComponent(key)}`;
    async function zeichne() {
        let daten;
        try { daten = await ladeFunktion(); } catch (f) {
            inhalt.replaceChildren(h('p', { class: 'hinweis' }, f.status === 404 ? 'Nicht gefunden.' : 'Keine Verbindung.'));
            return;
        }
        const liste = daten.teilnehmer;
        const kopf = [h('h1', {}, daten.titel || titel)];
        if (vereinKey) {
            const gesternt = speicher.vereinGesternt(vereinKey);
            kopf.push(h('div', { class: 'verein-leiste' },
                h('button', {
                    class: 'icon-knopf', 'data-testid': 'verein-stern', 'aria-pressed': String(gesternt),
                    'aria-label': gesternt ? 'Verein nicht mehr verfolgen' : 'Ganzen Verein verfolgen',
                    onclick: () => { speicher.vereinStern(vereinKey, !gesternt); zeichne(); }
                }, gesternt ? '★' : '☆'),
                gesternt ? h('label', {}, h('input', {
                    type: 'checkbox', 'data-testid': 'verein-glocke-alle',
                    checked: liste.length > 0 && liste.every(t => speicher.hatGlocke(t.key, vereinKey)),
                    onchange: (e) => { speicher.vereinGlockeAlle(vereinKey, e.target.checked); zeichne(); }
                }), ' Glocke für alle') : null));
        }
        inhalt.replaceChildren(...kopf, ...(liste.length ? liste.map(t => kachel(t, speicher, zeichne)) : [h('p', { class: 'hinweis' }, 'Keine Teilnehmer.')]));
    }
    await zeichne();
}

async function zeigeUebersicht(key) {
    stoppeAktualisierung();
    const speicher = speicherFuer(key);
    menue.hidden = false;
    document.getElementById('menueUebersicht').href = `#/t/${encodeURIComponent(key)}/uebersicht`;
    document.getElementById('menueSuche').href = `#/t/${encodeURIComponent(key)}`;
    const cacheName = `hajime-live:cache:${key}`;

    async function lade() {
        const anfrage = speicher.anfrage();
        if (!anfrage.teilnehmer.length && !anfrage.vereine.length) {
            inhalt.replaceChildren(h('h1', {}, 'Übersicht'), h('p', { class: 'hinweis' }, 'Noch niemand verfolgt. Suche einen Teilnehmer und setze den Stern ☆.'));
            setzeStatus('');
            return;
        }
        let antwort;
        let ausCache = false;
        try {
            antwort = await api.uebersicht(key, anfrage);
            try { localStorage.setItem(cacheName, JSON.stringify(antwort)); } catch { /* ohne Speicher */ }
        } catch {
            try { antwort = JSON.parse(localStorage.getItem(cacheName)); } catch { antwort = null; }
            ausCache = true;
        }
        if (!antwort) {
            inhalt.replaceChildren(h('h1', {}, 'Übersicht'), h('p', { class: 'hinweis' }, 'Keine Verbindung.'));
            setzeStatus('Keine Verbindung', true);
            return;
        }
        const v = verbindung(antwort);
        setzeStatus(ausCache ? `Keine Verbindung · ${v.text}` : v.text, ausCache || !v.verbunden);
        const liste = antwort.teilnehmer;
        inhalt.replaceChildren(h('h1', {}, 'Übersicht'),
            ...(liste.length ? liste.map(t => kachel(t, speicher, lade)) : [h('p', { class: 'hinweis' }, 'Die verfolgten Teilnehmer sind (noch) nicht gemeldet.')]));
    }
    await lade();
    aktualisierer = setInterval(() => { if (document.visibilityState === 'visible') lade(); }, 15000);
}

function route() {
    const teile = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
    if (teile[0] !== 't' || !teile[1]) return zeigeStart();
    const key = teile[1];
    if (teile[2] === 'uebersicht') return zeigeUebersicht(key);
    if (teile[2] === 'pool' && teile[3]) {
        return zeigeListe(key, async () => {
            const p = await api.pool(key, teile[3]);
            return { titel: `${p.pool.bezeichnung}${p.pool.matteBezeichnung ? ` · ${p.pool.matteBezeichnung}` : ''}`, teilnehmer: p.teilnehmer };
        }, 'Pool');
    }
    if (teile[2] === 'verein' && teile[3]) {
        return zeigeListe(key, async () => {
            const [turnier, v] = await Promise.all([api.turnier(key), api.verein(key, teile[3])]);
            const name = turnier.vereine.find(x => x.key === teile[3])?.name || 'Verein';
            return { titel: name, teilnehmer: v.teilnehmer };
        }, 'Verein', teile[3]);
    }
    return zeigeTurnier(key);
}

window.addEventListener('hashchange', route);
route();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
```

- [ ] **Step 6: Testserver-Umgebung**

`tests/e2e/test-env.js` öffnen und in das Env-Objekt `testServerEnv` den Eintrag `LIVE_API_AKTIV: 'true'` aufnehmen (neben den vorhandenen Schlüsseln wie `IS_OFFLINE`).

- [ ] **Step 7: E2E-Test schreiben**

`tests/e2e/live-app.spec.js`:

```js
// End-to-End: Teilnehmer-App Phase 2 — Ingest, Suche mit Autovervollständigung, Pool-Ansicht, Stern, Übersicht.
import { test, expect } from '@playwright/test';
import crypto from 'node:crypto';
import knexLib from 'knex';
import { testDbVerbindung } from './test-env.js';

const TOKEN = 'hjl_e2e_token_0123456789abcdef0123456789abcdef';
const t = (key, vorname, nachname, extra = {}) => ({
    key, vorname, nachname, vereinKey: 'v1', verein: 'JC Muster', altersklasse: 'U15', gewichtsklasse: '-44', geschlecht: 'w',
    poolId: 10, poolBezeichnung: 'U15 w -44', matteId: 1, matteBezeichnung: 'Matte 2', zustand: 'in_n', abstand: 3,
    naechsterKampfId: 5, platz: null, ...extra
});
const paket = (sequenz, extra = {}) => ({
    version: 1, turnierKey: 'E2E-LIVE', name: 'Live-E2E-Turnier', datum: new Date().toISOString().slice(0, 10),
    stand: new Date().toISOString(), sequenz,
    vereine: [{ key: 'v1', name: 'JC Muster' }, { key: 'v2', name: 'TV Beispiel' }], matten: [{ id: 1, bezeichnung: 'Matte 2' }],
    teilnehmer: [
        t('a1', 'Anna', 'Muster'),
        t('a2', 'Mia', 'Mustermann', { zustand: 'laeuft', abstand: null }),
        t('b1', 'Ben', 'Beispiel', { vereinKey: 'v2', verein: 'TV Beispiel', poolId: 11, poolBezeichnung: 'U15 m -50', geschlecht: 'm', gewichtsklasse: '-50', zustand: 'abgeschlossen', abstand: null, platz: 3 })
    ],
    warteschlangen: [], ...extra
});

test.beforeAll(async () => {
    const db = knexLib({ client: 'pg', connection: testDbVerbindung });
    try {
        await db('live_ingest_tokens').where({ name: 'e2e' }).del();
        await db('live_ingest_tokens').insert({ name: 'e2e', token_hash: crypto.createHash('sha256').update(TOKEN).digest('hex') });
        await db('live_turniere').where({ turnier_key: 'E2E-LIVE' }).del();
    } finally {
        await db.destroy();
    }
});

async function sende(request, daten) {
    const r = await request.post('/api/live/ingest', { data: daten, headers: { Authorization: `Bearer ${TOKEN}` } });
    expect(r.status(), await r.text()).toBe(204);
}

test('Ingest → Suche → Pool → Stern → Übersicht', async ({ page, request }) => {
    await sende(request, paket(Date.now()));

    await page.goto('/live/');
    await page.getByTestId('turnier-E2E-LIVE').click();

    await page.getByTestId('suchfeld').fill('mus');
    await expect(page.getByTestId('treffer-a1')).toContainText('Anna Muster');
    await expect(page.getByTestId('treffer-a1')).toContainText('nächster Kampf: in 3 Kämpfen');
    await page.getByTestId('treffer-a1').click();

    await expect(page.getByTestId('kachel-a2')).toContainText('Mia Mustermann');
    await expect(page.getByTestId('kachel-a2')).toContainText('läuft jetzt');
    await expect(page.getByTestId('kachel-a1')).toContainText('U15 w −44 kg · Matte 2');
    await page.getByTestId('stern-a1').click();
    await expect(page.getByTestId('stern-a1')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('glocke-a1')).toHaveAttribute('aria-pressed', 'true');

    await page.getByTestId('menue-uebersicht').click();
    await expect(page.getByTestId('kachel-a1')).toContainText('nächster Kampf: in 3 Kämpfen');
    await expect(page.getByTestId('kachel-a2')).toHaveCount(0);
    await expect(page.getByTestId('statuszeile')).toContainText('Stand von');
});

test('Verein verfolgen zeigt alle seine Teilnehmer, Abschluss mit Platz, ohne Netz der letzte Stand', async ({ page, request, context }) => {
    await sende(request, paket(Date.now() + 1000));
    await page.goto('/live/#/t/E2E-LIVE');
    await page.getByTestId('vereinsauswahl').selectOption('v2');
    await page.getByTestId('verein-stern').click();
    await page.getByTestId('menue-uebersicht').click();
    await expect(page.getByTestId('kachel-b1')).toContainText('Abgeschlossen · Platz 3');

    await context.setOffline(true);
    await page.reload();
    await expect(page.getByTestId('statuszeile')).toContainText('Keine Verbindung');
    await expect(page.getByTestId('kachel-b1')).toContainText('Abgeschlossen · Platz 3');
});

test('Zurückgezogenes Turnier ist nicht mehr auswählbar', async ({ page, request }) => {
    await sende(request, { version: 1, turnierKey: 'E2E-LIVE', zurueckgezogen: true, stand: new Date().toISOString(), sequenz: Date.now() + 100000 });
    await page.goto('/live/');
    await expect(page.getByTestId('turnier-E2E-LIVE')).toHaveCount(0);
});
```

Hinweis zum Offline-Test: `context.setOffline(true)` blockiert auch das Nachladen der App-Hülle, wenn der Service Worker sie noch nicht vorhält. Der Test lädt `/live/` vorher mindestens einmal, daher liegt die Hülle im Cache; scheitert `page.reload()` offline trotzdem, den Reload durch `page.evaluate(() => window.dispatchEvent(new HashChangeEvent('hashchange')))` ersetzen und die Prüfung beibehalten.

- [ ] **Step 8: E2E laufen lassen**

Run: `npx playwright test tests/e2e/live-app.spec.js`
Expected: 3 passed. Bei roten Tests zuerst `read_console_messages`/Playwright-Trace auf Importfehler der Module prüfen (Pfade relativ zu `/live/`).

- [ ] **Step 9: Sichtprüfung im Browser**

`npm start` mit `BETRIEBSMODUS`-Variablen des Tests ist aufwendig; stattdessen `npx playwright test tests/e2e/live-app.spec.js --headed` und per Screenshot (`page.screenshot`) im Test prüfen, dass Kacheln lesbar sind (Hell/Dunkel über `colorScheme`). Keine Code-Änderung nötig, wenn die Kacheln sauber umbrechen.

- [ ] **Step 10: Commit**

```bash
git add teilnehmer-app scripts/erzeuge-live-icons.mjs tests/e2e/test-env.js tests/e2e/live-app.spec.js
git commit -m "feat: PWA Hajime Live (Suche, Pool-Ansicht, Stern/Glocke, Übersicht) mit E2E-Test" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Dokumentation und Abschluss

**Files:**
- Modify: `docs/live-uplink.md` (Abschnitt „Cloud-Seite“ ergänzen)
- Modify: `CLAUDE.md` (Eintrag „Live-Uplink für die Teilnehmer-App“ um Phase 2 erweitern)
- Modify: `docs/specs/2026-10-12-teilnehmer-app-design.md` (Kopfzeile Status, Abschnitt 6.1: Tabellenliste mit Hinweis, dass `live_verfolgungen`/`push_*` Phase 3 sind)

**Interfaces:** keine.

- [ ] **Step 1: `docs/live-uplink.md` ergänzen**

Am Ende anhängen:

```markdown
## Cloud-Seite (Phase 2)

Die Cloud (`BETRIEBSMODUS=cloud`) nimmt die Snapshots unter `POST /api/live/ingest` an und liefert die App-API unter
`/api/live/*` sowie die PWA unter `/live/`. Voraussetzung: die Migration `20261012110000_live_cloud_lesemodell` ist
gelaufen (`DB_AUTO_MIGRATE=true` oder manuell, siehe CLAUDE.md).

**Token für den Slave erzeugen** (einmalig angezeigt, in der Datenbank liegt nur der Hash):

    node scripts/live-token.mjs erzeugen --name "Halle Senden"
    # optional an ein Turnier binden: --turnier <urspruengliche_id>
    node scripts/live-token.mjs liste
    node scripts/live-token.mjs sperren <id>

Das Token gehört in die `live.env` des Slaves (`LIVE_UPLINK_TOKEN`), die URL ist `https://<cloud>/api/live/ingest`.

| Variable (Cloud) | Wirkung |
|---|---|
| `LIVE_AUFBEWAHRUNG_TAGE` | Löschfrist nach dem Turnierdatum, Standard 7 |
| `LIVE_PROXY_VERTRAUEN=true` | Absender-IP für die Ratenbegrenzung aus `X-Forwarded-For` (nur hinter einem Proxy setzen) |
| `LIVE_API_AKTIV=true` | schaltet die Routen außerhalb der Cloud ein (nur für Tests) |

Die App-API ist je IP auf 300 Anfragen/Minute begrenzt; falsche Token am Ingest auf 30/Minute. Fällt die Halle aus, zeigt
die App „Halle nicht verbunden“, sobald seit 3 Minuten kein Paket ankam.
```

- [ ] **Step 2: CLAUDE.md ergänzen**

Im Eintrag „**Live-Uplink für die Teilnehmer-App (`src/live/`, Phase 1; …)**“ den letzten Satz „Cloud-Ingest, App und Push folgen in Phase 2/3“ ersetzen durch:

```
**Phase 2 (Cloud, `src/liveCloud/`, `src/routes/liveRoutes.js`, PWA `teilnehmer-app/`):** nur im Modus `cloud` (oder `LIVE_API_AKTIV=true`) hängen `/api/live/ingest` (Bearer-Token aus `live_ingest_tokens`, Verwaltung `scripts/live-token.mjs`, nur Statuscodes, Sequenz-Prüfung, Grabstein bei Rücknahme), die ratenbegrenzte App-API (`/api/live/turniere…`: Suche ab 2 Zeichen, Pool, Verein, Übersicht per POST mit Schlüsselliste) und die PWA unter `/live/` ein; Lesemodell `live_turniere`/`live_teilnehmer`/`live_kampf_positionen`, Aufbewahrung 7 Tage (`LIVE_AUFBEWAHRUNG_TAGE`). Sterne/Glocken liegen im Gerät (`teilnehmer-app/js/speicher.js`), Anzeigetexte in `teilnehmer-app/js/anzeige.js`. Tests: `tests/unit/liveCloud*.test.js`, `tests/unit/liveApp.test.js`, `tests/e2e/live-app.spec.js`. Push folgt in Phase 3.
```

- [ ] **Step 3: Spec nachführen**

In `docs/specs/2026-10-12-teilnehmer-app-design.md` im Abschnitt 6.1 die Tabellenliste um den Satz ergänzen: „Phase 2 legt `live_turniere`, `live_teilnehmer`, `live_kampf_positionen` und `live_ingest_tokens` an; `live_verfolgungen`, `push_geraete` und `push_log` folgen mit Phase 3, bis dahin sind die Geräte zustandslos (Schlüsselliste je Anfrage).“

- [ ] **Step 4: Gesamtlauf**

Run: `npm run test:unit`
Expected: 0 fail.

Run: `npx playwright test tests/e2e/live-app.spec.js tests/e2e/live-freigabe.spec.js`
Expected: alle bestanden.

- [ ] **Step 5: Commit**

```bash
git add docs CLAUDE.md
git commit -m "docs: Cloud-Seite der Teilnehmer-App (Token, Konfiguration, Aufbewahrung)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Self-Review (gegen den Spec)

- **6.1 Cloud:** Tabellen (T1; `live_verfolgungen`/`push_*` bewusst Phase 3, siehe Global Constraints), Ingest atomar mit Sequenz (T1/T5), App-API Turnierliste/Vereinsliste/Suche ab 2 Zeichen/Pool/Übersicht/`stand` (T3/T5), Rate-Limit und keine Aufzählung (T3/T4/T5), Aufbewahrung (T5).
- **6.2 App:** Startbildschirm Turnier/Suche/Autovervollständigung/Verein (T7), Pool-Ansicht mit Stern und Glocke (T7), Vereinsstern mit „Glocke für alle“ und Ausnahmen (T6/T7), Übersicht mit Statuszeile `stand`/Verbindung (T6/T7), Hinweise vor Matten-Zuteilung (T6 Tabelle), Sterne in `localStorage` je Turnier (T6).
- **5.3:** Token sperrbar/turniergebunden, nur Statuscode (T2/T5).
- **11 Fehlerfälle:** Halle nicht verbunden / Cloud nicht erreichbar → Cache (T6/T7), Rücknahme (T1/T5).
- **Typkonsistenz:** `TeilnehmerDto` (T3) ↔ `kachelZeilen`-Eingabe (T6: `vorname`, `nachname`, `altersklasse`, `geschlecht`, `gewichtsklasse`, `matteBezeichnung`, `zustand`, `abstand`, `platz`) ↔ E2E-Fixtures (T7) stimmen überein; `vereinKey` wird in `speicher.hatGlocke(key, vereinKey)` benutzt.
- **Bekannte Lücken (bewusst):** Mannschaftskämpfe, Push, Glocken-Sync zur Cloud (Phase 3); App-Name/URL (Spec 14) bleibt „Hajime Live“ vorläufig; Datenschutz-/Einwilligungstext für die Anmeldung ist Texte-Arbeit, nicht Code.
