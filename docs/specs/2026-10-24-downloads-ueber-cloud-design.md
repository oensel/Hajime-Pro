# Downloads über den Cloud-Server (Entwurf)

Stand: 2026-10-24 · Status: **umgesetzt** (Cloud-Spiegel, Seite „Downloads“, Geräteschlüssel, Einlösecode im Installer-Dateinamen, GitHub-kompatible Fassade, Quellenwahl der Updates, Pipeline). Offen: der Windows-Installer mit Code im Dateinamen ist noch nicht auf einem echten Windows-Build erprobt (Abschnitt „Offen“, Punkt 3).

Entschieden: (1) Variante A, die Dateien bleiben im privaten Repo, die Cloud holt sie mit einem Lese-Token. (2) Berechtigt sind Rolle `benutzer`, `admin` und Super-Admin (im Super-Admin-Modus); Benutzer-Mitgliedschaft **und** Verein müssen freigeschaltet sein, das gilt bei jedem Abruf. (3) Das Auto-Update bleibt bestehen und verlangt im Betrieb kein Eingreifen (siehe 2, „Maschinen“).

## Ausgangslage

- Die Release-Pipeline (`.github/workflows/release.yml`, Job `veroeffentlichen`) legt Installer und Update-Pakete im **öffentlichen** Repository `oensel/Hajime-Pro-Releases` ab (Secret `RELEASES_REPO_TOKEN`).
- Alles, was Software holt, spricht GitHub an, **ohne Anmeldung** und teils mit der GitHub-API-Form (`releases/latest`, `releases/tags/vX`, Assets mit `url`):
  - Windows-Hallen-Server beim Start: `desktop/server/selbstUpdate.js`
  - Linux-Dienst/Cluster: `src/utils/dienstUpdate.js`, `src/cluster/updateDienst.js`, `deploy/linux/holen.sh`, `update.sh`
  - Cloud-Server selbst: `src/utils/cloudUpdate.js`, `scripts/cloud-update.mjs`
  - Client-Dateien auf dem Hallen-Server: `src/sync/clientDateien.js`, `scripts/hole-client-release.mjs`
- Desktop-Clients und Android-App holen ihre Updates **vom Hallen-Server** (`/downloads/<version>/…`, LAN), nicht von GitHub. Das bleibt unverändert.
- Alle Dateien sind per Ed25519 signiert (`desktop/update-schluessel.pub`), Prüfsummen liegen in `version.json`, `server-version.json`, `SHA256SUMS-Server.txt`.

## Ziel

Die Cloud ist die einzige Quelle für Installer und Updates. Nur angemeldete, freigeschaltete Benutzer laden herunter. Das öffentliche Repository entfällt.

**Nicht-Ziele:** Änderungen an der Verteilung im Hallen-LAN (Hallen-Server → Clients), neue Signaturverfahren, ein eigenes Lizenzmodell, macOS (bleibt wie bisher draußen).
**Anti-Ziel:** Ein Hallen-Server, der heute automatisch aktualisiert, darf nicht stillschweigend „für immer“ auf seiner Version hängen bleiben, ohne dass jemand es erfährt.

## Entwurf

### 1. Wie die Dateien in die Cloud kommen (meine Empfehlung: Variante A)

**A – Cloud holt (Pull).** Die Pipeline legt das Release im **privaten** Repository selbst an (`gh release create` mit dem normalen `GITHUB_TOKEN`, Job hat `contents: write` schon; `RELEASES_REPO_TOKEN` und das öffentliche Repo entfallen). Die Cloud bekommt ein nur lesendes Token (`RELEASE_QUELLE_TOKEN`, fine-grained, *Contents: read*) und spiegelt ein neues Release nach `RELEASE_VERZEICHNIS` (Standard `./data/releases/<version>/`): alle Assets, jede Datei gegen die vorhandene Signatur/Prüfsumme geprüft (Logik aus `clientDateien.js` wiederverwendbar), `version.json` zuletzt (atomar, wie bisher). Auslöser: stündliche Prüfung plus Knopf „Neue Version übernehmen“ auf `server-update.html` (Super-Admin, `X-2FA-Code` wie bei den Sicherungen). Kein Upload-Endpunkt, keine Größenlimits am Reverse-Proxy, kein CI-Secret mit Schreibrecht auf die Cloud.

**B – Pipeline schiebt (Push).** `POST /api/releases/ingest` mit einem CI-Token, mehrere hundert MB pro Release durch den Proxy. Nur sinnvoll, wenn die Cloud GitHub gar nicht erreichen soll. Mehr bewegliche Teile, daher nicht empfohlen.

Aufbewahrung: die neuesten `RELEASE_BEHALTEN` Versionen (Standard 3), ältere werden gelöscht. Die Cloud-Selbstaktualisierung (`cloudUpdate.js`) liest ihr Dienst-Paket danach aus diesem Verzeichnis statt von GitHub.

### 2. Wer darf was laden

Zwei Wege, derselbe Dateispeicher:

**Menschen im Browser.** Neue Seite `downloads.html` (Menüpunkt „Downloads“, nur Cloud) mit Gruppen *Hallen-Server* (Windows-Installer, Linux-Paket, Hol-Skript), *Client-Geräte* (Windows, Linux, Android-APK), Version, Größe, SHA-256, kurzer Installationshinweis. Zugriff: bestätigtes, nicht gesperrtes Konto mit **Rolle ab `benutzer` in mindestens einem Verein, in dem Mitgliedschaft und Verein freigeschaltet sind**, oder Super-Admin im Super-Admin-Modus. Helfer sehen die Seite nicht (Menüpunkt über `menueFuerRolle`). Weil das JWT im Browser liegt und ein Download-Link keinen Header senden kann: `POST /api/downloads/ticket { datei }` liefert einen **einmaligen, 60 s gültigen** Link `/api/downloads/datei/<ticket>` (HMAC, gebunden an Benutzer und Datei); dieser streamt mit `Range`-Unterstützung (Wiederaufnahme bei großen Installern). Jeder Ticketabruf steht automatisch im Aktionsprotokoll (POST mit Benutzer, Zeit, Datei).

**Maschinen (Auto-Update, Hol-Skript).** Ein unbeaufsichtigter Hallen-Server kann sich nicht per Passwort/2FA anmelden, braucht aber bei jedem Start ein Credential. Damit **niemand etwas eintragen muss**, entsteht es als Nebenprodukt einer Anmeldung, die es ohnehin gibt: der **Geräteschlüssel**.

- Ersteinrichtung/„Turnier aus der Cloud holen“ (`cloudRoutes.js`, Anmeldung mit Cloud-Benutzer, existiert bereits): meldet sich ein berechtigter Benutzer an, holt der Hallen-Server dabei mit dessen Token einen Geräteschlüssel (`POST /api/downloads/geraet`) und legt ihn im Datenverzeichnis ab (`data/release-schluessel`, Rechte 600; Windows-Server: Profilordner). Das Passwort wird weiterhin nie gespeichert. Beim Linux-Dienst/Cluster ohne Oberfläche geschieht dasselbe einmal bei der Installation (`install.sh` fragt Cloud-Benutzer/-Passwort ab, das Hol-Skript braucht es ohnehin zum Laden des Pakets); alternativ gibt die Downloads-Seite einen Installationsbefehl mit eingebautem Schlüssel aus.
- **Neuinstallation ganz ohne Schritt (Einlösecode im Dateinamen):** Wer den Server-Installer auf `downloads.html` lädt, bekommt ihn unter einem persönlichen Dateinamen, z. B. `Hajime-Pro-Server-Setup-1.2.3.k7Hq9x2Lm4.exe` (Header `Content-Disposition` des Tickets). Der Teil `k7Hq9x2Lm4` ist ein **Einlösecode**: einmalig verwendbar, 14 Tage gültig, nur der SHA-256 liegt in der Cloud (Tabelle `download_einloesecodes`, `benutzer_id`, `benutzt_am`), er kann nichts außer „gegen einen Geräteschlüssel tauschen“. Die Signatur deckt nur den Dateiinhalt ab; der Dateiname ändert weder Prüfsumme noch Ed25519-Prüfung. Der NSIS-Installer liest seinen eigenen Dateinamen (eigenes Include-Skript in `electron-builder.server.yml`, `$EXEFILE`) und legt den Code im Datenverzeichnis ab; beim ersten Serverstart tauscht der Server ihn gegen den Geräteschlüssel (`POST /api/downloads/einloesen`), löscht die Datei und fährt fort. Beim Linux-Paket genauso (Dateiname bzw. der vom Downloads-Seite erzeugte Installationsbefehl `curl … | sudo CODE=… bash`). Scheitert das Einlösen (Code abgelaufen, Datei umbenannt, offline), fällt der Server auf die Anmeldung über „Turnier aus der Cloud holen“ zurück; kein Fehler, nur der Hinweis aus Abschnitt 5. Verworfen: Zone.Identifier (Herkunfts-URL, die Windows an Browser-Downloads hängt) als Träger, weil browser- und dateisystemabhängig; ein Sidecar bzw. ZIP, weil der Benutzer es platzieren müsste.
- Ab dann arbeiten alle Update-Pfade (Start-Update Windows, Dienst-Update, Cluster-Update, Client-Dateien) mit diesem Schlüssel, ohne Zutun.
- Der Schlüssel ist an den **Benutzer** gebunden, der ihn ausgelöst hat (Tabelle `download_schluessel`: nur SHA-256, `benutzer_id`, `bezeichnung`, `erstellt_am`, `zuletzt_benutzt_am`, `widerrufen_am`). **Bei jedem Abruf** prüft die Cloud erneut: Konto bestätigt, nicht gesperrt, Mitgliedschaft freigegeben mit Rolle ab `benutzer`, Verein freigegeben (Super-Admins zählen nur mit aktivem Super-Admin-Modus bzw. ihrer Vereinsrolle nach denselben Regeln). Wird jemand gesperrt, entfernt oder der Verein gesperrt, endet auch der Geräteschlüssel; ein neuer entsteht bei der nächsten Anmeldung eines berechtigten Benutzers. Ein Schlüssel erlaubt nur lesenden Zugriff auf Release-Liste und Dateien.
- Admins/Super-Admins sehen auf `downloads.html` alle Geräteschlüssel ihrer Vereine (letzte Nutzung) und können sie widerrufen.
- Offline-Fall unverändert: ohne Verbindung zur Cloud startet der Server mit der vorhandenen Version (wie heute bei fehlendem GitHub).
- Gesendet wird der Schlüssel als `Authorization: Bearer …`; er ersetzt die bisherigen `CLIENT_RELEASE_TOKEN`/`GITHUB_TOKEN`-Stellen.

Ratenbegrenzung für Ticket/Schlüssel (nur Fehlversuche zählen, wie bei `/api/live`); Antworten für Unberechtigte immer 401/403 ohne Hinweis auf vorhandene Versionen.

### 3. GitHub-kompatible Fassade

Die Update-Clients zerlegen die GitHub-Antwort (`tag_name`, `assets[].name|url`). Statt alle Verbraucher umzuschreiben, liefert die Cloud unter `/api/releases/v1/` dieselben Formen (`GET /latest`, `GET /tags/v<version>`, Asset-URLs auf `/api/releases/v1/assets/<id>` mit Bearer-Schlüssel). Die Verbraucher bekommen nur eine konfigurierbare Basis (`apiBasis` gibt es in `selbstUpdate.js` und `clientDateien.js` bereits) und den Schlüssel. `holen.sh` ersetzt die `github.com/…/releases/latest`-Weiterleitung durch `GET /latest` der Fassade.

Ergebnis: Signaturprüfung, Wiederaufnahme, Versuchszähler und alle Tests der Update-Logik bleiben unverändert; die Cloud könnte auch keine manipulierte Datei einschleusen, weil der Ed25519-Schlüssel nur in der Pipeline liegt.

### 4. Konfiguration (neu)

| Variable | Ort | Bedeutung |
|---|---|---|
| `RELEASE_QUELLE_REPO` / `RELEASE_QUELLE_TOKEN` | Cloud | privates Repo + Lesetoken für die Spiegelung (Variante A) |
| `RELEASE_VERZEICHNIS`, `RELEASE_BEHALTEN` | Cloud | Ablage, Anzahl Versionen |
| `RELEASE_URL` | nur `holen.sh` (Linux-Installationsbefehl) | Eingabe des Skripts; im Server gilt ausschließlich `CLOUD_URL` |
| `RELEASE_SCHLUESSEL` | Hallen-Server/Dienst | Download-Schlüssel |

`CLIENT_RELEASE_REPO` entfällt nach der Übergangszeit.

### 5. Umstellung ohne Bruch

1. **Release N:** Cloud-Speicher, Endpunkte, Seite, Schlüssel; Verbraucher können die Cloud als Quelle nutzen. Die Pipeline veröffentlicht noch **zusätzlich** im öffentlichen Repo, damit installierte ältere Server N dort finden.
2. **Ab N:** Standardquelle der Verbraucher ist die Cloud. Hallen-Server ohne Geräteschlüssel starten normal und zeigen „Für Updates einmal bei der Cloud anmelden (Turnier aus der Cloud holen)“ (Konsole, `cluster.html`, Startfenster), statt still zu scheitern. Release N selbst holt sich jeder Bestandsserver noch aus dem öffentlichen Repo.
3. **Erst wenn Bastian bestätigt, dass seine bestehenden Installationen umgestellt sind** (jede hat einen Geräteschlüssel; die Cloud zeigt `zuletzt_benutzt_am` je Schlüssel): öffentliches Repo und `docs/releases-repo-README.md` löschen, `RELEASES_REPO_TOKEN` entfernen, Texte in `CLAUDE.md`, `docs/betrieb.md`, `desktop/README.md`, `deploy/linux/*` anpassen.

### 6. Betrieb und Grenzen

- Plattenbedarf grob 3 Versionen × (Windows-Server + Windows-Client + Linux-Server + Linux-Client + APK + Dienst-Paket), im Volume der Cloud (Docker: Volume ergänzen, Sicherung schließt `data/releases` **nicht** ein, das lässt sich jederzeit neu spiegeln).
- Bandbreite: Downloads laufen über den Cloud-Server; falls das knapp wird, später Auslieferung durch den Reverse-Proxy (X-Accel-Redirect/`sendfile`) bei gleicher Berechtigungsprüfung.
- „Nur registrierte Benutzer“ ist so stark wie die Registrierung: wer sich selbst registriert, ist bestätigt, aber erst mit Vereinsfreigabe (Rolle ab `benutzer`) kommt er an die Installer. Die Dateien sind außerdem ohne Hallen-Zugang wenig nützlich (Server braucht Turnierdaten), aber geheim im Sinne eines Schutzes des Quellcodes sind sie nicht.

## Dem Builder überlassen

Dateinamen und Form der Seite, Tabellenmigration, Reihenfolge der Spiegelung, Fehlermeldungen, Tests (Vorbilder: `tests/unit/clientDateien*.test.js`, `fake-cloud.mjs`; E2E: Berechtigungen, Ticket nur einmal gültig, Schlüssel widerrufen, Range-Abruf, Spiegelung mit gefälschter Quelle).

## Offen

1. **Bestandsserver:** Ein Server, der schon installiert ist und nie einen Geräteschlüssel bekommen hat, kann nach der Umstellung nicht mehr automatisch aktualisieren, bis sich einmal ein berechtigter Benutzer an der Cloud anmeldet (am einfachsten über „Turnier aus der Cloud holen“; bei Release N zeigt der Server dafür einen Hinweis). Das lässt sich ohne ein Credential nicht vermeiden. Ein Hallen-Server, der nie die Cloud sieht, bleibt auf seiner Version. Entwurf: akzeptiert.
2. **Linux-Dienst:** Befehl mit Einlösecode von der Downloads-Seite (Entwurf) statt Anmeldung in `install.sh`; `install.sh` fragt nur nach, wenn kein Code vorliegt.
3. **Windows-Installer:** ob das Auslesen des Dateinamens im NSIS-Skript mit dem verwendeten electron-builder-Setup (`oneClick`, silent) sauber funktioniert, muss die Umsetzung zuerst in einem kleinen Test klären; sonst Rückfall auf die Anmeldung.
