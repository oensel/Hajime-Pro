# Technische und organisatorische Maßnahmen (Art. 32 DSGVO) und Löschkonzept

> Entwurf nach dem tatsächlichen Stand von Hajime Pro (Oktober 2026). Die Spalte **Stand** ist ehrlich gemeint: „Software“ = im Programm umgesetzt und getestet, „Betrieb“ = hängt von Ihrer Einrichtung
> ab und muss von Ihnen sichergestellt werden, „offen“ = noch nicht umgesetzt. Rechtliche Prüfung empfohlen ([README](README.md)).

## Teil 1: Technische und organisatorische Maßnahmen

### Vertraulichkeit

| Maßnahme | Stand | Einzelheiten |
|---|---|---|
| **Zutrittskontrolle** zu den Servern | Betrieb | Rechenzentren von Hoster und Datenbank-Anbieter (Nachweise/Zertifikate anfordern) |
| **Zugangskontrolle** (Anmeldung) | Software | Konto mit Passwort; Passwort-Prüfwert PBKDF2-HMAC-SHA512, 210.000 Durchläufe, Salz je Passwort; alte Prüfwerte werden beim Login erneuert; Mindestlänge 8 Zeichen |
| **Zwei-Faktor** für Administratoren der Plattform | Software | Authenticator-App (TOTP) mit Backup-Codes, Pflicht für Super-Admins; Notfall-Schlüssel |
| **Schutz vor Raten** | Software | Ratenbegrenzung für Anmeldung, Registrierung, Passwort, 2FA, Notfall-Zugang (je Absender und je Konto); Sperrfrist nach Fehlversuchen beim zweiten Faktor |
| **Zugriffskontrolle** (Berechtigungen) | Software | Rollen je Verein (Admin, Benutzer, Helfer) und Super-Admin, serverseitig bei jeder Anfrage geprüft; Admins sehen nur die Daten ihres Vereins; Freischaltung neuer Mitglieder durch Vereins-Admins; Konten sperrbar |
| **Trennung nach Verein** | Software | Logische Trennung über Vereinszuordnung in einer gemeinsamen Datenbank (kein physisch getrennter Mandant) |
| **Pseudonymisierung** | Software | Teilnehmer-App: Personenschlüssel als gesalzener Hash, Judopass-Nummer und genaues Gewicht werden nicht veröffentlicht |
| **Verschlüsselung bei der Übertragung** | Betrieb | HTTPS (TLS) auf dem gesamten Auftritt, Verbindung zur Datenbank per TLS; Zertifikat und Weiterleitung HTTP→HTTPS sind einzurichten |
| **Verschlüsselung gespeicherter Daten** | Software / Betrieb | Sicherungsdateien AES-256-GCM (scrypt-Schlüssel, Salz je Datei); Zwei-Faktor-Geheimnisse AES-256-GCM; Datenbank im Ruhezustand verschlüsselt durch den Anbieter (nachfragen) |
| **Geheimhaltung der Konfiguration** | Betrieb | Zugangsdaten nur in `.env`/Secrets, Dateirechte 0600, nicht im Repository |
| **Verpflichtung auf Vertraulichkeit** | Betrieb | Alle Personen mit Zugriff (auch Admins der Vereine) schriftlich belehren |

### Integrität

| Maßnahme | Stand | Einzelheiten |
|---|---|---|
| **Eingabekontrolle / Protokollierung** | Software | Aktionsprotokoll für jede schreibende Aktion und alle Anmeldeereignisse (Wer, Wann, Was, IP bei Anmeldungen), 365 Tage; sichtbar für Vereins-Admins (ihr Verein) und Super-Admins |
| **Weitergabekontrolle** | Software / Betrieb | Übertragung nur verschlüsselt; Export und Sicherung nur für Super-Admins, mit zweitem Faktor; Turnier-Export/-Import nur mit Berechtigung |
| **Fehlerüberwachung** | Software | Konsole für Super-Admins (Server- und Browser-Fehler, Abstürze), Zugangsdaten werden geschwärzt |
| **Änderungsmanagement** | Betrieb | Updates nur nach Test (automatisierte Unit-Tests), Migration vor dem Umschalten (`docs/betrieb.md`) |

### Verfügbarkeit und Belastbarkeit

| Maßnahme | Stand | Einzelheiten |
|---|---|---|
| **Datensicherung** | Software | Täglich automatisch (03:00), verschlüsselt, konsistenter Schnappschuss, Prüfung der Sicherung ohne Datenbank (`scripts/sicherung.mjs pruefen`) |
| **Kopie an anderem Ort** | Betrieb | per rclone/Befehl nach `[Google Drive / HiDrive / …]`, Verschlüsselung vor dem Hochladen |
| **Wiederherstellung** | Software / Betrieb | Wiederherstellen über Seite oder Skript, alles oder nichts in einer Transaktion; **Wiederherstellungstest** mindestens `[halbjährlich]` durchführen und dokumentieren |
| **Notfall-Zugang** | Software | Notfall-Schlüssel für Super-Admins (ausgedruckt, sicher verwahrt) |
| **Überwachung** | Betrieb | Healthcheck des Containers, Neustart bei Absturz (systemd/Docker); Meldung bei fehlgeschlagener Sicherung `[offen: Mail-Benachrichtigung]` |

### Trennbarkeit und Datenminimierung

| Maßnahme | Stand | Einzelheiten |
|---|---|---|
| **Zweckbindung** | Software | Es werden nur die für die Durchführung nötigen Teilnehmerdaten erfasst (kein Foto, kein Geburtsdatum, nur das Geburtsjahr) |
| **Löschfristen** | Software / Betrieb | siehe Teil 2 |
| **Kein Tracking** | Software | Keine Cookies, keine Analyse, keine Drittanbieter-Einbindung; Schriften lokal |

### Organisatorische Maßnahmen

| Maßnahme | Stand |
|---|---|
| Verzeichnis der Verarbeitungstätigkeiten ([`verarbeitungsverzeichnis.md`](verarbeitungsverzeichnis.md)) | Betrieb: pflegen |
| Verträge zur Auftragsverarbeitung mit allen Dienstleistern ([`unterauftragnehmer-und-dsfa.md`](unterauftragnehmer-und-dsfa.md)) | Betrieb: abschließen |
| AV-Verträge mit allen Vereinen ([`av-vertrag-muster.md`](av-vertrag-muster.md)) | Betrieb: abschließen |
| Prozess für Betroffenenrechte und Datenpannen ([`prozesse-betroffenenrechte-datenpanne.md`](prozesse-betroffenenrechte-datenpanne.md)) | Betrieb: einüben |
| Berechtigungskonzept: wer hat Super-Admin, wer Server-Zugang (mindestens zwei Super-Admins, kein gemeinsames Konto) | Betrieb |
| Schulung/Belehrung der Vereins-Admins (Umgang mit Teilnehmerdaten, Freigabe der Live-Anzeige) | Betrieb |
| Regelmäßige Überprüfung dieser Maßnahmen (mindestens jährlich) | Betrieb: Termin `[…]` |

### Bekannte Schwächen und geplante Verbesserungen

| Schwäche | Bewertung |
|---|---|
| Logische statt physischer Mandantentrennung | Bei sorgfältiger Rechteprüfung im Programm üblich; ein Fehler in der Rechteprüfung würde mandantenübergreifend wirken (deshalb Tests auf Rechte) |
| Sitzungen vor Einführung der 2FA gelten bis zum Ablauf (24 Stunden); „Alle Sitzungen beenden“ fehlt | offen |
| Eine ratenbegrenzte Anfrage zählt je Instanz im Arbeitsspeicher | bei mehreren Instanzen gilt das Limit je Instanz |
| Teilnehmer-App zeigt Namen | Zugriff nur mit Zugangscode aus dem Aushang (bis Ende des Turniertags, erneuerbar/sperrbar); Option zum Kürzen der Namen weiterhin empfohlen |

## Teil 2: Löschkonzept

| Daten | Frist | Auslöser | Wie | Verantwortlich |
|---|---|---|---|---|
| Benutzerkonto (Daten, Mitgliedschaften, Einmal-Links) | bis zur Löschung | Löschwunsch, Austritt, Vereinsende | Super-Admin bzw. Vereins-Admin: Seite „Benutzer/Mitglieder“ → Löschen | Betreiber / Vereins-Admin |
| **Unbestätigte Konten** | 30 Tage | Alter | **automatisch** täglich (`UNBESTAETIGT_TAGE`) | System |
| Turnierdaten (Teilnehmer, Mannschaften, Kämpfe, Ergebnisse, Helferplan, Orga) | bis zur Löschung durch den Veranstalter | Veranstalter-Entscheidung, Vertragsende | Seite „Anstehende Turniere“ → Turnier löschen; Super-Admin kann Turniere archivieren/löschen | Veranstalter |
| Empfehlung: Teilnehmer- und Ergebnisdaten **spätestens `[2]` Jahre** nach dem Turnier löschen oder anonymisieren, Ergebnislisten nur ohne Gewicht/Judopass-Nr. aufbewahren | – | – | manuell, Erinnerung `[…]` | Veranstalter |
| Live-Daten der Teilnehmer-App | 7 Tage nach dem Turnier | Alter | **automatisch** (`LIVE_AUFBEWAHRUNG_TAGE`) | System |
| Push-Anmeldungen und gesendete Mitteilungen | 3 Tage nach dem Turnier | Alter | **automatisch** | System |
| Aktionsprotokoll | 365 Tage | Alter | **automatisch** (`PROTOKOLL_AUFBEWAHRUNG_TAGE`); auf Verlangen früher anonymisieren (Abfrage im Prozessdokument) | System / Betreiber |
| Fehlerprotokoll | 30 Tage | Alter | **automatisch** (`FEHLER_AUFBEWAHRUNG_TAGE`) | System |
| Sicherungen auf dem Server | 14 (automatisch), 30 (von Hand), 10 (vor Wiederherstellung) | Anzahl je Typ | **automatisch** (`SICHERUNG_BEHALTEN`) | System |
| Sicherungskopie am anderen Ort | `[60]` Tage | Alter | Cron-Befehl `rclone delete --min-age 60d` | Betreiber |
| Server-Protokolle Hoster/Proxy | `[7]` Tage | Alter | Log-Rotation | Betreiber |
| E-Mails im Postfach des Absenders | `[Frist]` | – | Postfach regelmäßig bereinigen | Betreiber |

**Löschung wirkt in Sicherungen verzögert:** Gelöschte Daten verschwinden aus allen Sicherungen spätestens nach der längsten Aufbewahrungszeit (`[60]` Tage). Bis dahin sind die Sicherungen
verschlüsselt und gesperrt. Das gehört auch in die Antworten an Betroffene.
