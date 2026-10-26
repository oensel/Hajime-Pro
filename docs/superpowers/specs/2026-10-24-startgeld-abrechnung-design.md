# Startgeld-Abrechnung (Zahlweg, Rechnung, SEPA-Lastschrift) — Design

Stand: 2026-10-24. Entwurf nach Brainstorming mit dem Projektinhaber. Keine Rechtsberatung: Mandatstext, Rechnungs-Pflichtangaben und Umsatzsteuer-Hinweise vor dem Produktiveinsatz fachlich prüfen lassen.

## Ziel und Warum

Vereine melden Kämpfer zu Turnieren anderer Vereine an. Der Ausrichter will das Startgeld (Betrag je Kämpfer) ohne Handarbeit einziehen: Der meldende Verein legt bei der Anmeldung fest, wie er zahlt. Nach dem Turnier erstellt der Admin des Ausrichters per Knopfdruck die Rechnungen (per Mail) und bei Lastschrift eine SEPA-Sammeldatei für das Online-Banking.

## Ziele
- Zahlweg je meldendem Verein und Turnier: **SEPA-Lastschrift**, **Überweisung**, **Bar vor Ort** (kein Wero).
- Der Zahlweg wird nur abgefragt, wenn das Turnier Startgeld verlangt (`turniere.startgeld > 0`) und der meldende Verein nicht der Ausrichter ist.
- Rechnung geht bei allen Zahlwegen per Mail (bei Bar als Quittung bzw. offene Rechnung), SEPA-Datei für Lastschriften.
- Abrechnungsbasis wählt der Turnier-Anleger: **Gemeldete** oder **Teilnahme Waage**.
- Kein Kämpfer eines Vereins mit gesichertem Zahlweg wird bei der Pool-Bildung wegen „Startgeld nicht bezahlt“ ausgeschlossen.

## Nicht-Ziele
- Wero, Kartenzahlung, Zahlungsdienstleister, automatische Zahlungsbestätigung durch Dritte.
- Mahnwesen über eine einfache Zahlungserinnerung hinaus; Buchhaltungsexport (DATEV o. Ä.).
- Zahlweg je Kämpfer (er gilt je Verein), Anzeige von Zahlweg/Betrag für Vereinsmitglieder.
- Steuerliche Beratung; die Umsatzsteuer-Behandlung ist ein frei wählbarer Hinweistext.

## Anti-Ziele (wäre ein Fehlschlag, auch wenn es technisch läuft)
- Ein Verein wird per Lastschrift belastet, ohne dass eine vertretungsberechtigte Person wirksam zugestimmt hat (Missbrauch mit fremder IBAN).
- IBANs oder SEPA-Dateien gelangen in Logs, Protokoll, Konsole, Turnier-Export zum Hallen-Server oder an nicht berechtigte Rollen.
- Das Zurückspielen aus der Hallen-Server-Datei überschreibt Zahlungsdaten oder bereits versandte Rechnungen.
- Doppelter Einzug derselben Rechnung.

## Bestehender Stand im Code (wichtig für die Planung)
- `turniere.startgeld`, `iban`, `kontoinhaber`, `verwendungszweck` existieren (Migration `20260712180934`); `turnier_teilnehmer.startgeld_bezahlt` existiert und ist heute **Voraussetzung für „kampfbereit“** (`poolController.js`, `teilnehmerController.js`: „Das Startgeld ist noch nicht bezahlt.“), nur Ausrichter-Verein und aktive Super-Admins dürfen es setzen (`istPrivilegiertFuerLizenzUndStartgeld`, Waage-Modal und `teilnehmer.html`). Kostenlose Turniere (`startgeld` = 0) umgehen das Flag.
- Die neue Logik **ersetzt dieses Flag nicht**, sondern befüllt es: Für Vereine mit Zahlweg Lastschrift/Überweisung gilt „Zahlweg gesichert“ als bezahlt für die Kampfbereitschaft (abgeleitet, Details unten); bei Bar setzt es die Waage beim Kassieren wie bisher von Hand.
- Turnier-Export/-Import (`importiereTurnierDaten`, `urspruengliche_id`), Cloud-Holen (`cloudZugriff.js`, `cloudRoutes.js`), Versandwege (SMTP), PDF (`pdf-lib`), AES-GCM-Verschlüsselung (`zweiFaktor.js`), Protokoll (`aktionsProtokoll.js`) und Konsolen-Schwärzung (`fehlerProtokoll.js`) sind vorhanden und wiederzuverwenden.
- `turnier_teilnehmer.verein` ist Freitext; ein „meldender Verein“ als Verweis auf `vereine.id` ist noch zu ergänzen (Spalte am Teilnehmer, in Export/Import mitführen).

## Ablauf

### 1. Stammdaten des Ausrichters (erst beim ersten Ausrichten mit Startgeld)
Im Turnierformular erscheint beim Setzen eines Startgelds > 0 ein Block „Startgeld“. Fehlen Vereins-Stammdaten, öffnet sich eine Pflege (Reiter „Abrechnung“ im Vereinsprofil, nur Admin des Vereins/Super-Admin) und der Block nennt, was fehlt:
- Anschrift, Rechnungs-E-Mail/Absendername, Steuernummer oder USt-Id, Umsatzsteuer-Hinweistext, Rechnungsnummern-Präfix (Nummern fortlaufend lückenlos je Verein).
- Kontoinhaber und IBAN (verschlüsselt gespeichert, maskiert angezeigt). Die vorhandenen Turnier-Felder `iban`/`kontoinhaber`/`verwendungszweck` bleiben als turnierbezogene Überschreibung/Voreinstellung bestehen (Migration/Übernahme in der Planung klären).
- Gläubiger-ID (nur für Lastschrift; Formatprüfung). Ohne Gläubiger-ID wird Lastschrift für dieses Turnier nicht angeboten.

Je Turnier: Startgeld je Kämpfer, **Abrechnungsbasis** (`gemeldet` | `teilnahme_waage`), angebotene Zahlwege (einzeln abschaltbar), Zahlungsziel bei Überweisung, Frist der Vorabankündigung bei Lastschrift, Hinweistext der Rechnung.

### 2. Anmeldung (Cloud)
- Beim ersten Anmelden eines Kämpfers durch einen Verein (nicht Ausrichter) bei Turnier mit Startgeld erscheint ein nicht überspringbares Popup: Zahlweg wählen; Höchstbetrag (Kämpferanzahl × Startgeld) und Abrechnungsbasis werden genannt.
- Immer abgefragt (auch bei Bar): Rechnungs-E-Mail (vorbelegt), Ansprechperson, Anschrift (am Verein gespeichert, später wiederverwendet), weil der Kassierer meist kein Admin ist.
- Bei Lastschrift: IBAN (Prüfsumme), Kontoinhaber, Mandatstext des Ausrichters mit Gläubiger-ID, Mandatsreferenz, Hinweis auf das 8-Wochen-Erstattungsrecht, **Vorabankündigungsfrist**, Bestätigung „Ich bin berechtigt, den Verein zu vertreten“, ausdrückliche Zustimmung. Gespeichert werden Zeitstempel, Benutzer, IP und die Textversion. Der Status „Zahlweg gesichert“ gilt erst nach Bestätigung des Mandats (Bestätigungsmail an die Admins des zahlenden Vereins, solange das Mandat nicht von einem Admin selbst erteilt wurde).
- Der Zahlweg ist bis zum Anmeldeschluss änderbar: Wechsel weg von Lastschrift widerruft das Mandat und löscht die IBAN (protokolliert, ohne IBAN); Wechsel zur Lastschrift öffnet das Mandatsformular neu. Nach dem Anmeldeschluss gesperrt, nur Admin des Ausrichters kann ausnahmsweise ändern (mit Protokolleintrag).
- Mitglieder sehen weder Zahlweg noch Betrag.

### 3. Pool-Bildung und Waage (Hallen-Server)
- Zahlungsdaten reisen nur reduziert zum Hallen-Server: je Verein ein Merker `bar` ja/nein sowie `zahlungGesichert`; **keine IBAN, kein Mandat**.
- Das bestehende Gate `startgeld_bezahlt` bleibt. Kämpfer von Vereinen mit gesichertem Zahlweg (Lastschrift/Überweisung) gelten für die Kampfbereitschaft als „bezahlt“; das wird **berechnet** (aus Verein und Zahlweg), nicht in die Spalte geschrieben. Bar-Vereine: Das Flag setzt die Waage beim Kassieren von Hand (Kassenliste an der Waage); bis dahin ist der Kämpfer nicht kampfbereit. Das Setzen des Flags darf am Hallen-Server jeder, der die Waage bedient (nicht nur Ausrichter-Verein/Super-Admin).
- Nachgemeldete Kämpfer eines angemeldeten Vereins werden mit dessen Zahlweg abgerechnet. Ein **neuer Verein** (nicht unter den Meldern) zahlt immer **Bar**; Rechnungs-E-Mail und Anschrift werden beim Anlegen mit erfasst, damit eine Quittung möglich ist. Kämpfer ohne Zuordnung stehen auf der Abrechnungsseite in „Nicht zugeordnet“ und müssen vor den Rechnungen aufgelöst werden.
- Die Waage erfasst Barzahlungen (Verein, Betrag, Zeitpunkt).

### 4. Zurückspielen in die Cloud (zwingend vor der Abrechnung)
- Neue Aktion am Hallen-Server „Turnier in die Cloud zurückspielen“ (direkt per Cloud-Login wie beim Holen; Reserve: Datei-Upload durch den Admin des Ausrichters).
- Ersetzt in der Cloud nur die **Wettkampfdaten** (Teilnehmer, Pools, Matten/Kampfflächen, Kämpfe, Ergebnisse, Mannschaften, Zuordnung Teilnehmer → meldender Verein, Barzahlungen). **Unberührt** bleiben Zahlwege, Mandate, IBANs, Rechnungen, Helferplan, Orga-Planer, Urkunden-Vorlagen und Live-Token.
- Zahlungsdaten hängen an (Turnier, Verein), nie an Teilnehmer-IDs; Rechnungspositionen speichern Namen als Kopie.
- Prüfungen: gleiches Turnier (`urspruengliche_id`), berechtigter Verein/Admin, vollständige Datei; nach versandten Rechnungen ist ein erneutes Ersetzen gesperrt (nur gezielte Freigabe durch einen Admin, bestehende Rechnungen bleiben unverändert).

### 5. Abrechnung
- Seite „Abrechnung“ je Turnier (Admin des Ausrichters/Super-Admin), erst nach dem Zurückspielen aktiv: je Verein Zahlweg, Anzahl Kämpfer nach Basis, Betrag, Status.
- Basis `gemeldet`: alle nicht abgemeldeten Kämpfer. Basis `teilnahme_waage`: Kämpfer, deren Gewicht an der Waage erfasst wurde (`gewogen`), auch bei späterem Ausschluss wegen Übergewicht; (Annahme, vom Projektinhaber zu bestätigen).
- „Rechnungen erstellen“ erzeugt je Verein eine Rechnung (PDF, `pdf-lib`) und mailt sie an die Rechnungs-E-Mail. Überweisung: IBAN, Verwendungszweck, Zahlungsziel und EPC-QR (Girocode). Lastschrift: Hinweis, dass per Lastschrift eingezogen wird, Mandatsreferenz, Einzugsdatum. Bar: Quittung („bar erhalten“) oder offene Rechnung, je nachdem ob die Waage kassiert hat.
- Lastschrift: Das System berechnet das früheste Fälligkeitsdatum (Rechnungsdatum + Vorabankündigungsfrist, SEPA-Core-Vorgaben) und erzeugt eine SEPA-Sammeldatei (pain.008 im aktuell gültigen Schema, Zeichensatz-Regeln, Verwendungszweck ≤ 140 Zeichen). Die Datei ist nur für Admins des Ausrichters, mit Protokolleintrag; bei Super-Admins zusätzlich Code-Abfrage. Das Merkmal „Datei erzeugt am“ verhindert Doppeleinzug; Neuerzeugung nur gezielt.
- Status je Rechnung/Verein: offen → versandt → eingezogen/bezahlt → zurückgebucht/überfällig. Der Admin setzt „bezahlt“ von Hand; Bankdatei-Import (camt.053/CSV, Zuordnung über die Rechnungsnummer im Verwendungszweck) ist eine spätere Stufe. Gutschriften für Korrekturen, Rücklastschrift-Erfassung (der Verein wird auf Überweisung/Bar umgestellt).

## Datenschutz, Sicherheit, Aufbewahrung
- IBAN/Mandat verschlüsselt (AES-GCM wie `totp_secret`), maskiert in der Oberfläche, nie in Protokoll, Konsole, Fehlermeldungen oder im Turnier-Export; die Konsolen-Schwärzung wird um IBAN-Muster ergänzt.
- Die Datensicherung enthält die Daten verschlüsselt mit; Datenschutzerklärung, Verarbeitungsverzeichnis und Löschkonzept (`docs/datenschutz/`) werden ergänzt. Aufbewahrung: Mandate bis rund 14 Monate nach dem letzten Einzug, Rechnungen 8 Jahre (Abgleich mit dem Löschkonzept).
- Alle Aktionen (Zahlweg ändern, Mandat, Rechnungslauf, SEPA-Download) landen im Aktionsprotokoll, ohne sensible Inhalte.

## Berechtigungen
- Zahlweg wählen/ändern (bis Anmeldeschluss): jedes freigegebene Vereinsmitglied ab Rolle `benutzer` (Annahme); ein bestehendes Lastschrift-Mandat widerruft nur ein Admin des Vereins (Annahme).
- Stammdaten, Abrechnungsseite, Rechnungslauf, SEPA-Datei: Admin des Ausrichters/Super-Admin im Super-Admin-Modus.

## Umsetzungsstufen (Vorschlag, im Plan auszuarbeiten)
1. Startgeld-Block im Turnier, Zahlweg und Rechnungsadresse (Überweisung/Bar), abgeleiteter Zahlstatus für Kampfbereitschaft, Kassenliste an der Waage.
2. Zurückspielen in die Cloud (mit Schutz der Zahlungsdaten), Abrechnungsseite, Rechnungs-PDF und Mailversand, Überweisung mit Girocode.
3. Lastschrift: Mandat, Bestätigungsmail, SEPA-Datei, Fristen, Statusverwaltung.
4. Später: Bankdatei-Import, Zahlungserinnerung, Gutschriften.

## Festlegungen des Autors (nach Rückfragen der Planungsprüfung)
Diese Punkte hat der Autor selbst entschieden; der Projektinhaber soll sie beim Lesen prüfen.
1. **Nur Cloud-Turniere:** Die Abrechnung gibt es nur für Turniere, die in der Cloud angelegt und von dort geholt wurden. Ein am Hallen-Server angelegtes oder aus einer Datei importiertes Turnier ohne Cloud-Bezug hat keine Startgeld-Abrechnung (das bisherige `startgeld_bezahlt` gilt dort weiter).
2. **Zahlstatus-Berechnung:** Sie läuft am Hallen-Server aus dem beim Holen mitgelieferten Stand je Verein (`zahlungGesichert`, `bar`); der Zahlweg ist ab Anmeldeschluss gesperrt, der Stand beim Holen also endgültig.
3. **Unbestätigtes Mandat** gilt nicht als „gesichert“. Der Verein bekommt Mails; bleibt das Mandat bis zum Anmeldeschluss unbestätigt, wird der Verein automatisch auf Bar umgestellt und informiert.
4. **Meldender Verein:** automatisch der aktive Verein der anmeldenden Person; beim CSV-/Mail-Import der aktive Verein des Importierenden; meldet der Ausrichter für einen fremden Verein, wählt er ihn aus der Vereinsliste; Bestandsdaten ohne Zuordnung erscheinen in „Nicht zugeordnet“.
5. **Rückspielen:** selektives Ersetzen der Wettkampfdaten mit Zuordnung über `urspruengliche_id`; am Hallen-Server neu entstandene Teilnehmer (Nachzügler, neuer Verein) werden mit ihrem Vereinsbezug (oder als „nicht zugeordnet“) mit eingespielt. Autorisierung durch Cloud-Login eines Admins des Ausrichters (bei Super-Admins mit 2FA-Code im Dialog).
6. **Lastschrift:** nur SEPA-Core, je Turnier und Verein ein Einmal-Mandat (Sequenztyp `OOFF`), kein Wiederholungsmandat in der ersten Version; Gläubiger-ID je ausrichtendem Verein; Vorabankündigungsfrist je Turnier einstellbar, Voreinstellung 5 Tage (im Mandatstext genannt; fachlich zu prüfen). Die Aufbewahrung der Mandate (14 Monate nach dem letzten Einzug) ist reine Archivfrist.
7. **Mandatsbestätigung:** Ersteller hat Rolle `benutzer`. Ist er Admin des Vereins, gilt das Mandat sofort; sonst geht ein Einmal-Link (Muster `token_einmal`, 7 Tage) an alle Admins des Vereins, einer genügt.
8. **Zählung:** „Abgemeldet“ heißt: der Kämpfer wurde aus der Teilnehmerliste gelöscht. Basis `gemeldet` zählt alle vorhandenen Teilnehmer (auch nicht angetreten/disqualifiziert); Mannschaftsmitglieder zählen als Kämpfer, ein Kämpfer in Einzel und Mannschaft nur einmal; kein Startgeld je Mannschaft.
9. **Rechnung:** Gesamtbetrag (Anzahl × Startgeld) mit freiem Umsatzsteuer-Hinweistext, kein Steuerausweis je Position in der ersten Version; Gutschriften erst in Stufe 4.
10. **Schlüssel:** Der IBAN-Schlüssel kommt wie beim 2FA-Geheimnis aus einer Umgebungsvariable und muss getrennt von den Sicherungen verwahrt werden (die Sicherung enthält nur Chiffretext; ohne Schlüssel ist die IBAN nach Wiederherstellung unbrauchbar).
11. **IBAN des Ausrichters:** Das Turnierfeld überschreibt die Vereins-IBAN, sonst gilt die des Vereins.

## Stand nach Stufe 1 / Abweichungen (Nachtrag 2026-10-25, Planung Stufe 2/3)
Stufe 1 ist auf `main` (Plan `docs/superpowers/plans/2026-10-24-startgeld-zahlweg-stufe1.md`). Folgende Punkte weichen vom obigen Text ab; die Pläne für Stufe 2 (`2026-10-25-startgeld-rechnungen-stufe2.md`) und Stufe 3 (`2026-10-25-startgeld-lastschrift-stufe3.md`) bauen darauf auf:
- **Meldender Verein über den Namen:** Zahlwege hängen an (Turnier, `verein_name`), nicht an einer neuen Spalte `meldender_verein_id` (Festlegung 4 und Abschnitt „Bestehender Stand“). Kämpfer mit abweichend geschriebenem Vereinsnamen sind „nicht zugeordnet“; Stufe 2 löst sie auf der Abrechnungsseite auf (zuordnen oder Rechnungsdaten erfassen).
- **Ausrichter zahlt nichts:** Kämpfer des Ausrichter-Vereins gelten automatisch als gesichert.
- **Kasse:** Die Kassenliste an der Waage gibt es schon (Bar-Vereine und Vereine ohne Zahlweg); sie setzt `startgeld_bezahlt`. Ein Journal der Barzahlungen (Verein, Betrag, Zeitpunkt) kommt erst mit Stufe 2.
- **Transfer zum Hallen-Server:** Der Export trägt je Verein Zahlweg **und Rechnungsangaben** (E-Mail, Ansprechperson, Anschrift), nicht nur `bar`/`zahlungGesichert`; ohne Vereins- und Benutzer-IDs. Die Turnierfelder `iban`/`kontoinhaber` (Empfängerkonto des Ausrichters) reisen wie seit jeher mit; Vereins-Stammdaten, Mandate und Zahler-IBANs reisen nie.
- **Rückspielen existiert teilweise:** `POST /api/turniere/:id/import-ergebnisse` (Datei-Upload, ersetzt die Wettkampfdaten, lässt Zahlwege unberührt, setzt `abgeschlossen`) gibt es schon, bisher für Rolle `benutzer` und nur einmal (danach `abgeschlossen` und gesperrt). Stufe 2 baut ihn zum gemeinsamen Kern von Datei-Upload und Direktweg um, verlangt Rolle `admin` und erlaubt erneutes Rückspielen bis zum ersten Rechnungsversand.
- **„Abgemeldet“:** Die Selbstabmeldung setzt `status = 'zurueckgezogen'` (der Datensatz bleibt); gelöscht wird nur durch den Ausrichter. Zurückgezogene zählen wie Gelöschte nicht (Festlegung 8 entsprechend gelesen).
- **Cloud-Live-Betrieb:** Turniere können inzwischen live in der Cloud laufen; dann gibt es nichts zurückzuspielen. Stufe 2 gibt die Abrechnung auch für beendete Cloud-Live-Turniere frei, die nie auf einen Hallen-Server geholt wurden (zu Festlegung 1 und Abschnitt 4).
- **Vereinsprofil:** Eine Profilseite mit Reitern gibt es nicht; die Stammdaten bekommen eine eigene Seite `verein-abrechnung.html`, verlinkt aus „Mein Profil“ und dem Startgeld-Block.
- **2FA beim Direktweg:** Der TOTP-Code eines Super-Admins wird schon bei der Cloud-Anmeldung verbraucht; das Rückspielen akzeptiert deshalb eine höchstens 10 Minuten alte 2FA-Anmeldung (Claim im Token) statt eines zweiten Codes. Der SEPA-Download verlangt immer einen frischen Code.
- **Turnier-IBAN:** Die Turnierfelder bleiben ohne Prüfsummenprüfung (bestehende Daten/Tests); geprüft werden die Vereins-IBAN der Stammdaten und die Zahler-IBAN im Mandat.

## Stand nach Stufe 2 / Abweichungen (Nachtrag 2026-10-25, Umsetzung Rechnungen)
Stufe 2 (Plan `docs/superpowers/plans/2026-10-25-startgeld-rechnungen-stufe2.md`) liefert Stammdaten, Rückspielen, Abrechnungsseite und Rechnungen. Was von der Planung oder von Stufe 1 abweicht:
- **Anrechnung bezahlter Kämpfer (E9 geändert):** Bereits bezahlte Kämpfer (Rohflag `startgeld_bezahlt`) werden bei **jedem** Zahlweg außer Lastschrift angerechnet. Die Rechnung zeigt die Zeile „bar erhalten“ beim Zahlweg Bar, sonst „bereits bezahlt“; ist alles bezahlt, entsteht eine Quittung (`art = 'quittung'`, Status `bezahlt`). Der Rest läuft per Überweisung (Girocode über den Rest).
- **Kassenjournal:** `turnier_barzahlungen` (eindeutig je `turnier_id`+`uid`) erfasst nur „Alles bar kassiert“ und ist **rein informativ**. Maßgeblich für Anrechnungen ist `startgeld_bezahlt` je Kämpfer.
- **Rückspielen:** nur Rolle `admin` des Ausrichters; Super-Admins brauchen den 2FA-Nachweis (`zf`-Claim, höchstens 10 Minuten alt, oder Header `X-2FA-Code`). Direktweg vom Hallen-Server (`POST /api/cloud/turniere/:cloudId/zurueckspielen`, optionales `code`) und Datei-Upload (`POST /api/turniere/:id/import-ergebnisse`) teilen sich `src/services/rueckspielen.js`. Nach dem ersten Rechnungsversand ist erneutes Zurückspielen gesperrt (409), bis ein Admin über „Freigabe“ (`POST /api/abrechnung/:turnierId/rueckspielen-freigeben`) das nächste Zurückspielen erlaubt (die Freigabe wird dabei verbraucht).
- **Rechnungen sind unveränderliche Momentaufnahmen** mit lückenlosen Nummern je Aussteller (Zähler `vereins_abrechnung.naechste_rechnungsnummer` unter Sperre). `rechnungen.pdf` enthält die Empfänger-IBAN im Klartext und liegt in der Datensicherung (Datenschutz-TOMs: Sicherungen mit `SICHERUNG_PASSWORT` verschlüsseln). Aufbewahrung 8 Jahre. Das Zusammenführen von Vereinen verschiebt Rechnungen nicht (Momentaufnahmen; Fremdschlüssel `SET NULL`).
- **Empfänger-IBAN für Zahlende:** `GET /api/zahlweg/:turnierId` liefert Zahlenden mit Zahlweg Überweisung die entschlüsselte Empfänger-IBAN (bewusste Entscheidung: sie steht ohnehin auf Rechnung und Girocode).
- **Neue Umgebungsvariable `ZAHLUNGSDATEN_SCHLUESSEL`** (mindestens 32 Zeichen, siehe `docs/betrieb.md`): getrennt von den Sicherungen verwahren; Verlust heißt IBANs neu eingeben. Stufe 3 ergänzt die Rotation.
- **Bekannte Lücken:** (1) Das Cloud-Anmeldeformular von „Turnier aus der Cloud holen“ hat kein 2FA-Code-Feld für Super-Admins. (2) Die Handler der Abrechnungsseite haben kein try/catch und keinen Doppelklick-Schutz vor dem Bestätigungsdialog. (3) Die Anzeige der `hinweise` und der 409-Pfad während des Rechnungslaufs sind nicht im Browser getestet. (4) Schreibvarianten von Vereinsnamen: die Abrechnung normalisiert Groß-/Kleinschreibung und Leerraum, Kasse und `synchronisiereGesichert` vergleichen exakt; das Normalisieren des gespeicherten Namens ist Folgearbeit. (5) Eine Rechnung kann nach `ordneVereinZu` abweichen und wird dann als „weicht ab“ markiert.

## Dem Bauenden überlassen
Tabellenaufbau und Migrationen, genaue Texte (außer dem rechtlich zu prüfenden Mandatstext), Layout von Popup und Abrechnungsseite, Format der Rückspiel-Datei, Umgang mit den vorhandenen Turnier-Feldern `iban`/`kontoinhaber`/`verwendungszweck`.
