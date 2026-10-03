# Hajime Pro für Android (Client-Gerät)

Android-App für Handy (Waage: Judopass-QR scannen, wiegen, nachmelden) und Tablet (Matte: Scoreboard,
Mattenleitung, ebenfalls Waage). Sie ist ein Client-Gerät wie der Desktop-Client: Teilnehmerdaten kommen
vom Hallen-Server, alle Änderungen werden lokal gespeichert und übertragen, sobald der Server erreichbar
ist — auch ohne WLAN läuft die Waage weiter.

## Aufbau

- **Capacitor-Hülle** (`mobil/android`): eine WebView, die das Frontend lokal aus der APK lädt
  (`http://localhost`, ein sicherer Kontext — nur so funktionieren Kamera und lokale Datenbank).
- **Web-Verzeichnis** (`mobil/www`, generiert von `scripts/baue-android-www.mjs`): die Client-Seiten aus
  `public/` (`client`, `teilnehmer`, `steuerung`, `kampf`, `anzeige`, `overlay`) plus `src/shared/` und die
  Bibliotheken, die der Server sonst aus `node_modules/` ausliefert. In jede Seite wird `boot.js` eingefügt.
- **Browser-Laufzeit** (`mobil/web/js/mobil/`): ersetzt den Node-Prozess des Desktop-Clients.
  `boot.js` lenkt alle `/api/…`-Aufrufe der Seiten auf `laufzeit.js` um; die Laufzeit nutzt dieselbe
  Client-Logik wie der Node-Client (`src/shared/clientKern.js`: Turnier-DB in IndexedDB, Replikation zum
  Hallen-Server, Turnierwechsel, Mattenwahl, Offline-Kaskade) und dieselbe Lese-API
  (`src/shared/clientAntworten.js`). `datenzugriff.js` schreibt in die lokale DB.
- **Kopplung** (`verbinden.html`): QR-Code auf `matten.html` scannen (oder Adresse + 6-stelligen Code
  eintragen). Der QR-Code ist eine URL `http://<IP>:<Port>/download#code=123456` — mit der Kamera-App
  gescannt öffnet er die Download-Seite, in der App koppelt er das Gerät (`src/shared/kopplungsQr.js`).
- **Server-Seite:** `src/middleware/appCors.js` erlaubt der App-Herkunft (`localhost`) den Zugriff auf
  `/db`, den Status, die Kopplung und die Version (für `/db` gilt weiterhin das `SYNC_SECRET`).
  `/download` bietet die APK an (`version.json`, Plattform `android`).

## Bauen

Voraussetzungen: Node.js, JDK 21, Android-SDK (Plattform 36; `ANDROID_HOME` setzen oder es liegt unter
`%LOCALAPPDATA%\Android\Sdk` bzw. `~/Android/Sdk`).

```bash
npm run android:apk
```

erzeugt `dist-android/Hajime-Pro-<version>.apk` (Version = `package.json`, wie Server und Desktop-Client).
Ohne Signaturschlüssel entsteht eine **Debug-APK**: installierbar, aber mit dem Debug-Schlüssel signiert —
eine spätere, anders signierte Version lässt sich nicht darüber installieren. Für den Einsatz eine
**Release-APK** mit eigenem, dauerhaft aufbewahrtem Schlüssel bauen:

```bash
keytool -genkeypair -v -keystore hajime-android.jks -alias hajime -keyalg RSA -keysize 2048 -validity 10000
export HAJIME_KEYSTORE=$PWD/hajime-android.jks HAJIME_KEYSTORE_PASSWORD=… HAJIME_KEY_ALIAS=hajime HAJIME_KEY_PASSWORD=…
npm run android:apk
```

Nur das Web-Verzeichnis neu bauen: `npm run android:www`.

## Installation auf den Geräten

Am Hallen-Server ist nichts einzurichten: Die signierte APK gehört zu den Client-Dateien, die das Server-Paket mitbringt
(bzw. ein Server aus dem Quellcode aus dem GitHub-Release holt) — siehe `desktop/README.md`, Abschnitt Release, und
`src/sync/clientDateien.js`. Ein Android-Gerät im Turnier-WLAN scannt den QR-Code auf `matten.html` (oder öffnet
`http://<Server-IP>:3000/download`), lädt die APK und installiert sie (einmalig „Aus dieser Quelle zulassen“).

### Release-Signatur einmalig einrichten (GitHub-Secrets)

`release.yml` baut die APK im Job `android` und bricht ab, solange der Keystore fehlt. Einmalig:

```bash
npm run android:schluessel
```

erzeugt `android-schluessel/hajime-android.jks` und gibt die vier Werte aus, die als Secrets im GitHub-Repository
eingetragen werden: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.
Den Keystore und das Passwort sicher aufbewahren (nicht ins Repository): Alle späteren Versionen müssen mit demselben
Schlüssel signiert sein, sonst lässt sich eine neue APK nicht über die alte installieren.

## Tests

`npm run test:e2e:mobil` (`playwright.mobil.config.js`, `tests/e2e-mobil/`): baut das Web-Verzeichnis,
liefert es unter einer eigenen Herkunft aus (`http://localhost:3401`) und prüft es gegen einen echten
Hallen-Server (3400): Kopplung, Laden der Turnierdaten, Waage ohne Verbindung mit anschließender
Übertragung, Mattenwahl, Kämpfe der Matte aus den lokalen Daten, QR-Code und Download-Seite. Ohne
gebündelten Chromium: `HAJIME_PW_CHANNEL=msedge` (oder `chrome`). Die Suite prüft die Web-Schicht im
Browser — die gebaute APK selbst wird nicht auf einem Gerät/Emulator ausgeführt.

## Grenzen

- **iOS** gibt es nicht (Apple erlaubt keine Installation aus dem Browser; TestFlight/App Store wären nötig).
- **Serversuche per mDNS** fehlt: Android löst `turnier.local` in Apps nicht zuverlässig auf, deshalb
  koppelt der QR-Code über die IP-Adresse. Ändert sich die IP des Servers, muss das Gerät neu gekoppelt
  werden („Mit anderem Hallen-Server koppeln“ auf der Startseite).
- **Updates** laufen von Hand: weicht die Serverversion von der App ab, zeigt die Statusleiste einen
  Hinweis; die neue APK lädt man über `/download` und installiert sie über die alte.
- Die Seiten sind Einzelseiten: die Replikation startet bei jedem Seitenwechsel neu (Fortsetzung ab dem
  letzten Stand, nicht übertragene Änderungen bleiben erhalten).
