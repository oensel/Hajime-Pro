# Verzeichnis der Verarbeitungstätigkeiten (Art. 30 DSGVO)

> Entwurf, vorbefüllt nach dem tatsächlichen Verhalten von Hajime Pro (Stand Oktober 2026). Die Angaben in `[eckigen Klammern]` ergänzen Sie. Rechtliche Prüfung empfohlen
> (siehe [README](README.md)). Das Verzeichnis ist laufend zu pflegen; bei Änderungen der Software (neue Datenarten, neue Dienstleister) hier nachziehen.

**Verantwortlicher / Auftragsverarbeiter (Betreiber):** `[Name, Anschrift, E-Mail, Telefon]`
**Datenschutzbeauftragter (falls benannt):** `[Name, Kontakt]`

---

## Teil A: Der Betreiber als Verantwortlicher (Art. 30 Abs. 1)

| Nr. | Tätigkeit | Zweck | Betroffene | Datenkategorien | Rechtsgrundlage | Empfänger | Drittland | Löschfrist | TOM |
|---|---|---|---|---|---|---|---|---|---|
| A1 | **Benutzerkonten und Anmeldung** | Bereitstellung der Plattform, Rechteverwaltung | Benutzer (Vereinsmitglieder, Helfer, Admins) | Vor-/Nachname, E-Mail, Passwort-Prüfwert, Verein, Rolle, Zeitstempel (Registrierung, Bestätigung, Sperre), Merker „muss Passwort ändern“, Zwei-Faktor-Daten (nur Super-Admins) | Art. 6 Abs. 1 lit. b | Vereins-Admins (eigener Verein), Hoster, Datenbank-Anbieter, Mail-Anbieter | `[abhängig vom Datenbank-Anbieter]` | Bis zur Kontolöschung; unbestätigte Konten 30 Tage (automatisch) | siehe TOM |
| A2 | **Sicherheitsprotokoll** (Aktionsprotokoll) | Nachvollziehbarkeit, Missbrauchsabwehr | Benutzer | Name, E-Mail, Rolle, Verein, Aktion, Zeitpunkt, bei Anmeldeereignissen IP-Adresse | Art. 6 Abs. 1 lit. f | Vereins-Admins (Einträge des eigenen Vereins), Super-Admin | – | 365 Tage (automatisch) | siehe TOM |
| A3 | **Fehlerprotokoll** („Konsole“) | Störungsbeseitigung | Benutzer (selten) | Fehlermeldung, Seite, E-Mail bei Browser-Fehlern angemeldeter Konten; Zugangsdaten werden geschwärzt | Art. 6 Abs. 1 lit. f | Super-Admin | – | 30 Tage (automatisch) | siehe TOM |
| A4 | **E-Mail-Versand** | Bestätigung, Freischaltung, Passwort-Reset, Einladung, Erinnerung | Benutzer, Eingeladene | Name, E-Mail-Adresse, Inhalt der Nachricht (Link) | Art. 6 Abs. 1 lit. b | Mail-Anbieter | `[…]` | Beim Mail-Anbieter nach dessen Frist `[…]`; Einmal-Links verfallen nach 2 Std. bis 14 Tagen | siehe TOM |
| A5 | **Datensicherung** | Wiederherstellbarkeit (Art. 32) | alle Betroffenen der Datenbank | gesamter Datenbestand, verschlüsselt (AES-256-GCM) | Art. 6 Abs. 1 lit. f, Art. 32 | Backup-Ziel `[Google Drive / HiDrive / …]` (nur verschlüsselte Dateien) | `[ja, falls USA-Anbieter]` | 14 Tage automatische Sicherungen, Kopie bis `[60]` Tage | siehe TOM |
| A6 | **Server-Protokolle** (Reverse Proxy/Hoster) | Betrieb, Sicherheit | Besucher | IP-Adresse, Zeit, URL, Statuscode, Browserkennung | Art. 6 Abs. 1 lit. f | Hoster | – | `[7]` Tage (Log-Rotation einrichten) | siehe TOM |
| A7 | **Rate-Limiting** (Missbrauchsschutz) | Schutz vor Massenanmeldungen | Besucher | IP-Adresse (im Arbeitsspeicher, SHA-256 bei Adressen aus dem Body) | Art. 6 Abs. 1 lit. f | – | – | wenige Minuten (nur im Speicher) | – |

## Teil B: Der Betreiber als Auftragsverarbeiter (Art. 30 Abs. 2)

Verantwortlich sind jeweils die **Veranstalter** (Vereine). Der Betreiber verarbeitet **ausschließlich auf Weisung** (Vertrag nach Art. 28, siehe [`av-vertrag-muster.md`](av-vertrag-muster.md)).

| Nr. | Tätigkeit | Kategorien von Verarbeitungen | Betroffene | Datenkategorien | Unterauftragsverarbeiter | Drittland | Löschung |
|---|---|---|---|---|---|---|---|
| B1 | **Turnierverwaltung** | Speichern, Auslosen, Planen, Anzeigen, Drucken (Urkunden), Exportieren | Teilnehmende (auch Minderjährige), Mannschaften | Judopass-Nr., Vor-/Nachname, Geburtsjahr, Geschlecht, Verein, Gewicht, Alters-/Gewichtsklasse, Graduierung, Lizenzablauf, Status, Kämpfe, Ergebnisse, Platzierungen | Hoster, Datenbank-Anbieter, Backup-Ziel | `[…]` | Durch den Veranstalter (Turnier löschen), danach Ablauf der Sicherungen |
| B2 | **Helferplan und Orga** | Speichern, Zuweisen, Erinnern per E-Mail | Helfende, Verantwortliche für Aufgaben | Name, E-Mail (bei Konten und eingeladenen Personen), Einsatzzeiten, Aufgaben, Mitbringlisten | Hoster, Datenbank, Mail-Anbieter | `[…]` | Durch den Veranstalter |
| B3 | **Teilnehmer-App (Live-Anzeige, Zugang per ausgehängtem QR-Code mit Zugangscode)** | Übertragen, Veröffentlichen, Suchen, Benachrichtigen (optional) | Teilnehmende | **Vor- und Nachname**, Verein, Altersklasse, Gewichtsklasse, Geschlecht, Pool, Matte, Kampfstatus, Ergebnisse, Platz (ohne Judopass-Nr. und Gewicht); bei Push: Geräteadresse (Endpoint, Schlüssel) und Glocken-Auswahl | Hoster, Datenbank, Push-Dienste der Browserhersteller | `[ja (Google/Apple/Mozilla)]` | Live-Daten 7 Tage, Push-Daten 3 Tage nach dem Turnier (automatisch) |
| B4 | **Startgeld-Abrechnung** (Rechnungen und Quittungen an meldende Vereine) | Speichern, Zusammenstellen, PDF-Erzeugung, Versand per E-Mail, Zahlstatus führen | Ansprechpersonen der meldenden Vereine; Kontoinhaber des Ausrichters | Vereinsname, Ansprechperson, Rechnungs-E-Mail, Anschrift, Zahlweg (Überweisung/Bar), Anzahl gemeldeter Kämpfer (ohne Namen der Kämpfer), Beträge, Barzahlungs-Journal (Verein, Betrag, Zeitpunkt); Stammdaten des Ausrichters: Anschrift, Steuernummer/USt-Id, Kontoinhaber, **IBAN (verschlüsselt, AES-256-GCM)**; Rechnung als unveränderliche Momentaufnahme samt PDF (enthält die IBAN des Empfängerkontos im Klartext) | Hoster, Datenbank-Anbieter, Mail-Anbieter (Versand an die Rechnungsadresse), Backup-Ziel (Sicherung enthält Rechnungs-PDFs; nur verschlüsselt, daher `SICHERUNG_PASSWORT` setzen) | `[…]` | Rechnungen/Quittungen **8 Jahre** ab Ende des Kalenderjahres (gesetzliche Aufbewahrung), manuelle Löschung, keine Automatik; Barzahlungs-Journal mit dem Turnier; Zahlwege/Rechnungsangaben mit dem Turnier |
| B5 | **SEPA-Lastschrift** (Mandate und Sammeldatei pain.008 für den Einzug des Startgelds) | Erfassen, Bestätigen (Link per E-Mail an Vereins-Admins), Verschlüsselt speichern, Sammeldatei erzeugen, Rücklastschrift erfassen, Löschen | Kontoinhaber und Vertretungsberechtigte der meldenden Vereine | Kontoinhaber, **IBAN (verschlüsselt, AES-256-GCM)**, Mandatsreferenz, Mandatstext und -version, Vertretungsbestätigung, Zeitstempel, Benutzerkonto und **IP-Adresse** als Nachweis; Bestätigungs-Tokens (nur als Hash); Kopfdaten der Sammeldatei (kein Inhalt) | Hoster, Datenbank-Anbieter, Mail-Anbieter; Bank des Ausrichters (Sammeldatei, durch den Ausrichter eingereicht) | `[nein]` | 14 Monate nach dem letzten Einzug bzw. nach der Entscheidung; IBAN bei Widerruf/Ablehnung/Umstellung sofort |

## Änderungsprotokoll

| Datum | Änderung | Wer |
|---|---|---|
| `[JJJJ-MM-TT]` | Erstanlage | `[Name]` |
| 2026-10-25 | Verarbeitung B4 „Startgeld-Abrechnung“ ergänzt (Rechnungen, Quittungen, Barzahlungs-Journal, Bankverbindung des Ausrichters verschlüsselt) | `[Name]` |
| 2026-10-26 | Verarbeitung B5 „SEPA-Lastschrift“ ergänzt (Mandate, Nachweisdaten, Sammeldatei) | `[Name]` |
