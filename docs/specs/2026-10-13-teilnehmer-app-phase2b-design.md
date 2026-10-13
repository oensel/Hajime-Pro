# Teilnehmer-App „Hajime Live“ — Phase 2b: Pools, Turnier-Dashboard, Turnierbaum, Optik der Turnier-App

Status: Entwurf zur Freigabe · Branch `feature/teilnehmer-app-phase2` · 2026-10-13
Ergänzt `docs/specs/2026-10-12-teilnehmer-app-design.md` (Abschnitt 6.2 „App“). Grundlage sind die am 2026-10-13 abgestimmten
Entwürfe (sieben Handy-Ansichten plus Übersicht, Suche, Verein folgen).

## 1. Ziel

Die PWA zeigt zusätzlich zu Suche, Pool-Teilnehmern und Übersicht (Phase 2) alle Pools, den Turnierbaum eines Pools, die
Kämpfe eines Pools und ein Handy-Dashboard der Matten, und sie sieht aus wie die Turnier-App der Halle (Waage, Dashboard).

## 2. Entscheidungen

| # | Entscheidung |
|---|---|
| 1 | **Navigation:** Reiterleiste unten mit vier Reitern: Suche, Pools, Turnier, Übersicht. Kein Seitenmenü. |
| 2 | **Startbildschirm (Reiter Suche):** Turniername, Suchfeld (Name oder Vorname, Autovervollständigung wie Phase 2), darunter **die Vereine direkt als zweispaltiges Raster** (Name, Teilnehmerzahl), darunter **Alters- und Gewichtsklassen** als aufklappbare Gruppen „<Altersklasse> <Geschlecht>“ mit den Gewichtsklassen als Chips. Kein Dropdown. |
| 3 | **Pools (Reiter):** Liste aller Einzel-Pools mit Bezeichnung, Matte, Teilnehmerzahl, Modus, Statusschild und Fortschrittsbalken; Filter-Chips „Alle“, je Matte, „Läuft“. Antippen öffnet den Pool. |
| 4 | **Pool-Ansicht:** drei Reiter innerhalb des Pools: **Baum**, **Kämpfe**, **Teilnehmer**. Startreiter je Weg: Menü Pools → Baum; Suche, Klasse oder Verein → Teilnehmer (der Gesuchte ist hervorgehoben); Kampf im Turnier-Dashboard → Kämpfe (der Kampf ist markiert). |
| 5 | **Turnierbaum:** Doppel-KO als Spalten je Runde (seitlich wischbar, darunter die Trostrunde), Jeder gegen jeden als Kampfbogen mit vorläufiger Platzierung, Gruppen-Überkreuz als zwei Kampfbögen plus Finalrunde. Dieselbe Rundenaufteilung wie die Steuerung (`src/shared/poolRunden.js`). Verfolgte Teilnehmer sind mit ★ markiert. |
| 6 | **Turnier (Reiter) = Dashboard B:** eine Matte je Ansicht, Wechsel über Chips „Alle Matten“, „Matte 1“ …; je Matte der laufende Kampf (Kämpfer 2 Blau/Rot links, Kämpfer 1 Weiß rechts, mit Verein), die nächsten drei Kämpfe, die Pools der Matte mit Fortschritt; darunter die Warteschlange der Pools ohne Matte. Aktualisierung alle 5 s. |
| 7 | **Klick auf einen Kampf** (im Dashboard) öffnet die **Kampfliste** des Pools (der Kampf ist markiert); dort öffnet „Turnierbaum öffnen“ (und der Tipp auf eine Kampfzeile) den Baum. |
| 8 | **Übersicht** nach Dringlichkeit: „Gerade dran“, „Als nächstes“ (nach Abstand), je gefolgtem Verein ein Block „Vereinsregel: <Verein>“ mit „Glocke für alle“, zuletzt „Fertig oder wartend“. Einzeln gesternte Teilnehmer stehen in den Dringlichkeits-Blöcken, die übrigen Mitglieder eines gefolgten Vereins im Vereinsblock. Statuszeile „Stand von hh:mm“, offline „Keine Verbindung · Stand von …“. Leerer Zustand mit Knopf „Teilnehmer suchen“. |
| 9 | **Verein folgen:** in der Vereinsansicht ein deutlich abgesetzter Knopf „Verein verfolgen“ (gefüllt, Primärfarbe, weiße Schrift); danach „Verein wird verfolgt“ (umrandet, Stern gefüllt) mit dem Schalter „Glocke für alle“. Die Glocke ist nach dem Stern aus. Kein Stern auf den Vereinskacheln des Rasters. |
| 10 | **Mannschafts-Pools** bleiben ausgeschlossen (wie Phase 1); der Sammelpool „Verspätet“ erscheint nicht in der Pool-Liste. |
| 11 | **Dunkelmodus** folgt dem Gerät (`prefers-color-scheme`). |

## 3. Optik

Übernommen aus `public/css/common.css` und `public/dashboard.html`:

| Token | Hell | Dunkel |
|---|---|---|
| Hintergrund | `#fcf9f2` | `#0b0f19` |
| Karte | `#ffffff` | `#111827` |
| Primär (Dojo-Blau) | `#1e3a8a` | `#3b82f6` |
| Text | `#1e293b` | `#f3f4f6` |
| Text gedämpft | `#64748b` | `#9ca3af` |
| Rand | `#d9d4c7` | `#1f2937` |

Karten mit 2 px Rand und 12 px Radius, Überschriften in **Outfit** (Großbuchstaben, 800–900, 2 px Unterstrich in Primärfarbe),
Fließtext in **Plus Jakarta Sans** (`/css/schriften.css`, lokal), Abschnittstitel 11 px Großbuchstaben, Kanji-Wasserzeichen 柔 / 道
am Rand, grünes „Live“-Schild, Material Icons (`/icons/material/material-icons.woff2`). Kämpfer 2 trägt die Pool- bzw.
Turnierfarbe (Blau oder Rot), Kämpfer 1 Weiß, wie im Dashboard der Halle.

### Kontrast (Anforderung aus der Abnahme der Entwürfe)

Text mindestens **4,5 : 1**, Symbole und Rahmen von Bedienelementen mindestens **3 : 1** gegen den jeweiligen Untergrund, in Hell und
Dunkel. Das gilt ausdrücklich für „Verein verfolgen“ und für Stern und Glocke: ein nicht gesetzter Stern ist `text gedämpft`
(Hell 4,8 : 1), ein gesetzter Stern ist Bernstein `#b45309` (Hell) bzw. `#fbbf24` (Dunkel). Ein Unit-Test rechnet die Verhältnisse
der Farbpaare aus `teilnehmer-app/css/app.css` nach.

## 4. Datenerweiterung

Der Snapshot enthält bisher nur die offene Warteschlange. Ergänzt werden (alle Felder optional beim Empfang, ältere Pakete bleiben gültig):

- **`pools`**: `{ id, bezeichnung, modus, status, matteId, altersklasse, geschlecht, gewichtsklasse, farbe2 }` für Einzel-Pools ohne
  Sammelpool. `farbe2` = Farbe von Kämpfer 2 (`pools.farbe_kaempfer2`, sonst `turniere.farbe_kaempfer2`, sonst `blau`).
- **`kaempfe`**: `{ id, poolId, nr, status, reihenfolge, k1, k2, sieger, p1, p2 }` für alle Einzelkämpfe dieser Pools
  (`nr` = `reihenfolge_nummer`, z. B. `H1`, `T3`, `F`, `V_A_2`; `k1`/`k2`/`sieger` = Teilnehmerschlüssel oder `null`; `p1`/`p2` =
  `unterbewertung_kaempfer1/2`).
- Die Views `live.turniere` und `live.pools` liefern zusätzlich `farbe_kaempfer2` (Migration; Rolle `live_ro` unverändert).

Cloud: Tabellen `live_pools` und `live_kaempfe` (je Turnier ersetzt, `ON DELETE CASCADE`). Namen der Kämpfer werden beim Abruf aus
`live_teilnehmer` aufgelöst, der Snapshot enthält keine Namen in den Kämpfen.

### App-API (Ergänzung)

| Endpunkt | Antwort |
|---|---|
| `GET /api/live/turniere/:key` | wie bisher, zusätzlich `klassen: [{ altersklasse, geschlecht, pools: [{ poolId, gewichtsklasse, bezeichnung }] }]` |
| `GET /api/live/turniere/:key/pools` | `{ pools: [{ poolId, bezeichnung, modus, status, matteId, matteBezeichnung, teilnehmer, gesamt, beendet, laeuft }] }` |
| `GET /api/live/turniere/:key/pools/:poolId` | wie bisher, zusätzlich `pool.modus`, `pool.status`, `pool.farbe2` und `kaempfe: [{ id, nr, status, k1, k2, sieger, p1, p2 }]` mit aufgelösten Kämpfern `{ key, name, verein }` |
| `GET /api/live/turniere/:key/dashboard` | `{ serverzeit, stand, empfangenAm, matten: [{ id, bezeichnung, laufend, naechste: [..3], pools: [..] }], warteschlange: [{ poolId, bezeichnung }] }` |

Regeln des Dashboards (wie `/api/pools/dashboard` der Halle): *laufend* = Kampf mit Status `gestartet` im Pool der Matte; *nächste* =
bis zu drei Kämpfe mit Status `bereit` oder `vorbereiten` nach `reihenfolge` (ohne Position zuletzt), dann `id`; *Pool-Fortschritt* =
beendete (`beendet`, `freilos`) / alle Kämpfe; *Warteschlange* = Pools ohne Matte.

## 5. Datenschutz

Keine neuen personenbezogenen Felder: Kampfpaarungen und Ergebnisse stehen bereits in der öffentlichen Siegerliste der Halle. Wie
in Phase 2 gelten Freigabe je Turnier, Rücknahme und Aufbewahrung 7 Tage.

## 6. Fehlerfälle

| Fall | Verhalten |
|---|---|
| Ältere Halle ohne `pools`/`kaempfe` im Snapshot | Pools, Turnier und Baum zeigen „Noch keine Kampfdaten von der Halle“; Suche und Übersicht funktionieren wie bisher |
| Pool noch ohne Kämpfe (nicht ausgelost) | Baum und Kämpfe zeigen „Noch nicht ausgelost“, der Reiter Teilnehmer funktioniert |
| Kämpfer eines Kampfes unbekannt (Freilos, Vorkampf offen) | Name „offen“ bzw. „Freilos“ |
| Keine Verbindung | letzter geladener Stand je Ansicht aus dem Gerät, Hinweis in der Statuszeile (Muster der Übersicht) |
| Turnier zurückgezogen (404) | Hinweis „nicht mehr verfügbar“, Merkzettel des Geräts wird gelöscht |

## 7. Tests

Unit: Snapshot (`pools`, `kaempfe`, Farbe), Views, Ingest (neue Tabellen, doppelte Schlüssel), Abfragen (Klassen, Pools,
Pool mit Kämpfen, Dashboard), Baum-Modell (Doppel-KO, Kampfbogen, Überkreuz, Freilos), Übersicht-Gruppierung, Kontrast. E2E:
Start mit Vereinen und Klassen, Pools, Baum, Dashboard und Kampf → Kampfliste → Baum, Verein verfolgen, Übersicht.

## 8. Offen

- Matten-Auswahl im Dashboard merkt sich das Gerät (`localStorage`); „Alle Matten“ zeigt die Matten untereinander wie in Variante A.
- Mannschaftsbegegnungen im Baum (eigene Regel, nicht Teil dieser Phase).
