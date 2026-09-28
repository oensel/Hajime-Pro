# Desktop-Client (Electron) mit Selbst-Update, mDNS-Serversuche und CI-Pipeline — Design

Stand: 2026-09-28 · Teilprojekt A der Zero-Config-Spezifikation (`judo_agent_specification.md`)

## 1. Ziel

Helfer an Waage und Matte installieren den Client **einmal** und müssen danach nichts mehr tun:

- Erstinstallation: Browser auf `turnier.local/download`, passende Datei für das eigene
  Betriebssystem herunterladen, starten → installiert, Desktop-Symbol vorhanden. Keine Admin-Rechte,
  kein Node, keine `.env`.
- Beim allerersten Start einmalig ein 6-stelliger Kopplungscode (gehört zur Erstinstallation).
- Jeder Start: Versionsvergleich mit dem Server; weicht die Version ab, ersetzt sich die App vor dem
  eigentlichen Start selbst. Server nicht erreichbar → sofortiger Offline-Start ohne Fehlermeldung.
- Daten kommen wie heute per Replikation vom Hallen-Server; die Server-Adresse wird automatisch
  gefunden.

Plattformen: Windows 10/11 (x64), Linux-Desktop (x64), macOS (universal, Intel + Apple Silicon).

### Teilprojekte der Zero-Config-Spezifikation

| | Inhalt | Status |
|---|---|---|
| **A** | Electron-Client mit Selbst-Update + CI-Pipeline | **diese Spec** |
| B | Serversuche per mDNS statt VIP/`SYNC_SERVER_URL` | nur der für A nötige Teil (Ankündigung `_hajime._tcp`, Client-Suche) ist hier enthalten; keepalived bleibt vorerst |
| C | Server-Betrieb per Docker Compose + Server-Auto-Update | später |
| D | Externe CouchDB statt eingebettetem `express-pouchdb` | später |

## 2. Getroffene Entscheidungen

| # | Frage | Entscheidung |
|---|---|---|
| 1 | Client-Plattformen | Windows, Linux, macOS |
| 2 | Build | GitHub Actions (echte Win-/Linux-/Mac-Runner); Ablage als GitHub-Release am Versions-Tag, nicht als Binärdatei im Git |
| 3 | Pipeline | Unit + `test:e2e` + `test:e2e:sync` + `test:e2e:cluster` bei jedem Push/PR; bei Tag `v*` zusätzlich Build aller Plattformen und Release. `test:e2e:vollablauf` nicht in CI (schreibt in die Cloud-DB) |
| 4 | Client-Architektur | Electron-Main-Prozess startet den bestehenden Node-Client-Dienst (`src/app.js` mit `SYNC_ROLLE=client`) auf localhost; das Fenster lädt `client.html`. Keine PouchDB im Renderer, kein CORS |
| 5 | Updater | Eigener Updater (kein `electron-updater`, da dieser auf macOS eine bezahlte Apple-Signatur verlangt) mit Ed25519-Signaturprüfung |
| 6 | Versionskopplung | Client-Version = Server-Version (ein Tag baut beides). Update bei jeder **Abweichung**, auch nach unten (Zurückrollen des Servers zieht die Clients mit) |
| 7 | `SYNC_SECRET` für neue Clients | Kopplungscode beim allerersten Start; Code nur auf `matten.html` (Login) sichtbar |
| 8 | Server-Geheimnis | Ohne `SYNC_SECRET` in der `.env` erzeugt der Server es selbst und speichert es; im Cluster weiter per `.env` (beide Server gleich) |
| 9 | IDs offline | Unverändert UUIDs (nicht `judoka_<zeitstempel>_<name>` wie in der Ausgangsspezifikation) |

## 3. Bausteine Client (`desktop/`)

Gebaut mit electron-builder aus dem Repo-Root (Konfiguration `desktop/electron-builder.yml`), damit
`src/`, `public/` und die Produktions-`node_modules` mitkommen. Electron-Main als ES-Modul.

| Datei | Aufgabe |
|---|---|
| `desktop/main.js` | Startablauf (Abschnitt 4), Fenster, Einzelinstanz-Sperre (`requestSingleInstanceLock`) |
| `desktop/serverSuche.js` | mDNS-Suche nach `_hajime._tcp` über `bonjour-service` (unabhängig davon, ob das Betriebssystem `.local` auflöst); Auswahl bei mehreren Treffern (TXT `rolle=master` bevorzugt, Gegenprobe `/api/cluster/status`) |
| `desktop/updater.js` | Versionsprüfung, Download, sha256 + Signatur, plattformspezifischer Austausch, Schleifenschutz |
| `desktop/updateLogik.js` | reine Funktionen (Versionsvergleich, Plattformdatei-Auswahl, Signaturprüfung, Schleifenschutz-Entscheidung) — Unit-getestet |
| `desktop/kopplung.js` + `kopplung.html` | Kopplungscode-Eingabe, Tausch gegen das Geheimnis |
| `desktop/einstellungen.js` | Persistenz in `app.getPath('userData')/einstellungen.json`: `serverUrl`, `secret`, `clientId`, Update-Versuche |
| `desktop/startfenster.html` | „Suche Server …“, Update-Fortschritt, Hinweise |
| `desktop/linuxIntegration.js` | Linux: `.desktop`-Datei + Schreibtisch-Verknüpfung beim ersten Start |
| `desktop/update-schluessel.pub` | öffentlicher Ed25519-Schlüssel, in die App eingebaut |
| `desktop/README.md` | Build, Einrichtung Schlüssel/Secret, manuelle Update-Checkliste je Plattform |

Das lokale `SYNC_DATENVERZEICHNIS` liegt unter `userData/dokumente` — außerhalb des
Programmordners, damit ein Update die lokale PouchDB (inkl. nicht übertragener Änderungen) nie
berührt.

## 4. Startablauf

1. Startfenster „Suche Server …“, mDNS-Suche höchstens ca. 5 s.
2. **Server gefunden** → `GET <server>/api/client/version` (Zeitlimit 3 s). Version ≠
   `app.getVersion()` → Update (Abschnitt 6), danach Neustart; sonst weiter.
3. **Nicht gekoppelt** (kein `secret` gespeichert) → Kopplungsdialog (Abschnitt 5.4).
4. Umgebung setzen: `SYNC_ROLLE=client`, `SYNC_SERVER_URL` (gefunden oder zuletzt gespeichert),
   `SYNC_SECRET`, `SYNC_DATENVERZEICHNIS`, `PORT` (freier localhost-Port), dann
   `await import('../src/app.js')` — unverändert.
5. Hauptfenster lädt `http://localhost:<port>/client.html`. Kamera (Waage) über
   `session.setPermissionRequestHandler` für localhost freigegeben; macOS:
   `NSCameraUsageDescription` im Build.
6. **Kein Server gefunden** → Start mit der gespeicherten Adresse, offline weiter; die Suche läuft im
   Hintergrund weiter. Beim allerersten Start ohne Kopplung: Hinweis „Kein Turnier-Server gefunden –
   WLAN prüfen“, Suche läuft weiter, kein Start ohne Kopplung.

### Änderung am bestehenden Client-Dienst

`clientDienst.setzeServerUrl(url)` stellt die laufende Replikation (`replikation.js`) auf eine neue
Server-Adresse um (alte Replikation abbrechen, neue mit derselben lokalen DB starten; nicht
übertragene Änderungen bleiben lokal und werden nachrepliziert). Die Electron-Hülle ruft es auf,
wenn die Verbindung länger als 10 s fehlt und die Hintergrundsuche einen anderen Master findet
(z. B. nach Übernahme im Cluster). Ohne Electron (heutige Client-Geräte mit `.env`) ändert sich
nichts.

## 5. Server-Seite

### 5.1 mDNS-Ankündigung (`src/sync/ankuendigung.js`)

- Nur bei `SYNC_ROLLE=server`. Dienst `_hajime._tcp`, Port = `PORT`, Host `<MDNS_NAME>.local`
  (Standard `turnier`), TXT `version`, `knoten`, `rolle`.
- Ohne Cluster: kündigt immer an. Mit Cluster: nur der Master; `clusterDienst` startet/stoppt die
  Ankündigung bei Beförderung/Rückstufung.
- Port-80-Weiterleitung: zusätzlicher Mini-Listener auf Port 80, der auf `:<PORT>` umleitet
  (für `turnier.local/download`). Schlägt das Öffnen fehl (fehlende Rechte), wird es geloggt und
  ignoriert — alles funktioniert weiter unter `turnier.local:<PORT>/download`. `deploy/linux/`:
  systemd `AmbientCapabilities=CAP_NET_BIND_SERVICE`.

### 5.2 Client-Dateien

- Ablage `data/client-downloads/<version>/` (in `.gitignore`):
  - `Hajime-Pro-Setup-<v>.exe` (Windows, NSIS)
  - `Hajime-Pro-<v>-universal.dmg` (macOS, Erstinstallation)
  - `Hajime-Pro-<v>-universal-mac.zip` (macOS, Update)
  - `Hajime-Pro-<v>.AppImage` (Linux)
  - `version.json`: `{ version, dateien: { "win32-x64": { datei, sha256, signatur }, "darwin-universal": { install, update: { datei, sha256, signatur } }, "linux-x64": {…} } }`
- Statisch unter `/downloads/<version>/…`; es wird nur der Ordner zur aktuellen
  `package.json`-Version angeboten.
- `npm run client:holen` (`scripts/hole-client-release.mjs`): lädt das GitHub-Release zur
  `package.json`-Version, prüft Signaturen, legt die Dateien ab. Später ruft Teilprojekt C das beim
  Server-Auto-Update auf.

### 5.3 Endpunkte / Seiten

| Endpunkt | Zugriff | Inhalt |
|---|---|---|
| `GET /download` | öffentlich | `public/download.html`: Betriebssystem per User-Agent erkennen, passende Datei groß, übrige darunter; Kurzanleitung Mac (einmalig „Trotzdem öffnen“) und Linux (`libfuse2`-Einzeiler); Hinweis, wenn für die Serverversion keine Client-Dateien vorliegen |
| `GET /api/client/version` | öffentlich | `version.json` der aktuellen Version (404, wenn keine vorliegt) |
| `POST /api/client/koppeln` | öffentlich, rate-limitiert | `{ code, clientId }` → `{ secret }`; 5 Fehlversuche/Minute/IP, danach Sperre mit Restzeit |
| `GET /api/client/kopplungscode` | Login (Turnierleitung) | aktueller Code |
| `POST /api/client/kopplungscode/erneuern` | Login (Turnierleitung) | neuer Code |

Alle neuen Routen im Factory-Muster (`src/routes/clientRoutes.js`, `getClientRoutes(…)`), nur bei
`SYNC_ROLLE=server` gemountet.

### 5.4 Kopplung und Geheimnis (`src/sync/kopplung.js`)

- `SYNC_SECRET` gesetzt → wird verwendet. Nicht gesetzt → beim ersten Start erzeugt (32 Byte,
  zufällig) und in `<SYNC_DATENVERZEICHNIS>/kopplung.json` gespeichert; `liesSyncKonfig` bzw. der
  Sync-Dienst verwenden dann dieses.
- Code: 6 Ziffern, in derselben Datei, gültig bis zur Erneuerung.
- `matten.html`: Karte „Neues Gerät koppeln: 482 913 [Erneuern]“. Der Code steht **nicht** auf der
  öffentlichen Download-Seite.
- Erneuern ändert nur den Code, nicht das Geheimnis — bereits gekoppelte Clients bleiben gekoppelt.

## 6. Updater

### 6.1 Signatur

- Ed25519 über Node-`crypto` (keine zusätzliche Abhängigkeit). Signiert wird die sha256-Prüfsumme
  jeder Datei zusammen mit Dateiname und Version.
- `npm run client:schluessel` erzeugt das Schlüsselpaar einmalig; öffentlicher Teil nach
  `desktop/update-schluessel.pub` (committet), privater Teil als GitHub-Secret
  `CLIENT_SIGNATUR_SCHLUESSEL`, nur im Job `veroeffentlichen` sichtbar.
- `scripts/signiere-client.mjs` signiert und schreibt `version.json`.
- Falsche Prüfsumme/Signatur → Datei verwerfen, alte Version starten.

### 6.2 Ablauf

1. `GET /api/client/version`; gleich oder keine Antwort → normaler Start.
2. Datei der eigenen Plattform nach `userData/updates/` laden (Fortschritt im Startfenster), prüfen.
3. Schleifenschutz: höchstens 2 Versuche je Zielversion (gezählt in `einstellungen.json`); danach
   Start der alten Version mit Hinweis in der Statusleiste (`syncStatus.js`).

### 6.3 Austausch je Plattform

| | Installation | Update | Desktop-Symbol |
|---|---|---|---|
| Windows | NSIS, `oneClick`, `perMachine: false` → `%LOCALAPPDATA%\Programs\Hajime Pro`, ohne Admin | Installer mit `/S --force-run` starten, App beendet sich; Installer startet die neue Version | `createDesktopShortcut: always` |
| macOS | `.dmg`, App nach „Programme“ ziehen | `.zip` per `ditto -x -k` entpacken; Hilfsskript wartet auf Prozessende, tauscht das `.app`-Bundle, startet per `open` (von der App geladene Dateien tragen kein Quarantäne-Flag) | Programme/Launchpad |
| Linux | `.AppImage` | neue Datei neben `$APPIMAGE` schreiben, `chmod 755`, atomar umbenennen, neu starten | beim ersten Start `~/.local/share/applications/hajime-pro.desktop` + Verknüpfung auf dem Schreibtisch (`xdg-user-dir DESKTOP`) |

### 6.4 Bekannte Grenzen

- Ohne Code-Signatur: Windows-SmartScreen („Trotzdem ausführen“) und macOS-Gatekeeper
  (Systemeinstellungen → Datenschutz → „Trotzdem öffnen“) je einmal bei der Erstinstallation.
- macOS: Läuft die App aus dem `.dmg` oder einem schreibgeschützten Ort (App Translocation), kein
  Update; Startfenster zeigt „Bitte in Programme verschieben“.
- Linux: Ubuntu ≥ 22.04 braucht einmalig `libfuse2` (bzw. `libfuse2t64`), sonst startet das AppImage
  nicht — Hinweis auf der Download-Seite. Sandbox-Sperre (Ubuntu ≥ 24.04) per
  `executableArgs: ["--no-sandbox"]`.
- Das Zurückrollen auf eine ältere, gültig signierte Version ist bewusst erlaubt (Versionskopplung).

## 7. Pipeline (`.github/workflows/`)

### `ci.yml` — bei jedem Push/PR, auch als wiederverwendbarer Workflow (`workflow_call`)

| Job | Runner | Inhalt |
|---|---|---|
| `unit` | ubuntu-latest | `npm ci`, `npm run test:unit` |
| `e2e` | ubuntu-latest | `npx playwright install --with-deps chromium`, `npm run test:e2e` |
| `e2e-sync` | ubuntu-latest | `npm run test:e2e:sync` |
| `e2e-cluster` | ubuntu-latest | `npm run test:e2e:cluster` |

Alle E2E-Jobs installieren vorher Chromium (`npx playwright install --with-deps chromium`).
Parallel, je frische Maschine. Bei Fehlschlag Upload von Playwright-Report/Traces und
`data/test-cluster/logs/` als Artefakt.

### `release.yml` — bei Tag `v*`

1. `tests`: ruft `ci.yml` auf.
2. `pruefen`: Tag == `v` + `package.json`-Version, sonst Abbruch.
3. `build` (Matrix `windows-latest`, `ubuntu-latest`, `macos-latest`): `npm ci`,
   `npx electron-builder install-app-deps`, `npx electron-builder --config desktop/electron-builder.yml`,
   Electron-Rauchtest (Abschnitt 8), Upload als Artefakt.
4. `veroeffentlichen` (ubuntu): Artefakte sammeln, signieren, `version.json` erzeugen, GitHub-Release
   zum Tag mit allen Dateien anlegen.

Release-Ablauf für den Entwickler: `npm version <patch|minor|major>`, `git push --follow-tags`.

## 8. Fehlerfälle

| Situation | Verhalten |
|---|---|
| Kein Server beim Start | nach ~5 s Start mit gespeicherter Adresse, offline; Hintergrundsuche |
| Kein Server beim allerersten Start | „Kein Turnier-Server gefunden – WLAN prüfen“, weitersuchen |
| Falscher Kopplungscode | Meldung, erneute Eingabe; Sperre mit angezeigter Wartezeit |
| Replikation meldet 401 (anderer Server/anderes Geheimnis) | einmalig erneut Kopplungscode abfragen statt stumm zu scheitern |
| Download/Signatur fehlerhaft | verwerfen, alte Version starten (Schleifenschutz) |
| Mehrere Ankündigungen | TXT `rolle=master` bevorzugen, Gegenprobe `/api/cluster/status` |
| Master-Wechsel im Betrieb | nach 10 s ohne Verbindung neue Suche, `setzeServerUrl()` |
| Server hat keine Client-Dateien für seine Version | `/api/client/version` 404 → Client startet ohne Update; Download-Seite zeigt Hinweis |

## 9. Tests

- **Unit** (`tests/unit/`): `updateLogik.js` (Versionsvergleich, Plattformdatei-Auswahl,
  Signaturprüfung inkl. manipulierter Datei, Schleifenschutz), Code-Sperre aus `kopplung.js`,
  Serverauswahl bei mehreren Ankündigungen.
- **Sync-Suite** (`tests/e2e-sync/`, da die neuen Routen nur bei `SYNC_ROLLE=server` gemountet
  sind): `/download` (User-Agent-Erkennung), `/api/client/version` mit Fixture-`version.json`,
  `/api/client/koppeln` (richtig/falsch/Sperre), Kopplungskarte auf `matten.html` inkl. Erneuern,
  `setzeServerUrl()` am laufenden Client ohne Datenverlust.
- **Electron-Rauchtest** im `build`-Job je Plattform: Playwright `_electron` startet die gebaute App
  ohne Server, prüft, dass `client.html` offline lädt.
- **Manuell** (Checkliste `desktop/README.md`): echter Selbstaustausch je Plattform (installieren,
  neue Version taggen, Neustart).

## 10. Außerhalb des Umfangs

- Docker-Compose-Serverbetrieb und Server-Auto-Update (Teilprojekt C)
- Externe CouchDB (Teilprojekt D)
- Ersatz von keepalived/VIP durch mDNS für Browser-Zugriffe auf den Server (Rest von Teilprojekt B)
- Code-Signatur mit bezahlten Zertifikaten (Windows/Apple)
- Tablets (Android/iPad)
- Linux arm64, Windows arm64
