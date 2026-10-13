# Teilnehmer-App „Hajime Live“ — Phase 3: Push-Nachrichten

Status: Entwurf zur Freigabe · Branch `feature/teilnehmer-app-push` · 2026-10-13
Ergänzt `docs/specs/2026-10-12-teilnehmer-app-design.md` (Abschnitt 6.2 „App“, Push folgt dort in Phase 3) und
`docs/specs/2026-10-13-teilnehmer-app-phase2b-design.md`.

## 1. Ziel

Wer in der App für einen Teilnehmer (oder „für alle“ eines Vereins) die Glocke setzt, bekommt eine Push-Nachricht aufs Gerät,
auch bei geschlossener App:

1. **3 Kämpfe vor dem Pool-Start** des Gefolgten („Der Pool startet in 3 Kämpfen“),
2. **3 Kämpfe vor dem Kampf** des Gefolgten („Der Kampf ist in 3 Kämpfen“).

Es funktioniert auf Android, am Desktop und auf dem iPhone (iOS ab 16.4; dort nur, wenn die App zum Home-Bildschirm
hinzugefügt ist, das ist eine Vorgabe von Apple).

## 2. Entscheidungen

| # | Entscheidung |
|---|---|
| 1 | **Technik:** Standard-Web-Push (Push API, Service Worker, VAPID, Bibliothek `web-push`). Keine native App, keine Fremddienste außer den Push-Diensten der Browser-Hersteller. Gilt für iOS, Android und Desktop gleich. |
| 2 | **Wer wird benachrichtigt:** nur Geräte, die die Glocke gesetzt haben (einzeln oder „für alle“ eines Vereins, inklusive später hinzukommender Mitglieder, ohne ausdrücklich Abgewählte). Der Stern allein löst nichts aus. |
| 3 | **Auslöser Pool-Start:** der Pool des Teilnehmers hat noch keinen laufenden oder beendeten Kampf (`poolBegonnen = false`) und sein erster offener Kampf ist höchstens 3 Positionen von der Spitze der Matten-Warteschlange entfernt (`poolStartetIn ≤ 3`; dieselbe Definition wie „Bald dran“ in der App). |
| 4 | **Auslöser Kampf:** der nächste Kampf des Teilnehmers ist höchstens 3 Positionen entfernt (`als_naechstes` = 0, `in_n` mit `abstand ≤ 3`). Läuft der Kampf schon, gibt es keine Nachricht. Jeder weitere Kampf des Teilnehmers löst erneut aus (je Kampf einmal). |
| 5 | **Genau einmal:** je Gerät, Teilnehmer, Art und Bezug (Pool-ID bzw. Kampf-ID) höchstens eine Nachricht. Bedingungen, die bei der Anmeldung schon erfüllt sind, werden als „gesendet“ vermerkt, damit beim Einschalten keine Flut entsteht. |
| 6 | **Zusammenfassen:** Treffen Pool-Start und Kampf desselben Teilnehmers in derselben Auswertung zusammen (üblich, wenn sein Kampf der erste des Pools ist), gibt es eine Nachricht. |
| 7 | **Wortlaut (Vorschlag):** Titel „Hajime Live · <Turniername>“. Text „Mia Mustermann: Pool U15 w −44 kg startet in 3 Kämpfen (Matte 2)“, „Mia Mustermann: Kampf in 3 Kämpfen (Matte 2)“, bei Abstand 0 „… als Nächstes“, zusammengefasst „Mia Mustermann: Pool U15 w −44 kg startet in 3 Kämpfen, erster Kampf als Nächstes (Matte 2)“. Die Namen erscheinen auch auf dem Sperrbildschirm; das erwähnt der Hinweistext der App. Endgültiger Wortlaut in `src/liveCloud/pushText.js`, unit-getestet. |
| 8 | **Datenschutz:** gespeichert werden nur Push-Endpunkt und -Schlüssel des Geräts, die Turnier-Kennung und die Glockenliste (Teilnehmer-/Vereinsschlüssel). Kein Name, keine IP, kein Nutzerkonto. **Löschung 3 Tage nach dem Turnier-Datum** (`LIVE_PUSH_AUFBEWAHRUNG_TAGE`, Standard 3), sofort bei Abmeldung, bei Abmeldung durch den Push-Dienst (404/410) und mit der Rücknahme des Turniers. Der Datenschutztext der App wird entsprechend ergänzt. |
| 9 | **Einwilligung:** die Berechtigung wird erst beim ersten Setzen einer Glocke erfragt (das Antippen der Glocke ist die nötige Nutzeraktion), mit kurzer Erklärung. Abgelehnt: die Glocke bleibt lokal gesetzt, die App zeigt „Benachrichtigungen sind in den Einstellungen deines Geräts blockiert“. Ohne Unterstützung (iPhone, App nicht installiert): Hinweis „Zum Home-Bildschirm hinzufügen, dann Benachrichtigungen erlauben“. |
| 10 | **Zustellung:** höchstens einmal, kein Wiederholen; TTL 10 Minuten (spätere Zustellung wäre sinnlos), Dringlichkeit hoch. |
| 11 | **Nicht Teil von Phase 3:** Nachrichten bei Ergebnissen, „Kampf läuft jetzt“, Siegerehrung, Livestream (Phase 4). |

## 3. Datenmodell (Cloud)

Neue Migration, nur im Cloud-Betrieb genutzt:

```
live_push_abos(id, turnier_key → live_turniere ON DELETE CASCADE, endpoint (UNIQUE je turnier_key), p256dh, auth,
               erstellt_am, aktualisiert_am, laeuft_ab_am)
live_push_glocken(abo_id → live_push_abos ON DELETE CASCADE, art 'teilnehmer'|'verein'|'ausnahme', schluessel)
live_push_gesendet(abo_id → live_push_abos ON DELETE CASCADE, teilnehmer_key, art 'pool'|'kampf', bezug_id,
                   gesendet_am, UNIQUE(abo_id, teilnehmer_key, art, bezug_id))
```

`laeuft_ab_am` = Turnier-Datum + `LIVE_PUSH_AUFBEWAHRUNG_TAGE` (ohne Datum: Anmeldezeitpunkt + Tage). Der stündliche
Aufbewahrungslauf (`src/liveCloud/aufbewahrung.js`) löscht abgelaufene Abos zusätzlich zu den Turnieren.

## 4. Ablauf

```
Gerät (App)                           Cloud
  Glocke gesetzt, erlaubt ─────────▶  PUT /api/live/turniere/:key/push   (Abo + Glockenliste, ersetzt vollständig)
                                       speichert, vermerkt bereits erfüllte Bedingungen als gesendet
Halle ── Snapshot ───────────────▶  POST /api/live/ingest → uebernimmPaket()
                                       danach (nur bei „uebernommen“): pruefeUndSende(turnierKey)
                                       je Abo: Glocken auflösen → Bedingungen prüfen →
                                       neue Treffer in live_push_gesendet eintragen → web-push senden
Gerät  ◀── Push ──────────────────  Push-Dienst des Herstellers
  Service Worker zeigt die Nachricht; Antippen öffnet #/t/<key>/uebersicht
```

- **Auflösung der Glocken serverseitig:** `teilnehmer`-Schlüssel direkt; `verein`-Schlüssel → alle Teilnehmer des Vereins im
  aktuellen Stand (so zählen später gemeldete mit); `ausnahme`-Schlüssel (einzeln abgewählt oder Glocke aus) werden abgezogen.
  Die App rechnet die Liste aus ihrem Speicher (`speicher.js`): einzelne Glocken, Vereine mit „Glocke für alle“, Ausnahmen.
- **Auswertung:** `pruefeUndSende` nutzt dieselbe Pool-Beginn-Berechnung wie die App-API (`poolStarts` aus
  `src/liveCloud/abfrage.js`, dafür exportiert) und `live_teilnehmer.zustand/abstand/naechster_kampf_id`. Ein Advisory-Lock je
  Turnier verhindert doppeltes Senden bei überlappenden Ingests. Eintragen vor Senden: bei einem Sendefehler geht eine Nachricht
  eher verloren, als dass sie doppelt kommt (Entscheidung 10).
- **Fehler:** `web-push` meldet 404/410 → Abo löschen; andere Fehler loggen, nie den Ingest scheitern lassen (Aufruf ohne
  `await` im Request, mit `catch`).

## 5. API

| Methode | Pfad | Zweck |
|---|---|---|
| GET | `/api/live/push/schluessel` | öffentlicher VAPID-Schlüssel; 503, wenn Push nicht konfiguriert ist |
| PUT | `/api/live/turniere/:key/push` | Body `{ abo: { endpoint, keys: { p256dh, auth } }, glocken: { teilnehmer: [], vereine: [], ausnahmen: [] } }`; ersetzt die Anmeldung vollständig; 404 bei unbekanntem Turnier; leere Glockenliste löscht das Abo |
| DELETE | `/api/live/turniere/:key/push` | Body `{ endpoint }`; löscht das Abo |

Absicherung: gleiche Ratenbegrenzung wie die App-API; Endpunkt nur `https:` und nur von bekannten Push-Diensten
(`fcm.googleapis.com`, `*.push.services.mozilla.com`, `*.notify.windows.com`, `web.push.apple.com`, `*.push.apple.com`;
verhindert, dass die Cloud an beliebige Adressen sendet), höchstens 500 Zeichen; höchstens 200 Schlüssel je Liste; Abos je
Turnier begrenzt (Standard 5000). Der Ingest bleibt unverändert.

## 6. App (PWA)

- `teilnehmer-app/js/push.js` (neu): Unterstützung erkennen, Berechtigung erfragen, `pushManager.subscribe` mit dem
  VAPID-Schlüssel, Glockenliste aus dem Speicher berechnen und per PUT übertragen (entprellt, bei jeder Änderung von Glocke,
  Stern und Verein sowie beim Start der App); Abmeldung, wenn keine Glocke mehr gesetzt ist.
- `teilnehmer-app/sw.js`: Handler `push` (Benachrichtigung aus dem JSON-Body, `tag` verhindert Dubletten),
  `notificationclick` (vorhandenes Fenster fokussieren, sonst öffnen) und `pushsubscriptionchange` (erneut anmelden).
  Cache-Version erhöhen, `push.js` in die Hülle aufnehmen.
- Hinweiszeile in der Übersicht (und beim ersten Setzen einer Glocke): Zustand der Benachrichtigungen in Worten (aktiv,
  blockiert, „auf dem iPhone zuerst zum Home-Bildschirm hinzufügen“, nicht unterstützt).
- Ohne Push bleibt alles unverändert (Glocke, Sterne und Übersicht arbeiten lokal wie bisher).

## 7. Konfiguration und Betrieb

`LIVE_PUSH_VAPID_PUBLIC`, `LIVE_PUSH_VAPID_PRIVATE`, `LIVE_PUSH_BETREFF` (`mailto:` oder `https:`),
`LIVE_PUSH_AUFBEWAHRUNG_TAGE`. Schlüsselpaar mit `node scripts/live-push-schluessel.mjs`. Ohne diese Variablen ist Push
abgeschaltet (503, die App blendet die Hinweise aus). Betriebsbeschreibung in `docs/live-uplink.md` ergänzen.
Voraussetzung: die Cloud ist per HTTPS erreichbar.

## 8. Tests

- Unit (eingebettetes PostgreSQL, `sender` injizierbar): Auslöser Pool-Start und Kampf an den Schwellen (4, 3, 0), „genau
  einmal“, Anmeldung mit bereits erfüllter Bedingung, Zusammenfassung, später gemeldetes Vereinsmitglied, Ausnahme, 410 löscht
  das Abo, Ablauf nach 3 Tagen, Rücknahme des Turniers löscht Abos, Endpunkt-Prüfung (fremde Hosts, `http:`).
- Unit: Glockenliste aus dem Speicher; Texte (`pushText.js`).
- Routen: PUT/DELETE/GET mit Fehlerfällen und Ratenbegrenzung.
- E2E: Anmeldeablauf in der PWA mit gestubbtem `PushManager` und Benachrichtigungs-Attrappe. Der echte Versand lässt sich nur
  mit HTTPS und einem echten Gerät prüfen (manuelle Prüfliste: Android Chrome, iPhone mit Home-Bildschirm-App, Desktop).

## 9. Offen

- Endgültiger Wortlaut der Nachrichten (Entscheidung 7).
- Ob die Schwelle „3“ später einstellbar sein soll (vorerst Konstante `PUSH_SCHWELLE = 3`).
