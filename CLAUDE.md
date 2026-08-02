# Hajime Pro (hajime-pro)

Turnierverwaltungssoftware für Judo-Wettkämpfe nach den Regeln des Deutschen Judo-Bundes (DJB) — deckt den gesamten Ablauf von der Anmeldung bis zur Siegerliste ab. Kein Scoring/Refereeing-Tool (keine Ippon/Waza-ari/Shido-Erfassung), sondern reine Wettkampf-Organisation: Teilnehmerverwaltung, Auslosung, Matten-/Zeitplanung, Live-Steuerung, Ergebnisanzeige.

## Tech-Stack
- **Backend:** Node.js (ES-Module) + Express, Knex als Query-Builder/Migrations
- **DB:** PostgreSQL im Online-Betrieb, SQLite im Offline-Betrieb (`IS_OFFLINE=true` steuert Umschaltung in `knexfile.cjs`/`app.js`)
- **Frontend:** Server-gerenderte statische HTML-Seiten in `public/` + Vanilla-JS, Material Components Web für UI, `jsqr`/`qrcode-generator` für QR-Scanning (Judopass) an der Waage
- **Auth:** JWT (`jsonwebtoken`), vereinsbasierte Zugriffsrechte

## Domänenmodell (Kernentitäten)
- **`vereine`** — Judo-Vereine; jeder Nutzer (`benutzer`) gehört zu genau einem Verein (`verein_freigegeben`-Flag für Mitgliedschafts-Freigabe)
- **`turniere`** — ein Wettkampftag, gehört einem ausrichtenden Verein, hat Status-Lifecycle (`geplant` → `abgesagt`/`abgeschlossen`)
- **`kampfflaechen`** — die Matten eines Turniers
- **`pools`** — die eigentlichen Wettkampfklassen (Alters-/Gewichtsklasse + Geschlecht), jeweils mit Modus (Jeder-gegen-Jeden, Doppel-KO-8/16/32, Gruppen-Überkreuz), Kampfzeit und Golden-Score-Einstellungen
- **`turnier_teilnehmer`** — angemeldete Athlet:innen (Judopass-ID, Gewicht, Verein, zugeordneter Pool)
- **`kaempfe`** — einzelne Kämpfe innerhalb eines Pools, verknüpft per `..._quelle_kampf_id/_typ` mit ihren Vorgängerkämpfen (Bracket-Verkettung)

## Zentrale Architekturkonzepte
- **`src/shared/`** ist bewusst framework-/DB-frei gehalten (kein knex, kein DOM) und läuft identisch server- und client-seitig (Browser-Offline-Modus):
  - `bracketTopologie.js` — deklarative Turnierbaum-Struktur pro Modus (welcher Kampf bezieht seine Kämpfer aus welchem Vorkampf)
  - `kampfProgression.js` — Kaskaden-Engine: befüllt Folgekämpfe erst, wenn beide Kämpfer-Slots feststehen
  - `pausenRegel.js` — Mindestpausenzeiten zwischen Kämpfen eines Athleten (DJB-WKO)
- **`src/services/*Manager.js`** — Turniermodus-Implementierungen (DoppelKo8/16/32Manager, GruppenUeberKreuzManager, JederGegenJedenManager), erzeugen die Kämpfe eines Pools beim Anlegen
- **Offline-Modus pro Matte:** `offlineController.js` exportiert die Kämpfe/Teilnehmer einer einzelnen Kampffläche, sodass eine Matte ohne Internetverbindung weiterlaufen kann; Ergebnisse werden später zurücksynchronisiert
- **Regelkonformität DJB-WKO:** Alters-/Gewichtsklassen (`src/config/altersklassen.json`), Kampf-/Pausenzeiten und die dreistufige Golden-Score-Regel (kein Golden Score bis U13, 3 Min. begrenzt bei U15, unbegrenzt ab U18) sind explizit im Code nachgebildet und kommentiert (`poolController.js`, `pausenRegel.js`)

## Umfang / bewusste Auslassungen
- Nur **Einzelwettkämpfe** — keine Mannschaftswettbewerbe (Jugendpokal, DVMM/DVMP, Bundesliga) abgebildet
- Keine Kampfrichter-/Scoring-Logik (IJF-Kampfregeln zu Wurftechniken/Bewertungen sind nicht Teil der Anwendung)

## Seitenstruktur (`public/`)
`login` → `verein_auswahl` → `turniere` (Turnierauswahl) → `turnier`/`teilnehmer`/`pools` (Verwaltung) → `matten`/`steuerung`/`kampf` (Live-Betrieb am Wettkampftag) → `waage` (Einwiegen per QR-Scan) → `anzeige`/`dashboard`/`siegerliste` (öffentliche Anzeigen)
