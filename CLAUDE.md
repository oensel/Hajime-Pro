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
- **`kaempfe`** — einzelne Kämpfe innerhalb eines Pools, verknüpft per `..._quelle_kampf_id/_typ` mit ihren Vorgängerkämpfen (Bracket-Verkettung); bei Mannschaftskämpfen zusätzlich per `mannschaftskampf_id`/`mannschaft_gewichtsklasse` einer Begegnung zugeordnet
- **`mannschaften`** — eine Mannschaft in einem Mannschafts-Pool (`pools.typ = 'mannschaft'`), Verein als freier Text (analog `turnier_teilnehmer.verein`)
- **`mannschaft_mitglieder`** — ordnet vorhandene `turnier_teilnehmer` einer Gewichtsklassen-Position der Mannschaft zu (der Judoka bleibt ein normaler `turnier_teilnehmer`, Wiegen/QR-Scan laufen unverändert über `waage`)
- **`mannschaftskaempfe`** — eine Begegnung (Team A vs. Team B) innerhalb eines Mannschafts-Pools, strukturell parallel zu `kaempfe` (gleiche Status-Werte, gleiches Quelle-Verknüpfungsmuster für die Bracket-Kaskade); ihre Einzelkämpfe (einer pro gemeinsam besetzter Gewichtsklasse) sind ganz normale `kaempfe`-Zeilen

## Zentrale Architekturkonzepte
- **`src/shared/`** ist bewusst framework-/DB-frei gehalten (kein knex, kein DOM) und läuft identisch server- und client-seitig (Browser-Offline-Modus):
  - `bracketTopologie.js` — deklarative Turnierbaum-Struktur pro Modus (welcher Kampf bezieht seine Kämpfer aus welchem Vorkampf)
  - `kampfProgression.js` — Kaskaden-Engine: befüllt Folgekämpfe erst, wenn beide Kämpfer-Slots feststehen
  - `pausenRegel.js` — Mindestpausenzeiten zwischen Kämpfen eines Athleten (DJB-WKO)
  - `mannschaftsProgression.js` — Kaskaden-Engine für Mannschaftsbegegnungen, das Pendant zu `kampfProgression.js` auf Ebene der Begegnungen statt der Einzelkämpfe
- **`src/services/*Manager.js`** — Turniermodus-Implementierungen (DoppelKo8/16/32Manager, GruppenUeberKreuzManager, JederGegenJedenManager), erzeugen die Kämpfe eines Pools beim Anlegen; für Mannschafts-Pools die entsprechenden `Mannschaft*Manager.js` (Jeder-gegen-Jeden, Doppel-KO-8/16), die Begegnungen statt Einzelkämpfe erzeugen
- **`src/services/mannschaftsBegegnungEngine.js`** — erzeugt pro Begegnung die Einzelkämpfe je gemeinsam besetzter Gewichtsklasse, wertet Sieg-/Wertungspunkte aus und lost bei vollständigem Gleichstand automatisch einen Stichkampf aus (DJB-WKO Art. 3.12.13.1); das Abschenken-Verbot (Art. 3.12.13.3) hängt in `teilnehmerController.js` an den bestehenden „nicht angetreten“/„disqualifizieren“-Aktionen
- **Offline-Modus pro Matte:** `offlineController.js` exportiert die Kämpfe/Teilnehmer einer einzelnen Kampffläche, sodass eine Matte ohne Internetverbindung weiterlaufen kann; Ergebnisse werden später zurücksynchronisiert
- **Regelkonformität DJB-WKO:** Alters-/Gewichtsklassen (`src/config/altersklassen.json`), Kampf-/Pausenzeiten und die dreistufige Golden-Score-Regel (kein Golden Score bis U13, 3 Min. begrenzt bei U15, unbegrenzt ab U18) sind explizit im Code nachgebildet und kommentiert (`poolController.js`, `pausenRegel.js`)

## Mannschaftskämpfe
Mannschafts-Pools (`pools.typ = 'mannschaft'`) laufen als Team-vs-Team-Begegnungen: pro fest
definierter Gewichtsklassen-Position (`pools.mannschafts_gewichtsklassen`, DJB-Vorlage für U15/U18
m/w, sonst aus den Einzelwettkampf-Gewichtsklassen übernommen oder frei editierbar) ein
Einzelkampf; Sieger der Begegnung = mehr Kampfsiege, bei Gleichstand Wertungspunkte, bei
vollständigem Gleichstand automatischer Stichkampf. Unterstützte Turniersysteme: Jeder-gegen-Jeden
und Doppel-KO-8/16 (Doppel-KO-32 und Gruppen-Überkreuz für Mannschaften bewusst noch nicht
umgesetzt). Mannschafts-Pools werden manuell angelegt (kein automatisches Bulk-Auslosen aus
Einzelanmeldungen) und komplett auf der eigenen Seite `mannschaften.html` verwaltet — sie
erscheinen bewusst nicht in `pools.html`/`pools.js`, deren Rendering strukturell auf
Einzelwettkampf-Pools zugeschnitten ist. Bundesliga-Ligabetrieb (Startgenehmigungen,
Transferfenster, Kampfgemeinschaften, Fremdstarter-Kontingente) ist explizit außerhalb des Scopes
— das ist überjährige Vereinsverwaltung, kein Turniertag.

## Umfang / bewusste Auslassungen
- Kein separater Team-Ligabetrieb (Bundesliga-Startgenehmigungen/Transferfenster) — siehe
  „Mannschaftskämpfe“ oben; einzelne Turniertage mit Mannschaftskämpfen sind abgedeckt
- Keine Kampfrichter-/Scoring-Logik (IJF-Kampfregeln zu Wurftechniken/Bewertungen sind nicht Teil der Anwendung)

## Seitenstruktur (`public/`)
`login` → `verein_auswahl` → `turniere` (Turnierauswahl) → `turnier`/`teilnehmer`/`pools`/`mannschaften` (Verwaltung) → `matten`/`steuerung`/`kampf` (Live-Betrieb am Wettkampftag) → `waage` (Einwiegen per QR-Scan) → `anzeige`/`dashboard`/`siegerliste` (öffentliche Anzeigen)
