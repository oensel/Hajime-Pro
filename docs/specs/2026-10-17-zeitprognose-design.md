# Zeitprognose, Zeitplan-Simulation und Verspätungsanzeige

Stand: 2026-10-17 · Status: Entwurf zur Freigabe

## Zweck

Hallenmiete ist teuer, und alle Beteiligten wollen wissen, wann es ungefähr weitergeht. Das Feature liefert nur **Zusatzinformation** für Orga und Kämpfer. Es greift nirgends selbst ein, verschiebt keine Pools und verändert keine Turnierdaten.

Drei Teile, die aufeinander aufbauen:

1. **Live-Prognose**: eine voraussichtliche Uhrzeit an jedem kommenden Kampf.
2. **Zeitplan-Simulation** vor dem Turnier: wann ist welcher Pool auf welcher Matte ungefähr fertig? Die Orga legt damit fest, wann welche Alters-/Geschlechtsklasse gewogen werden kann.
3. **Verspätungsanzeige**: wie weit liegt eine Matte hinter den anderen?

## Ziele

- Jede Liste kommender Kämpfe zeigt „ca. HH:MM“: Steuerung/Scoreboard (`steuerung.html`), Mattenansicht (`matten.html`, `kampf.html`), Anzeige (`anzeige.html`), Teilnehmer-App.
- Die Uhrzeit passt sich laufend an, sobald ein Kampf endet (Stand der Matte, nicht fester Plan).
- Die Simulation nennt je Matte und Pool das ungefähre Ende.
- Matten-Rückstand ist in Scoreboard und `matten.html` sichtbar.

## Nicht-Ziele und Anti-Ziele

- Kein automatischer Umverteilungsvorschlag und kein automatisches Verschieben. Die Orga reagiert manuell. (Ursprünglich als Idee genannt, bewusst gestrichen.)
- Keine Vorhersage für einzelne Kämpfer-Wartezeiten über die Mattenreihenfolge hinaus; die Prognose folgt der Reihenfolge der Matte.
- Die Simulation ändert nichts am Turnier (kein Auslosen, kein Verteilen). Sie ist eine reine Berechnung auf dem vorhandenen Stand.
- Die Zeit ist ausdrücklich ungefähr („ca.“). Keine Sekundengenauigkeit, keine Zusage an Kämpfer.

## Entscheidungen des Auftraggebers

- **Dauer je Kampf** = Durchschnitt der tatsächlich gekämpften Zeiten der letzten Kämpfe der Matte **plus 90 Sekunden Puffer** (Aufruf, Verbeugen, Abgang). Die gekämpfte Zeit steht in `kaempfe.kampfzeit_in_sekunden` (vom Scoreboard beim Ergebnis geschrieben).
- Live: die Uhrzeit **passt sich laufend an**.
- Simulation: Der Benutzer verteilt zuerst alle Teilnehmer auf Pools und Pools auf Matten, **danach** startet er die Simulation. Sie berechnet nur.
- Simulation-Eingaben: ein **gemeinsamer Beginn für alle Matten** und die **durchschnittliche Kampfzeit je Altersklasse**, vom Benutzer eingegeben (keine Herleitung aus früheren Turnieren).
- Simulation-Ausgabe: je Pool und Matte das ungefähre Ende.
- Verspätung: **im Vergleich der Matten untereinander**, nicht gegen einen gespeicherten Plan. Anzeige im Scoreboard und in `matten.html`.

## Teil 1: Live-Prognose

**Rechenkern** als reines Modul `src/shared/zeitPrognose.js` (kein knex, kein DOM, läuft am Server und auf Client-Geräten wie die übrigen Module in `src/shared/`, mit Unit-Tests in `tests/unit/`).

- Eingabe: die Kampfliste einer Matte in Mattenreihenfolge (die Form, die `baueMattenAnsicht` bereits liefert), `jetzt`.
- Je Kampf `voraussichtlich_um` (Zeitpunkt). Zähler sind die noch nicht beendeten Kämpfe in Reihenfolge; der erste kommende Kampf beginnt etwa nach dem laufenden Kampf, jeder weitere nach `Ø Kampfzeit + 90 s`.
- Ø Kampfzeit: Mittelwert von `kampfzeit_in_sekunden` der **letzten N beendeten Kämpfe der Matte** mit tatsächlicher Zeit > 0 (Freilose und Kämpfe ohne Zeit zählen nicht).
- Solange weniger als M beendete Kämpfe vorliegen: Vorgabe ist die eingestellte Kampfzeit des Pools des jeweiligen Kampfs (`pool_kampfzeit`) — **Annahme/Entscheidung des Entwurfs**, nicht des Auftraggebers.
- Die Prognose gilt für Kämpfe mit Status `bereit`/`angelegt`/`vorbereiten`; Kämpfe, die auf Einzelpools warten (`wartet_auf_einzelpools`), laufen hinten in der Reihenfolge mit.
- Pausenregel (`pausenRegel.js`) bleibt außen vor: die Reihenfolge der Matte ist schon pausenkonform geplant, die Prognose folgt ihr nur.

**Einbindung:** `baueMattenAnsicht` (`src/shared/mattenAnsicht.js`) ist die gemeinsame Quelle für Scoreboard, Mattenleitung und Anzeige und läuft auch im Sync-Modus. Dort wird `voraussichtlich_um` je Kampf ergänzt (das Argument `jetzt` ist schon da). Anzeige als „ca. 11:20“ in `scoreboard.js` (Liste kommender Kämpfe, `steuerung.html`), `matten.js`, `kampf.js`, `anzeige.html`.

**Teilnehmer-App:** Die App bekommt Live-Snapshots (Phase 2b, Tabellen `live_kaempfe`) mit Abstand je Kampf. Dort wird die Uhrzeit aus dem Abstand und dem Ø der Matte berechnet; der Snapshot trägt dafür je Matte die Ø-Dauer (neues Feld). Details legt der Baumeister fest.

## Teil 2: Zeitplan-Simulation

Neue Seite oder Bereich (z. B. `zeitplan.html` oder Bereich auf `matten.html`) am Hallen-Server/Einzelbenutzerbetrieb.

Ablauf für den Benutzer: Teilnehmer auf Pools verteilen → Pools auf Matten verteilen → Simulation öffnen.

- Eingaben: Beginn der Kämpfe (eine Uhrzeit für alle Matten); je Altersklasse die durchschnittliche Kampfzeit (Vorbelegung: eingestellte Kampfzeit der Pools dieser Klasse — **Entscheidung des Entwurfs**). Die 90 s Puffer kommen immer dazu und sind nicht einstellbar (**Entscheidung des Entwurfs**).
- Berechnung: je Matte werden die Kämpfe der zugeordneten Pools in der geplanten Mattenreihenfolge (`matten_reihenfolge`) nacheinander mit `Ø + 90 s` summiert, ab dem Beginn.
- Ausgabe: Tabelle je Matte mit den Pools und deren ungefährem Ende, je Matte das Gesamtende. Daraus liest die Orga ab, wann die Alters-/Geschlechtsklassen gewogen werden können.
- Rein lesend: keine Schreibzugriffe auf Turnierdaten. Eingaben werden nicht gespeichert (**Entscheidung des Entwurfs**; kann später ergänzt werden).
- Teilnehmer, die erst nach dem Wiegen einen Pool bekommen, gibt es in der Simulation nicht: es zählt der Stand, den der Benutzer durchgespielt hat.

Hinweis zu Kämpfen, die erst später entstehen (Doppel-KO-Folgekämpfe): sie sind als `angelegt` schon in der DB und zählen mit; maßgeblich ist die vorhandene Kampfanzahl des Pools.

## Teil 3: Verspätungsanzeige

- Vergleich der **voraussichtlichen Endzeiten der Matten** untereinander (aus Teil 1). Bezugsmatte ist die, die am frühesten fertig wird; jede andere Matte zeigt ihren Rückstand dazu, z. B. „Matte 2: ca. 40 Min. nach Matte 1“.
- Mindestabstand für die Anzeige, damit nicht jede Kleinigkeit blinkt: ab 10 Minuten (**Entscheidung des Entwurfs**).
- Wo: Scoreboard (`steuerung.html`, sichtbar für die Matte) und `matten.html` (Übersicht aller Matten).
- Nur Information, kein Eingriff. Es werden keine Pools vorgeschlagen.

## Randfälle

- Noch kein Kampf gespielt: Vorgabewerte aus der Pool-Kampfzeit.
- Matte ohne Kämpfe oder alle beendet: keine Prognose, keine Verspätung.
- Matte pausiert (`pausiert`): Prognose läuft weiter, sie rechnet ab `jetzt`; die Pause selbst ist nicht vorhersehbar.
- Laufender Kampf: Beginn unbekannt; er zählt mit der Hälfte von `Ø + 90 s` (**Entscheidung des Entwurfs**).
- Mannschaftsbegegnungen: Einzelkämpfe zählen wie normale Kämpfe der Matte.
- Der Sammelpool „Verspätet“ hat keine Matte und kommt nicht vor.

## Tests

- Unit-Tests für `zeitPrognose.js` (Durchschnitt, Vorgabe bei wenig Daten, Freilose, Mehr-Matten-Rückstand, Schwelle).
- E2E: Prognose-Zeit in Steuerung/`matten.html` nach gespielten Kämpfen; Simulationsseite gegen ein aufgebautes Turnier (Baukasten `tests/e2e/helpers/turnier-aufbau.js`).

## Offen für den Baumeister

- Die Werte N (Zahl der letzten Kämpfe, Vorschlag 5–10) und M (Mindestzahl, Vorschlag 3).
- Genaue Platzierung der Oberfläche der Simulation.
- Form der Ø-Dauer im Live-Snapshot für die Teilnehmer-App.
