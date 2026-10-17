# Helferverwaltung – Entwurf

Stand: 2026-10-17 (überarbeitet: Rollen je Verein) · Status: Entwurf zur Freigabe, nichts umgesetzt
Betrifft: Cloud-Server (Anmeldung, Rechte, Helfer-App), Hallen-Server (Plan, Ausweisdruck), Verwaltungsoberfläche

## 1. Ziel und Abgrenzung

Helfer für ein Turnier organisieren, von der Anmeldung bis zum Ausweis am Wettkampftag.

- Pro Kampfgericht (Matte) mindestens 2 Personen, pro Waage mindestens 2 Personen.
- Frei anlegbare weitere Tätigkeiten (Getränketheke, Waffelstand, Kuchenverkauf, …) mit Bezeichnung und Mindestzahl Helfer.
- Jede Tätigkeit ist in Zeit-Slots von standardmäßig 2 Stunden aufgeteilt. Helfer tragen sich selbst in Slots ein.
- Die Turnierorganisation plant die Slots in einer grafischen Zeitstrahl-Ansicht.
- Helfer bekommen einen druckbaren Ausweis.

Nicht Ziel: Arbeitszeitabrechnung, Verpflegungsmarken, Push-Nachrichten, Helfer-Chat. Ebenfalls nicht Teil der Anwendung: Kampf- oder Wertungslogik.

Anti-Ziel: Ein Konto, das nur Helfer ist, darf nie Turniere verwalten (siehe 3.3). Ein Mensch soll sich nur einmal registrieren müssen.

## 2. Rollen

Es gibt **einen Rollenbaustein global** und **drei Rollen je Verein**.

| Rolle | Geltungsbereich | Rechte |
|---|---|---|
| **Super-Admin** | gesamtes System | Alles in allen Vereinen. Kann weitere Super-Admins ernennen und entziehen. Bekommt die Freischaltungs-Mail, wenn ein Verein noch keinen Admin hat. Der Auftraggeber ist derzeit der einzige. |
| **Admin** | ein Verein | Mitglieder des Vereins freigeben und ablehnen, ihnen die Rolle Admin, Benutzer oder Helfer zuweisen, Rollen ändern, Mitglieder entfernen. Alles, was ein Benutzer darf. Jeder Verein hat mindestens einen Admin. |
| **Benutzer** | ein Verein | Turniere des Vereins verwalten (wie bisher) und deren Helferplan pflegen. Hat alle Rechte eines Helfers. |
| **Helfer** | ein Verein | Nur die Helfer-App: Turniere des Vereins sehen, sich in Slots ein- und austragen, Profil. Keine Turnierverwaltung. |

Die Rechte bauen aufeinander auf: **Admin ⊃ Benutzer ⊃ Helfer**. Ein Benutzer oder Admin kann die Helfer-App ohne weitere Registrierung nutzen und sich selbst als Helfer eintragen.

Die Rolle hängt an der **Mitgliedschaft eines Kontos in einem Verein**, nicht am Konto. Dasselbe Konto kann in Verein A Helfer und in Verein B Admin sein.

## 3. Rechtemodell

### 3.1 Datenmodell der Rollen

- `benutzer_vereine` (vorhanden: `benutzer_id`, `verein_id`, `freigegeben`) bekommt die Spalte **`rolle`** mit `admin`, `benutzer`, `helfer`. Solange `freigegeben = 0`, ist die Rolle noch nicht vergeben (leer).
- `benutzer.ist_super_admin` (vorhanden, `src/utils/superAdmin.js`, `requireSuperAdmin`) bleibt die einzige globale Rolle. Es gibt keine zweite Spalte dafür.
- **Migration bestehender Daten (meine Entscheidung):** Alle bereits freigegebenen Mitgliedschaften werden zu `admin`. Heute dürfen alle freigegebenen Mitglieder eines Vereins weitere Mitglieder freischalten, das entspricht der Admin-Rolle und erhält den Ist-Zustand. Admins können danach auf Benutzer zurückstufen.
- Super-Admin-Verwaltung: Admin-Seite „Nutzer“ (nur Super-Admins) mit der Liste aller Konten, Umschalter für Super-Admin. Der letzte Super-Admin kann sich nicht selbst herabstufen.

### 3.2 Welche Prüfungen sich ändern

Heute gilt als einzige Regel: freigegebenes Mitglied des ausrichtenden Vereins darf das Turnier bearbeiten (`hatVereinsZugriffAufTurnier` in `src/utils/vereinHelper.js`, `requireTournamentEditAccess` in `src/middleware/auth.js`). Künftig:

| Aktion | Wer darf |
|---|---|
| Turnier, Pools, Teilnehmer, Kämpfe usw. bearbeiten; Helferplan pflegen; Ausweise drucken | Super-Admin, Admin und Benutzer des ausrichtenden Vereins (Rolle `admin` oder `benutzer`, freigegeben) |
| Mitglieder freigeben/ablehnen, Rollen vergeben und ändern | Super-Admin, Admin dieses Vereins |
| Helfer-App nutzen, Turniere des Vereins sehen, sich eintragen | jedes freigegebene Mitglied dieses Vereins (Helfer, Benutzer, Admin) |
| Super-Admins ernennen | Super-Admin |

Das heißt konkret: `hatVereinsZugriffAufTurnier` und `ladeBenutzerMitAktivemVerein`/`ladeVerwalteteVereinIds` müssen die Rolle berücksichtigen, und der Super-Admin muss ausdrücklich durchgelassen werden (heute nicht der Fall). Die bestehenden Freigabe-Routen (`approveMember`, `rejectMember`, `getPendingRequests`) sind künftig Admin-Routen und nehmen die gewählte Rolle entgegen.

### 3.3 Absicherung gegen Rechteausweitung

- Ein Konto, das in einem Verein nur Helfer ist, hat dort **kein** Verwaltungsrecht. Alle Prüfungen laufen über die Rolle der Mitgliedschaft im jeweiligen Verein, nicht über eine Mitgliedschaft allgemein.
- Verwaltungsseiten und der Vereinswechsel („aktiver Verein“) bieten nur Vereine an, in denen das Konto Benutzer oder Admin ist. Ein reiner Helfer sieht kein Verwaltungsmenü.
- Die Helfer-App spricht ausschließlich eigene Endpunkte unter `/api/helfer/*` an, die selbst die Mitgliedschaft prüfen.
- **Jeder Verein hat mindestens einen Admin:** Der letzte Admin eines Vereins kann nicht herabgestuft oder entfernt werden (der Super-Admin darf es). Ein Verein ohne Admin entsteht nur durch Neuanlage oder Altbestand; dann geht die Freischaltung an den Super-Admin (siehe 4).

## 4. Registrierung und Freischaltung

Es gibt **eine Registrierung für alle**. Daraus ergibt sich, wer was darf, erst durch die Freischaltung.

1. **Registrieren** (in der Helfer-App oder auf der bestehenden Anmeldeseite, gleicher Ablauf): Name, E-Mail, Passwort (mindestens 8 Zeichen), Verein aus einer Liste mit Autovervollständigung (Suche ab 2 Zeichen, trifft den Text an jeder Stelle des Namens, ohne Beachtung von Groß- und Kleinschreibung, Vereine mit passendem Anfang zuerst). Es lassen sich nur vorhandene Vereine wählen. Das Anlegen eines neuen Vereins bleibt der bisherige Weg über den Super-Admin.
2. **E-Mail bestätigen:** Das Konto hat den Status „E-Mail unbestätigt“. Eine Mail mit einem einmaligen, zeitlich begrenzten Link (z. B. 48 Stunden) bestätigt die Adresse; ohne Bestätigung ist keine Anmeldung möglich (mit Möglichkeit, die Mail neu zu senden). Bestehende Konten gelten als bestätigt. Der Link führt auf die Wartemeldung „Deine Registrierung muss noch freigeschaltet werden.“
3. **Anfrage an den Verein:** Erst nach der E-Mail-Bestätigung entsteht die Mitgliedschaft mit `freigegeben = 0` und die Benachrichtigung.
   - **Der Verein hat mindestens einen Admin:** Die Mail geht an **alle Admins dieses Vereins**.
   - **Der Verein hat noch keinen Admin:** Die Mail geht an **alle Super-Admins**. (Heute geht sie an die feste Adresse `SUPER_ADMIN_EMAIL`; künftig an alle Konten mit `ist_super_admin`.)
4. **Freigabe:** Die Mail enthält Name, E-Mail und Verein sowie einen einmaligen Link. Der Link öffnet eine Seite mit Auswahl der **Rolle (Admin, Benutzer, Helfer)** und den Knöpfen „Freischalten“ und „Ablehnen“. Ein bloßer Aufruf des Links verändert nichts, weil Mail-Programme Links vorab abrufen können. Die Rolle ist vorausgewählt: bei Registrierung über die Helfer-App „Helfer“, bei der Verwaltungsseite „Benutzer“ (Vorbelegung, der Admin entscheidet). Zusätzlich gibt es eine Liste offener Anfragen in der Verwaltungsoberfläche (bestehender Ort „Turnierübersicht“/„Mein Profil“) für alle, die die Mail nicht nutzen.
5. **Benachrichtigung:** Der Registrierte bekommt eine Mail („Du bist als [Rolle] bei [Verein] freigeschaltet“) oder bei Ablehnung eine kurze Absage. Die Mitgliedschaft bei Ablehnung wird gelöscht.

Die Mails laufen über `src/utils/mailer.js` (nodemailer). Ohne SMTP wird nur geloggt; die Registrierung scheitert nie an fehlender Mailkonfiguration, dann bleibt die Liste offener Anfragen.

### 4.1 Profil

Der Reiter „Profil“ der Helfer-App zeigt Name und E-Mail, die Liste „Meine Vereine“ mit Rolle und Status (`Freigeschaltet als Helfer` / `Wartet auf Freischaltung`), ein Feld „Weiteren Verein hinzufügen“ (dieselbe Autovervollständigung), „Passwort ändern“ und „Abmelden“.

- Jeder weitere Verein löst eine Anfrage nach Punkt 3 und 4 aus, ohne erneute E-Mail-Bestätigung.
- Einen Verein doppelt hinzufügen geht nicht.
- Austreten aus einem Verein: gesperrt, solange Dienste dort offen sind (erst austragen). Der letzte Admin kann nicht austreten (3.3). Meine Entscheidung.

### 4.2 Sichtbarkeit

Ein Konto sieht in der Helfer-App nur Turniere, deren **ausrichtender Verein** (`turniere.verein_id`) eine seiner freigegebenen Mitgliedschaften ist, unabhängig von der Rolle. Es erscheinen Turniere im Status `geplant` mit Datum heute oder später.

## 5. Helfer-App (Oberfläche)

Keine App im eigentlichen Sinne (keine PWA, kein Service-Worker, keine Installation): normale Seiten im bestehenden Frontend (`public/`, Vanilla-JS wie die übrigen Seiten, nur im Modus `cloud` verfügbar), die auf dem Handy und auf dem PC gut aussehen (responsives Layout, einspaltig mit unterer Navigation auf dem Handy, auf dem PC mittig begrenzte Breite mit der Navigation oben oder links). Reiter:

- **Turniere:** Liste der Turniere der eigenen Vereine (Name, Datum, Ort, Anzahl offener Dienste).
- **Offene Dienste eines Turniers:** Gruppiert nach Bezeichnung der Tätigkeit (alphabetisch), darunter die Slots nach Uhrzeit. Nur nicht voll besetzte Slots erscheinen; Slots, in denen man selbst steht, bleiben sichtbar mit „Eingetragen“ (meine Entscheidung). Je Slot: Zeit, „noch X Plätze frei“, Knopf „Eintragen“.
- **Meine Dienste:** Alle eigenen Dienste aufsteigend nach Datum und Uhrzeit, gruppiert nach Turnier und Tag, mit „Austragen“.
- **Profil:** siehe 4.1.

Benutzer und Admins erreichen die Helfer-App über einen Menüpunkt „Helfer-App“ der Verwaltungsoberfläche und melden sich mit demselben Konto an.

### 5.1 Regeln beim Eintragen

- Keine zwei zeitlich überlappenden Slots (auch nicht in verschiedenen Tätigkeiten) für dieselbe Person; die App zeigt einen Hinweis.
- Ein Slot ist voll, wenn die Zahl der Eintragungen seinen `bedarf` erreicht. Bei gleichzeitigem Buchen des letzten Platzes entscheidet die Datenbank (Zählen und Einfügen in einer Transaktion mit Sperre des Slots); der Zweite erhält „Gerade vergeben“.
- Eintragen ist möglich, solange „Turniertag 08:00 Uhr“ (Europe/Berlin) nicht erreicht ist; danach nur noch durch Admin/Benutzer des Vereins (meine Entscheidung, spiegelt die Austragefrist).

### 5.2 Austragen

Helfer können sich bis **08:00 Uhr am Wettkampftag** (Europe/Berlin) selbst austragen. Danach ist die Funktion gesperrt, die App zeigt „Bitte melde dich bei der Turnierleitung“. Admins und Benutzer des Vereins sowie Super-Admins können Helfer jederzeit eintragen und austragen.

## 6. Orga-Ansicht: Helferplan (Zeitstrahl)

Neue Seite **`helfer-plan.html`** (Menüpunkt „Helfer“, sichtbar für Super-Admins sowie Admins und Benutzer des ausrichtenden Vereins) in der bestehenden Oberfläche. Grundlage ist der abgestimmte Entwurf:

- **Kopfzeile:** Zeitstrahl von eine Stunde vor Turnierbeginn bis eine Stunde nach Turnierende mit Stundenmarken; die Turnierzeit ist hinterlegt.
- **Zeilen:** Eine Zeile je Tätigkeit.
  - *Kampfgericht Matte n*: automatisch je Kampffläche des Turniers.
  - *Waage n*: Anzahl der Waagen stellt die Turnierleitung ein (Standard 1).
  - Weitere Tätigkeiten: unter der letzten Zeile der Knopf **„+ Tätigkeit hinzufügen“**, der ein Popup mit **Bezeichnung** und **Anzahl Helfer pro Slot** öffnet. Die neue Tätigkeit bekommt automatisch 2-Stunden-Slots über die Turnierzeit.
  - Matten- und Waagenzeilen lassen sich nicht umbenennen oder löschen. Eigene Tätigkeiten lassen sich umbenennen, in der Mindestzahl ändern und löschen (mit Bestätigung und Hinweis auf eingetragene Helfer).
- **Slots:** Pro Tätigkeit die 2-Stunden-Slots. Mit der Maus an den Rändern kürzer und länger ziehen, in der Mitte verschieben. Raster 15 Minuten, Mindestlänge 30 Minuten, keine Überlappung innerhalb einer Zeile. Doppelklick auf freie Fläche legt einen 2-Stunden-Slot an.
- **Farben:** grün = besetzt, gelb = teilweise, rot = offen; im Slot „eingetragen/Mindestzahl“.
- **Slot-Detail:** Klick zeigt die eingetragenen Helfer mit Namen, erlaubt manuelles Zuteilen und Entfernen (aus den Mitgliedern des Vereins, plus Eintrag ohne Konto), Slot löschen und abweichende Mindestzahl für diesen Slot.

Bei Verkürzung oder Verschiebung eines Slots mit Eingetragenen fragt die Oberfläche nach („N Helfer sind eingetragen, trotzdem ändern?“); die Betroffenen bekommen eine Mail über die neue Zeit (meine Entscheidung, kann entfallen).

Umsetzung des Plans in Vanilla-JS ohne neue Bibliothek (Pointer-Events, Prozentpositionen). Der klickbare Entwurf liegt im Gesprächsverlauf, nicht im Repository.

## 7. Datenmodell (neue und geänderte Tabellen)

Alle Zeitangaben als `timestamp with time zone`, Anzeige in Europe/Berlin.

- `benutzer_vereine`: neue Spalte `rolle` (`admin`/`benutzer`/`helfer`, leer solange nicht freigegeben), `angefragt_ueber` (`helfer-app`/`verwaltung`, nur zur Vorbelegung der Rolle), `entschieden_von`, `entschieden_am`. Eine Tabelle `helfer_vereine` entfällt.
- `benutzer`: neue Spalte `email_bestaetigt_am` (bestehende Konten werden bei der Migration als bestätigt gesetzt).
- `token_einmal(id, benutzer_id, zweck 'email'|'freischaltung', verein_id, token_hash, laeuft_ab_am, benutzt_am)`: nur der Hash wird gespeichert.
- `turniere`: neue Spalten `beginn_min`, `ende_min` (Uhrzeit als ganze Minuten seit Mitternacht, optional; fehlt sie, fragt die Planungsseite danach), `waagen_anzahl` (Standard 1). Bisher existieren nur Datum und `anmeldeschluss`. Ein Turnier ist ein einziger Kalendertag; Uhrzeiten als Minuten umgehen jede Sommerzeit-Problematik. Nur die Austragefrist (Turniertag 08:00 Europe/Berlin) rechnet mit Zeitzonen.
- `helfer_taetigkeiten(id, turnier_id, art 'matte'|'waage'|'frei', kampfflaeche_id nullable, bezeichnung, bedarf, reihenfolge)`.
- `helfer_slots(id, taetigkeit_id, von_min, bis_min, bedarf)` (Minuten seit Mitternacht des Turniertags).
- `helfer_einsaetze(id, slot_id, benutzer_id nullable, name_manuell nullable, eingetragen_von, eingetragen_am)`; eindeutig je `(slot_id, benutzer_id)`. `name_manuell` erlaubt Einträge für Personen ohne Konto (z. B. Eltern ohne Smartphone); sie bekommen keine Mails.

Mit dem Turnier-Export (Cloud → Hallen-Server) wandern Tätigkeiten, Slots und Einsätze mit Anzeigenamen (keine E-Mail-Adressen, keine Passwörter). Die Konten bleiben in der Cloud.

## 8. Hallen-Server und Wettkampftag

- Der Hallen-Server hat keine Anmeldung (Einzelbenutzerbetrieb). Der Helferplan ist dort über die bestehende Turnierleitungs-Absicherung (`requireWriteAuth`) bearbeitbar; die Helfer-App gibt es dort nicht.
- Weil sich Helfer bis 08:00 Uhr am Turniertag austragen können, kann der Plan im Hallen-Server veralten. Deshalb ein Knopf **„Helferplan aus der Cloud aktualisieren“** (nutzt `CLOUD_URL` und `src/services/cloudZugriff.js`), der nur den Helferplan überschreibt, nicht das Turnier. Danach wird lokal gepflegt; eine Rückübertragung in die Cloud gibt es nicht.
- **Helferausweis** und Helferliste (Druck) werden im Hallen-Server wie in der Cloud erzeugt.

## 9. Helferausweis

- PDF, mehrere Ausweise pro A4-Seite, gleiche Technik wie bei den Urkunden (`pdf-lib`, vorhandene Schriften).
- Inhalt je Ausweis: Turniername und Datum, Name, die Einsätze mit Tätigkeit und Zeit, farbige Kopfleiste je (Haupt-)Tätigkeit, QR-Code (Kennung von Helfer und Turnier, für späteres Einchecken).
- Auswahl: alle Helfer des Turniers oder einzelne; ein Ausweis pro Person mit allen Einsätzen dieses Turniers.
- Kein Designer-Werkzeug: ein festes Layout, später ergänzbar.
- Aufruf über „Helferausweise drucken“ auf `helfer-plan.html`.

## 10. Entscheidungen

### Von dir vorgegeben
- Super-Admin (der Auftraggeber) kann weitere Super-Admins ernennen; je Verein mindestens ein Admin; Rollen Admin, Benutzer, Helfer.
- Ein Admin des Vereins gibt neue Benutzer und Helfer frei und weist die Rolle zu; gibt es keinen Admin, geht die Mail an den Super-Admin.
- Ein Benutzer hat alle Rechte eines Helfers (eine Registrierung genügt).
- Konten hängen an Vereinen; Autovervollständigung bei der Vereinswahl.
- E-Mail-Bestätigung per Link, danach Wartemeldung, dann Freischaltung per Mail-Link.
- Weitere Vereine im Profil; Helfer sehen nur Turniere ihrer Vereine.
- 2-Stunden-Slots, verschieb- und dehnbar; Zeitstrahl eine Stunde vor bis eine Stunde nach Turnier; Matten und Waagen je 2 Personen; weitere Tätigkeiten über „+“ und Popup.
- Austragen bis 08:00 Uhr am Wettkampftag; Helferausweis zum Drucken.

### Meine Entscheidungen (bitte prüfen)
1. Bestehende freigegebene Mitglieder werden bei der Migration zu Admins (erhält den Ist-Zustand).
2. Die E-Mail-Bestätigung gilt für alle neuen Registrierungen, nicht nur für Helfer.
3. Der Freischaltungs-Link öffnet eine Seite mit Rollenauswahl und Knöpfen, statt beim Aufruf direkt freizuschalten.
4. Die Admin-Mail geht erst nach der E-Mail-Bestätigung und an alle Admins des Vereins; ohne Admin an alle Super-Admins.
5. Rollenvorbelegung: Helfer-App → Helfer, Verwaltungsseite → Benutzer; der Admin entscheidet.
6. Der letzte Admin eines Vereins kann nicht herabgestuft, entfernt oder ausgetreten werden.
7. Eintragen ebenfalls nur bis Turniertag 08:00 Uhr.
8. Austreten aus einem Verein ist mit offenen Diensten gesperrt.
9. Waagen-Anzahl ist eine Turniereinstellung (Standard 1), da das System keine Waagen als Objekte kennt.
10. Helferplan-Aktualisierung im Hallen-Server per Knopf, überschreibt nur den Helferplan.
11. Einträge ohne Konto sind möglich.
12. Mails an Helfer bei geänderten Slot-Zeiten (optional).

## 11. Tests (Richtschnur)

- Unit: Autovervollständigung, Überlappungsprüfung, Austragefrist (08:00 Berlin, Zeitumstellung), Wettlauf um den letzten Platz, Token (Ablauf, Einmaligkeit, Hash), Rollenhierarchie, Schutz des letzten Admins.
- E2E: Registrierung → Bestätigung → Freigabe mit Rollenwahl → Eintragen → Austragen; Mail geht an Vereins-Admins bzw. an Super-Admins, wenn kein Admin existiert; Sichtbarkeit nach Vereinen; ein reiner Helfer erhält auf Verwaltungs-APIs 403; ein Benutzer kann sich eintragen; Super-Admin erreicht alle Vereine; Rollenvergabe durch Super-Admin.
- E2E Plan-Seite: Slot ziehen, verschieben, anlegen; Tätigkeit per „+“ anlegen.
- Ausweis-PDF: Seitenzahl und Inhalte pro Person.
- Regression: bestehende Vereinsfreigabe-Tests laufen weiter (Mitglieder werden als Admin migriert).

## 12. Offen / spätere Stufen

- Automatisches Befüllen des Plans nach Verfügbarkeit.
- Einchecken per QR-Code am Wettkampftag, Anwesenheitsliste.
- Android-App-Anbindung.
- Auswertung der geleisteten Stunden.
