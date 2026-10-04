# Hajime Pro Desktop-Client

## Überblick

> **Server-Paket:** Dieses Dokument beschreibt den Desktop-Client (Matte/Waage). Das zweite, getrennte Paket "Hajime Pro Server"
> (`desktop/server/`, Builder-Konfiguration `desktop/electron-builder.server.yml`) macht ein Notebook zum Hallen-Server mit
> eingebetteter Datenbank und Frontend in einem; Rauchtest `npm run test:electron:server`, CI `.github/workflows/server-paket.yml`.

Der Desktop-Client ist eine Electron-Hülle um den bestehenden `src/app.js` — er startet den
Server intern immer mit `BETRIEBSMODUS=client` und bindet ihn per `LISTEN_HOST` nur an `127.0.0.1`
(kein Netzwerkzugriff von außen, nur die eigene Electron-Oberfläche spricht mit ihm). Einstellungen,
Turnier-Dokumente und geladene Updates liegen unter `userData` (`einstellungen.json`, `dokumente/`,
`updates/`) — beim Deinstallieren bleibt dieses Verzeichnis erhalten, außer es wird manuell gelöscht.
Fachlich verhält sich der Client wie das bestehende Client-Gerät (Notebook/Tablet an Matte/Waage,
siehe CLAUDE.md): Replikation und Offline-Kaskade sind unverändert. Neu sind der Start (Electron),
die Serversuche per mDNS (`_hajime._tcp`, bevorzugt die Absenderadresse der Antwort; findet sie
nach ~15 s nichts oder ist der Server beim Koppeln nicht erreichbar, bietet das Startfenster die
manuelle Eingabe der Server-Adresse an, z.B. `192.168.1.10` oder `turnier.local`, ohne Port gilt
3000), die Kopplung per Code statt `.env` und das Selbst-Update. Im Betrieb sucht der Client neu,
wenn der Server > 10 s fehlt oder sich als Secondary meldet (Cluster-Übergabe).

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
3. Die Pipeline testet, prüft die Tag/Version-Übereinstimmung, baut Windows/macOS/Linux **und die Android-App**
   (`android`-Job, signiert mit dem Keystore aus den Secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`,
   `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` — einmalig erzeugen mit `npm run android:schluessel`, siehe `mobil/README.md`),
   signiert alle vier Client-Dateien einmal (`signieren`-Job, `version.json`) und baut danach das **Server-Paket**
   ("Hajime Pro Server", `server-paket.yml`) **mit diesen signierten Client-Dateien im Installer**. Dessen Installer
   (Windows `.exe`, macOS `.dmg`/`.zip` für Apple Silicon, Linux `.AppImage`) hängen mit `SHA256SUMS-Server.txt` am
   selben Release, die Client-Dateien samt `version.json` ebenfalls. Die Server-Installer werden nicht mit dem
   Client-Schema signiert (kein Selbst-Update, Installation von Hand) und stehen nicht in `version.json`.
   Noch offen: Intel-Mac für das Server-Paket.
4. **Am Hallen-Server ist nichts zu tun:** Das Server-Paket kopiert die mitgelieferten Client-Dateien beim ersten Start
   nach `client-downloads/<version>/` (`src/sync/clientDateien.js`, prüft jede Datei gegen die Signatur) — `/download`
   bietet danach Windows, macOS, Linux und Android an, ohne Internet. Ein Server aus dem Quellcode (`deploy/linux/install.sh`,
   Entwicklung) holt sich die Dateien stattdessen aus dem GitHub-Release zur eigenen Version, bei privatem Repository mit
   `CLIENT_RELEASE_TOKEN` (Leserecht auf Releases; `install.sh` übernimmt ihn aus der Umgebung in die `.env`); `CLIENT_AUTO_HOLEN=false`
   schaltet das ab. Manueller Abruf: `npm run client:holen`.

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

1. `.dmg` **in Safari auf einem Apple-Silicon-Mac** von `http://turnier.local/download` (bzw. `http://<server-ip>:3000/download`) laden (nur so
   trägt die Datei das Quarantäne-Flag wie bei Helfern) und öffnen, App-Bundle nach „Programme“ ziehen.
2. Erststart: Gatekeeper blockiert die nur ad-hoc signierte App → Systemeinstellungen →
   Datenschutz & Sicherheit → „Trotzdem öffnen“. Es darf **nicht** „ist beschädigt und kann nicht
   geöffnet werden“ erscheinen (das wäre ein kaputtes Siegel, siehe `identity: "-"` in
   `electron-builder.yml`); zur Kontrolle `codesign --verify --deep --strict "/Applications/Hajime Pro.app"`.
3. Neue Version am Server bereitstellen; Client lädt die `.zip`, entpackt sie, wartet auf
   Prozessende und tauscht das `.app`-Bundle aus.
4. Neustart tauscht die Version aus — kein erneuter Gatekeeper-Dialog, da von der App selbst
   geschriebene Dateien kein Quarantäne-Flag tragen.
5. Gegentest: App direkt aus dem `.dmg` bzw. aus App Translocation heraus starten → Startfenster
   zeigt „Bitte in Programme verschieben“, kein Update-Versuch. Mit einem Standard-Konto ohne
   Schreibrecht auf `/Applications` → Meldung „Keine Schreibrechte im Ordner Programme“.

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

- Ohne Code-Signatur (macOS nur ad-hoc): Windows-SmartScreen („Trotzdem ausführen“) und
  macOS-Gatekeeper (Systemeinstellungen → Datenschutz → „Trotzdem öffnen“) je einmal bei der
  Erstinstallation.
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
- Blockiert das Netz mDNS (WLAN-Client-Isolation, abgelehnte Firewall-Freigabe für UDP 5353),
  findet der Client den Server nicht selbst — dann die Server-Adresse im Startfenster eingeben.
- Server benötigt für mDNS UDP 5353 offen sowie `CAP_NET_BIND_SERVICE` für Port 80
  (Weiterleitung); siehe `deploy/linux/README.md` für die Firewall-/Capability-Einrichtung im
  Hallenbetrieb.
