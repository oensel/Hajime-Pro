# Orga-Planer: Checkliste für Planung, Vorbereitung und Durchführung eines Turniers

Stand 2026-10-18. Entstanden im Gespräch mit dem Projektinhaber; was er entschieden hat, steht als Entscheidung, was ich ergänzt habe, ist mit **(Annahme)** markiert.

## Ziel

Ausrichter sollen bei der Organisation rund um ein Turnier begleitet werden: eine Checkliste, die man abarbeiten oder an Vereinsmitglieder (auch an Externe) delegieren kann. Wer eine Aufgabe bekommt, wird per Mail benachrichtigt, sieht sie in der Cloud neben seinen Helfer-Diensten und setzt sie selbst auf „erledigt“. Nichts Wichtiges soll vergessen werden (Technik, Preise, Catering, Ersthelfer).

**Nicht-Ziele:** Fachfunktionen, die in der Checkliste nur als Aufgabe vorkommen: Startgeld-Verfolgung, Kampfrichter-Lizenzen, Bistro-Kasse, Abrechnung (eigene spätere Projekte). Kein Kanban-Board. Kein Mailversand bei Überfälligkeit. **Anti-Ziel:** Eine Einladung darf nie mehr Rechte verschenken als „Helfer“.

## Begriffe

- **Aufgabe**: Zeile der Checkliste (Titel, Notiz, Phase, Fälligkeit, Zuständiger, Status).
- **Unteraufgabe/Posten**: Kind einer Aufgabe, z. B. „Mikrofon“ unter „Technik bereitstellen“, optional mit Menge. Eine Aufgabe mit Unteraufgaben ist **erledigt, sobald alle Unteraufgaben erledigt sind** (abgeleitet, nicht gespeichert).
- **Automatische Aufgabe**: Status kommt aus dem Helferplan (siehe unten), der Haken von Hand bleibt möglich.
- **Mitbringliste**: Unteraufgaben des Caterings, die Helfer selbst eintragen („Kuchen: Marmor“). Zählen **nicht** für die Erledigung der Elternaufgabe **(Annahme)**.

## Phasen und Vorlage

Phasen: `grundlage`, `vorbereitung`, `meldephase`, `turniertag`, `nachbereitung`. **Grundlage** ist eine eigene, vorgelagerte Phase (6 bis 12 Monate vorher, im UI abgesetzt), sie enthält zuerst „Hallenzeiten reservieren“.

Die mitgelieferte Standardvorlage (Code, `src/shared/orgaVorlage.js`, kein Datenbankbestand) wird beim Anlegen eines Turniers in dessen Aufgaben kopiert; danach sind Aufgaben frei änderbar, ergänzbar, löschbar. Außerdem „Vorlage nachladen“ (fügt fehlende Vorlagenaufgaben anhand `vorlage_key` ein). Inhalt (Reihenfolge = Reihenfolge der Phase):

- **Grundlage:** Hallenzeiten reservieren (−240 Tage).
- **Vorbereitung:** Ausschreibung erstellen und versenden (−56); Genehmigung beim Landesverband (−49); Medaillen und Pokale (−30; Posten: bestellen, bedrucken lassen, abholen, Mengen prüfen); Technik bereitstellen (−21; Posten siehe unten); Helferbedarf festlegen (−21, automatisch).
- **Meldephase** (Anker Anmeldeschluss): Mattenzahl festlegen (+0 Tage nach Anmeldeschluss); Kampfrichter besetzt (−7, automatisch); Ersthelfer und Sanitäter besetzt (−7, automatisch); Startgelder nachverfolgen (−7, einfache Aufgabe); Catering einkaufen (−2; Posten: Kaffeemaschinen, Wasser, Cola, Saft, Grillfleisch, Brötchen, Getränkekisten; dazu die Mitbringliste „Kuchen und Sonstiges“).
- **Turniertag:** Aufbau der Matten/Tribünen (Dienste im Helferplan, Aufgabe automatisch), Technik aufbauen, Bistro und Kasse eröffnen, Kampfrichter-Besprechung, Wiegen, Pools erstellen, Siegerehrung, Abbau und Reinigung.
- **Nachbereitung** (+1 bis +3 Tage): Ergebnisse an den Verband übermitteln, Ergebnisliste veröffentlichen, Spesen auszahlen, Bistro-Kasse abrechnen, Startgelder abrechnen, Dankesmail an Helfer/Spender/Kampfrichter.

**Technik-Posten** (jeweils einzeln, mit Menge, alles in der Vorlage): Notebooks Matte, Notebooks Waage, Server, WLAN-Router, Mikrofon, Lautsprecher, TVs mit Halterung, Drucker, Urkundenpapier, Mehrfachsteckdosen, Verlängerungskabel, Netzwerkkabel, Kabeltrommeln. **(Annahme)** zusätzlich: Ersatzakkus/Ladegeräte, Gaffa-Tape, Wiegekarten, Stifte und Klemmbretter, Waagen mit Prüfgewicht, Tische und Stühle, Beschilderung, Müllsäcke, Erste-Hilfe-Koffer.

Der Punkt „Mattenwagen“ entfällt (Entscheidung).

## Fälligkeit

`frist_anker` ∈ {`turnier`, `anmeldeschluss`} und `frist_tage` (negativ = vorher). `faellig_am` wird daraus berechnet; wird das Turnierdatum oder der Anmeldeschluss geändert, werden alle Fälligkeiten **ohne** manuelle Überschreibung (`faellig_manuell = true`) neu berechnet. Anmeldeschluss: vorhandenes Turnierfeld; fehlt es, fällt der Anker auf den Turniertag zurück **(Annahme)**.

## Datenmodell (Migration `20261018130000_orga_planer.js`)

`orga_aufgaben`: `id`, `turnier_id` (CASCADE), `eltern_id` (self-FK, CASCADE, null = Hauptaufgabe), `phase`, `art` (`aufgabe` | `posten` | `mitbringen`), `titel` (≤255), `notiz`, `menge` (int, null), `reihenfolge`, `frist_anker`, `frist_tage`, `faellig_am` (date), `faellig_manuell` (bool), `auto_art` (null | `helferplan_gesamt` | `helferplan_taetigkeit`), `auto_ref` (z. B. `kampfrichter`, `ersthelfer`, `aufbau`), `link` (Schlüssel einer App-Seite: `helferplan`, `matten`, `teilnehmer`, `turnier` …), `vorlage_key`, `benutzer_id` (Zuständiger mit Konto, FK `benutzer`, SET NULL), `name_frei`, `email_frei`, `erledigt_am`, `erledigt_von`, `erinnert_fuer` (date, für welche Fälligkeit zuletzt erinnert wurde), `erstellt_von`, `erstellt_am`.

`orga_einladungen`: `id`, `token_hash` (SHA-256, eigene Tabelle, weil kein Konto existiert), `email`, `name`, `verein_id`, `laeuft_ab_am` (14 Tage), `benutzt_am`, `erstellt_am`. Eine Einladung gilt je (E-Mail, Verein); mehrere Aufgaben derselben Adresse teilen sie.

Helferplan-Erweiterung (gleiche Migration): `helfer_taetigkeiten.tag_versatz` smallint (0 oder −1 = Vortag). Neue Standardtätigkeiten in `synchronisiereStandardTaetigkeiten`: `ersthelfer` („Ersthelfer/Sanitäter“, Bedarf 1 je Schicht über die Turnierzeit), `aufbau` („Mattenaufbau“ Bedarf 4, „Tribünenaufbau“ Bedarf 2), Standard Vortag 17:00–19:00 **(Annahme)**. Überschneidungs- und Fristprüfung rechnen mit absoluten Minuten (`tag_versatz × 1440 + von_min`); die Eintragungsfrist (Turniertag 08:00) gilt für Vortagsdienste weiter am Turniertag-Morgen **(Annahme)**. Das Planer-UI zeigt Vortagsdienste in einem eigenen Streifen „Vortag“ und erlaubt, eine Tätigkeit zwischen Vortag/Turniertag zu verschieben.

## Automatische Erledigung

Reiner Aufbau in `src/shared/orgaStatus.js` (testbar ohne DB): `berechneStatus(aufgabe, kinder, helferplanZaehlung)`.
- Eigene Hauptaufgabe mit Kindern: erledigt, wenn alle Nicht-`mitbringen`-Kinder erledigt.
- `helferplan_taetigkeit` (`auto_ref` = Art der Tätigkeit): erledigt, wenn alle Slots aller Tätigkeiten dieser Art voll sind (`belegt >= bedarf`) und mindestens ein Slot existiert. Fortschritt „4 von 6 Plätzen“ wird angezeigt.
- `helferplan_gesamt` („Helferbedarf festlegen“): erledigt, wenn alle Slots aller Tätigkeiten voll sind.
- Manuelles Abhaken (`erledigt_am`) gilt zusätzlich: wer abhakt, überstimmt die Automatik. Wird später ein Slot wieder frei, bleibt der manuelle Haken stehen; die Anzeige nennt es nicht, der Haken lässt sich zurücknehmen **(Annahme)**.
- Berechnet wird beim Laden (eine Abfrage über `helfer_slots`/`helfer_einsaetze`), nichts wird gespiegelt gespeichert.

## Zuweisen, Mail, Einladung

- **Zuständiger** wählbar aus (a) Vereinsmitgliedern mit freigegebenem Konto im ausrichtenden Verein, (b) freiem Namen, optional mit E-Mail.
- (a): Mail an das Konto mit Aufgabe, Fälligkeit und Link `<PUBLIC_BASE_URL>/helfer.html#aufgaben`.
- (b) ohne E-Mail: reine Notiz, die Orga hakt ab (wie `name_manuell` im Helferplan).
- (b) mit E-Mail: Gibt es dazu ein bestätigtes Konto im Verein, wird zugewiesen wie (a). Sonst geht eine **Einladungsmail** mit Link `<PUBLIC_BASE_URL>/einladung.html?token=…`; die Seite fragt Passwort, Vor- und Nachname ab (E-Mail vorbelegt, nicht änderbar). Der Link beweist die Adresse: das Konto entsteht **bestätigt und im Verein freigegeben mit Rolle `helfer`**, ohne Admin-Freigabe und ohne Bestätigungsmail; alle offenen Aufgaben mit dieser Adresse in diesem Verein werden dem neuen Konto zugeordnet. Token 14 Tage gültig, einmal verwendbar, „erneut senden“ durch die Orga; Ratenbegrenzung wie bei der Registrierung. Existiert die Adresse bereits mit einem Konto in einem *anderen* Verein, wird sie nach Anmeldung dem Verein als `helfer` hinzugefügt statt zu registrieren **(Annahme)**.
- Nur Mailversand mit `PUBLIC_BASE_URL` (Cloud); ohne sichere Basis-URL keine Links, der Fehler wird dem Aufrufer als 503 gemeldet wie bei der Registrierung.

## Erinnerung

Stündlicher Job (nur Cloud bzw. wenn `HELFER_APP_AKTIV=true` und SMTP konfiguriert; Start in `app.js` über `setInterval`, kein neues Paket): für alle offenen Aufgaben mit Zuständigem und E-Mail, deren `faellig_am` in 0 bis 3 Tagen (Europe/Berlin) liegt und `erinnert_fuer` ≠ `faellig_am`: Mail senden, `erinnert_fuer = faellig_am` setzen. Eine Erinnerung je Fälligkeit; ändert sich die Fälligkeit, gilt sie erneut. Fehler beim Senden werden protokolliert, `erinnert_fuer` dann nicht gesetzt (nächster Lauf probiert es erneut). Überfällige Aufgaben bekommen keine Mail.

## Rechte

Orga-Seiten und Bearbeiten (anlegen, zuweisen, Frist, löschen): wie `helfer-plan` (`requireRolle(knex, 'benutzer')` bzw. Einzelbenutzerbetrieb/Super-Admin, Schreiben über `requireWriteAuth`). Zuständige (jede Rolle, auch `helfer`) dürfen **nur ihre eigenen** Aufgaben über die Helfer-Route auf erledigt/offen setzen. Rolle `helfer` darf in der Mitbringliste eigene Einträge anlegen, ändern und löschen (nur eigene, `erstellt_von`).

## Oberfläche

- **Menü** (`public/js/menu.js`): neuer Punkt **Orga** (aufklappbar, Zustand im `localStorage`, Standard offen) mit Untermenü: Übersicht (`orga.html`), Meine Aufgaben (`orga.html?ansicht=meine`, Zähler offener eigener), Helfer (verschoben, `helfer-plan.html`), Technik, Catering, Medaillen und Pokale (jeweils `orga-aufgabe.html?id=…`, Zähler `erledigt/gesamt`), Urkunden-Designer (verschoben, `urkunden-designer.html`). Aus der Hauptleiste verschwinden Helfer und Urkunden-Designer. Es gibt **keinen** Phasenschalter und keinen Sammelpunkt „Verwaltung“; die Systempunkte unten bleiben wie bisher.
- **`orga.html`**: Kennzahlen (erledigt, überfällig, ohne Zuständigen), Phasenblöcke (Grundlage abgesetzt), Filter „Nur meine Aufgaben“, Umschalter „Nach Phase / Nach Person“, Aufgabenzeile mit Statuspunkt (offen/angefangen/erledigt), Titel, Fortschritt der Posten oder der Automatik, Zuständiger-Chip (Zuweisen-Dialog mit Konto-Auswahl oder freiem Namen + E-Mail), Fälligkeit (überfällig rot), Link zur passenden Seite. Aufgaben mit Posten öffnen `orga-aufgabe.html` mit Zurück-Knopf.
- **`orga-aufgabe.html`**: Liste der Posten (Haken, Titel, Menge, Zuständiger), Fortschrittsbalken, „Posten hinzufügen“, „Alle auf mich“; beim Catering darunter die Mitbringliste mit Eintragsformular.
- **Helfer-App** (`helfer.html`): Abschnitt „Meine Aufgaben“ (Überfällig, Diese Woche, Später) mit Erledigt-Haken, neben den Diensten. Kein Board.
- **`einladung.html`**: Registrierung per Einladungslink.
- Orga-Seiten gehören zu den `eingeschraenkteSeiten` in `menu.js` (Gastvereine erreichen sie nicht).

## Transfer und Betriebsmodi

Die Cloud ist der Ort, an dem geplant und delegiert wird (Konten, Mail). Aufgaben wandern mit dem Turnier-Export/-Import zum Hallen-Server (`orgaTransfer.js` nach Vorbild `helferTransfer.js`; Zuständige nur als Namen/E-Mail ohne Kontobezug, Erinnerungsstand wird nicht übernommen). Am Hallen-Server (Einzelbenutzerbetrieb) funktioniert die Checkliste mit freien Namen; es gibt dort weder Einladungen noch Erinnerungsmails. Die Teilnehmer-App/Live-Uplink bleibt unberührt.

## Tests

Unit: `orgaStatus` (Kinder, Automatik, manueller Haken), Fristberechnung mit Ankern und Überschreibung, Vorlage (eindeutige `vorlage_key`, Phasen vollständig), Einladungstoken, Erinnerungsauswahl. Service-Tests mit eingebettetem PostgreSQL (Anlegen aus Vorlage, Neuberechnung bei Terminänderung, Zuweisen mit/ohne Konto, Einladung einlösen = bestätigt+freigegeben+Rolle `helfer`, Zuordnung offener Aufgaben, Erinnerung nur einmal). Helferplan: neue Tätigkeiten, `tag_versatz` in Überlappungsprüfung. E2E (`tests/e2e/orga-planer.spec.js`): Aufgabe abhaken, Posten → Elternaufgabe grün, Menü-Untermenü, Zuweisen an freien Namen.

## Dem Bauer überlassen

Spaltentypen im Detail, API-Pfade (`/api/orga`, `/api/helfer/orga`), Mailtexte (Sie-Form wie in `registrierung.js`), Gestaltung der Dialoge im Stil der vorhandenen Seiten, Reihenfolge der Umsetzung (sinnvoll: Datenmodell + Status → Helferplan-Erweiterung → API → Seiten → Einladung → Erinnerung → Menü).
