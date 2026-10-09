# Live-Durchsage vom Scoreboard zum Server-Lautsprecher

## Ziel
Am Scoreboard-Client (`steuerung.html`) wird ein Knopf „Durchsage“ gedrückt gehalten, solange gesprochen wird.
Die Stimme aus dem Notebook-Mikrofon kommt live aus dem Audio-Standardgerät (z. B. 3,5-mm-Klinke) des
Hallen-Servers. Loslassen beendet die Durchsage.

## Entscheidungen
- **Live-Streaming** (Funkgerät-Prinzip), kein Aufnehmen-und-danach-Abspielen.
- **Ausgabe über einen nativen Player-Prozess**, damit sie auf allen Server-Arten läuft (Notebook-Server unter
  Windows/macOS/Linux und der Linux-Server ohne Desktop aus `install.sh`; dort gibt es keine Electron-App).
- Ausgabegerät = Standardgerät des Betriebssystems (keine Geräteauswahl, keine Lautstärkeregelung).
- Gesendet wird nur am **Master**; der Secondary im Cluster lehnt ab. Am Cloud-Server gibt es die Funktion nicht.
- Android-App ist in dieser Version nicht dabei (dort fehlt der lokale Node-Prozess als Vermittler).

## Ablauf
1. Browser: `getUserMedia` (auf `http://localhost` ein sicherer Kontext), `AudioWorklet` liefert Mono-PCM
   (16 kHz, 16 Bit, Blöcke zu 20 ms). Das Mikrofon bleibt nach dem ersten Druck 30 s offen, damit nichts abgeschnitten wird.
2. WebSocket `/api/durchsage`: Text-Nachrichten `{t:'start'}` / `{t:'ende'}` (Server antwortet `{t:'bereit'}`,
   `{t:'fehler', grund}` oder `{t:'ende', grund}`), dazwischen binäre PCM-Blöcke. Bis `bereit` puffert der Browser.
3. Client-Knoten (Desktop): leitet den WebSocket an `SYNC_SERVER_URL` weiter und fügt `SYNC_SECRET` ein.
   Hallen-Server: akzeptiert Browser der eigenen Seite (`Sec-Fetch-Site: same-origin`) oder das Secret im Header.
4. Server: ein Sprecher gleichzeitig (sonst `besetzt`), höchstens 60 s je Durchsage, Ende bei Verbindungsabbruch.
   Der Player wird bei `start` gestartet, PCM geht in dessen stdin, bei Ende wird stdin geschlossen.
5. `GET /api/durchsage/status` → `{verfuegbar, grund, besetzt}`. Ohne Player oder ohne Master ist der Knopf gesperrt und erklärt den Grund.

## Player
Reihenfolge je Betriebssystem: Linux `aplay`, `paplay`, `ffplay`; macOS `ffplay`, `play` (sox); Windows eine
eingebaute PowerShell-Brücke (winmm `waveOut`, keine Installation nötig), sonst `ffplay`.
`DURCHSAGE_PLAYER_BEFEHL` überschreibt den Befehl (Tests, Sonderfälle). `install.sh` installiert `alsa-utils`.

## Tests
`tests/unit/durchsage.test.js`: Playerwahl, Sprecherplatz (besetzt), Zeitlimit, Datenfluss über einen echten
WebSocket in eine Fake-Playerdatei, Secondary-Ablehnung, Secret-Prüfung.
