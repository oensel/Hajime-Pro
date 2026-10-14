# Betriebsmodi: typische Aufbauten

Sechs typische Aufbauten, vom einzelnen Notebook bis zum Cluster mit Internet. Immer gilt: **Pro Halle gibt es genau einen Server**, alle Clients hängen an ihm. Welche Rolle ein Gerät hat und wie man sie einstellt (`BETRIEBSMODUS`), steht in [`betriebsarten.md`](betriebsarten.md); Installation und Updates in [`betrieb.md`](betrieb.md).

**Zeichenerklärung:** blau = Server, grün = Client-Gerät, grau = Netzwerk, Drucker, Internet, Cloud.

| Aufbau | autark | ausfallsicher | Internet nötig | Teilnehmer-App |
|---|---|---|---|---|
| [1 Ein Notebook](#1-ein-notebook-für-alles) | ja | nein | nein | nein |
| [2 Notebook als Server im WLAN](#2-notebook-als-server-im-wlan) | ja | nein | nein | nein |
| [3 Durchführung über das Internet](#3-durchführung-über-das-internet) | nein | – | ja | ja |
| [4 Server-Cluster in der Halle](#4-server-cluster-in-der-halle) | ja | ja | nein | nein |
| [5 Cluster mit Internet](#5-cluster-mit-internet-teilnehmer-app-und-streaming) | ja | ja | optional | ja |
| [6 Notebook-Server mit Internet](#6-notebook-als-server-mit-internet-und-teilnehmer-app) | ja | nein | optional | ja |

## 1 Ein Notebook für alles

![Ein Notebook ist Server und Client, per USB mit Drucker und Videobeweis-Kamera verbunden, dazu ein Lautsprecher](img/betriebsmodus-1.svg)

Der einfachste Aufbau: ein Rechner, ein Drucker. Datenbank und Oberfläche laufen auf dem Notebook, ohne Netzwerk. Die Pläne kommen auf Papier aus dem Drucker. Durchsagen gehen per Mikro am Notebook auf den Lautsprecher. Der Videobeweis läuft direkt am Notebook und wird nicht gespeichert.

## 2 Notebook als Server im WLAN

![Ein Notebook als Server, WLAN-Router, Notebooks und Handys als Clients, Dashboard, Drucker](img/betriebsmodus-2.svg)

Matten und Waage bekommen eigene Geräte. Die Clients arbeiten bei einem WLAN-Abbruch lokal weiter und gleichen danach ab. Ein Beamer oder Monitor zeigt das Dashboard. Durchsagen gehen per Mikro vom Client auf den Server-Lautsprecher.

## 3 Durchführung über das Internet

![Notebooks und Handys greifen über Router und Internet auf den Cloud-Server zu; die Teilnehmer-App bekommt ihre Daten von dort](img/betriebsmodus-3.svg)

Das Turnier läuft auf dem Cloud-Server: Vereine melden an, Matten und Waage arbeiten im Browser, die Teilnehmer-App zeigt Ergebnisse und Push-Nachrichten. Das geht nur mit durchgehendem Internet.

## 4 Server-Cluster in der Halle

![Zwei Linux-Rechner als Cluster mit fester Adresse, WLAN-Router, Clients, Drucker, Dashboard und Kamera](img/betriebsmodus-4.svg)

Fällt ein Rechner aus, übernimmt der andere automatisch. Die Clients tragen die feste Adresse (VIP) ein. Die Kamera hängt per USB am Client; der Videobeweis braucht kein Internet, gespeichert wird er nur über den Server. Aufbau und Betrieb: [`../deploy/linux/README.md`](../deploy/linux/README.md).

## 5 Cluster mit Internet, Teilnehmer-App und Streaming

![Cluster wie in Bild 4, dazu Internet, Cloud-Server, Teilnehmer-App und Streaming-PC](img/betriebsmodus-5.svg)

Alles aus Aufbau 4, dazu Internet für Updates und Cloud. Mit Internet kommen automatische Durchsagen auf die Lautsprecher am Server dazu. Der Streaming-PC zeigt per OBS die Seite `overlay.html` je Matte. Die Teilnehmer-App bekommt ihre Daten über den Cloud-Server.

## 6 Notebook als Server mit Internet und Teilnehmer-App

![Notebook-Server mit WLAN-Router, Clients, Drucker, Internet, Cloud-Server und Teilnehmer-App](img/betriebsmodus-6.svg)

Wie Aufbau 2, dazu Internet: Updates beim Start, Austausch mit dem Cloud-Server und automatische Durchsagen auf dem Lautsprecher. Die Teilnehmer-App bekommt ihre Daten über den Cloud-Server.

## Hinweise für alle Aufbauten

- Der Cloud-Server kann das Turnier selbst durchführen (Aufbau 3) oder nur vorbereiten; dann wandert das Turnier als Datei auf einen Hallen-Server.
- Der Desktop-Client und die Android-App koppeln sich nur an einen Hallen-Server; in Aufbau 3 arbeiten Notebooks und Handys deshalb im Browser.
- Drucker drucken über das Gerät, auf dem das Dokument geöffnet ist; der Server druckt nicht selbst.
- Beamer oder Monitor zeigen das Dashboard in allen Aufbauten mit LAN/WLAN.
- Die Videobeweis-Kamera hängt per USB am Client und funktioniert auch direkt dort, wird dann aber nicht gespeichert.
- Ohne Internet gibt es Durchsagen nur per Mikro vom Client, mit Internet auch automatisch auf den Lautsprechern am Server.

## Grafiken neu erzeugen

Die SVG-Dateien in [`img/`](img/) sind eigenständig und passen sich per `prefers-color-scheme` an helle und dunkle Darstellung an. Sie werden von Hand gepflegt; bei Änderungen am Aufbau die SVGs und diese Seite gemeinsam anpassen.
