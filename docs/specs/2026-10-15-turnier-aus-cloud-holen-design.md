# Turnier aus der Cloud holen (Hallen-Server)

Stand: 2026-10-15 · Status: Entwurf zur Freigabe

## Ziel

Auf der Turnierauswahl (`turniere.html`) eines **Hallen-Servers** kann die Turnierleitung ein Turnier ihres
Vereins direkt aus der Cloud auf den Server holen, ohne Umweg über Export-Datei und Datei-Upload.

## Entscheidungen (mit dem Nutzer abgestimmt)

- Anmeldung an der Cloud mit **Benutzer und Passwort des Cloud-Kontos**, eingegeben auf der Seite. Die
  Zugangsdaten werden nur für diese Abfrage verwendet und weder gespeichert noch geloggt.
- Aufbau der Seite: oben das lokale Turnier (falls vorhanden), darunter ein **Trennstrich** „Turniere aus der
  Cloud“, darunter Anmeldefeld bzw. nach der Anmeldung die Turniere des Vereins mit „Auf diesen Server holen“.
- Ist die Cloud nicht erreichbar, fehlen Trennstrich und Cloud-Bereich komplett.
- Die Cloud-Adresse kommt aus der Variable **`CLOUD_URL`** (`.env`). Ohne Wert gibt es die Funktion nicht.
- Sichtbar und nutzbar **nur auf Hallen-Servern** (`BETRIEBSMODUS=server`, bzw. `istEinzelbenutzerBetrieb()`).
  In der Cloud und auf Client-Geräten bleibt die Seite unverändert; die neuen Endpunkte lehnen dort ab (403).

## Holen erst nach Anmeldeschluss

Das Holen folgt der bestehenden Export-Regel der Cloud: erst wenn die Anmeldefrist abgelaufen ist
(effektiver Status `anmeldung_geschlossen`, `in_durchfuehrung` oder `abgeschlossen`, `exportTurnier`).
So enthält das geholte Turnier alle Anmeldungen. Die Cloud-Seite bleibt unverändert.

- Die Liste (`GET /api/turniere` liefert `status_effektiv`) zeigt nur für diese Status den Knopf
  „Auf diesen Server holen“. Davor steht statt des Knopfes der Hinweis „Anmeldung läuft noch (bis <Datum>)“.
- Die Prüfung gilt zusätzlich in der Cloud (403 bei direktem Aufruf), das Frontend ist nur die Anzeige.

## Nicht Teil dieser Funktion

- Der Rückweg (Ergebnisse in die Cloud hochladen) bleibt wie bisher (`import-ergebnisse`).
- Keine Speicherung von Cloud-Zugangsdaten, kein „angemeldet bleiben“.
- Keine Änderung am Export-Format und an der Cloud-Seite.

## Ablauf

1. `turniere.html` fragt `GET /api/cloud/status`. Antwort `{ verfuegbar }`: `true`, wenn Hallen-Server,
   `CLOUD_URL` gesetzt und die Cloud innerhalb von 3 s auf `GET <CLOUD_URL>/api/auth/mode` antwortet.
   Bei `false` wird der Cloud-Bereich nicht gerendert.
2. Anmeldung: `POST /api/cloud/turniere` mit `{ email, password }`. Der Hallen-Server meldet sich per
   `POST <CLOUD_URL>/api/auth/login` an der Cloud an und lädt mit dem erhaltenen Token `GET <CLOUD_URL>/api/turniere`
   (die Cloud filtert dort bereits auf den Verein des Benutzers). Antwort: Liste der Turniere plus das Token,
   das die Seite nur im Arbeitsspeicher hält.
3. Holen: `POST /api/cloud/turniere/:id/holen` mit `{ token }`. Der Server lädt
   `GET <CLOUD_URL>/api/turniere/:id/export` mit diesem Token und führt den vorhandenen Import aus.
   Antwort wie beim Datei-Import (`turnierId`, `imported`), die Seite springt auf `teilnehmer.html?turnierId=`.
4. Vor Schritt 3 verlangt die Seite dieselbe Bestätigung wie beim Datei-Import, weil das bisherige Turnier auf
   dem Hallen-Server ersetzt wird (genau ein Turnier pro Server).

## Komponenten

| Einheit | Aufgabe | Abhängig von |
|---|---|---|
| `src/services/cloudZugriff.js` (neu) | HTTP zur Cloud: `pruefeErreichbar`, `meldeAn`, `listeTurniere`, `ladeExport`; Timeouts, Fehler als `FachFehler` mit klarem Grund | `fetch`, `CLOUD_URL` |
| `src/routes/cloudRoutes.js` (neu) | Endpunkte `/api/cloud/status`, `/turniere`, `/turniere/:id/holen`; Gate auf Einzelbenutzerbetrieb, Schreibpfad nur am Master (`nurMaster`) | `cloudZugriff`, Import |
| `turnierController.js` | Kern von `importTurnier` in eine Funktion `importiereTurnierDaten(knex, req, daten)` auslösen; `importTurnier` und `holen` rufen sie auf. Keine Verhaltensänderung des Datei-Imports | — |
| `public/turniere.html` | Cloud-Bereich: Trennstrich, Anmeldefeld, Liste, Holen-Knopf; nur sichtbar bei `verfuegbar` | `/api/cloud/*` |
| `src/app.js` | Route einhängen, nur wenn `istEinzelbenutzerBetrieb()` | — |

## Fehlerfälle

| Fall | Verhalten |
|---|---|
| Cloud nicht erreichbar / Timeout | Cloud-Bereich bleibt weg (`verfuegbar: false`); bricht sie erst nach der Anmeldung weg, Meldung „Die Cloud ist gerade nicht erreichbar“ |
| Zugangsdaten falsch (401 der Cloud) | Meldung direkt unter dem Anmeldefeld, Felder bleiben erhalten |
| Verein noch nicht freigegeben | Hinweis aus der Cloud-Antwort, keine Liste |
| Keine Turniere im Verein | Kurzer Hinweis „Keine Turniere in der Cloud“ statt leerem Bereich |
| Turnier noch in der Anmeldephase | Kein Holen-Knopf, Hinweis „Anmeldung läuft noch“; ein direkter Aufruf scheitert in der Cloud mit 403, deren Meldung wird angezeigt |
| Ungültige Export-Antwort | Import bricht ab, bisheriges Turnier bleibt (Import läuft in einer Transaktion) |
| Aufruf am Secondary (Cluster) | 409 wie bei anderen Schreibpfaden (`nurMaster`) |

## Sicherheit

- Passwort und Token werden nicht geloggt und nicht auf der Platte abgelegt; das Token ist nur kurz im
  Browser-Arbeitsspeicher der Seite.
- Der Hallen-Server ruft ausschließlich `CLOUD_URL` auf, nie eine vom Client übergebene Adresse (kein SSRF).
- Antworten der Cloud werden wie die Datei beim Datei-Import validiert (Pflichtfelder, Größenlimit).

## Tests

- Unit: `cloudZugriff` mit Fake-`fetch` (Erreichbarkeit, Login 401, Timeout, Export-Fehler).
- E2E: Die Fake-Cloud liefert ein Turnier vor und eines nach Anmeldeschluss; nur das zweite hat den
  Holen-Knopf, das erste den Hinweis.
- E2E (`tests/e2e/`): Zweiter Express-Prozess als Fake-Cloud (`/api/auth/mode`, `/login`, `/turniere`,
  `/turniere/:id/export` mit einem echten Export aus `turnier-aufbau.js`) auf eigenem Port, `CLOUD_URL` darauf
  gesetzt. Prüft: Bereich sichtbar und Holen ersetzt das lokale Turnier; Bereich fehlt ohne `CLOUD_URL` und bei
  nicht erreichbarer Cloud; falsches Passwort; im Modus `cloud` sind Endpunkte 403 und der Bereich fehlt.

## Offen

- **Standardwert für `CLOUD_URL`:** Adresse der Produktiv-Cloud ist im Repository nicht hinterlegt. Bis sie
  festgelegt ist, muss `CLOUD_URL` am Hallen-Server gesetzt werden (Installationsskript kann sie eintragen).
- Anzeige des Status/Datums je Cloud-Turnier hängt davon ab, was `GET /api/turniere` liefert; im Plan gegen die
  tatsächliche Antwort prüfen.
