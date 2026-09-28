# Hajime Pro Desktop-Client

## Überblick

Der Desktop-Client ist eine Electron-Hülle um den bestehenden `src/app.js` — er startet den
Server intern immer mit `SYNC_ROLLE=client` und bindet ihn per `LISTEN_HOST` nur an `127.0.0.1`
(kein Netzwerkzugriff von außen, nur die eigene Electron-Oberfläche spricht mit ihm). Einstellungen,
Turnier-Dokumente und geladene Updates liegen unter `userData` (`einstellungen.json`, `dokumente/`,
`updates/`) — beim Deinstallieren bleibt dieses Verzeichnis erhalten, außer es wird manuell gelöscht.
Fachlich verhält sich der Client wie das bestehende Client-Gerät (Notebook/Tablet an Matte/Waage,
siehe CLAUDE.md): mDNS-Serversuche, Kopplung und Offline-Kaskade sind unverändert, nur Start,
Serversuche und Selbst-Update sind neu.

## Einmalige Einrichtung (Entwickler)

Der Updater prüft jede heruntergeladene Datei gegen eine Ed25519-Signatur. Ohne Schlüsselpaar
funktioniert kein Selbst-Update — das muss **einmalig vor dem ersten Release** eingerichtet werden:

1. `npm run client:schluessel` ausführen. Das Skript schreibt den öffentlichen Schlüssel nach
   `desktop/update-schluessel.pub` und gibt den privaten Schlüssel (PEM) einmalig auf der
   Konsole aus.
2. `desktop/update-schluessel.pub` committen.
3. Den privaten Schlüssel auf GitHub hinterlegen: *Settings → Secrets and variables → Actions →
   New repository secret*, Name `CLIENT_SIGNATUR_SCHLUESSEL`, Wert = die komplette PEM-Ausgabe
   inklusive `-----BEGIN PRIVATE KEY-----` / `-----END PRIVATE KEY-----`.
4. Die Konsolenausgabe danach löschen (Terminal-Scrollback, Zwischenablage) — der private Schlüssel
   existiert ab jetzt nur noch als GitHub-Secret.

**Warnung:** Ein neu erzeugter Schlüssel macht alle bereits installierten Clients update-unfähig
(die Signatur passt nicht mehr zum committeten öffentlichen Schlüssel) — sie müssten neu installiert
werden. `npm run client:schluessel` verweigert deshalb den Lauf, wenn `desktop/update-schluessel.pub`
schon existiert (nur mit `--ueberschreiben` erzwingbar).

Solange `desktop/update-schluessel.pub` fehlt oder das Secret nicht gesetzt ist, bricht der
Release-Workflow (`veroeffentlichen`-Job) mit einer klaren Fehlermeldung ab; bereits gebaute Clients
ohne gültigen öffentlichen Schlüssel überspringen Updates nur mit einer Log-Zeile, statt
abzustürzen.

## Release

1. `npm version patch|minor|major` — erhöht die Version in `package.json` und legt den Git-Tag an.
2. `git push --follow-tags` — löst `release.yml` aus.
3. Die Pipeline testet, prüft die Tag/Version-Übereinstimmung, baut Windows/macOS/Linux, signiert
   die Dateien und veröffentlicht sie als GitHub-Release.
4. Auf dem Hallen-Server die neue Version holen: `git pull && npm ci && npm run client:holen`
   (bei privatem Repository zusätzlich `GITHUB_TOKEN` mit Leserecht auf Releases in der `.env`).

## Lokal entwickeln

- `npm run desktop:start` — Electron-Hülle direkt gegen den lokalen Code starten.
- `npm run desktop:build` — Distributionspakete lokal bauen (`dist-desktop/`).
- `npm run test:electron` — Playwright-Rauchtest gegen die gebaute/gestartete Electron-App
  (`playwright.electron.config.js`).

## Manuelle Update-Checkliste je Plattform

### Windows

1. Alte Version installieren und starten.
2. Neue Version am Hallen-Server bereitstellen (`npm run client:holen` auf dem Server bzw. neues
   Release).
3. Client zeigt den Update-Hinweis, lädt die `.exe` nach `userData/updates/` und prüft die Signatur.
4. Installer wird mit `--force-run` (ohne `/S`) gestartet — das Installer-Fenster ist sichtbar, die
   laufende App beendet sich, der Installer installiert die neue Version und startet sie.
5. Prüfen: Installation liegt weiterhin unter `%LOCALAPPDATA%\Programs\hajime-pro` (nicht
   `Hajime Pro`), Desktop-Verknüpfung funktioniert weiter, keine Admin-Rechte nötig.

### macOS

1. `.dmg` installieren: Öffnen, App-Bundle nach „Programme“ ziehen.
2. Erststart: Gatekeeper blockiert die unsignierte App → Systemeinstellungen →
   Datenschutz & Sicherheit → „Trotzdem öffnen“.
3. Neue Version am Server bereitstellen; Client lädt die `.zip`, entpackt sie, wartet auf
   Prozessende und tauscht das `.app`-Bundle aus.
4. Neustart tauscht die Version aus — kein erneuter Gatekeeper-Dialog, da von der App selbst
   geschriebene Dateien kein Quarantäne-Flag tragen.
5. Gegentest: App direkt aus dem `.dmg` bzw. aus App Translocation heraus starten → Startfenster
   zeigt „Bitte in Programme verschieben“, kein Update-Versuch.

### Linux

1. `.AppImage` ausführbar machen und starten; Ubuntu ≥ 22.04 braucht einmalig `libfuse2`
   (bzw. `libfuse2t64`), sonst startet das AppImage nicht.
2. Erststart legt `~/.local/share/applications/hajime-pro.desktop` und eine Schreibtisch-Verknüpfung
   an (`xdg-user-dir DESKTOP`).
3. Neue Version am Server bereitstellen; Client lädt die neue AppImage-Datei, schreibt sie neben
   `$APPIMAGE`, macht sie mit `chmod 755` ausführbar und benennt sie atomar um.
4. Neustart tauscht die Datei aus — das Desktop-Symbol zeigt weiterhin auf denselben Pfad und
   funktioniert unverändert. Die neu gestartete AppImage restartet sich selbst mit `--no-sandbox`
   (Sandbox-Sperre ab Ubuntu ≥ 24.04).

## Bekannte Grenzen

- Ohne Code-Signatur: Windows-SmartScreen („Trotzdem ausführen“) und macOS-Gatekeeper
  (Systemeinstellungen → Datenschutz → „Trotzdem öffnen“) je einmal bei der Erstinstallation.
- macOS: Läuft die App aus dem `.dmg` oder einem schreibgeschützten Ort (App Translocation), kein
  Update; Startfenster zeigt „Bitte in Programme verschieben“.
- Linux: Ubuntu ≥ 22.04 braucht einmalig `libfuse2` (bzw. `libfuse2t64`), sonst startet das AppImage
  nicht — Hinweis auf der Download-Seite. Sandbox-Sperre (Ubuntu ≥ 24.04) per
  `executableArgs: ["--no-sandbox"]`.
- Das Zurückrollen auf eine ältere, gültig signierte Version ist bewusst erlaubt
  (Versionskopplung Client = Server).
- Der reale Dateitausch bei Update auf macOS und Linux (Prozessende abwarten, Bundle/AppImage
  ersetzen, Neustart) ist bisher nicht gegen ein echtes Release getestet — zu prüfen beim ersten
  Release.
- Server benötigt für mDNS UDP 5353 offen sowie `CAP_NET_BIND_SERVICE` für Port 80
  (Weiterleitung); siehe `deploy/linux/README.md` für die Firewall-/Capability-Einrichtung im
  Hallenbetrieb.
