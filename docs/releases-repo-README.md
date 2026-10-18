# Hajime Pro – Downloads

Turnierverwaltung für Judo-Wettkämpfe nach den Regeln des DJB. Dieses Repository enthält nur die fertigen Installationsdateien (Releases); der Quellcode ist nicht öffentlich.

## Installation

- **Windows / Linux (Notebook als Hallen-Server):** „Hajime Pro Server“ aus dem [neuesten Release](../../releases/latest) herunterladen und installieren. Er aktualisiert sich beim Start selbst.
- **Client-Geräte (Matte, Waage, Android):** Installationsdateien über die Download-Seite des Hallen-Servers (`http://turnier.local/download`).
- **Linux-Server ohne Desktop (Einzelserver oder Cluster):**

  ```bash
  curl -fsSL https://github.com/oensel/Hajime-Pro-Releases/releases/latest/download/hajime-holen.sh | sudo bash
  cd /opt/hajime-quelle && sudo bash deploy/linux/install.sh
  ```

Alle Update-Dateien sind mit einem Ed25519-Schlüssel signiert; die Prüfsummen stehen in `SHA256SUMS-Server.txt`.
