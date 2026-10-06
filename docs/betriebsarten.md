# Betriebsarten im Überblick

**Grundregel: Ohne Server läuft nichts.** Jede Installation braucht genau einen Server, der die Turnierdaten
führt (Auslosung, Kämpfe, Ergebnisse). Ein **Client** (Desktop-Client, Android-App) ist nur ein Gerät an
Matte oder Waage: Er holt seine Daten vom Server, arbeitet bei Funkloch lokal weiter und überträgt danach
nach. Einen Client ohne erreichbaren Server kann man nicht neu einrichten, und ein Turnier lässt sich auf
ihm nicht anlegen.

## Die drei Rollen (`BETRIEBSMODUS`)

| Rolle | Wofür | Datenbank | Login |
|---|---|---|---|
| `cloud` | Internet-Server: Vorbereitung vorab, Vereine melden an | PostgreSQL (Supabase oder eigener Server) | ja, vereinsbasiert |
| `server` | **Hallen-Server** am Wettkampftag, genau ein Turnier | PostgreSQL lokal (eingebettet oder installiert) + Dokument-DB | nein (Einzelbenutzer) |
| `client` | Gerät an Matte/Waage, braucht einen Hallen-Server | nur lokale Dokument-DB | nein |

Der Cloud-Server ist **kein** Ersatz für den Hallen-Server: Clients koppeln sich nur an einen Hallen-Server.
Turniere wandern per Export/Import zwischen Cloud und Hallen-Server.

## Matrix: Server-Betriebsweise × Clients

Links die Betriebsweise des **Servers** (ohne ihn läuft kein Client), oben die Clients, die daran
arbeiten können.

| Server-Betriebsweise | ausfallsicher | autark | Windows-Client | Linux-Client | Android Handy | Android Tablet |
|---|---|---|---|---|---|---|
| **1× Linux-Server (ohne Desktop)** (`install.sh`) | nein | nein | ja | ja | ja (nur Waage) | ja (Waage, Kampf, Scoreboard) |
| **2× Linux-Server (ohne Desktop)** (Cluster, `install-cluster.sh`) | **ja** (Master/Secondary, Übernahme bei Ausfall) | nein | ja | ja | ja (nur Waage), feste Adresse/VIP eintragen | ja, feste Adresse/VIP eintragen |
| **Windows** (Server-Paket, Server + Frontend, mit Desktop) | nein | **ja** | ja | ja | ja (nur Waage) | ja |
| **Linux** (Server-Paket, Server + Frontend, mit Desktop) | nein | **ja** | ja | ja | ja (nur Waage) | ja |

Lesehilfe:
- **Jede Zeile ist ein Server.** Die Clients der Spalten sind zusätzliche Geräte an Matte oder Waage und
  immer an genau einen Server gekoppelt. Ein Client ersetzt den Server nie.
- **ausfallsicher** heißt: Fällt ein Server aus, übernimmt automatisch der zweite. Nur der Cluster kann das.
  Bei allen anderen Zeilen steht das Turnier auf einem einzigen Rechner. Clients arbeiten bei einem
  Verbindungsabbruch lokal weiter und gleichen danach ab, aber ein ausgefallener Server selbst bleibt aus.
- **autark** heißt: Der Server zeigt die Oberfläche selbst (Server und Frontend in einem Paket, mit Desktop),
  man braucht kein weiteres Gerät und kein Netzwerk, um ein Turnier zu führen. Ein Linux-Server ohne Desktop
  hat keine Oberfläche: Er braucht mindestens einen Client oder einen Browser im Netz.
- **Windows-/Linux-Client** sind der Desktop-Client auf einem weiteren Notebook. Ein autarker Server (Windows/Linux
  mit Desktop) braucht keinen Client, ein Client ist dort nur für weitere Matten/Waagen nötig.
- **Android Handy** ist nur die Waage (Judopass-QR, wiegen, nachmelden), **Android Tablet** zusätzlich Kampf,
  Scoreboard und Mattenleitung.
- macOS verhält sich wie Windows und Linux (Server- und Client-Paket vorhanden), iOS wird nicht unterstützt.
- Der **Cloud-Server** (`cloud`, Internet) steht nicht in der Matrix: Er dient nur zur Vorbereitung. Clients
  koppeln sich nicht an ihn, Turniere wandern per Export/Import zum Hallen-Server.

### Einrichtung je Zeile und Spalte

| | Wie einrichten |
|---|---|
| 1× Linux-Server | `sudo bash deploy/linux/install.sh` auf Debian/Ubuntu |
| 2× Linux-Server | `sudo bash deploy/linux/install-cluster.sh` auf beiden Servern |
| Windows / Linux als Server (autark) | Installer bzw. AppImage „Hajime Pro Server“ |
| Windows-/Linux-Client | Installer „Hajime Pro“, vom Server unter `/download` |
| Android | APK vom Server unter `/download`, Kopplung per QR-Code |

## Was die Einträge praktisch bedeuten

- **Autarker Server (Windows/Linux mit Desktop):** Der Rechner ist Server und zeigt selbst die Oberfläche (über
  `localhost`, geht auch ohne Netzwerk). Im Netzwerk bietet er sich als `turnier.local`, Port 80 an; weitere
  Geräte nutzen ihn wie einen Linux-Server. Die Datenbank ist eingebettet, nichts weiter zu installieren.
- **Notebook nur als Client:** Es startet nur die Oberfläche für Waage oder Matte. Daten holt es vom
  Hallen-Server; ohne erreichbaren Server arbeitet es mit dem Stand weiter, den es schon hat, und gleicht
  danach ab. Der Server wird per mDNS (`turnier.local`) gefunden, sonst Adresse manuell eintragen.
- **Android:** Handy = nur Waage (Judopass-QR, wiegen, nachmelden). Tablet = Waage, Kampf, Scoreboard und
  Mattenleitung. Die App sucht den Server nicht selbst (kein mDNS): Adresse oder QR-Code verwenden, im
  Cluster die feste Cluster-Adresse (VIP) eintragen. Updates der APK erfolgen manuell.
- **Kein Client nötig:** Ein Browser im selben Netz reicht für Verwaltung und Anzeigen, nur ohne
  Offline-Betrieb.
- **Cluster:** Zwei Server, einer führt (Master), der andere (Secondary) übernimmt bei Ausfall. Ein Cluster
  gibt es nur mit installiertem PostgreSQL auf zwei Linux-Servern, nicht mit den autarken Server-Paketen (Windows/Linux).

## Wann welche Variante?

| Situation | Empfehlung |
|---|---|
| Kleines Turnier, ein Laptop, kein weiteres Gerät | Windows/Linux als autarker Server |
| Mehrere Matten und Waage, ein Laptop als Zentrale | Windows/Linux als autarker Server, Matten/Waage als Clients oder Browser |
| Feste Halle, dauerhaft verfügbarer Server | 1× Linux-Server |
| Ausfall darf das Turnier nicht stoppen | 2× Linux-Server (Cluster) |
| Waage am Eingang mit Handy | Android-Handy als Client am Hallen-Server |

Details: Betrieb und Installation in [`betrieb.md`](betrieb.md), Cluster in `deploy/linux/README.md`,
Desktop in `desktop/README.md`, Android in `mobil/README.md`.
