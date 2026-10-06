# Urkunden-Generator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vereinsweite Urkunden-Vorlagen (Blanko-PDF + Textfelder) anlegen und daraus pro Turnier ein mehrseitiges Urkunden-PDF erzeugen, drucken — auch direkt nach „Pool abschließen".

**Architecture:** Reine, geteilte Module in `src/shared/` (Platzierungen, Text-Anpassung, Schriftliste) laufen in Browser und Server. Der Server rendert mit pdf-lib + fontkit (`urkundenRenderer.js`) aus Datensätzen von `urkundenDaten.js`; REST unter `/api/urkunden`. Frontend `urkunden.html` (Fabric-Editor + Generieren) und das gemeinsame Vorschau-Modul `urkundenDruck.js`.

**Tech Stack:** Node/Express (ESM), Knex (SQLite/PostgreSQL), pdf-lib, @pdf-lib/fontkit, fabric, pdfjs-dist, node:test, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-29-urkunden-generator-design.md` — vor jedem Task den zugehörigen Abschnitt lesen; der Plan wiederholt die Spec nicht vollständig.

## Global Constraints

- Branch `feature/urkunden-generator`; Commit-Messages deutsch, Präfix `feat(urkunden):` / `test(urkunden):` / `refactor(siegerliste):`, Abschlusszeile `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- `src/shared/` bleibt frei von knex, DOM und Node-APIs (läuft im Browser über `/js/shared`); relative Imports mit `.js`-Endung.
- Kampf-Schlüssel ist `kaempfe.reihenfolge_nummer` bzw. `mannschaftskaempfe.reihenfolge_nummer` (`'F'`, `'F1'`, `'T3'`, `'V_A_1'`, …); „fertig" heißt `status` ∈ {`beendet`, `freilos`}.
- Platzierungsregeln exakt nach Spec-Tabelle „Platzierungen je Modus"; Jeder-gegen-Jeden-Rangfolge wie bisher in `siegerliste.js` (Vorsortierung nach Gewicht, dann Siege, dann Summe der `unterbewertung_*` der gewonnenen Kämpfe).
- Platzhalter genau: `{Name}` `{Verein}` `{Platzierung}` `{Altersklasse}` `{Geschlecht}` `{Gewichtsklasse}` `{Mannschaft}`; `{Platzierung}` = „1. Platz" … bzw. „Teilnahme".
- Feld-Koordinaten in pt, Ursprung oben links, `y` = Zeilen-Oberkante. Validierung: Schrift-ID bekannt, `groesse` 4–200, Farbe `#rrggbb`, Rahmen in der Seite, ≤ 50 Felder, Text ≤ 200 Zeichen.
- Verkleinerung in 0,5-pt-Schritten bis minimal 50 % der Ausgangsgröße; passt es dann nicht → drucken + Warnung.
- PDF-Upload ≤ 10 MB (Rohbytes), verschlüsselt/ungültig → 400. Globales `express.json({ limit: '15mb' })` in `src/app.js` reicht für 10 MB als Base64 — nicht ändern.
- `platzbereich` wird als String gespeichert/übertragen: `'3'|'5'|'7'|'alle'`; `reihenfolge`: `'siegerehrung'|'aufsteigend'`.
- Keine Funktion auf Client-Geräten (`SYNC_ROLLE=client`), keine Spiegelung in die Dokument-DB.

## Review Focus

1. **Pool nur teilweise gespielt:** Plätze, die noch nicht feststehen, sind `null` und erzeugen bei 1.–N keine Urkunde (bei „alle" → „Teilnahme"); kein Absturz auf `undefined`-Kämpfen. → Test in Task 2.
2. **Freilos im Doppel-KO (z. B. 5 Teilnehmer im DK8):** Aus `T1`/`T2`/`T3`/`T4` mit `status='freilos'` entsteht kein Platz 5/7 für einen leeren Slot. → Test in Task 2.
3. **Sonderzeichen/leere Werte:** Name „Łukasz Şahin", Verein leer, `gewichtsklasse` null → kein Crash, leerer String statt „null"/„undefined". → Tests in Task 3 und Task 4.
4. **Vorlage eines fremden Vereins:** Zugriff per ID auf eine Vorlage eines anderen Vereins (online) → 403, auch bei `/generieren` und `/vorlagen/:id/pdf`. → Test in Task 6 (Unit der Rechteprüfung).
5. **Pool-Abschluss ohne Vorlage/ohne Urkunden:** kein Dialog, keine Fehlermeldung, Pool trotzdem abgeschlossen. → E2E in Task 9.

---

## Dateistruktur

| Datei | Verantwortung |
|---|---|
| `src/shared/platzierungen.js` (neu) | Plätze je Pool (Einzel + Mannschaft) |
| `src/shared/urkundenText.js` (neu) | Platzhalter, Verkleinerung, x-Position, `platzierungsText` |
| `src/shared/urkundenSchriften.js` (neu) | Schriftliste |
| `src/shared/gruppenUeberkreuzProgression.js` | `berechneGruppenRangliste` exportieren |
| `public/fonts/urkunden/*.ttf` + `OFL-*.txt` (neu) | Schriften |
| `migrations/20260929100000_create_urkunden_vorlagen.js` (neu) | Tabelle |
| `src/services/urkundenRenderer.js` (neu) | pdf-lib-Rendering |
| `src/services/urkundenDaten.js` (neu) | DB → Datensätze |
| `src/controllers/urkundenController.js` (neu) | HTTP, Validierung, Rechte |
| `src/routes/urkundenRoutes.js` (neu) | Routen |
| `src/app.js`, `src/middleware/nurMaster.js` | Mount, Static-Mounts, Ausnahme |
| `src/controllers/turnierController.js` | Export/Import der Vorlagen |
| `public/urkunden.html`, `public/js/urkunden.js` (neu) | Editor + Generieren |
| `public/js/urkundenDruck.js` (neu) | Vorschau-Modal, Angebot nach Abschluss |
| `public/js/siegerliste.js`, `public/siegerliste.html` | Umstellung auf `platzierungen.js` |
| `public/js/pools.js`, `public/js/mannschaften.js`, `public/pools.html`, `public/mannschaften.html`, `public/js/menu.js` | Einbindung |
| `tests/unit/platzierungen.test.js`, `urkundenText.test.js`, `urkundenRenderer.test.js`, `urkundenRechte.test.js` (neu) | Unit |
| `tests/e2e/urkunden.spec.js`, `tests/e2e/fixtures/urkunde-blanko.pdf` (neu) | E2E |

---

### Task 1: Abhängigkeiten, Schriften, Schriftliste

**Files:**
- Modify: `package.json` (via npm)
- Create: `public/fonts/urkunden/` (8 Dateien), `src/shared/urkundenSchriften.js`
- Modify: `src/app.js:186-191` (Static-Mounts)
- Test: `tests/unit/urkundenSchriften.test.js`

**Interfaces:**
- Produces: `URKUNDEN_SCHRIFTEN: Array<{ id: string, anzeigename: string, datei: string }>`, `findeSchrift(id) → Eintrag|undefined`, `STANDARD_SCHRIFT_ID = 'noto-sans'`. URL im Browser: `/fonts/urkunden/<datei>`; am Server: `path.join(projektRoot, 'public/fonts/urkunden', datei)`. Static-Mounts `/js/fabric` → `node_modules/fabric/dist`, `/js/pdfjs` → `node_modules/pdfjs-dist/build`.

- [ ] **Step 1:** `npm install pdf-lib @pdf-lib/fontkit fabric pdfjs-dist` (Versionen im Commit notieren). Prüfen: `ls node_modules/fabric/dist` enthält `index.min.js` (fabric ≥ 6, UMD, globales `fabric`) und `node_modules/pdfjs-dist/build/pdf.min.mjs` + `pdf.worker.min.mjs`. Heißen die Dateien anders, die tatsächlichen Namen in Task 8 verwenden.
- [ ] **Step 2:** Schriften laden (TTF, statische Instanzen, aus dem Google-Fonts-Repo `github.com/google/fonts`, Ordner `ofl/...`, bzw. `notofonts`): `NotoSans-Regular.ttf`, `NotoSans-Bold.ttf`, `NotoSerif-Regular.ttf`, `NotoSerif-Bold.ttf`, `GreatVibes-Regular.ttf`, `Cinzel-Regular.ttf` (bei variabler Cinzel die statische Regular-Instanz; notfalls `Cinzel[wght].ttf` unter diesem Namen, fontkit nutzt die Default-Instanz) sowie je Familie `OFL-<Familie>.txt`. Nach `public/fonts/urkunden/`.
- [ ] **Step 3: Failing Test** `tests/unit/urkundenSchriften.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { URKUNDEN_SCHRIFTEN, findeSchrift, STANDARD_SCHRIFT_ID } from '../../src/shared/urkundenSchriften.js';

test('jede Schrift hat eine vorhandene Datei', () => {
    assert.equal(URKUNDEN_SCHRIFTEN.length, 6);
    for (const s of URKUNDEN_SCHRIFTEN) {
        assert.ok(fs.existsSync(path.join('public/fonts/urkunden', s.datei)), s.datei);
    }
});
test('findeSchrift', () => {
    assert.equal(findeSchrift(STANDARD_SCHRIFT_ID).datei, 'NotoSans-Regular.ttf');
    assert.equal(findeSchrift('gibtsnicht'), undefined);
});
```

- [ ] **Step 4:** `npm run test:unit` → FAIL (Modul fehlt).
- [ ] **Step 5:** `src/shared/urkundenSchriften.js`:

```js
// Mitgelieferte Urkunden-Schriften (SIL OFL, Dateien in public/fonts/urkunden/). Browser lädt sie
// per FontFace, der Server bettet dieselben Dateien per fontkit ein (urkundenRenderer.js).
export const URKUNDEN_SCHRIFTEN = [
    { id: 'noto-sans', anzeigename: 'Noto Sans', datei: 'NotoSans-Regular.ttf' },
    { id: 'noto-sans-bold', anzeigename: 'Noto Sans Fett', datei: 'NotoSans-Bold.ttf' },
    { id: 'noto-serif', anzeigename: 'Noto Serif', datei: 'NotoSerif-Regular.ttf' },
    { id: 'noto-serif-bold', anzeigename: 'Noto Serif Fett', datei: 'NotoSerif-Bold.ttf' },
    { id: 'great-vibes', anzeigename: 'Great Vibes (Schreibschrift)', datei: 'GreatVibes-Regular.ttf' },
    { id: 'cinzel', anzeigename: 'Cinzel (Titel)', datei: 'Cinzel-Regular.ttf' }
];
export const STANDARD_SCHRIFT_ID = 'noto-sans';
export function findeSchrift(id) {
    return URKUNDEN_SCHRIFTEN.find(s => s.id === id);
}
```

  In `src/app.js` nach Zeile 188 ergänzen:

```js
app.use('/js/fabric', express.static(path.join(__dirname, '../node_modules/fabric/dist')));
app.use('/js/pdfjs', express.static(path.join(__dirname, '../node_modules/pdfjs-dist/build')));
```

- [ ] **Step 6:** `npm run test:unit` → PASS.
- [ ] **Step 7:** Commit `feat(urkunden): Abhängigkeiten, Schriften und Schriftliste`.

---

### Task 2: `platzierungen.js`

**Files:**
- Create: `src/shared/platzierungen.js`
- Modify: `src/shared/gruppenUeberkreuzProgression.js:28` (`export function berechneGruppenRangliste`)
- Test: `tests/unit/platzierungen.test.js`

**Interfaces:**
- Consumes: `berechneGruppenRangliste(kaempfe, praefix) → [{ id, siege, unterbewertung }]` (Präfixe `'V_A_'`, `'V_B_'`).
- Produces:
  - `berechnePlatzierungen(pool, kaempfe, teilnehmer) → { abgeschlossen: boolean, eintraege: [{ platz: number|null, teilnehmer }] }` — `pool.modus` ∈ `'Jeder-gegen-Jeden'|'Jeder gegen Jeden'|'Doppel-KO-8'|'Doppel-KO-16'|'Doppel-KO-32'|'Gruppen-Überkreuz'|'Gruppen-ueberkreuz'`. `eintraege` enthält **jede:n** Teilnehmer:in genau einmal, sortiert nach Platz aufsteigend, `null` am Ende.
  - `berechneMannschaftsPlatzierungen(pool, begegnungen, mannschaften) → { abgeschlossen, eintraege: [{ platz, mannschaft }] }` — Begegnungsfelder `mannschaft1_id`, `mannschaft2_id`, `sieger_mannschaft_id`, `status`, `reihenfolge_nummer`, `siegpunkte_mannschaft1/2`, `wertungspunkte_mannschaft1/2`.

**Regeln (aus der Spec, hier verbindlich):**
- Hilfsfunktion `fertig(k) = k && (k.status === 'beendet' || k.status === 'freilos')`; `verlierer(k)` = der Kämpfer ≠ `sieger_id`, aber nur bei `status === 'beendet'` und beiden Kämpfern gesetzt (Freilos → kein Verlierer).
- 1 Teilnehmer → Platz 1, `abgeschlossen: true`.
- JGJ: Rangfolge wie Global Constraints; Platz = Index+1; `abgeschlossen` = alle Kämpfe fertig; ist der Pool nicht abgeschlossen, sind **alle** Plätze `null`.
- DK: Schlüssel je Modus (`final`, `bronze`, `trost`): DK8 `F`, `[T3,T4]`, `[T1,T2]`; DK16 `F1`, `[T11,T12]`, `[T9,T10]`; DK32 `F1`, `[T27,T28]`, `[T25,T26]`. Finale fertig → Sieger 1, Verlierer 2; Bronze fertig → Sieger 3, Verlierer 5; Trost fertig → Verlierer 7. Jeder Platz wird gesetzt, sobald sein Kampf fertig ist. `abgeschlossen` = Finale und beide Bronzekämpfe fertig.
- Überkreuz: `F1` → 1/2, `F2` → Sieger 3 / Verlierer 4; Gruppenplatz 3 (Index 2) beider Gruppen → 5, Gruppenplatz 4 → 7 — nur wenn alle Kämpfe der jeweiligen Gruppe fertig sind. `abgeschlossen` = `F1` und `F2` fertig.
- Mannschaft: gleiche Logik mit Begegnungen (Sieger = `sieger_mannschaft_id`); JGJ-Rangfolge Begegnungssiege, dann Summe `siegpunkte_*` (Einzelsiege), dann Summe `wertungspunkte_*`; Mannschaftsmodi `Jeder-gegen-Jeden`, `Doppel-KO-8`, `Doppel-KO-16`.

- [ ] **Step 1: Failing Tests** `tests/unit/platzierungen.test.js` — mit kleinem Fabrik-Helfer:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { berechnePlatzierungen, berechneMannschaftsPlatzierungen } from '../../src/shared/platzierungen.js';

const tn = n => Array.from({ length: n }, (_, i) => ({ id: i + 1, nachname: `N${i + 1}`, gewicht: 30 + i }));
const k = (nr, k1, k2, sieger, status = 'beendet', u1 = 0, u2 = 0) =>
    ({ reihenfolge_nummer: nr, kaempfer1_id: k1, kaempfer2_id: k2, sieger_id: sieger, status,
       unterbewertung_kaempfer1: u1, unterbewertung_kaempfer2: u2 });
const plaetze = r => Object.fromEntries(r.eintraege.map(e => [e.teilnehmer.id, e.platz]));

test('DK8 vollständig: 1,2,3,3,5,5,7,7', () => {
    const kaempfe = [k('T1', 5, 6, 5), k('T2', 7, 8, 7), k('T3', 3, 5, 3), k('T4', 4, 7, 4), k('F', 1, 2, 1)];
    const r = berechnePlatzierungen({ modus: 'Doppel-KO-8' }, kaempfe, tn(8));
    assert.equal(r.abgeschlossen, true);
    assert.deepEqual(plaetze(r), { 1: 1, 2: 2, 3: 3, 4: 3, 5: 5, 6: 7, 7: 5, 8: 7 });
});
test('DK8 Freilos in T1 erzeugt keinen Platz 7', () => {
    const kaempfe = [k('T1', 5, null, 5, 'freilos'), k('T2', 7, 8, 7), k('T3', 3, 5, 3), k('T4', 4, 7, 4), k('F', 1, 2, 1)];
    const r = berechnePlatzierungen({ modus: 'Doppel-KO-8' }, kaempfe, tn(8));
    assert.equal(plaetze(r)[8], 7);
    assert.equal(r.eintraege.filter(e => e.platz === 7).length, 1);
});
test('DK8 unvollständig: nur fertige Plätze, abgeschlossen=false', () => {
    const kaempfe = [k('T1', 5, 6, 5), k('T3', 3, 5, null, 'angelegt'), k('F', 1, 2, null, 'angelegt')];
    const r = berechnePlatzierungen({ modus: 'Doppel-KO-8' }, kaempfe, tn(6));
    assert.equal(r.abgeschlossen, false);
    assert.equal(plaetze(r)[6], 7);
    assert.equal(plaetze(r)[1], null);
    assert.equal(r.eintraege.at(-1).platz, null);
});
test('DK16 nutzt F1/T11/T12/T9/T10', () => {
    const kaempfe = [k('T9', 5, 6, 5), k('T10', 7, 8, 7), k('T11', 3, 5, 3), k('T12', 4, 7, 4), k('F1', 1, 2, 2)];
    const r = berechnePlatzierungen({ modus: 'Doppel-KO-16' }, kaempfe, tn(8));
    assert.deepEqual([1, 2, 5, 6].map(i => plaetze(r)[i]), [2, 1, 5, 7]);
});
test('DK32 nutzt F1/T27/T28/T25/T26', () => {
    const kaempfe = [k('T25', 5, 6, 5), k('T26', 7, 8, 7), k('T27', 3, 5, 3), k('T28', 4, 7, 4), k('F1', 1, 2, 1)];
    assert.equal(plaetze(berechnePlatzierungen({ modus: 'Doppel-KO-32' }, kaempfe, tn(8)))[8], 7);
});
test('JGJ: Siege, dann Wertung; unvollständig → alle null', () => {
    const t = tn(3);
    const kaempfe = [k('1', 1, 2, 2, 'beendet', 0, 10), k('2', 1, 3, 1, 'beendet', 7, 0), k('3', 2, 3, 3, 'beendet', 0, 1)];
    // jede:r 1 Sieg; Wertung: 2→10, 1→7, 3→1
    assert.deepEqual(plaetze(berechnePlatzierungen({ modus: 'Jeder-gegen-Jeden' }, kaempfe, t)), { 2: 1, 1: 2, 3: 3 });
    kaempfe[2].status = 'angelegt';
    const r = berechnePlatzierungen({ modus: 'Jeder-gegen-Jeden' }, kaempfe, t);
    assert.equal(r.abgeschlossen, false);
    assert.ok(r.eintraege.every(e => e.platz === null));
});
test('ein Teilnehmer → Platz 1', () => {
    const r = berechnePlatzierungen({ modus: 'Doppel-KO-8' }, [], tn(1));
    assert.deepEqual([r.abgeschlossen, r.eintraege[0].platz], [true, 1]);
});
test('Überkreuz: F1, F2, Gruppenplatz 3 → 5', () => {
    // Gruppe A: 1,3,5; Gruppe B: 2,4,6 (je 3 Kämpfe)
    const kaempfe = [
        k('V_A_1', 1, 3, 1), k('V_A_2', 1, 5, 1), k('V_A_3', 3, 5, 3),
        k('V_B_1', 2, 4, 2), k('V_B_2', 2, 6, 2), k('V_B_3', 4, 6, 4),
        k('HF1', 1, 4, 1), k('HF2', 2, 3, 2), k('F1', 1, 2, 1), k('F2', 3, 4, 4)
    ];
    const r = berechnePlatzierungen({ modus: 'Gruppen-Überkreuz' }, kaempfe, tn(6));
    assert.deepEqual(plaetze(r), { 1: 1, 2: 2, 4: 3, 3: 4, 5: 5, 6: 5 });
});
test('Mannschaft DK8 und JGJ', () => {
    const m = [1, 2, 3, 4].map(id => ({ id, bezeichnung: `M${id}` }));
    const b = (nr, a, c, s, sp1 = 0, sp2 = 0, wp1 = 0, wp2 = 0) => ({ reihenfolge_nummer: nr, mannschaft1_id: a, mannschaft2_id: c,
        sieger_mannschaft_id: s, status: 'beendet', siegpunkte_mannschaft1: sp1, siegpunkte_mannschaft2: sp2,
        wertungspunkte_mannschaft1: wp1, wertungspunkte_mannschaft2: wp2 });
    const dk = berechneMannschaftsPlatzierungen({ modus: 'Doppel-KO-8' },
        [b('T3', 3, 4, 3), b('T4', 1, 2, 1), b('F', 1, 3, 3)], m);
    assert.equal(dk.eintraege.find(e => e.mannschaft.id === 3).platz, 1);
    const jgj = berechneMannschaftsPlatzierungen({ modus: 'Jeder-gegen-Jeden' },
        [b('1', 1, 2, 1, 3, 2), b('2', 1, 3, 3, 2, 3), b('3', 2, 3, 2, 4, 1)], m.slice(0, 3));
    // je 1 Begegnungssieg; Einzelsiege: M1=5, M2=6, M3=4
    assert.deepEqual(jgj.eintraege.map(e => e.mannschaft.id), [2, 1, 3]);
});
```

- [ ] **Step 2:** `npm run test:unit` → FAIL.
- [ ] **Step 3:** Implementieren. Gerüst (Einzel und Mannschaft teilen die Logik über einen Adapter `{ a, b, sieger }`):

```js
// Platzierungen je Pool — gemeinsame Berechnung für Siegerliste (Browser) und Urkunden (Server).
// Regeln: docs/superpowers/specs/2026-09-29-urkunden-generator-design.md, "Platzierungen je Modus".
import { berechneGruppenRangliste } from './gruppenUeberkreuzProgression.js';

const DK_SCHLUESSEL = {
    'Doppel-KO-8': { final: 'F', bronze: ['T3', 'T4'], trost: ['T1', 'T2'] },
    'Doppel-KO-16': { final: 'F1', bronze: ['T11', 'T12'], trost: ['T9', 'T10'] },
    'Doppel-KO-32': { final: 'F1', bronze: ['T27', 'T28'], trost: ['T25', 'T26'] }
};
const istJgj = m => m === 'Jeder-gegen-Jeden' || m === 'Jeder gegen Jeden';
const istUeberkreuz = m => m === 'Gruppen-Überkreuz' || m === 'Gruppen-ueberkreuz';
const fertig = k => !!k && (k.status === 'beendet' || k.status === 'freilos');

// adapter: { a(k), b(k), sieger(k) } liefert IDs der Slots/des Siegers
function verlierer(k, ad) {
    if (!k || k.status !== 'beendet' || !ad.a(k) || !ad.b(k) || !ad.sieger(k)) return null;
    return ad.sieger(k) === ad.a(k) ? ad.b(k) : ad.a(k);
}

function baueErgebnis(objekte, platzNachId, abgeschlossen, schluessel) {
    const eintraege = objekte.map(o => ({ platz: platzNachId.get(o.id) ?? null, [schluessel]: o }));
    eintraege.sort((x, y) => (x.platz ?? Infinity) - (y.platz ?? Infinity));
    return { abgeschlossen, eintraege };
}
```

  Danach `berechneKo(kaempfe, schl, ad) → { plaetze: Map, abgeschlossen }`, `berechneJgj(objekte, kaempfe, ad, vergleich)`, `berechneUeberkreuz(kaempfe, ad)` und die zwei exportierten Funktionen, die den passenden Zweig wählen. Einzel-Adapter: `a = k => k.kaempfer1_id`, `b = k => k.kaempfer2_id`, `sieger = k => k.sieger_id`; Mannschaft: `mannschaft1_id`, `mannschaft2_id`, `sieger_mannschaft_id`. JGJ-Einzel: Objekte vorher stabil nach `Number(gewicht)` sortieren. `set` nur, wenn die ID noch keinen Platz hat (sonst überschreibt Platz 7 nie einen besseren Platz — Reihenfolge der Auswertung: Finale, Bronze, Trost). Überkreuz Gruppenplätze nur, wenn alle `V_A_*` bzw. `V_B_*` fertig. Unbekannter Modus → alle `null`, `abgeschlossen: false`.
- [ ] **Step 4:** `npm run test:unit` → PASS.
- [ ] **Step 5:** Commit `feat(urkunden): gemeinsame Platzierungsberechnung inkl. Platz 5/7`.

---

### Task 3: Siegerliste auf `platzierungen.js` umstellen

**Files:**
- Modify: `public/js/siegerliste.js:15-107` (`berechnePoolStandings`), `public/siegerliste.html:89`
- Test: vorhandene `tests/e2e/siegerliste-dk8.spec.js` (+ alle Siegerliste-Specs, `npx playwright test tests/e2e/siegerliste`)

**Interfaces:**
- Consumes: `berechnePlatzierungen(pool, pool.kaempfe, pool.teilnehmer)` (Task 2). Rückgabe von `berechnePoolStandings` bleibt `{ platz1, platz2, platz3: [] }`, damit Render/Vereinswertung unverändert bleiben.

- [ ] **Step 1:** Baseline: `npx playwright test tests/e2e/siegerliste` → PASS notieren.
- [ ] **Step 2:** `public/siegerliste.html:89` auf `<script type="module" src="/js/siegerliste.js"></script>` ändern und in `siegerliste.js` oben `import { berechnePlatzierungen } from '/js/shared/platzierungen.js';` einfügen (Module laufen deferred — prüfen, dass der bestehende `DOMContentLoaded`-Listener noch feuert; falls die Datei im `DOMContentLoaded`-Handler startet, funktioniert das auch bei Modulen).
- [ ] **Step 3:** `berechnePoolStandings` ersetzen:

```js
function berechnePoolStandings(pool) {
    const { eintraege } = berechnePlatzierungen(pool, pool.kaempfe, pool.teilnehmer);
    const mitPlatz = p => eintraege.filter(e => e.platz === p).map(e => e.teilnehmer);
    return { platz1: mitPlatz(1)[0] || null, platz2: mitPlatz(2)[0] || null, platz3: mitPlatz(3) };
}
```

  Hinweis: Bei JGJ zeigte die alte Version auch bei unvollständigem Pool Plätze; die Siegerliste zeigt nur Pools mit `status === 'abgeschlossen'`, dort sind alle Kämpfe fertig — kein sichtbarer Unterschied.
- [ ] **Step 4:** `npx playwright test tests/e2e/siegerliste` → PASS (identisch zur Baseline).
- [ ] **Step 5:** Commit `refactor(siegerliste): Platzierungen aus shared/platzierungen.js`.

---

### Task 4: `urkundenText.js`

**Files:**
- Create: `src/shared/urkundenText.js`
- Test: `tests/unit/urkundenText.test.js`

**Interfaces:**
- Produces:
  - `ersetzePlatzhalter(text, datensatz) → string` — `{Schlüssel}` durch `datensatz[Schlüssel]`; fehlt der Schlüssel im Datensatz → Platzhalter bleibt; Wert `null/undefined` → `''`.
  - `passeGroesseAn(text, groesse, breite, misstBreite) → { groesse, passt }`.
  - `berechneX(ausrichtung, x, breite, textBreite) → number` (`links` → x, `zentriert` → x+(breite−tb)/2, `rechts` → x+breite−tb).
  - `platzierungsText(platz) → '3. Platz' | 'Teilnahme'`.
  - `geschlechtText(g) → 'männlich'|'weiblich'|g||''`.
  - `PLATZHALTER = ['Name','Verein','Platzierung','Altersklasse','Geschlecht','Gewichtsklasse','Mannschaft']`.

- [ ] **Step 1: Failing Tests:**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { ersetzePlatzhalter, passeGroesseAn, berechneX, platzierungsText, geschlechtText } from '../../src/shared/urkundenText.js';

test('ersetzePlatzhalter', () => {
    const d = { Name: 'Łukasz Şahin', Verein: null, Altersklasse: 'U15' };
    assert.equal(ersetzePlatzhalter('{Name} – {Verein}|{Altersklasse} {Foo}', d), 'Łukasz Şahin – |U15 {Foo}');
    assert.equal(ersetzePlatzhalter('Kreismeisterschaft 2026', d), 'Kreismeisterschaft 2026');
});
test('passeGroesseAn', () => {
    const misst = (t, g) => t.length * g * 0.5;
    assert.deepEqual(passeGroesseAn('abcd', 20, 100, misst), { groesse: 20, passt: true });   // 40
    assert.deepEqual(passeGroesseAn('a'.repeat(20), 20, 100, misst), { groesse: 10, passt: true }); // 20*10*0.5=100
    assert.deepEqual(passeGroesseAn('a'.repeat(40), 20, 100, misst), { groesse: 10, passt: false });
    assert.deepEqual(passeGroesseAn('a'.repeat(21), 20, 100, misst), { groesse: 10, passt: false }); // nie unter 50 %
});
test('berechneX', () => {
    assert.equal(berechneX('links', 10, 100, 40), 10);
    assert.equal(berechneX('zentriert', 10, 100, 40), 40);
    assert.equal(berechneX('rechts', 10, 100, 40), 70);
});
test('Texte', () => {
    assert.equal(platzierungsText(5), '5. Platz');
    assert.equal(platzierungsText(null), 'Teilnahme');
    assert.equal(geschlechtText('w'), 'weiblich');
    assert.equal(geschlechtText(null), '');
});
```- [ ] **Step 2:** `npm run test:unit` → FAIL.
- [ ] **Step 3:** Implementieren:

```js
export function passeGroesseAn(text, groesse, breite, misstBreite) {
    const minimum = groesse / 2;
    let g = groesse;
    while (misstBreite(text, g) > breite && g - 0.5 >= minimum) g -= 0.5;
    return { groesse: g, passt: misstBreite(text, g) <= breite };
}
export function ersetzePlatzhalter(text, datensatz) {
    return text.replace(/\{([^{}]+)\}/g, (roh, schluessel) =>
        Object.prototype.hasOwnProperty.call(datensatz, schluessel) ? String(datensatz[schluessel] ?? '') : roh);
}
```

  Rest gemäß Interfaces.
- [ ] **Step 4:** PASS. **Step 5:** Commit `feat(urkunden): Platzhalter und Textanpassung`.

---

### Task 5: Migration + Renderer

**Files:**
- Create: `migrations/20260929100000_create_urkunden_vorlagen.js`, `src/services/urkundenRenderer.js`
- Test: `tests/unit/urkundenRenderer.test.js`

**Interfaces:**
- Consumes: `findeSchrift` (Task 1), `ersetzePlatzhalter`, `passeGroesseAn`, `berechneX` (Task 4).
- Produces:
  - `leseVorlagenPdf(bytes) → Promise<{ breite, hoehe }>` — wirft `FehlerUngueltigesPdf` (Klasse exportiert, `message` deutsch) bei ungültig/verschlüsselt/0 Seiten; Größe aus Seite 1, bei `/Rotate` 90/270 Breite↔Höhe vertauscht.
  - `renderUrkunden({ pdfBytes, felder, datensaetze }) → Promise<{ bytes: Uint8Array, warnungen: [{ seite, name, feld, grund }] }>` — `grund` ∈ `'zu_lang'|'zeichen_fehlt'`; `feld` = Feld-`text`; `name` = `datensatz.Name`.
  - Migration: Spalten laut Spec-Tabelle (inkl. `platzbereich`, `reihenfolge`, `bei_abschluss_anbieten`).

- [ ] **Step 1:** Migration schreiben:

```js
export async function up(knex) {
    await knex.schema.createTable('urkunden_vorlagen', table => {
        table.increments('id').primary();
        table.integer('verein_id').unsigned().notNullable().references('id').inTable('vereine').onDelete('CASCADE');
        table.string('name').notNullable();
        table.binary('pdf').notNullable();
        table.string('pdf_dateiname');
        table.float('seiten_breite_pt').notNullable();
        table.float('seiten_hoehe_pt').notNullable();
        table.text('felder').notNullable().defaultTo('[]');
        table.string('platzbereich').notNullable().defaultTo('3');
        table.string('reihenfolge').notNullable().defaultTo('siegerehrung');
        table.boolean('bei_abschluss_anbieten').notNullable().defaultTo(false);
        table.timestamps(true, true);
        table.unique(['verein_id', 'name']);
    });
}
export async function down(knex) { await knex.schema.dropTableIfExists('urkunden_vorlagen'); }
```

  Prüfen, ob andere Migrationen `export async function` oder `exports.up` nutzen — Stil übernehmen. `npx knex migrate:latest --knexfile knexfile.cjs --env offline` → OK.
- [ ] **Step 2: Failing Test** `tests/unit/urkundenRenderer.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, degrees } from 'pdf-lib';
import { renderUrkunden, leseVorlagenPdf, FehlerUngueltigesPdf } from '../../src/services/urkundenRenderer.js';

async function blanko(rotate = 0) {
    const d = await PDFDocument.create();
    const p = d.addPage([595.28, 841.89]);
    if (rotate) p.setRotation(degrees(rotate));
    return d.save();
}
const feld = (text, breite = 400) => ({ id: 'f', text, x: 97, y: 400, breite, schrift: 'noto-serif-bold', groesse: 30, farbe: '#112233', ausrichtung: 'zentriert' });

test('3 Datensätze → 3 Seiten, Sonderzeichen ohne Warnung', async () => {
    const r = await renderUrkunden({ pdfBytes: await blanko(), felder: [feld('{Name}'), feld('Kreismeisterschaft')],
        datensaetze: [{ Name: 'Łukasz Şahin' }, { Name: 'Anna' }, { Name: 'Đorđe' }] });
    assert.equal((await PDFDocument.load(r.bytes)).getPageCount(), 3);
    assert.deepEqual(r.warnungen, []);
});
test('zu langer Text → Warnung zu_lang auf Seite 1', async () => {
    const r = await renderUrkunden({ pdfBytes: await blanko(), felder: [feld('{Name}', 50)], datensaetze: [{ Name: 'Maximiliane Mustermann-Schmidt' }] });
    assert.deepEqual(r.warnungen.map(w => [w.seite, w.grund]), [[1, 'zu_lang']]);
});
test('fehlendes Zeichen → Warnung', async () => {
    const r = await renderUrkunden({ pdfBytes: await blanko(), felder: [feld('{Name}')], datensaetze: [{ Name: '李雷' }] });
    assert.equal(r.warnungen[0].grund, 'zeichen_fehlt');
});
test('leseVorlagenPdf: Rotation und ungültig', async () => {
    assert.deepEqual(await leseVorlagenPdf(await blanko(90)), { breite: 841.89, hoehe: 595.28 });
    await assert.rejects(leseVorlagenPdf(new Uint8Array([1, 2, 3])), FehlerUngueltigesPdf);
});
```

- [ ] **Step 3:** FAIL. **Step 4:** Implementieren — Kernpunkte:
  - `PDFDocument.load(bytes)` (ohne `ignoreEncryption`; `EncryptedPDFError` und jeder andere Fehler → `FehlerUngueltigesPdf`).
  - `ziel = await PDFDocument.create(); ziel.registerFontkit(fontkit)`; Schriften je ID einmal `ziel.embedFont(bytes, { subset: true })`, Bytes per `fs.readFile` aus `public/fonts/urkunden` (Pfad relativ zu `import.meta.url`: `new URL('../../public/fonts/urkunden/', import.meta.url)`) mit Modul-Cache.
  - Fehlende Zeichen: vor dem Zeichnen `font.getCharacterSet()` (Set von Codepoints) gegen `[...text].map(c => c.codePointAt(0))` prüfen; fehlende Zeichen durch `'?'` ersetzen und Warnung `zeichen_fehlt`, sonst wirft `drawText`.
  - Seiten: `const hintergrund = await ziel.embedPage(quelle.getPage(0))` **einmal**, dann je Datensatz `ziel.addPage([breite, hoehe])` + `page.drawPage(hintergrund, …)` — so liegt die Vorlage nur einmal im PDF (Abweichung von „copyPages" in der Spec, gleiches Ergebnis, kleinere Datei). Zusatztest: 100 Datensätze → `r.bytes.length < pdfBytes.length + 1_000_000`.
  - Umrechnung bei Rotation 0: `pdfY = hoehe - y - font.heightAtSize(g, { descender: false })`; `drawText(text, { x: berechneX(...), y: pdfY, size: g, font, color: rgb(r/255,g/255,b/255) })`. Rotierte Vorlagen: bei `drawPage`-Variante wird die Seite mit der **sichtbaren** Größe `{breite, hoehe}` angelegt und die eingebettete Seite gedreht gezeichnet (`drawPage(e, { x, y, rotate: degrees(-rot) })` mit passendem Versatz) — im Test mit `blanko(90)` + einem Feld auf Seitenanzahl/keinen Fehler prüfen.
- [ ] **Step 5:** PASS. **Step 6:** Commit `feat(urkunden): Tabelle urkunden_vorlagen und PDF-Renderer`.

---

### Task 6: Datenaufbereitung, Controller, Routen

**Files:**
- Create: `src/services/urkundenDaten.js`, `src/controllers/urkundenController.js`, `src/routes/urkundenRoutes.js`
- Modify: `src/app.js:182` (Mount), `src/middleware/nurMaster.js:4`
- Test: `tests/unit/urkundenRechte.test.js`, `tests/e2e/urkunden.spec.js` (API-Teil), `tests/e2e/fixtures/urkunde-blanko.pdf`

**Interfaces:**
- Consumes: Tasks 2, 4, 5; `hatVereinsZugriffAufTurnier(user, turnier)` und `ladeBenutzerMitAktivemVerein(knex, benutzerId)` aus `src/utils/vereinHelper.js` (Nutzungsmuster in `mannschaftController.js:86,188` ansehen).
- Produces:
  - `ladeUrkundenDaten(knex, turnierId, { platzbereich, poolIds, reihenfolge }) → Promise<Array<Datensatz>>` — `Datensatz = { Name, Verein, Platzierung, Altersklasse, Geschlecht, Gewichtsklasse, Mannschaft, _poolId }`.
  - `ladeUebersicht(knex, turnierId) → Promise<{ pools: [{ id, bezeichnung, typ, status, abgeschlossen, anzahl: { '3','5','7','alle' } }], beispiel: Datensatz }>`.
  - `darfVorlageNutzen(user, vorlage, istOffline) → boolean` (rein, exportiert aus dem Controller; offline immer true, sonst `user.verein_id === vorlage.verein_id` bzw. Feldname so, wie `ladeBenutzerMitAktivemVerein` ihn liefert).
  - HTTP laut Spec-Tabelle, plus `GET /abschluss-angebot?poolId=`.

- [ ] **Step 1:** `ladeUrkundenDaten`: Pools des Turniers (Filter `poolIds`), je Pool Kämpfe/Teilnehmer (`turnier_teilnehmer` mit `pool_id` — Feldnamen in `poolController.getPoolsMitDetails` nachsehen und dieselbe Abfrage nutzen) bzw. Begegnungen/Mannschaften/Mitglieder (`mannschaft_mitglieder` join `turnier_teilnehmer`). Filter: `platzbereich === 'alle'` → alle Einträge, sonst `platz !== null && platz <= Number(platzbereich)`. Sortierung Pools: `altersklasse`, `geschlecht`, `gewichtsklasse` (numerisch über `parseFloat` des Betrags, `+` hinten) wie in `siegerliste.js` `renderPlatzierungen` — dort die Sortierung nachsehen und übernehmen; Einzel vor Mannschaft. Innerhalb: `siegerehrung` → `null` zuerst, dann Platz absteigend; `aufsteigend` umgekehrt; Gleichstand → `nachname` (`localeCompare 'de'`), Mitglieder nach Position in `pools.mannschafts_gewichtsklassen`. Werte: `Name = \`${vorname} ${nachname}\`.trim()`, `Verein = teilnehmer.verein ?? ''`, `Gewichtsklasse = pool.gewichtsklasse ?? ''` (Mitglied: `mannschaft_mitglieder.gewichtsklasse`), `Mannschaft = ''` bei Einzel.
- [ ] **Step 2: Failing Unit** `tests/unit/urkundenRechte.test.js`: `darfVorlageNutzen({ verein_id: 1 }, { verein_id: 2 }, false) === false`, `(…, 1 vs 1, false) === true`, `(…, 1 vs 2, true) === true`. Controller-Datei darf dafür keine Seiteneffekte beim Import haben. → FAIL → implementieren → PASS.
- [ ] **Step 3:** Controller + Routen. Validierung `pruefeFelder(felder, breite, hoehe) → string|null` (Fehlermeldung) nach Global Constraints; Rahmen: `x >= 0 && y >= 0 && x + breite <= seitenBreite + 0.5 && y + groesse <= seitenHoehe + 0.5`. Upload: `Buffer.from(pdf_base64, 'base64')`, `> 10 * 1024 * 1024` → 400 „Die PDF-Datei ist größer als 10 MB."; `leseVorlagenPdf` → bei `FehlerUngueltigesPdf` 400. Unique-Verletzung → 409 „Eine Vorlage mit diesem Namen gibt es bereits." (vor dem Insert per Select prüfen, DB-unabhängig). `bei_abschluss_anbieten: true` → in einer Transaktion alle anderen Vorlagen des Vereins auf `false`. Listen ohne `pdf`-Spalte selektieren. `/generieren`: Vorlage laden, `darfVorlageNutzen`, Datensätze, leer → 422 `{ success:false, error:'Für diese Auswahl gibt es keine Urkunden.' }`, sonst `renderUrkunden`, Header laut Spec (`X-Urkunden-Warnungen: encodeURIComponent(JSON.stringify(warnungen.slice(0, 50)))`), `res.type('application/pdf').send(Buffer.from(bytes))`. `/abschluss-angebot`: Pool → Turnier → Vorlage `where({ verein_id: turnier.verein_id, bei_abschluss_anbieten: true })`; `anzahl = (await ladeUrkundenDaten(..., { platzbereich: v.platzbereich, poolIds: [poolId], reihenfolge: v.reihenfolge })).length`. Rechte online: Turnier laden, `hatVereinsZugriffAufTurnier` sonst 403; Offline durchwinken (Muster `mannschaftController.js:86`). Auf Client-Geräten nicht gemountet (Mount im selben Block wie die übrigen `/api/*`-Routen in `src/app.js:176-182`, der nur mit relationaler DB läuft — prüfen).
- [ ] **Step 4:** `nurMaster.js`: `const AUSNAHMEN = ['/cluster', '/auth', '/sync/test', '/urkunden/generieren'];` und Kommentar ergänzen („Urkunden generieren schreibt nichts").
- [ ] **Step 5: Fixture** `tests/e2e/fixtures/urkunde-blanko.pdf` per Einmal-Skript im Scratchpad erzeugen (A4 hoch, pdf-lib, Rahmenlinie) und committen.
- [ ] **Step 6: E2E API-Teil** `tests/e2e/urkunden.spec.js` (seriell, `test.describe.configure({ mode: 'serial' })`): mit `ladeUndErstelleTurnier(request, require('./fixtures/pool-ko-doppel-ko8.json'))` + `spieleBracketKomplettDurch` (Import per `fs.readFileSync` + `JSON.parse`, wie in `pools-bracket-anzeige-*.spec.js`); Vorlage anlegen (`POST /api/urkunden/vorlagen` mit Base64 der Fixture) → 200 mit `id`; zweites Mal gleicher Name → 409; ungültiges PDF → 400; `PUT` mit Feld außerhalb der Seite → 400; `PUT` gültiges Feld `{Name}`; `POST /generieren` mit `platzbereich: '3'` → Seitenzahl (`PDFDocument.load(await resp.body())`) = Anzahl Einträge mit Platz ≤ 3 laut `GET /uebersicht` (`anzahl['3']`), ebenso `'7'` und `'alle'` (= Teilnehmerzahl); `Content-Type` `application/pdf`. Leere Auswahl (`poolIds: []`) → 422.
- [ ] **Step 7:** `npx playwright test tests/e2e/urkunden.spec.js` + `npm run test:unit` → PASS. Commit `feat(urkunden): API für Vorlagen und Generierung`.

---

### Task 7: Turnier-Export/-Import

**Files:**
- Modify: `src/controllers/turnierController.js` (`exportTurnier` ~Z. 867, `importTurnier` ~Z. 651)
- Test: `tests/e2e/urkunden.spec.js` (Export-Teil); Import-Rundreise in `tests/e2e-vollablauf/turnier-vollablauf.spec.js`

**Interfaces:**
- Produces: Exportfeld `urkunden_vorlagen: [{ name, pdf_base64, pdf_dateiname, seiten_breite_pt, seiten_hoehe_pt, felder, platzbereich, reihenfolge, bei_abschluss_anbieten }]` (`felder` als geparstes Array).

- [ ] **Step 1: Failing E2E:** `GET /api/turniere/:id/export` enthält `urkunden_vorlagen` mit der Vorlage aus Task 6 (Name, `felder.length === 1`, `pdf_base64` nicht leer).
- [ ] **Step 2:** `exportTurnier`: Vorlagen `where({ verein_id: turnier.verein_id })`, Binary → Base64 (Muster `baueAusschreibungFragment`).
- [ ] **Step 3:** `importTurnier`: nach dem Zuordnen/Anlegen des Vereins je Vorlage: vorhandene gleichnamige des Vereins löschen, neu einfügen (`Buffer.from(pdf_base64,'base64')`, `felder` → `JSON.stringify`); `bei_abschluss_anbieten`-Eindeutigkeit wie in Task 6 sicherstellen. Fehlt das Feld → nichts tun. `importTurnierErgebnisse` nicht anfassen.
- [ ] **Step 4:** Vollablauf-Spec: vor dem Export in der Cloud eine Vorlage anlegen (API), nach dem Import am Offline-Server `GET /api/urkunden/vorlagen?turnierId=` → Name vorhanden, `felder` gleich. Nur lokal ausführbar (`npm run test:e2e:vollablauf`, schreibt in die Cloud-DB) — ausführen, wenn Zugangsdaten vorhanden, sonst im Abschlussbericht vermerken.
- [ ] **Step 5:** PASS. Commit `feat(urkunden): Vorlagen im Turnier-Export/-Import`.

---

### Task 8: Frontend `urkunden.html`, `urkunden.js`, `urkundenDruck.js`, Menü

**Files:**
- Create: `public/urkunden.html`, `public/js/urkunden.js`, `public/js/urkundenDruck.js`
- Modify: `public/js/menu.js` (nach `nav-siegerliste`)
- Test: `tests/e2e/urkunden.spec.js` (UI-Teil)

**Interfaces:**
- Consumes: REST aus Task 6; `URKUNDEN_SCHRIFTEN`, `findeSchrift` (Task 1); `ersetzePlatzhalter`, `passeGroesseAn`, `berechneX`, `PLATZHALTER` (Task 4).
- Produces (`urkundenDruck.js`, ES-Modul; setzt zusätzlich `window.hajimeUrkunden = { zeigeUrkundenVorschau }`, Task 9 ergänzt dort `bieteUrkundenNachAbschlussAn`):
  - `zeigeUrkundenVorschau({ turnierId, vorlageId, platzbereich, reihenfolge, poolIds }, { autoDruck = false } = {}) → Promise<void>`

- [ ] **Step 1:** `urkunden.html` nach dem Muster von `siegerliste.html` (Head, Material-CSS, `menu.js`), zwei Karten mit festen IDs: `#vorlagenAuswahl`, `#btnVorlageNeu`, `#btnVorlageDuplizieren`, `#btnVorlageUmbenennen`, `#btnVorlageLoeschen`, `#editorContainer` (enthält `<canvas id="urkundenCanvas">`), `#btnFeldPlatzhalter`, `#btnFeldText`, Werkzeugleiste `#feldText`, `#feldSchrift`, `#feldGroesse`, `#feldFarbe`, `#feldAusrichtung`, `#btnFeldZentrieren`, `#btnFeldLoeschen`, Platzhalter-Knöpfe `.platzhalter-btn[data-platzhalter]`, `#schalterBeispiel`, Voreinstellungen `#vorlagePlatzbereich`, `#vorlageReihenfolge`, `#vorlageBeiAbschluss`, `#btnVorlageSpeichern`; Karte 2: `#genVorlage`, `#genPlatzbereich`, `#genReihenfolge`, `#genPoolListe` (Checkboxen `input[data-pool-id]`), `#genAnzahl`, `#btnGenerieren`; Hinweis `#hallenHinweis` (sichtbar, wenn `/api/sync/status` Server-Rolle meldet): „Änderungen an Vorlagen werden nicht in die Cloud übertragen." Scripts: `<script src="/js/fabric/index.min.js"></script>`, `<script type="module" src="/js/urkunden.js"></script>`.
- [ ] **Step 2:** `urkunden.js` — Kernlogik:
  - pdf.js: `const pdfjs = await import('/js/pdfjs/pdf.min.mjs'); pdfjs.GlobalWorkerOptions.workerSrc = '/js/pdfjs/pdf.worker.min.mjs';` Seite 1 mit `scale = containerBreite / seiten_breite_pt` in ein Offscreen-Canvas rendern → `canvas.setBackgroundImage`/`backgroundImage = new fabric.FabricImage(offscreen)`.
  - Schriften: für jede `URKUNDEN_SCHRIFTEN` `new FontFace(s.id, 'url(/fonts/urkunden/' + s.datei + ')')` laden und `document.fonts.add`; Fabric-`fontFamily` = Schrift-ID.
  - Feld ↔ Fabric: `new fabric.Textbox(anzeigeText, { left: x*scale, top: y*scale, width: breite*scale, fontSize: groesse*scale, fontFamily: schrift, fill: farbe, textAlign: {links:'left',zentriert:'center',rechts:'right'}[ausrichtung], lockRotation: true, lockScalingY: true, hasControls: true, splitByGrapheme: false })` und `setControlsVisibility({ mt:false, mb:false, tl:false, tr:false, bl:false, br:false, mtr:false })`; Originaltext in `obj.feld`. Beim Speichern zurückrechnen (`/scale`, Rundung auf 0,1). Breitenänderung per `scaling`-Event: `width *= scaleX; scaleX = 1`.
  - Beispielmodus: `anzeigeText = ersetzePlatzhalter(feld.text, beispiel)` und Größe via `passeGroesseAn(text, groesse, breite, (t, g) => { ctx.font = \`${g}px "${schrift}"\`; return ctx.measureText(t).width; })` (Messung in pt-Einheiten, dann `* scale` für die Anzeige); sonst Rohtext.
  - Ungespeicherte Änderungen: Flag + `beforeunload`.
  - Generieren-Karte: Vorlage wählen → `#genPlatzbereich`/`#genReihenfolge` aus der Vorlage; Pool-Liste aus `/uebersicht` (angehakt: `status === 'abgeschlossen'`; sonst Label-Zusatz „noch nicht abgeschlossen"); `#genAnzahl` = Summe `anzahl[platzbereich]` der angehakten; Klick → `zeigeUrkundenVorschau(...)`.
- [ ] **Step 3:** `urkundenDruck.js` — `zeigeUrkundenVorschau`: POST `/api/urkunden/generieren`; bei `!ok` JSON-Fehler als Notification (vorhandene Notification-Helfer der Seite nicht voraussetzen: eigenes kleines Modal mit Meldung); sonst `URL.createObjectURL(await res.blob())`, Modal (`#urkundenVorschauModal`, wird bei Bedarf per JS in `document.body` erzeugt, Stil wie vorhandene Modals in `pools.html`) mit `<iframe>`, Knöpfen *Drucken* (`iframe.contentWindow.print()`), *In neuem Tab öffnen* (`window.open(url)`), *Herunterladen* (`<a download="urkunden.pdf">`), *Schließen* (`URL.revokeObjectURL`); Warnungen aus Header decodieren und als Liste „Seite N – Name – Feld: zu lang/Zeichen fehlt". `autoDruck` → `iframe.onload = () => setTimeout(() => { try { iframe.contentWindow.print(); } catch {} }, 300)`.
- [ ] **Step 4:** `menu.js`: nach dem Siegerliste-Eintrag `<a href="/urkunden.html" class="menu-item" id="nav-urkunden">` mit Icon `workspace_premium` und Text „Urkunden", gleiche Struktur wie die Nachbarn (turnierId-Anhängen passiert automatisch — prüfen, dass die Logik über `.menu-item` läuft). Auf Client-Geräten wie andere Verwaltungsseiten behandeln (Muster für `nav-teilnehmer` o. ä. in `menu.js` suchen).
- [ ] **Step 5: E2E UI-Teil:** Seite `urkunden.html?turnierId=…` öffnen, Vorlage aus Task 6 wählen, `#btnFeldText` klicken, `#feldText` mit „Kreismeisterschaft 2026" füllen, speichern, neu laden → `GET /vorlagen` liefert 2 Felder; in Karte 2 generieren → Modal mit `iframe` sichtbar (`src` beginnt mit `blob:`).
- [ ] **Step 6:** Manuelle Sichtprüfung über den Preview-Browser (Canvas, Ziehen, Beispielmodus, Vorschau) — Screenshot.
- [ ] **Step 7:** PASS. Commit `feat(urkunden): Vorlagen-Editor und Generieren im Browser`.

---

### Task 9: Druck-Angebot nach „Pool abschließen"

**Files:**
- Modify: `public/js/urkundenDruck.js`, `public/js/pools.js:1639-1645`, `public/js/mannschaften.js:421-426`, `public/pools.html`, `public/mannschaften.html`
- Test: `tests/e2e/urkunden.spec.js`

**Interfaces:**
- Consumes: `GET /api/urkunden/abschluss-angebot?poolId=` → `{ vorlage: { id, name, platzbereich, reihenfolge } | null, anzahl }`; `zeigeUrkundenVorschau` (Task 8).
- Produces: `bieteUrkundenNachAbschlussAn(turnierId, poolId, poolBezeichnung)`.

- [ ] **Step 1: Failing E2E:** (a) Vorlage per `PUT` auf `platzbereich: '5', bei_abschluss_anbieten: true`; neues DK8-Turnier aus Fixture aufbauen und durchspielen; `pools.html?turnierId=` öffnen, Pool-Kampfplan öffnen, „Pool abschließen" bestätigen → Dialog mit Text „Urkunden für" und „Platz 1–5" sichtbar; *Drucken* → Vorschau-Modal mit `iframe`. Zusätzlich per Request: `/generieren` mit denselben Parametern liefert die in `/abschluss-angebot` gemeldete `anzahl` Seiten. (b) Vorlage `bei_abschluss_anbieten: false` → zweiten Pool abschließen → kein Dialog, Pool-Status per API `abgeschlossen`. (Den Selektor für das Öffnen des Kampfplans aus `pools-bracket-anzeige-*.spec.js` übernehmen.)
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implementieren:

```js
export async function bieteUrkundenNachAbschlussAn(turnierId, poolId, poolBezeichnung) {
    let angebot;
    try {
        const res = await fetch(`/api/urkunden/abschluss-angebot?poolId=${poolId}`);
        if (!res.ok) return;
        angebot = await res.json();
    } catch { return; }
    if (!angebot?.vorlage || !angebot.anzahl) return;
    const { vorlage } = angebot;
    const bereich = vorlage.platzbereich === 'alle' ? 'alle Platzierungen' : `Platz 1–${vorlage.platzbereich}`;
    const reihenfolge = vorlage.reihenfolge === 'aufsteigend' ? 'aufsteigend' : 'Siegerehrung';
    const ja = await frage(`Urkunden für ${poolBezeichnung} drucken?`,
        `Vorlage „${vorlage.name}", ${bereich}, ${reihenfolge} · ${angebot.anzahl} Urkunde(n)`);
    if (!ja) return;
    await zeigeUrkundenVorschau({ turnierId, vorlageId: vorlage.id, platzbereich: vorlage.platzbereich,
        reihenfolge: vorlage.reihenfolge, poolIds: [poolId] }, { autoDruck: true });
}
```

  `frage(titel, text) → Promise<boolean>`: eigenes Modal im selben Stil wie das Vorschau-Modal, Knöpfe *Drucken* / *Später*. In `pools.html`/`mannschaften.html` `<script type="module" src="/js/urkundenDruck.js"></script>` einbinden. In `pools.js` nach `await ladePools();` und in `mannschaften.js` nach `ladeUndRendere();`:

```js
window.hajimeUrkunden?.bieteUrkundenNachAbschlussAn(turnierId, poolId, poolBezeichnung);
```

  (`turnierId`/Bezeichnung aus den in der jeweiligen Datei vorhandenen Variablen bzw. dem Pool-Objekt nehmen; in `mannschaften.js` `btn.dataset.poolId` und die Pool-Bezeichnung als zusätzliches `data-`-Attribut am Knopf.) Kein `await` nötig, Fehler werden intern geschluckt.
- [ ] **Step 4:** PASS (`npx playwright test tests/e2e/urkunden.spec.js`).
- [ ] **Step 5:** Commit `feat(urkunden): Druck-Angebot beim Pool-Abschluss`.

---

### Task 10: Gesamtlauf und Doku

**Files:**
- Modify: `CLAUDE.md` (Domänenmodell: `urkunden_vorlagen`; Seitenstruktur: `urkunden`; `src/shared/`-Liste: `platzierungen.js`, `urkundenText.js`, `urkundenSchriften.js`)

- [ ] **Step 1:** `npm run test:unit` und `npm run test:e2e` → PASS (vollständige Suite, da Siegerliste und pools.js berührt wurden). `npm run test:e2e:cluster` nur, wenn lokal lauffähig (Ausnahme in `nurMaster`), sonst CI.
- [ ] **Step 2:** CLAUDE.md-Einträge in je einer Zeile im vorhandenen Stil ergänzen.
- [ ] **Step 3:** Commit `docs(urkunden): CLAUDE.md ergänzt`.
