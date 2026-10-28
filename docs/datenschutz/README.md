# Datenschutz und Rechtliches für Hajime Pro (Cloud)

> **Wichtig:** Diese Unterlagen sind sorgfältig auf Grundlage dessen erstellt, was Hajime Pro tatsächlich tut, aber **keine Rechtsberatung** und keine Garantie für
> Abmahnsicherheit. „Wasserdicht“ wird ein Text erst durch die Prüfung einer fachkundigen Person (Rechtsanwältin oder Rechtsanwalt mit Datenschutz-Erfahrung,
> ein Datenschutzbeauftragter oder der Datenschutzbeauftragte Ihres Landesverbands). Planen Sie diese Prüfung vor dem Start mit echten Teilnehmerdaten ein.

## Was die Software schon liefert

| Baustein | Wo |
|---|---|
| **Impressum** (§ 5 DDG) und **Datenschutzerklärung** (Art. 13 DSGVO), öffentlich unter `/impressum.html` und `/datenschutz.html`, serverseitig erzeugt aus Ihren Angaben, Fehlendes erscheint rot als „ANGABE FEHLT“ | `src/services/rechtstexte.js`, `src/services/rechtliches.js` |
| Betreiberangaben in **einer JSON-Datei** außerhalb des Programms (Vorlage: [`rechtliches.example.json`](rechtliches.example.json)), Status für Super-Admins unter `GET /api/rechtliches/status`, Warnung in der Konsole beim Start | `RECHTLICHES_DATEI` |
| Fußzeile **Impressum · Datenschutz** auf jeder Seite (Anwendung, Anmeldung, Einladung, Teilnehmer-App), Datenschutzhinweis bei der Registrierung | `public/js/rechtsfuss.js`, `login.html` |
| Keine Cookies, keine Drittanbieter-Einbindungen (Schriften lokal, kein Tracking, keine Analyse) | — |
| Verschlüsselte, automatische Sicherung (AES-256-GCM) | `docs/betrieb.md` |
| Aktionsprotokoll (365 Tage), Fehlerprotokoll (30 Tage), Rollen, 2FA für Super-Admins | Seiten „Protokoll“, „Konsole“ |
| Automatische Löschung unbestätigter Konten nach 30 Tagen, Live-Daten nach 7, Push nach 3 Tagen | `src/services/kontenAufraeumen.js`, `src/liveCloud/` |
| Startgeld-Abrechnung: IBAN des Ausrichters verschlüsselt (`ZAHLUNGSDATEN_SCHLUESSEL`), Rechnungen als Momentaufnahme mit 8 Jahren Aufbewahrung | `src/utils/feldVerschluesselung.js`, `src/services/rechnungslauf.js` |
| SEPA-Lastschrift: Mandate mit verschlüsselter IBAN, Nachweis (Zeitstempel, Benutzer, IP), 14 Monate Aufbewahrung, Schlüsselwechsel | `src/services/lastschriftMandate.js`, `scripts/zahlungsdaten-schluessel.mjs` |
| Passwörter nur als PBKDF2-SHA512-Prüfwert mit 210.000 Durchläufen (alte Prüfwerte werden beim Login erneuert) | `src/utils/password.js` |

## Dokumente in diesem Ordner

1. [`verarbeitungsverzeichnis.md`](verarbeitungsverzeichnis.md): Verzeichnis der Verarbeitungstätigkeiten (Art. 30 DSGVO), vorbefüllt
2. [`av-vertrag-muster.md`](av-vertrag-muster.md): Auftragsverarbeitungsvertrag zwischen Ihnen und jedem Verein (Art. 28 DSGVO)
3. [`toms-und-loeschkonzept.md`](toms-und-loeschkonzept.md): technische und organisatorische Maßnahmen (Art. 32) und Löschfristen, ehrlich mit „umgesetzt / noch offen“
4. [`prozesse-betroffenenrechte-datenpanne.md`](prozesse-betroffenenrechte-datenpanne.md): Ablauf bei Auskunfts- und Löschwünschen (mit Abfragen für die Datenbank) und bei Datenpannen (72 Stunden)
5. [`teilnehmerinformation-muster.md`](teilnehmerinformation-muster.md): Text für Ausschreibung und Anmeldung, den der **Veranstalter** (Verein) seinen Teilnehmenden gibt, einschließlich Einwilligung bei Minderjährigen
6. [`unterauftragnehmer-und-dsfa.md`](unterauftragnehmer-und-dsfa.md): Liste Ihrer Dienstleister mit den nötigen Verträgen und die Schwellenwertanalyse zur Datenschutz-Folgenabschätzung

## Einrichtung in fünf Schritten

1. `rechtliches.example.json` kopieren, alle Werte durch Ihre ersetzen und als `data/rechtliches.json` (oder `RECHTLICHES_DATEI`) ablegen. Im Docker-Container als Volume einbinden.
2. `/impressum.html` und `/datenschutz.html` öffnen: **keine rote Stelle** darf übrig sein. Außerdem prüfen, dass jede Aussage in der Datenschutzerklärung für Ihren Betrieb stimmt (siehe Abschnitt „Ihre Verantwortung“).
3. Mit **jedem Dienstleister** den Vertrag zur Auftragsverarbeitung abschließen (Liste in `unterauftragnehmer-und-dsfa.md`).
4. Mit **jedem Verein**, der Hajime Pro nutzt, den AV-Vertrag abschließen (`av-vertrag-muster.md`) und ihm die Teilnehmerinformation (`teilnehmerinformation-muster.md`) geben.
5. Den Rechtsanwalt oder Datenschutzbeauftragten drüberschauen lassen und die Unterlagen im Verarbeitungsverzeichnis ablegen.

## Ihre Verantwortung: was die Software nicht erledigen kann

Die Datenschutzerklärung beschreibt Dinge, die vom Betrieb abhängen. Prüfen Sie jede davon:

- **HTTPS** mit gültigem Zertifikat auf dem gesamten Auftritt (Reverse Proxy, z. B. Caddy oder nginx mit Let's Encrypt). Ohne HTTPS stimmt die Aussage „verschlüsselte Übertragung“ nicht.
- **Server-Protokolle des Hosters/Proxys** nach `datenschutz.logfileTage` (Standard 7) löschen (Log-Rotation einrichten) oder die Angabe in `rechtliches.json` anpassen.
- **Verträge zur Auftragsverarbeitung** mit Hoster, Datenbank-Anbieter, Mail-Anbieter und gegebenenfalls Backup-Ziel; bei Anbietern in den USA zusätzlich Standardvertragsklauseln bzw. Zertifizierung nach dem EU-US Data Privacy Framework. Die tatsächlich geltende Grundlage tragen Sie in `rechtliches.json` unter `datenbank.garantie` bzw. `backup.garantie` ein (Pflicht bei `drittland: true`); sie erscheint so in der Datenschutzerklärung.
- **Aufsichtsbehörde:** `datenschutz.aufsichtsbehoerde` muss die Behörde am Sitz des Betreibers nennen; es gibt keine Voreinstellung mehr, ohne Angabe ist die Stelle rot markiert.
- **Fristen in der Umgebung:** Die Datenschutzerklärung liest `UNBESTAETIGT_TAGE`, `JWT_EXPIRES_IN`, `LIVE_AUFBEWAHRUNG_TAGE`, `LIVE_PUSH_AUFBEWAHRUNG_TAGE`, `NACHRICHTEN_AUFBEWAHRUNG_TAGE`, `PROTOKOLL_AUFBEWAHRUNG_TAGE` und `FEHLER_AUFBEWAHRUNG_TAGE` aus derselben Umgebung wie der Server. Werden sie nur für einen Prozess gesetzt, stimmen Text und Löschung nicht mehr überein.
- **Sicherungskopie:** Nutzen Sie ein Google-Konto für die Kopie, gibt es bei privaten Konten keinen Vertrag zur Auftragsverarbeitung. Das ist nur mit der clientseitigen Verschlüsselung (so wie eingebaut) vertretbar; ein Google-Workspace-Konto mit AV-Vertrag ist sauberer.
- **Startgeld-Abrechnung (nur wenn Sie sie nutzen):** `ZAHLUNGSDATEN_SCHLUESSEL` erzeugen (z. B. `openssl rand -base64 48`) und getrennt von den Sicherungen verwahren; `SICHERUNG_PASSWORT` setzen, weil Rechnungs-PDFs die Empfänger-IBAN im Klartext enthalten und in der Sicherung stehen; Rechnungen 8 Jahre aufbewahren und danach von Hand löschen; in der AV-Vereinbarung die Abrechnung als Verarbeitung im Auftrag des Veranstalters nennen (Verarbeitungsverzeichnis B4).
- **SEPA-Lastschrift (nur wenn Sie sie nutzen):** zusätzlich zum Schlüssel die Gläubiger-ID in den Stammdaten eintragen; den Ablauf zum Schlüsselwechsel und den Hinweis zur pain.008-Version der Hausbank in `docs/betrieb.md` beachten; Mandatstext und Verfahren rechtlich prüfen lassen.
- **Datenschutzbeauftragter** (§ 38 BDSG): Pflicht, wenn ständig mindestens 20 Personen mit der automatisierten Verarbeitung personenbezogener Daten beschäftigt sind, sonst freiwillig. Bei Kindern als Betroffenen lohnt sich die Benennung trotzdem.
- **Veranstalter-Pflichten:** Die Vereine als Verantwortliche müssen ihre Teilnehmenden informieren und für die öffentliche Teilnehmer-App eine Grundlage haben (Einwilligung der Erziehungsberechtigten, siehe Muster). Weisen Sie die Vereine darauf hin.
- **Nutzungsbedingungen/AGB** für das Vertragsverhältnis mit den Vereinen (Leistung, Entgelt, Haftung, Kündigung, Verfügbarkeit): rechtlich individuell, daher hier **nur Hinweis**, ohne Mustertext. Lassen Sie sie anwaltlich erstellen, wenn Sie das Angebot gewerblich oder gegen Entgelt anbieten.
- **Rechtsform und Anmeldungen:** Entgeltliche, nachhaltige Tätigkeit kann gewerbe-, steuer- und gegebenenfalls versicherungsrechtliche Folgen haben (Gewerbeanmeldung, Umsatzsteuer, Betriebshaftpflicht). Das ist nicht Teil dieser Unterlagen.
- **Barrierefreiheit:** Das Barrierefreiheitsstärkungsgesetz betrifft derzeit vor allem Verbraucher-Dienste im elektronischen Geschäftsverkehr; bei einem reinen Vereins-Werkzeug ist es in der Regel nicht einschlägig. Prüfen Sie das für Ihr Angebot.

## Bekannte Lücken in der Software (bewusst benannt)

| Lücke | Stand |
|---|---|
| **Teilnehmer-App zeigt Vor- und Nachnamen** (auch von Kindern) durchsuchbar, sobald der Veranstalter die Freigabe einschaltet; **Zugang nur mit dem ausgehängten QR-Code (Zugangscode je Turnier, bis Ende des Turniertags, erneuerbar/sperrbar, keine öffentliche Liste)**. Ein weitergegebenes Foto des Aushangs bleibt bis zum Ablauf nutzbar | Datenschutzrechtlich der heikelste Punkt, durch den Zugangscode deutlich entschärft. Empfehlung: Einwilligung der Erziehungsberechtigten über die Anmeldung einholen und eine Option einbauen, die Namen zu kürzen (z. B. „Anna M.“) |
| **Keine Selbstbedienung für Betroffenenrechte** (Auskunft, Löschung, Export einer Person) | Abwicklung per Prozess und Abfragen (`prozesse-betroffenenrechte-datenpanne.md`) |
| **Keine automatische Löschung abgeschlossener Turniere** | Das Löschen macht der Veranstalter oder Super-Admin; eine Frist-Automatik ließe sich ergänzen |
| **AV-Vertrag wird nicht in der Software angenommen** (kein Häkchen bei Registrierung eines Vereins) | Abschluss außerhalb (Mail/Unterschrift); eine Online-Annahme ließe sich ergänzen |
| **Keine automatische Löschung von Rechnungen** (Startgeld-Abrechnung) nach 8 Jahren | Löschung von Hand; Rechnungs-PDFs enthalten die Empfänger-IBAN im Klartext, Sicherungen daher verschlüsseln |
| **Keine Einwilligungsverwaltung** für Fotos/Videos (Videoarchiv gibt es nur im Hallen-Server) | Einwilligung durch den Veranstalter, außerhalb der Software |

Stand der Unterlagen: Oktober 2026.
