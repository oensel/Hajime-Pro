# Zeitprognose, Simulation und Verspätungsanzeige Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Jeder kommende Kampf zeigt eine laufend angepasste ungefähre Uhrzeit, die Orga bekommt eine Zeitplan-Simulation und eine Matten-Rückstandsanzeige.

**Architecture:** Ein reines Modul `src/shared/zeitPrognose.js` (kein knex, kein DOM) rechnet alles. `baueMattenAnsicht` ergänzt `voraussichtlich_um` je Kampf (damit Server, Sync-Modus und Client-Geräte dieselbe Liste bekommen). Ein neuer Endpunkt liefert die Mattenenden samt Rückstand für Scoreboard und `matten.html`, ein zweiter die Simulation für die neue Seite `zeitplan.html`.

**Tech Stack:** Node.js ES-Module, Express, Knex, Vanilla-JS, `node:test` (Unit), Playwright (E2E).

**Spec:** `docs/specs/2026-10-17-zeitprognose-design.md`

## Global Constraints

- Dauer je Kampf = Ø der tatsächlich gekämpften Zeit (`kaempfe.kampfzeit_in_sekunden`) der letzten beendeten Kämpfe der Matte **+ 90 Sekunden** Puffer (Konstante `PUFFER_SEKUNDEN = 90`).
- Anzeigeformat „ca. HH:MM“ (24 h, `de-DE`).
- Verspätung wird nur im Vergleich der Matten untereinander gezeigt, Schwelle ab **10 Minuten** (`RUECKSTAND_SCHWELLE_MINUTEN = 10`). Kein automatischer Umverteilungsvorschlag, kein Verschieben.
- Die Simulation schreibt nichts in die Datenbank und speichert keine Eingaben.
- Konstanten für den Schnitt: `LETZTE_KAEMPFE = 8` (N), `MIN_KAEMPFE = 3` (M). Bei weniger als M gültigen Kämpfen gilt die Pool-Kampfzeit (`pool_kampfzeit` bzw. `pools.kampfzeit_sekunden`) als Vorgabe.
- Laufender Kampf (`gestartet`) zählt mit der Hälfte der Dauer je Kampf.
- Freilose (`freilos`) und beendete Kämpfe mit `kampfzeit_in_sekunden` ≤ 0 zählen nicht für den Schnitt; `freilos`/`beendet` zählen nicht als offen.
- Der Sammelpool „Verspätet“ (`pools.verspaetet`) kommt nie vor.
- Reine Module in `src/shared/` bleiben DB- und DOM-frei; `public/js/shared/` spiegelt `src/shared/` bereits (siehe `datenzugriff.js`), dort nichts doppelt pflegen.

## Review Focus

- Matte ohne offene Kämpfe oder ohne beendete Kämpfe: keine Zeit, kein Absturz, Vorgabe aus Pool-Kampfzeit.
- Beendete Kämpfe nur mit Zeit 0 (z. B. Aufgabe/nicht angetreten): zählen nicht in den Schnitt.
- Kämpfe ohne `matten_reihenfolge` und wartende Mannschaftskämpfe: laufen hinten mit, keine Zeit „vor jetzt“.
- Nur eine Matte oder nur Matten ohne offene Kämpfe: kein Rückstand, keine Vergleichsmatte.
- Simulation ohne Pools auf Matten oder ohne Eingabe für eine Altersklasse: klare Meldung bzw. Vorbelegung, kein NaN.
- Uhrzeit nach Mitternacht (Simulation über 24:00 hinaus): Anzeige bleibt lesbar.

---

### Task 1: Rechenkern `zeitPrognose.js`

**Files:**
- Create: `src/shared/zeitPrognose.js`
- Test: `tests/unit/zeitPrognose.test.js`

**Interfaces:**
- Produces:
  - `export const PUFFER_SEKUNDEN = 90; LETZTE_KAEMPFE = 8; MIN_KAEMPFE = 3; RUECKSTAND_SCHWELLE_MINUTEN = 10;`
  - `dauerJeKampfSekunden(beendeteKaempfe: Array<{kampfzeit_in_sekunden:number, status:string, updated_at?:any}>, vorgabeSekunden: number): number` — nimmt die letzten `LETZTE_KAEMPFE` beendeten (Status `beendet`, Zeit > 0, sortiert nach `updated_at` aufsteigend, sonst Listenreihenfolge), mittelt; bei weniger als `MIN_KAEMPFE` gilt `vorgabeSekunden`; Rückgabe jeweils plus `PUFFER_SEKUNDEN`.
  - `prognoseMatte(kaempfeInReihenfolge: Array<{id, status, pool_kampfzeit?, kampfzeit_in_sekunden?, matten_reihenfolge?}>, jetztMs: number): { zeiten: Map<number, number>, endeMs: number|null, dauerSekunden: number, offeneKaempfe: number }` — `zeiten` hat je offenem Kampf (`bereit`/`angelegt`/`vorbereiten`) den voraussichtlichen **Beginn** in ms; `endeMs` = Ende des letzten offenen Kampfs, `null` ohne offene Kämpfe.
  - `berechneRueckstand(matten: Array<{id:number, endeMs:number|null}>): Map<number, {minuten:number, bezugMatteId:number}>` — nur Matten mit `endeMs`; Bezug ist die mit dem frühesten Ende; Eintrag nur, wenn mindestens 2 Matten ein Ende haben und der Abstand ≥ `RUECKSTAND_SCHWELLE_MINUTEN`.
  - `simuliereZeitplan({ matten, beginnMs, kampfzeitJeAltersklasse }): Array<{ matteId, bezeichnung, pools: Array<{ poolId, bezeichnung, altersklasse, kaempfe, endeMs }>, endeMs }>` mit `matten: Array<{id, bezeichnung, pools: Array<{id, bezeichnung, altersklasse, gesamt_kaempfe, kampfzeit_sekunden}>}>` (Pools in Mattenreihenfolge), `kampfzeitJeAltersklasse: Record<string, number>` in Sekunden; fehlt eine Altersklasse, gilt `kampfzeit_sekunden` des Pools. Jeder Kampf dauert Kampfzeit + `PUFFER_SEKUNDEN`.
  - `formatUhrzeit(ms: number): string` → `"11:20"`.

- [ ] **Step 1: Failing tests schreiben** in `tests/unit/zeitPrognose.test.js` (`node:test`): 
  - `dauerJeKampfSekunden` mit 5 Kämpfen à 120 s → 210; mit 2 Kämpfen und Vorgabe 240 → 330; Kämpfe mit Zeit 0 und Status `freilos` werden ignoriert; es zählen nur die letzten 8.
  - `prognoseMatte`: 3 offene Kämpfe, Dauer 210 s, `jetzt` = 10:00 → Beginne 10:00:00 / 10:03:30 / 10:07:00, `endeMs` 10:10:30; ein `gestartet`-Kampf davor verschiebt den ersten Beginn um 105 s; ohne offene Kämpfe `endeMs === null`.
  - `berechneRueckstand`: Matten 10:00/10:40 → Matte 2 mit 40 Minuten, Bezug Matte 1; Abstand 9 Min. → kein Eintrag; eine einzelne Matte → leere Map; `endeMs: null` wird ignoriert.
  - `simuliereZeitplan`: zwei Pools à 10 Kämpfe, Kampfzeit 120 s, Beginn 09:00 → Poolende 09:35 und 10:10; fehlende Altersklasse nutzt Pool-Kampfzeit; Matte ohne Pools hat `endeMs === beginnMs`.
  - `formatUhrzeit` mit festem Datum (lokale Zeit).
- [ ] **Step 2: Fehlschlag prüfen:** `npx cross-env node --test tests/unit/zeitPrognose.test.js` bzw. `node --test tests/unit/zeitPrognose.test.js` → Fehler „Cannot find module“.
- [ ] **Step 3: Modul implementieren** (Signaturen oben; `updated_at` mit dem vorhandenen `parseDbZeitstempel` aus `src/shared/pausenRegel.js` lesen, falls dort exportiert, sonst `Date.parse` mit ISO-Ersatz des Leerzeichens).
- [ ] **Step 4: Tests grün:** `node --test tests/unit/zeitPrognose.test.js` → alle bestanden.
- [ ] **Step 5: Commit** `feat(prognose): Rechenkern fuer Kampfzeit-Prognose, Rueckstand und Simulation`

---

### Task 2: `voraussichtlich_um` in der Mattenansicht

**Files:**
- Modify: `src/shared/mattenAnsicht.js` (Ende von `baueMattenAnsicht`, Zeilen ~84-89)
- Test: `tests/unit/mattenAnsicht.test.js`

**Interfaces:**
- Consumes: `prognoseMatte` aus Task 1.
- Produces: jedes Kampfobjekt aus `baueMattenAnsicht` hat zusätzlich `voraussichtlich_um: number|null` (ms seit Epoch; `null` für beendete/Freilos-Kämpfe und wenn nicht prognostizierbar). Der Pool-Wert `pool_kampfzeit` ist schon vorhanden und dient als Vorgabe.

- [ ] **Step 1: Failing test:** in `tests/unit/mattenAnsicht.test.js` mit der vorhandenen Fixture: zwei beendete Kämpfe mit `kampfzeit_in_sekunden: 120`, zwei `bereit`-Kämpfe, `JETZT` fest → `voraussichtlich_um` des ersten `bereit`-Kampfs ist `JETZT`, des zweiten `JETZT + (Vorgabe-Fall: weniger als 3 beendete → pool_kampfzeit + 90) * 1000`; beendete Kämpfe haben `null`.
- [ ] **Step 2:** Test laufen lassen, Fehlschlag bestätigen: `node --test tests/unit/mattenAnsicht.test.js`.
- [ ] **Step 3:** In `baueMattenAnsicht` `prognoseMatte(kaempfeDerMatte, jetzt)` aufrufen und `zeiten.get(kampf.id) ?? null` als `voraussichtlich_um` in das zurückgegebene Objekt jedes Kampfs legen (auch in der `pausenwarnung`-Zeile).
- [ ] **Step 4:** `node --test tests/unit/mattenAnsicht.test.js` und `npm run test:unit` → grün.
- [ ] **Step 5: Commit** `feat(prognose): voraussichtliche Uhrzeit je Kampf in der Mattenansicht`

---

### Task 3: Uhrzeit in den Kampflisten anzeigen

**Files:**
- Modify: `public/js/scoreboard.js` (Liste `kommende`, Zeile ~2616-2659: neues Element `st-k-zeit` in `row.append(...)`; Vorschau für die Anzeige, ~Zeile 2024), `public/js/kampf.js`, `public/js/matten.js`? (nein, siehe Task 4), die Vorschau in `public/anzeige.html`/`scoreboard.js`
- Create: `public/js/zeitAnzeige.js` — `window.ZeitAnzeige.format(ms): string` → `"ca. 11:20"` oder `""` bei `null`; geladen von `steuerung.html`, `kampf.html`, `anzeige.html` per `<script>`
- Test: `tests/e2e/zeitprognose-kampfliste.spec.js`

**Interfaces:**
- Consumes: `voraussichtlich_um` aus Task 2.

- [ ] **Step 1: Failing E2E** (Vorbild `tests/e2e/waage-runden-matte-und-app.spec.js`, Baukasten `tests/e2e/helpers/turnier-aufbau.js`): Turnier aufbauen, Kämpfe der Matte, `steuerung.html` öffnen → `#steuerungUpcomingList` enthält je Zeile ein Element `.st-k-zeit` mit Text `/^ca\. \d{2}:\d{2}$/`; die Zeiten steigen von Zeile zu Zeile. Nach einem beendeten Kampf bleibt der erste Eintrag ≥ jetzt. Dasselbe in `kampf.html` (Liste der anstehenden Kämpfe) und der Anzeige-Vorschau (`.vorschau-…` der Seite `anzeige.html`).
- [ ] **Step 2:** `npx playwright test tests/e2e/zeitprognose-kampfliste.spec.js` → Fehlschlag.
- [ ] **Step 3:** `zeitAnzeige.js` anlegen, einbinden und in den drei Listen je Zeile ausgeben (`formatUhrzeit`-Logik des Moduls aus Task 1 mit `toLocaleTimeString('de-DE', {hour:'2-digit', minute:'2-digit'})`). Keine Zeit anzeigen, wenn `voraussichtlich_um` fehlt.
- [ ] **Step 4:** E2E-Spec grün; zusätzlich `npx playwright test tests/e2e/steuerung-pool-beginn-meldung.spec.js` (Regression der Liste).
- [ ] **Step 5: Commit** `feat(prognose): Uhrzeit in den Listen kommender Kaempfe`

---

### Task 4: Mattenenden und Rückstand (Endpunkt, Scoreboard, `matten.html`)

**Files:**
- Modify: `src/controllers/poolController.js` (neue Funktion neben `getKampfflaechenMitPools`), `src/routes/poolRoutes.js` (Route `GET /zeitprognose` mit `requireTournamentEditAccess(knex)`; die Route darf nicht auf Schreibrechte angewiesen sein, wie das Scoreboard-Lesen: gleiche Zugriffsregel wie `GET /kampfflaechen`), `public/js/datenzugriff.js` (`ladeZeitprognose(turnierId)`: REST am Server; im Sync-/Client-Modus aus den lokalen Dokumenten), `src/shared/clientAntworten.js` (gleiche Antwort für Client-Geräte), `public/js/scoreboard.js`, `public/steuerung.html`, `public/js/matten.js` (Matten-Kopf `renderMatte`), `public/matten.html`
- Test: `tests/e2e/zeitprognose-rueckstand.spec.js`, Unit-Test für die Antwortfunktion in `tests/unit/zeitprognose-antwort.test.js`

**Interfaces:**
- Consumes: `prognoseMatte`, `berechneRueckstand`.
- Produces: `GET /api/pools/zeitprognose?turnierId=` → `{ jetzt: number, matten: Array<{ id, bezeichnung, endeMs: number|null, offeneKaempfe: number, dauerSekunden: number, rueckstand: { minuten: number, bezugMatteId: number, bezugBezeichnung: string } | null }> }`; reine Funktion `baueZeitprognoseAntwort({ kampfflaechen, pools, kaempfe }, jetztMs)` in `src/shared/zeitprognoseAntwort.js`, die Server und Client-Geräte gemeinsam nutzen (nur Matten des Turniers, ohne Sammelpool).

- [ ] **Step 1: Failing Unit-Test** für `baueZeitprognoseAntwort`: zwei Matten, eine mit 10 offenen Kämpfen, eine mit 30, gleiche Dauer → Matte 2 bekommt `rueckstand.minuten` passend, Matte 1 `null`; Matte ohne offene Kämpfe `endeMs: null`.
- [ ] **Step 2:** Test laufen lassen → Fehlschlag (`node --test tests/unit/zeitprognose-antwort.test.js`).
- [ ] **Step 3:** `src/shared/zeitprognoseAntwort.js` implementieren, Endpunkt in `poolController.js` anbinden (Kämpfe des Turniers inkl. `pool_kampfzeit`, über `baueMattenAnsicht` je Matte oder gleichwertig; Mannschaftskämpfe wie in der Mattenansicht), `datenzugriff.js`/`clientAntworten.js` ergänzen.
- [ ] **Step 4: UI:** In `scoreboard.js` über der Liste kommender Kämpfe (Element neben `#steuerungUpcomingList`, neue `<div id="verspaetungHinweis">` in `steuerung.html`) die eigene Matte zeigen: „Matte endet ca. HH:MM“ und, falls `rueckstand`, „ca. N Min. nach <Bezug>“ (gelber Hinweis, kein Eingriff). Aufruf in `ladeMattenUebersicht()`. In `matten.js` `ladeDaten` zusätzlich `ladeZeitprognose` abrufen und im Kopf von `renderMatte` neben `.matte-total-time` „Ende ca. HH:MM“ und ggf. „+N Min.“ als `.matte-rueckstand` ausgeben.
- [ ] **Step 5: Failing E2E** `tests/e2e/zeitprognose-rueckstand.spec.js`: zwei Matten mit sehr unterschiedlicher Last aufbauen → `matten.html` zeigt `.matte-rueckstand` mit „Min.“ an der längeren Matte, nicht an der kürzeren; `steuerung.html` der längeren Matte zeigt `#verspaetungHinweis`. Laufen lassen, Fehlschlag, dann grün machen: `npx playwright test tests/e2e/zeitprognose-rueckstand.spec.js`.
- [ ] **Step 6: Commit** `feat(prognose): Mattenenden und Rueckstand in Scoreboard und Mattenuebersicht`

---

### Task 5: Zeitplan-Simulation

**Files:**
- Create: `public/zeitplan.html`, `public/js/zeitplan.js`
- Modify: `src/controllers/poolController.js` (Funktion `simuliereZeitplanEndpunkt`), `src/routes/poolRoutes.js` (`POST /zeitplan-simulation`, gleiche Zugriffsregel wie `GET /kampfflaechen`, nur lesend), Menü in `public/js/menu.js` (Eintrag „Zeitplan“, Einzelbenutzerbetrieb und Cloud gleichermaßen sichtbar; Position nach „Matten“)
- Test: `tests/e2e/zeitplan-simulation.spec.js`

**Interfaces:**
- Consumes: `simuliereZeitplan`, `formatUhrzeit`.
- Produces: `POST /api/pools/zeitplan-simulation` mit Body `{ turnierId, beginn: string /* ISO-Zeitpunkt */, kampfzeitJeAltersklasse: Record<string, number> /* Sekunden */ }` → `{ matten: Array<…wie simuliereZeitplan, endeMs als ms> }`; liest Matten, Pools (ohne `verspaetet`, ohne Pools ohne Matte) und die Kampfzahl (`gesamt_kaempfe` wie in `getKampfflaechenMitPools`), Mannschafts-Pools zählen über ihre Kämpfe; schreibt nichts.

- [ ] **Step 1: Failing E2E:** Turnier mit zwei Altersklassen aufbauen und auf Matten verteilen; `zeitplan.html` öffnen → Feld „Beginn“ (Uhrzeit), je Altersklasse ein Feld „Ø Kampfzeit (Sek.)“ vorbelegt mit der eingestellten Pool-Kampfzeit; „Simulieren“ → Tabelle je Matte mit Zeilen je Pool („ca. HH:MM“) und Matten-Gesamtende; geänderte Kampfzeit verschiebt die Endzeiten nach hinten; Datenbank unverändert (Anzahl Kämpfe/Pools vorher = nachher).
- [ ] **Step 2:** Spec laufen lassen, Fehlschlag bestätigen.
- [ ] **Step 3:** Endpunkt + Seite bauen. Seite: Hinweistext „Ablauf: Teilnehmer auf Pools und Pools auf Matten verteilen, dann simulieren“; ohne verteilte Pools Meldung statt Tabelle; Ergebnis über 24:00 hinaus mit Zusatz „(+1 Tag)“.
- [ ] **Step 4:** Spec grün; `npx playwright test tests/e2e/matten*.spec.js` als Regression der Menüänderung.
- [ ] **Step 5: Commit** `feat(prognose): Zeitplan-Simulation fuer die Waage-Planung`

---

### Task 6: Teilnehmer-App

**Files:**
- Modify: `src/live/snapshot.js` (je Matte `dauer_sekunden` = Ø + 90 s aus den beendeten Kämpfen; Hilfsdatei nutzt `dauerJeKampfSekunden`), `src/liveCloud/ingest.js` + Migration für Spalte `live_kampffl…` bzw. Feld im vorhandenen Lesemodell (Tabellenname in `migrations/20261012110000_live_cloud_lesemodell.js` nachsehen), `src/liveCloud/abfrage.js` (Feld in der Antwort), `teilnehmer-app/js/anzeige.js` (`prognoseUhrzeit({ stand, abstand, dauerSekunden })`), Kachel/Kampfzeilen in `teilnehmer-app/js/ansicht-*.js`
- Test: `tests/unit/liveAppPrognose.test.js`, Ergänzung in `tests/e2e/live-app.spec.js`

**Interfaces:**
- Consumes: `dauerJeKampfSekunden`.
- Produces: `prognoseUhrzeit({ stand: number, abstand: number|null, dauerSekunden: number|null }): string` → `"ca. 11:20"` (Stand + (abstand + 1) × Dauer) oder `""`, wenn Abstand oder Dauer fehlen.

- [ ] **Step 1: Failing Unit-Test** `prognoseUhrzeit`: Stand 10:00, Abstand 0, Dauer 210 → „ca. 10:04“ (auf Minuten gerundet, 10:03:30 → 10:04); Abstand 2 → „ca. 10:11“; fehlender Wert → `""`.
- [ ] **Step 2:** Test laufen lassen, Fehlschlag; dann `prognoseUhrzeit` implementieren, Snapshot und Cloud-Lesemodell um die Dauer je Matte erweitern (rückwärtskompatibel: fehlt das Feld, zeigt die App nichts), Anzeige in den Kampfzeilen und Kacheln „Nächster Kampf“ der App ergänzen.
- [ ] **Step 3:** Bestehende Live-Tests: `npm run test:unit` (Dateien `tests/unit/live*.test.js`) und `npx playwright test tests/e2e/live-app.spec.js` → grün; neuer E2E-Fall: nach dem Ingest zeigt die Teilnehmer-Kachel „ca. HH:MM“.
- [ ] **Step 4: Commit** `feat(prognose): voraussichtliche Uhrzeit in der Teilnehmer-App`

---

### Task 7: Abschluss

**Files:**
- Modify: `CLAUDE.md` (Abschnitt Architekturkonzepte: Zeitprognose in drei Sätzen, Verweis auf Spec), `docs/specs/2026-10-17-zeitprognose-design.md` (Status „umgesetzt“)

- [ ] **Step 1:** `npm run test:unit` → alle grün.
- [ ] **Step 2:** `npm run test:e2e` → alle grün (Pre-Push nutzt sonst nur die schlanke Variante).
- [ ] **Step 3:** CLAUDE.md und Spec-Status nachziehen.
- [ ] **Step 4: Commit** `docs(prognose): Zeitprognose in CLAUDE.md und Spec`
