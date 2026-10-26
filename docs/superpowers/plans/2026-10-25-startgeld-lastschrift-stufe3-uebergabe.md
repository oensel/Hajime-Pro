# Startgeld-Lastschrift (Stufe 3) — Übergabe an einen neuen Agenten

Stand: Stufe 2 ist umgesetzt und geprüft (Branch `feature/startgeld-rechnungen`, aufbauend auf `main` mit Stufe 1). Stufe 3 ist **nicht begonnen**. Diese Datei ist die Arbeitsanweisung.

## Auftrag in einem Satz
Ein meldender Verein kann das Startgeld per SEPA-Basislastschrift zahlen: Er erteilt bei der Anmeldung ein Einmal-Mandat, ein Admin seines Vereins bestätigt es; der Ausrichter erstellt nach dem Turnier die Rechnungen (sie sind zugleich die Vorabankündigung) und lädt eine `pain.008`-Sammeldatei für sein Online-Banking herunter.

## Lesen (in dieser Reihenfolge)
1. `docs/superpowers/plans/2026-10-25-startgeld-lastschrift-stufe3.md` — **der Plan**, 12 Tasks mit Dateien, Signaturen, Tests und den Entscheidungen L1–L12. Er ist die Arbeitsgrundlage.
2. `docs/superpowers/specs/2026-10-24-startgeld-abrechnung-design.md` — die verbindliche Spezifikation, inklusive der Abschnitte „Stand nach Stufe 1 / Abweichungen“ und „Stand nach Stufe 2 / Abweichungen“.
3. `CLAUDE.md` — Abschnitte „Startgeld-Zahlweg (Stufe 1)“ und „Startgeld-Rechnungen (Stufe 2)“.
4. Dieses Dokument: Abschnitt „Was gegenüber dem Plan anders ist“.

## Arbeitsweise
Wie bei Stufe 1 und 2: ein Task nach dem anderen, je Task Tests zuerst (rot, dann grün), danach ein unabhängiges Review (Spezifikation und Qualität), Nachbesserung bis sauber, ein Abschluss-Review über den ganzen Branch. Verfahren: Skill `superpowers:subagent-driven-development`. Nicht pushen, nicht mergen ohne Freigabe des Projektinhabers. Commit-Zeile: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Voraussetzungen
- Stufe 2 muss auf dem Branch vorhanden sein (Tabellen `vereins_abrechnung`, `rechnungen`, `turnier_barzahlungen`, Service `rechnungslauf`, `rechnungPdf`, `abrechnung`, `rueckspielen`).
- Arbeite **nicht parallel zu Stufe 2** auf denselben Dateien. Aufsetzen auf den Stand von `feature/startgeld-rechnungen` nach dem letzten Fix-Commit (oder auf `main`, sobald Stufe 2 gemergt ist).
- Neue Migration `20261103100000_startgeld_lastschrift.js` (nach der Stufe-2-Migration `20261102100000_startgeld_rechnungen.js`).
- Entwicklung mit lokalem PostgreSQL (`npm run pg:start`) und den Test-Hinweisen aus `CLAUDE.md`.

## Was gegenüber dem Plan anders ist (Ergebnis des Abschluss-Reviews von Stufe 2)
Der Plan wurde vor dem Bau von Stufe 2 geschrieben. Diese Punkte sind jetzt Tatsache:

1. **`VereinsZeile` und `RechnungsDaten` sind keine Typdefinitionen im Code**, nur Prosa im Plan. Die echten Objekte sind Obermengen: `VereinsZeile` hat zusätzlich `rechnungWeichtAb`, `rechnung` hat `anzahl` und `betrag_cent`; `RechnungsDaten` hat zusätzlich `barDatum`. Stufe 3 erweitert die echten Funktionen (`rechnungsDatenAusZeile` in `src/services/rechnungslauf.js`, `baueRechnungsZeilen` in `src/services/rechnungPdf.js`), nicht ein Typdokument.
2. **Anrechnung bezahlter Kämpfer (E9, im Review geändert):** Bereits bezahlte Kämpfer (rohes `startgeld_bezahlt`) werden bei **jedem Zahlweg außer Lastschrift** angerechnet. Bei Lastschrift bleibt die Anrechnung 0 und `rechnungsArt` bleibt `rechnung`. Das darf Stufe 3 nicht ändern.
3. **Lastschrift ist in Stufe 2 an drei Stellen vorbereitet, aber blockiert:**
   - `rechnungsDatenAusZeile` wirft 409 „kein Konto“, sobald offen > 0 und keine Ausrichter-IBAN da ist. Für Lastschrift muss das entfallen (die IBAN des **Zahlers** kommt aus dem Mandat, die Ausrichter-IBAN wird für die SEPA-Datei gebraucht, nicht für die Rechnung).
   - `brauchtKonto` in `erstelleRechnungen` behandelt Lastschrift als kontopflichtig. Das muss für Lastschrift angepasst werden.
   - `src/services/rechnungPdf.js` enthält einen schlafenden Satz „Der Betrag wird per Lastschrift eingezogen.“ (nicht erreichbar). Stufe 3 ersetzt ihn durch den Text aus dem Plan (Task 7: Betrag, Einzugsdatum, Maske der Zahler-IBAN, Mandatsreferenz, Gläubiger-ID; kein Girocode).
4. **Status `zurueckgebucht`** wird von keinem Stufe-2-Code gesetzt. `setzeBezahlt` verweigert ihn, `ladeAbrechnung` und der Lauf schließen ihn aus; der Partial-Unique-Index lässt danach eine neue Rechnung zu. Die Sperre für erneutes Rückspielen (`whereNotNull('versandt_am')` in `src/services/rueckspielen.js`) zählt auch zurückgebuchte Rechnungen.
5. **Schlüsselwechsel (Task 11):** `kid` wird beim Verschlüsseln in `src/utils/feldVerschluesselung.js` geschrieben, beim Entschlüsseln aber **ignoriert**. Für `ZAHLUNGSDATEN_SCHLUESSEL_ALT` braucht es einen kid-basierten Schlüssel-Lookup. Das Format trägt es bereits.
6. **`heuteBerlin`** ist an drei Stellen exportiert (`src/shared/abrechnung.js`, `src/services/helferPlan.js`, `src/shared/orgaAnzeige.js`). Stufe 3 importiert die aus `src/shared/abrechnung.js`.
7. **`sendeMail`** nimmt `anhaenge`, `replyTo`, `absenderName` und liefert `{ versendet, grund }`. Mails mit Link brauchen in der Cloud `PUBLIC_BASE_URL` (siehe `src/utils/basisUrl.js`).
8. **Das Journal der Barzahlungen** (`turnier_barzahlungen`) ist nur Information. Die Autorität für Anrechnung ist `startgeld_bezahlt` je Kämpfer.
9. **Rückspielen** ist Admin-Sache und verlangt für Super-Admins den 2FA-Code (Claim `zf` im Login-Token, 10 Minuten). `pruefeSensibleAktion(knex, req, { frischeAnmeldungGenuegt })` existiert. Für den SEPA-Download verlangt Stufe 3 **immer** einen frischen Code (`frischeAnmeldungGenuegt: false`).
10. **Hallen-Server-Transfer:** Export und Import tragen Zahlwege, Rechnungsangaben und die Barzahlungen. Für Lastschrift reist nur `zahlweg` und `gesichert`, **nie** Mandat oder IBAN (Plan Task 5).

## Offene Entscheidungen des Projektinhabers (nicht selbst treffen)
- **Rechtliche Prüfung** von Mandatstext (`MANDATSTEXT_VERSION`), Vorabankündigungsfrist (Voreinstellung 5 Tage) und Online-Mandat ohne Unterschrift (der Gläubiger trägt das Risiko) mit Bank oder Rechtsberatung, **vor dem Produktiveinsatz**.
- **`pain.008`-Version:** Der Plan nimmt `pain.008.001.08` (Stand der Recherche Oktober 2026: Pflicht auf November 2026 verschoben, `.02` gilt bis dahin). **Mit der Hausbank des Ausrichters klären**, bevor die erste Datei eingereicht wird. Die Datei ist mit dem offiziellen XSD zu prüfen (Task 9, Schritt 5; XSD nicht ins Repository einchecken).
- Gläubiger-ID: Der Ausrichter muss sie bei der Bundesbank beantragt haben.

## Was nicht zu Stufe 3 gehört
Wiederholungsmandate (FRST/RCUR), B2B-Lastschrift, Bankdatei-Import (camt.053), Gutschriften — das ist eine spätere Stufe 4.

## Bekannte Lücken aus Stufe 2 (nicht Teil von Stufe 3, nur zur Kenntnis)
Cloud-Login-Formular „Turnier aus der Cloud holen“ ohne 2FA-Feld für Super-Admins; Aktionen auf `abrechnung.html` ohne `try/catch` und ohne Doppelklick-Schutz vor der Bestätigung; kein 2FA und keine Info-Mail bei IBAN-Änderung durch einen Super-Admin; Teilnehmer werden vom Rechnungslauf außerhalb der Transaktion gelesen („Rechnung weicht ab“ meldet Abweichungen); alte, per „Ergebnisse hochladen“ hochgeladene Turniere sind nicht abrechenbar; Vereinsnamen-Schreibweisen (Abrechnung normalisiert, Kasse nicht).
