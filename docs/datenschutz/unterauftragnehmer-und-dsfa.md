# Unterauftragnehmer und Datenschutz-Folgenabschätzung (Schwellenwertanalyse)

> Entwurf; Angaben zu Anbietern bitte selbst gegenprüfen (Anschriften, Vertragsportale, Standorte ändern sich). Rechtliche Prüfung empfohlen ([README](README.md)).

## Teil 1: Dienstleister und die nötigen Verträge

| Dienstleister | Leistung | Daten | Standort / Drittland | Nötiger Vertrag | Erledigt |
|---|---|---|---|---|---|
| **Hoster** `[STRATO AG, Pascalstraße 10, 10587 Berlin]` (VPS) | Server, auf dem Hajime Pro läuft | alle (Anwendung, Sicherungen auf der Platte, Protokolle) | Deutschland | **AV-Vertrag** (bei STRATO im Kundenservicebereich „Datenschutz/AV-Vertrag“ abschließbar) | ☐ |
| **Datenbank** `[Supabase Inc.]` | PostgreSQL | alle | `[Region wählen: EU (Frankfurt) empfohlen]`; Anbieter sitzt in den USA | **Data Processing Addendum (DPA)** von Supabase (im Dashboard/Online-Portal akzeptierbar), **Standardvertragsklauseln** bzw. Zertifizierung nach EU-US Data Privacy Framework; Region in der Datenschutzerklärung nennen | ☐ |
| **Mail** `[ALL-INKL.COM – Neue Medien Münnich, Hauptstraße 68, 02742 Friedersdorf]` (Kasserver) | SMTP-Versand | Name, E-Mail, Linkinhalte | Deutschland | **AV-Vertrag** (im KAS-Kundenbereich abschließbar) | ☐ |
| **Backup-Ziel** `[Google Drive / STRATO HiDrive / Backblaze …]` | verschlüsselte Sicherungsdateien | alle, **nur verschlüsselt** (AES-256-GCM, Passwort nur beim Betreiber) | `[…]` | Google Workspace: **Data Processing Amendment** (im Admin-Bereich); **private Google-Konten haben keinen AV-Vertrag**, daher nur mit clientseitiger Verschlüsselung und besser ein Workspace-Konto; HiDrive: AV-Vertrag im Kundenbereich; USA-Anbieter: SCC/DPF | ☐ |
| **Push-Dienste der Browserhersteller** (Google FCM, Mozilla, Apple) | Auslieferung von Web-Push (nur bei Einwilligung der Nutzer) | Geräteadresse, Zeitpunkt, Nachrichtentext | weltweit | kein Vertrag mit dem Betreiber; Rechtsgrundlage ist die **Einwilligung der Nutzer** (Browserabfrage); in der Datenschutzerklärung genannt | – |
| **Zertifikats-Dienst** (z. B. Let's Encrypt) | TLS-Zertifikat | keine personenbezogenen Daten der Nutzer | – | keiner | – |
| **E-Mail-Postfächer der Beteiligten** | Empfang | – | – | liegt bei den Empfängern | – |

**Vor dem Start prüfen:** Jeder Vertrag ist abgeschlossen und abgelegt; die Dienstleister stehen in Datenschutzerklärung (`rechtliches.json`), Verarbeitungsverzeichnis und AV-Verträgen mit den Vereinen (Anlage 2) übereinstimmend.

## Teil 2: Schwellenwertanalyse zur Datenschutz-Folgenabschätzung (Art. 35 DSGVO)

Eine **Datenschutz-Folgenabschätzung** (DSFA) ist nötig, wenn eine Verarbeitung **voraussichtlich ein hohes Risiko** für die Betroffenen hat. Orientierung bieten die neun Kriterien der Datenschutzbehörden (Leitlinien WP 248);
treffen **zwei oder mehr** zu, spricht viel für eine DSFA. Die Analyse gehört zu den Unterlagen (Nachweis, dass geprüft wurde).

| Kriterium | Trifft zu? | Begründung |
|---|---|---|
| 1. Bewertung oder Einstufung (Scoring, Profiling) | nein | Auslosung und Ergebnisse nach Wettkampfregeln, kein Profiling |
| 2. Automatisierte Entscheidung mit rechtlicher Wirkung | nein | keine solche Entscheidung |
| 3. Systematische Überwachung | nein | keine Überwachung; Videoarchiv nur lokal im Hallen-Server, nicht Teil der Cloud |
| 4. Sensible Daten (Art. 9) oder hoch persönliche Daten | **grenzwertig** | Name, Geburtsjahr, Gewicht, Verein; **kein** Gesundheitsdatum im engeren Sinn, aber Gewichtsklassen betreffen den Körper; keine Gesundheits- oder Verletzungsangaben erfassen |
| 5. Daten in großem Umfang | **möglich** | viele Turniere und Teilnehmer, aber je Betroffenen wenige Datenarten; Einordnung abhängig von Nutzerzahl |
| 6. Abgleich oder Zusammenführung von Datensätzen | nein | kein Abgleich verschiedener Quellen (Judopass-Nummer dient nur als Kennung) |
| 7. Daten **schutzbedürftiger Betroffener** (z. B. Kinder) | **ja** | Minderjährige (U11–U18) als Teilnehmende |
| 8. Innovative Technologie | nein | Standard-Webtechnik (Web-Push ist üblich) |
| 9. Betroffene werden an der Ausübung von Rechten oder Nutzung eines Dienstes gehindert | nein | Teilnahme hängt nicht von der Live-Anzeige ab (Einwilligung freiwillig) |

**Ergebnis (vorläufig):** Kriterium 7 trifft zu, 4 und 5 sind grenzwertig. Es ist **empfehlenswert, die Analyse mit Ihrem Datenschutzbeauftragten oder Rechtsbeistand zu bestätigen**. Mit den vorgesehenen Maßnahmen
(Einwilligung für die öffentliche Anzeige bei Minderjährigen, Datenminimierung, Verschlüsselung, kurze Löschfristen) ist das Risiko nach unserer Einschätzung **nicht hoch**; eine förmliche DSFA ist dann voraussichtlich nicht erforderlich.
**Wird die Teilnehmer-App ohne Einwilligung oder mit Namen von Kindern im großen Stil betrieben, ist eine DSFA anzuraten.** Zur Prüfung auch die „Muss-Liste“ der Datenschutzkonferenz (DSK) und der zuständigen Landesbehörde heranziehen.

**Dokumentation:** Datum `[…]`, Prüfende `[…]`, Ergebnis `[…]`, nächste Überprüfung `[spätestens bei Änderung der Verarbeitung, sonst jährlich]`.
