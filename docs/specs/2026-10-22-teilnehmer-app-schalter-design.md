# Teilnehmer-App am Hallen-Server ein-/ausschalten (Design)

Stand: 2026-10-22. Ergänzt die Teilnehmer-App-Specs (`2026-10-12-teilnehmer-app-design.md`, `2026-10-13-teilnehmer-app-push-design.md`), Betrieb des bisherigen Uplinks: `docs/live-uplink.md`.

## Hintergrund und Ziel

Die Teilnehmer-App (PWA in der Cloud, Web-Push) bekommt ihre Daten vom Live-Uplink, der Snapshots an `/api/live/ingest` der Cloud sendet. Heute ist der Uplink ein eigener Prozess mit eigener `live.env`, eigenem Token und systemd (nur Linux, nur Slave im Cluster). Ein Hallen-Server auf einem Windows-Notebook, der sein Internet per USB-Tethering vom Handy bekommt, kann die App so nicht versorgen.

Ziel: Der Veranstalter schaltet die Teilnehmer-App in der Oberfläche des Hallen-Servers ein, sobald eine Internetverbindung zur Cloud besteht. Er braucht dafür keine Konfigurationsdatei, keinen Dienst und kein von Hand kopiertes Token. Die Push-Benachrichtigungen löst weiterhin die Cloud aus (nach jedem angenommenen Snapshot, unverändert).

### Nicht-Ziele
- Cloud-Push-Logik, Teilnehmer-App (PWA) und Snapshot-Inhalt ändern sich nicht.
- Der Linux-Weg (`hajime-live`, `install-live.sh`, `live_ro`, Slave im Cluster) bleibt unverändert bestehen.
- Der Betrieb des alten Linux-Dienstes `hajime-live` zusammen mit dem neuen Uplink im Server-Prozess: beide gleichzeitig würden doppelt senden. Der neue Weg ersetzt den Dienst; die Dokumentation sagt, dass der Dienst dann deaktiviert werden muss.
- Keine Änderung der Anmeldeschluss-Regel der Cloud für den Export.

### Anti-Ziel
Daten dürfen nie ohne ausdrückliche Entscheidung des Veranstalters in die Cloud gehen (Namen, Vereine, Paarungen). Ein neu importiertes oder neu geholtes Turnier startet immer mit ausgeschalteter Funktion. Nur ein Neustart des Servers setzt eine bereits eingeschaltete Funktion fort.

## Entscheidungen (vom Auftraggeber)

1. **Der Haken „Live freigeben“ in `turnier.html` entfällt.** Der Zustand wird nur noch über das neue Icon und die Abfrage auf der Mattenseite gesteuert. Die Spalte `turniere.live_freigabe` bleibt als technischer Schalter bestehen (der Snapshot-Code und der Linux-Uplink lesen sie weiter); `GET/PUT /api/turniere/:id/live-freigabe` bleiben, die Oberfläche nutzt sie über das neue Icon.
2. **Zeitpunkt:** Die Funktion wird erst angeboten, wenn die Pools auf die Matten verteilt sind (vorher gibt es keine sinnvollen Daten).
3. **Hinweis auf `matten.html`:** Sind die Pools verteilt und ist die Cloud erreichbar, erscheint ein Hinweiskasten „Teilnehmer-App verfügbar“ mit „Aktivieren“ und „Später“. Der Kasten nennt, dass Teilnehmer Stände, Kampfzeiten und Benachrichtigungen in der App verfolgen können, und dass dafür eine Internetverbindung nötig ist.
4. **Icon in der Kopfleiste** (neben dem Cluster-Symbol `hallenServerBtn`, gleiche Bauart: Material-Icon in `.theme-toggle`, Farbe wechselt selbst, Tooltip erklärt den Zustand, Klick öffnet den Dialog):
   - **rot:** Cloud nicht erreichbar
   - **gelb:** Cloud erreichbar, aber es können keine Daten gesendet werden
   - **grün:** Cloud erreichbar, Daten werden gesendet
   - **grau:** ausgeschaltet *(Annahme des Entwurfs, vom Auftraggeber nicht widersprochen)*
5. **Dialog** (Klick auf das Icon): Status mit Farbpunkt und Klartext (z. B. „Läuft – letzter Abgleich vor 4 s“), Schalter „Daten an die Teilnehmer-App senden“, Hinweis auf Internetbedarf (z. B. USB-Tethering) und auf regelmäßige Verbindungsprüfung, beim Einschalten ein deutlicher Hinweis, dass Namen, Vereine und Paarungen in die Cloud gesendet werden. Schrift muss im hellen und dunklen Theme lesbar sein (Theme-Variablen der App verwenden, keine festen Farben, die zu einem Theme passen).
6. **Das Token erzeugt die Cloud beim Holen des Turniers** (nicht beim Anlegen, weil die Cloud nur den SHA-256 speichert und ein Token später nicht mehr herausgeben kann). Es wird mit `turnier_key` = Cloud-Turnier-ID erzeugt (die Cloud erzwingt die Bindung bereits in `liveRoutes.js`). Frühere Tokens für dasselbe Turnier verfallen erst, wenn das neue zum ersten Mal am Ingest benutzt wird (ein gescheitertes Holen darf das laufende Token nicht sperren). Es reist im Turnier-Export mit und wird beim Import am Hallen-Server gespeichert.
7. **Der Uplink läuft im Server-Prozess.** Er verwendet die vorhandenen Bausteine `ladeSnapshots` (`src/live/snapshot.js`), `erzeugeUplink` (`uplink.js`) und `starteLiveDienst` (`dienst.js`), mit der Datenbankverbindung des Servers statt der Rolle `live_ro`, Ziel-URL und Token aus dem gespeicherten Turnier statt aus `live.env`. Er startet und stoppt mit dem Schalter. Kein `live.env`, kein systemd, keine Datenbankrolle.
8. **Das Pseudonymisierungs-Geheimnis** (heute `LIVE_SCHLUESSEL`) erzeugt der Hallen-Server selbst und speichert es beim Turnier *(Annahme des Entwurfs)*. Es muss über Neustarts stabil bleiben, damit die Schlüssel der Teilnehmer in der Cloud gleich bleiben (Sterne und Glocken der Besucher).

## Verhalten

### Voraussetzungen für „verfügbar“
- Einzelbenutzerbetrieb (Hallen-Server), allein oder im Cluster.
- `CLOUD_URL` gesetzt.
- Das aktive Turnier stammt aus der Cloud (`urspruengliche_id` gesetzt) und hat ein gespeichertes Live-Token. Sonst zeigt der Dialog „Dieses Turnier wurde nicht aus der Cloud geholt, die Teilnehmer-App ist nicht verfügbar“ (Icon grau, kein Hinweiskasten).
- Mindestens ein Pool ist einer Matte zugeordnet (Pools verteilt) *(Auslegung des Entwurfs; „Pools verteilt“ = es gibt Pools mit Matte)*.

### Verbindungsprüfung
Der Server prüft die Erreichbarkeit der Cloud regelmäßig (`pruefeErreichbar` aus `src/services/cloudZugriff.js`, Intervall 15 s *(Annahme)*), unabhängig davon, ob die Funktion eingeschaltet ist, damit Hinweiskasten und Icon aktuell sind. Das Ergebnis liefert ein Status-Endpunkt (`GET` an einer neuen Route, rein lesend), den `menu.js` wie beim Cluster-Icon periodisch abfragt.

### Zustände
| Zustand | Bedingung |
|---|---|
| grau | Funktion aus, oder nicht verfügbar |
| rot | Funktion an (oder verfügbar) und Cloud nicht erreichbar |
| gelb | Cloud erreichbar, aber letzter Sendeversuch scheiterte (z. B. Token abgelehnt, Statuscode ≠ 2xx) oder noch kein erfolgreicher Versand |
| grün | Cloud erreichbar und der letzte Versand war erfolgreich (Lebenszeichen höchstens ~60 s alt) |

Der Dialog nennt bei gelb den Grund in Klartext (aus `uplink.zustand().letzterFehler`, ohne technische Rohdaten wie das Token).

### Einschalten / Ausschalten
- Einschalten setzt `live_freigabe` für das Turnier und startet den Uplink-Dienst. **Der Zustand bleibt über einen Neustart des Servers erhalten** (Entscheidung des Auftraggebers): war die Funktion vorher an, startet der Uplink beim Serverstart von selbst wieder, sobald das Turnier aktiv ist. Ausgeschaltet wird sie nur durch den Veranstalter (oder durch Löschen/Ersetzen des Turniers).
- Ausschalten stoppt den Dienst und nimmt das Turnier in der Cloud zurück (wie das bisherige Entfernen des Hakens; die Cloud löscht Daten und Push-Anmeldungen).
- „Später“ im Hinweiskasten blendet ihn für dieses Turnier im Browser aus (`localStorage`), das Icon bleibt.

## Cluster (zwei Hallen-Server)

Der Schalter funktioniert auch im Cluster. Vorgesehen ist, dass nur der Secondary („Slave“) Internet hat (USB-Tethering); möglich ist auch, dass beide Internet haben.

- **Gemeinsamer Zustand:** Schalter („an“), Token und Geheimnis liegen in der PostgreSQL-Datenbank und replizieren zum Secondary. Ein-/Ausschalten geschieht am Master (über die VIP), wie alle Schreibzugriffe.
- **Wer sendet:** Genau ein Server sendet. Regel *(Annahme des Entwurfs)*: Der Secondary sendet, wenn er die Cloud erreicht. Erreicht er sie nicht, sendet der Master, sofern er sie erreicht. Jeder Knoten ermittelt seine eigene Cloud-Erreichbarkeit und teilt sie im Cluster-Status (den die Server bereits austauschen, `src/cluster/`); beide leiten daraus dieselbe Entscheidung ab. Hat kein Server Internet, sendet keiner (Icon rot).
- **Lesen der Daten:** Der sendende Secondary liest seine eigene Standby-Datenbank (nur lesend, genügt für `ladeSnapshots`). Der Schalterzustand wird nur am Master geschrieben, am Secondary nur gelesen.
- **Wechsel der Rollen:** Übernimmt der Secondary die Master-Rolle, sendet er weiter, wenn er Internet hat; sonst übernimmt der andere Knoten das Senden, sobald er die Cloud erreicht. Der neue Sender sendet beim Start den vollständigen Stand (der Uplink merkt sich ohne seine lokale Zustandsdatei nichts); die Sequenz bleibt über die Uhr streng monoton (Cloud verwirft Pakete mit kleinerer Sequenz mit 409, der Uplink wiederholt mit Backoff, bis die Uhrzeit aufgeholt hat).
- **Icon und Dialog:** Zeigen den Zustand des sendenden Servers. Der Master bezieht ihn aus dem Cluster-Status des Partners, wenn der Secondary sendet. Der Dialog nennt, welcher Server sendet.
- **Gelb/Rot im Cluster:** rot = kein Server erreicht die Cloud; gelb = ein Server erreicht sie, Senden scheitert.

## Cloud-Seite
- Beim Export des Turniers (`baueTurnierExport` bzw. der Export-Endpunkt) erzeugt die Cloud, sofern Push/Live in der Cloud aktiv ist (`live`-Routen aktiv, Modus `cloud`), ein Token via `erzeugeToken(knex, { name, turnierKey })` (frühere Tokens dieses Turniers werden beim ersten Gebrauch des neuen gesperrt). Das Token steht in einem neuen Feld der Export-Datei. Ältere Hallen-Server ignorieren unbekannte Felder; ein Export ohne Feld (alte Cloud) gilt am Hallen-Server als „kein Token, nicht verfügbar“.
- Der Dateiformat-Hinweis: Die Export-Datei enthält damit ein Geheimnis und ist wie ein Passwort zu behandeln (nur für Berechtigte, die das Turnier exportieren dürfen — Regeln des Exports unverändert).
- Tokens brauchen eine Zuordnung zum Turnier für das Sperren des Vorgängers (`turnier_key` reicht).

## Hallen-Server-Seite (Überblick)
- Import (`importiereTurnierDaten`) speichert das Token am Turnier (neue Spalten, z. B. `live_token`, `live_geheimnis`; nicht Teil des normalen Exports vom Hallen-Server zurück in die Cloud).
- Neuer Dienst, der Uplink und Verbindungsprüfung hält, Zustände berechnet und Start/Stop kapselt; neue Routen für Status und Ein-/Ausschalten (nur Einzelbenutzerbetrieb, am Secondary aus).
- Frontend: Icon und Dialog in `public/js/menu.js`, Hinweiskasten in `public/matten.html`/`matten.js`; Haken und zugehöriger Code aus `turnier.html`/`turnier.js` entfernen.

## Dem Entwickler überlassen
Konkrete Namen von Routen, Spalten und Dateien; Intervalle (Vorschlag 15 s Verbindungsprüfung, Uplink-Takt wie bisher 5 s); genaue Texte; Tests (Unit für Zustandslogik und Token-Vergabe, E2E mit Fake-Cloud analog `tests/helpers/fake-cloud.mjs`); Migration; Aktualisierung von `CLAUDE.md` und `docs/live-uplink.md`.

## Offene Annahmen (zur Kontrolle)
Grau für „aus“; Prüfintervall 15 s; „Pools verteilt“ = mindestens ein Pool mit Matte; Geheimnis wird am Hallen-Server erzeugt; im Cluster sendet bevorzugt der Secondary (Regel im Abschnitt Cluster).
