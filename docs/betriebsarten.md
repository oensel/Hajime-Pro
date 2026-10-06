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

## Matrix: Geräte und Einsatz

| Gerät / Aufbau | Rolle | Ist Server? | Server nötig? | Clients nutzbar? | Einrichtung |
|---|---|---|---|---|---|
| **Linux-Server** (1×) | `server` | ja | – (ist der Server) | **ja**: Desktop-Clients (Windows/macOS/Linux), Android, jeder Browser im LAN | `sudo bash deploy/linux/install.sh` |
| **2× Linux-Server** (Cluster) | `server`, Master + Secondary | ja, ausfallsicher | – (sind die Server) | **ja**, folgen beim Ausfall dem neuen Master; Android mit fester Adresse/VIP | `sudo bash deploy/linux/install-cluster.sh` auf beiden |
| **Windows-Notebook als Server + Frontend** | `server` (Server-Paket) | ja | – | **ja**, im selben WLAN/LAN | Installer „Hajime Pro Server“ |
| **Windows-Notebook nur als Client** | `client` (Desktop-Client) | nein | **ja**, ein Hallen-Server im Netz | – | Installer „Hajime Pro“, vom Server unter `/download` |
| **Linux-Notebook als Server + Frontend** | `server` (Server-Paket) | ja | – | **ja** | Paket „Hajime Pro Server“ (Linux) |
| **Linux-Notebook nur als Client** | `client` (Desktop-Client) | nein | **ja** | – | Client-Paket, vom Server unter `/download` |
| **Android-Handy** | Client (App) | nein | **ja** | – (nur Waage) | APK vom Server unter `/download`, Kopplung per QR |
| **Android-Tablet** | Client (App) | nein | **ja** | – (Waage, Kampf, Scoreboard) | wie Handy |
| **Cloud-Server** (Internet) | `cloud` | ja, aber nur zur Vorbereitung | – | **nein**, Clients koppeln nur an Hallen-Server | Docker/Supabase |

macOS verhält sich wie Windows und Linux (Server-Paket und Client-Paket vorhanden). iOS wird nicht
unterstützt.

## Was die Einträge praktisch bedeuten

- **Server + Frontend auf einem Notebook:** Der Rechner ist Server und zeigt selbst die Oberfläche (über
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
  gibt es nur mit installiertem PostgreSQL auf zwei Linux-Servern, nicht mit den Notebook-Paketen.

## Wann welche Variante?

| Situation | Empfehlung |
|---|---|
| Kleines Turnier, ein Laptop, kein weiteres Gerät | Notebook als Server + Frontend |
| Mehrere Matten und Waage, ein Laptop als Zentrale | Notebook als Server, Matten/Waage als Clients oder Browser |
| Feste Halle, dauerhaft verfügbarer Server | 1× Linux-Server |
| Ausfall darf das Turnier nicht stoppen | 2× Linux-Server (Cluster) |
| Waage am Eingang mit Handy | Android-Handy als Client am Hallen-Server |

Details: Betrieb und Installation in [`betrieb.md`](betrieb.md), Cluster in `deploy/linux/README.md`,
Desktop in `desktop/README.md`, Android in `mobil/README.md`.
