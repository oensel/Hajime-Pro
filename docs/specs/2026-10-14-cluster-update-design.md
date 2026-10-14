# Cluster-Update aus der Oberfläche (cluster.html)

Stand: 2026-10-14 · Status: Entwurf zur Durchsicht

## Ziel

Die Hallen-Server eines Clusters sollen sich über `cluster.html` auf ein neues Release bringen lassen, ohne SSH und ohne
Shell-Befehle, und zwar so, dass die richtige Reihenfolge nicht verfehlt werden kann. Die Turnierleitung sieht die
eingesetzte Version beider Server, erkennt ein neues Release und löst das Update am jeweiligen Server per Knopf aus.

Ein Update ist das **volle Update** (`update.sh`): Code, Datenbankschema, keepalived, systemd-Units, sudoers. Nicht nur der
Anwendungscode wie beim Selbst-Update des Einzelservers.

## Bedienung

### Anzeige

`cluster.html` zeigt je Server (Master und Secondary) die **eingesetzte Version**. Darunter, am Server der Seite selbst,
die **neueste verfügbare Version** (GitHub-Release) und den Zustand der Aktualisierung.

### Wer bekommt den Knopf „Update“

Der Knopf erscheint **nur an dem Server, der aktualisiert wird**, also in der `cluster.html`, die auf diesem Server
geöffnet ist:

| Lage | Knopf am Secondary | Knopf am Master |
|---|---|---|
| Release neuer als der Secondary, Master gleich alt oder neuer | ja | nein |
| Secondary hat eine neuere Version als der Master | nein | ja |
| Beide auf der neuesten Version | nein | nein |
| Partner nicht erreichbar oder Version unbekannt | nein (Hinweis) | nein (Hinweis) |
| Release nicht prüfbar (kein Internet) | nein (Hinweis) | nein (Hinweis) |

Kurz: Es wird immer der **ältere** Server aktualisiert; bei Gleichstand der Secondary. Damit steht der Secondary immer
zuerst auf der neuen Version und nie läuft ein Update auf dem Server, der gerade die VIP hält, ohne dass die andere Seite
bereits aktualisiert ist.

### Ablauf am Secondary

1. Knopf „Update“ (Turnierleitungs-Passwort, wie die Übergabe).
2. Bestätigungsdialog mit Versionssprung und dem Hinweis unten.
3. Der Server sichert die Datenbank und führt das Update aus, die Seite zeigt den Fortschritt (Schritte aus `update.sh`).
4. Der Dienst startet neu, die Seite verbindet sich wieder und zeigt die neue Version.

### Ablauf am Master

Der Master kann seinen Dienst nicht neu starten, ohne dass die Halle ausfällt. Der Knopf am Master löst darum **erst die
geplante Übergabe** aus (wie „Rolle übergeben“: Partner gesund und synchron, die Dokument-DB ist übertragen) und
aktualisiert den Server, **nachdem er zum Secondary geworden ist**. Danach hält der frühere Secondary VIP und Master-Rolle.
Das ist ein normales Rollen-Tauschen, die Hallen-Clients sehen nur die Umschaltung.

Schlägt die Übergabe fehl (Partner nicht gesund, nicht synchron), geschieht nichts, die Meldung nennt den Grund.

### Pflicht-Hinweis: der zweite Server

Weil immer nur ein Server gleichzeitig aktualisiert wird, bleibt der andere zunächst auf der alten Version. Die Seite zeigt
daher an zwei Stellen einen Hinweis:

- **im Bestätigungsdialog vor dem Update:** „Danach muss der andere Server ebenfalls aktualisiert werden. Öffne dazu
  `cluster.html` auf dem anderen Server und klicke dort auf ‚Update‘.“
- **dauerhaft nach dem Update**, solange die Versionen beider Server verschieden sind: „Dieser Server ist auf Version X,
  der andere (Name/IP) noch auf Y. Dort muss das Update von Hand angestoßen werden.“

Es gibt bewusst **keinen automatischen Folgeschritt**: Das Update des zweiten Servers wird immer ausdrücklich ausgelöst.

### Update des Secondary vom Master aus (Aufruf über die VIP)

Ergänzung vom 2026-10-14. Die VIP führt immer zum Master, dem bei gleicher Version kein eigener Update-Knopf zusteht.
Damit das ganze Cluster-Update über eine Adresse laufen kann, bietet der Master den Knopf **„<Name> (Secondary) auf X
aktualisieren“** an:

- Sichtbar nur am Master, solange der Secondary erreichbar, nicht neuer als der Master und nicht auf dem neuesten
  Release ist und dort kein Update läuft (`entscheidePartnerUpdate`, `src/cluster/updateLogik.js`; die Status-Antwort
  trägt das Ergebnis als `update.partner`).
- `POST /api/cluster/partner-update` (Steuerungs-Passwort wie die übrigen Schreibaktionen) am Master ruft
  `POST /api/cluster/update-vom-partner` am Secondary auf (Header `x-hajime-sync-secret`, wie bei der Übergabe). Der
  Secondary prüft die Regeln **selbst** (`updateStarten`, nur als Secondary und nur Aktion „direkt“); der Master schaltet
  nichts am Partner um.
- Der Master bleibt Master und unverändert. Danach ist der Secondary der neuere Server, und am Master erscheint der
  bekannte Knopf „Übergeben und auf X aktualisieren“. Der zweite Schritt bleibt damit ein bewusster Klick, eine
  vollautomatische Kette gibt es nicht.
- Fehlt ein Update-Knopf, obwohl ein neueres Release bekannt ist, nennt die Seite den Grund („Update hier nicht möglich: …“).


## Regeln, serverseitig durchgesetzt

Die Oberfläche blendet den Knopf nach den Regeln oben ein, die **Entscheidung trifft der Server**: `POST /api/cluster/update`
prüft dieselben Bedingungen und lehnt mit 409 und Begründung ab, wenn sie nicht gelten (veralteter Seitenstand, direkter
Aufruf). Eine reine Funktion `entscheideUpdate({ eigeneVersion, partnerVersion, neuesteVersion, eigeneRolle, … })` in
`src/cluster/updateLogik.js` liefert `{ erlaubt, grund, aktion }` und wird von Server und Seite gleich genutzt
(Unit-Tests, wie `rollenLogik.js`).

Zusätzlich:

- Nur ein Update gleichzeitig je Server (laufende Aktualisierung → 409).
- Versionsvergleich nach SemVer; Downgrade ist nie erlaubt (die neueste Version muss größer sein als die eigene).
- Zielversion ist die neueste Release-Version, die dieser Server kennt. Ist der Partner schon darüber hinaus (neuer als dieses
  Release), gilt die Regel der Tabelle, nicht ein Downgrade.

## Technik

### Release-Prüfung

Der Server fragt die neueste Release-Version selbst von GitHub ab (`CLIENT_RELEASE_REPO`, `CLIENT_RELEASE_TOKEN`, wie das
vorhandene Selbst-Update), höchstens alle 10 Minuten und beim Aufruf von `cluster.html`, Ergebnis im Speicher. Ohne
Internet: `neuesteVersion = null`, Hinweis „Release nicht prüfbar“, kein Knopf.

### Ausführung als root

Der Dienst läuft als Benutzer `hajime`. Wie bei der Rückstufung wird **genau ein Root-Skript** über sudoers freigegeben:

- `deploy/linux/hajime-update.sh` (neu, nach `/usr/local/bin/`, Besitzer root, 0755): liest `KLON` und die Zielversion,
  prüft die Eingabe (nur `v<semver>`), und führt `update.sh` mit `GIT_REF=v<version>` aus. Es schreibt Fortschritt und
  Ergebnis nach `<SYNC_DATENVERZEICHNIS>/update-status.json` und `update.log`.
- `deploy/linux/sudoers.hajime`: zusätzliche Zeile für `/usr/local/bin/hajime-update.sh`.
- `CLUSTER_UPDATE_BEFEHL` in `src/cluster/konfig.js` (Standard `sudo -n /usr/local/bin/hajime-update.sh`), austauschbar für
  Tests, spiegelt `CLUSTER_RUECKSTUFEN_BEFEHL`.
- `install-cluster.sh` installiert das Skript und schreibt `KLON=<Quellordner>` nach `/etc/hajime/cluster.env`.

Das Update läuft **losgelöst vom Dienst** (`systemd-run --scope` bzw. `setsid`), damit es den Neustart des Dienstes überlebt.
Es wird immer der Tag des Release gezogen, nicht der Branch `main`; der Tag stammt aus dem Release-Lauf der CI.

### Schnittstellen

- `GET /api/cluster/status` (vorhanden): zusätzlich `version`, eigene `update`-Angaben (`neuesteVersion`, `zustand`
  `bereit|laeuft|fehler|fertig`, `knopf`, `grund`, `fortschritt`) und für den Partner dessen `version`.
- `POST /api/cluster/update` (neu, `requireWriteAuth`): startet das Update nach den Regeln oben.
- Der Master-Fall ruft intern `cluster.uebergeben()` und startet das Update, sobald die Rolle gewechselt ist.

### Frontend

`public/cluster.html`/`public/js/cluster.js`: Versionszeilen je Server, Bereich „Update“ (Knopf, Fortschritt, Hinweise).
Während des Neustarts ist der Server kurz nicht erreichbar; die Seite fragt weiter, bis er wieder antwortet.

## Fehlerfälle

| Fall | Verhalten |
|---|---|
| Sicherung (`pg_dump`) schlägt fehl | Warnung, Update läuft weiter (wie `update.sh`) |
| `npm ci`/Migration/`install-cluster.sh` schlägt fehl | Dienst läuft in der alten Version weiter, Zustand `fehler` mit Ende des Logs |
| Dienst startet nach dem Update nicht | Zustand `fehler`; Zurückrollen von Hand (`.update/alt-<version>/` bzw. `update.sh` mit alter `GIT_REF`) |
| Netz zum Partner bricht ab | Knopf gesperrt, Hinweis |
| Übergabe am Master scheitert | kein Update, Meldung mit Grund |

## Bewusst nicht Teil dieses Features

- Automatisches Aktualisieren beider Server in einem Zug (Rolling Update).
- Zurückrollen per Knopf.
- Einzelserver ohne Cluster (dort gilt weiter das Selbst-Update beim Start).
- Download und Prüfung der Signatur des Dienst-Pakets für diesen Weg; die Vertrauensbasis ist der Release-Tag des
  Repositorys.

## Einführung auf den vorhandenen Servern

Die erste Version mit diesem Feature muss auf beiden Servern **einmal von Hand** eingespielt werden (`sudo bash update.sh`),
weil erst dieses Update das Root-Skript und die sudoers-Regel installiert. Ab dann geht es aus der Oberfläche.

## Tests

- Unit: `entscheideUpdate` (alle Zeilen der Tabelle, Versionsvergleich, Downgrade, unbekannte Version, parallele
  Aktualisierung), Release-Prüfung mit Zwischenspeicher, Eingabeprüfung der Zielversion.
- Cluster-E2E (`tests/e2e-cluster/`): zwei Knoten, `CLUSTER_UPDATE_BEFEHL` auf ein Testskript; Knopf nur am richtigen
  Server, 409 bei falscher Reihenfolge, Master-Fall löst Übergabe aus, Hinweis auf den zweiten Server.
- `shellcheck` für `hajime-update.sh` und `update.sh` (CI vorhanden).
