# Videoaufnahme für den Videoschiedsrichter

## Ziel
Die USB-Kamera am Client (Steuerung der Matte, `steuerung.html`) nimmt je Kampf einen Clip auf. Der Hallen-Server speichert ihn
mit Marken (Kampf geladen, START, STOPP, Ergebnis), man kann ihn live sehen und später im Video-Archiv abspielen.

## Entscheidungen
- **Ein Clip je Kampf**: von „Nächsten Kampf holen“ bis „Ergebnis senden“ (damit ein Vorlauf automatisch dabei ist und jeder
  Clip in sich abspielbar bleibt; kein Ring-Puffer nötig). Ein Wechsel des geladenen Kampfes ohne Ergebnis beendet den Clip als abgebrochen.
- **720p/30 fps/2,5 MBit/s** als Standard (480p, 1080p wählbar), je Matte etwa 1,1 GB pro Stunde.
- **Kodiert wird am Client** (MediaRecorder, VP8/WebM bevorzugt, sonst H.264/MP4). Der Server schreibt nur Dateien und reicht
  Blöcke weiter, daher reicht schwache Hardware (z. B. Futro S740) aus.
- **Aufnahme standardmäßig aus**, einschaltbar je Client; Hinweis auf Einwilligung und Löschen nach dem Turnier.
- **Overlay im Bild**: Über ein Canvas werden Kampfzeit, Pool, Kämpfer 1 (Weiß, links) und Kämpfer 2 (rechts, in der wirksamen Farbe Blau oder Rot aus Turnier/Pool/Kampf) mit Wertungen (Ippon, Waza-ari, Yuko), Strafen (Shido, Behandlung) und die Uhrzeit ins Video gezeichnet; die Werte liest `video.js` aus `window.hajimeScoreboardState` (von `update()` in `scoreboard.js` gesetzt). Die Farbe steht als `farbe2` im Clip-Index und im Ergebnistext („Sieger Weiß/Blau/Rot“).
- Kein ffmpeg: MediaRecorder-Dateien haben keine Länge; `videobeweis.js` ermittelt sie im Browser (`currentTime = 1e101`).
- Nur am Hallen-Server und Master; Clips liegen lokal (`VIDEO_VERZEICHNIS`, Standard `./data/video`) und werden nicht repliziert.
  Android-App ist nicht dabei.

## Ablauf (Hybrid: lokal aufnehmen, live streamen, vollständig ablegen)
1. `scoreboard.js` meldet `hajime:kampf` (geladen, start, stopp, ergebnis, abbruch); `public/js/video.js` reagiert darauf.
2. Jeder Clip hat eine Clip-ID und liegt **zuerst lokal**: im Arbeitsspeicher und im Zwischenspeicher des Browsers (IndexedDB). Er überlebt
   so ein Neuladen der Seite, und viele offline gesammelte Clips belegen nicht den Arbeitsspeicher.
3. Übertragung über WebSocket `/api/video` (Client-Knoten reichen sie an den Hallen-Server weiter):
   `{t:'start', meta}` → `{t:'bereit', empfangen}` (so viele Bytes hat der Server schon), danach binäre Blöcke ab dieser Stelle,
   am Ende `{t:'ende', groesse, meta}` mit Marken, Ergebnis, Farbe → `{t:'fertig'}` oder `{t:'fehlt', empfangen}`. Bei bestehender Verbindung
   werden die Blöcke **schon während der Aufnahme** gesendet (`live: true`); ohne Verbindung wiederholt der Client alle 5 s (bis zu 2
   nachgelieferte Clips parallel, der laufende hat Vorrang). Nach einem Abbruch geht es an der Stelle weiter, bis zu der der Server den
   Clip hat. Am Server liegt am Ende das **vollständige** Video; die Größe wird geprüft.
4. `src/video/videoDienst.js` + `videoSpeicher.js`: Datei und Index unter `<wurzel>/turnier-<id>/matte-<id>/<clipId>.webm|mp4` + `.json`.
   Unvollständige Clips bleiben liegen (Video-Archiv zeigt sie als „unvollständig“), bis der Client sie fortsetzt.
5. **Live-Raster** `video-live.html`: je Matte mit laufender Aufnahme eine Kachel (alle Kameras zugleich, Klick vergrößert), Wiedergabe per
   MediaSource; wer später dazukommt, bekommt zuerst den bisherigen Clip. Nachgelieferte Clips werden nicht live weitergereicht.
6. **Ansehen in der Steuerung**: Während der Aufnahme zeigt „📹 Video ansehen“ (oben links in der Meta-Leiste der Anzeige, nur während der
   Aufnahme) den bisherigen Stand mit Sprüngen ±5/±10 s, Einzelbild, Zeitlupe und Sprung zu den Marken; die Aufnahme läuft dabei weiter.
7. `videobeweis.html`: Liste (nach Matte filtern, suchen, Kämpfer untereinander mit Farbmarke), Abspielen mit Sprung zu den Marken, Zeitlupe,
   Einzelbild, Herunterladen, Löschen. REST: `GET /api/video/status|clips`, `GET /api/video/clips/:id/datei`, `DELETE /api/video/clips/:id`,
   `POST /api/video/clips/alle-loeschen`.

## Internet (Schritt 2, noch nicht umgesetzt)
Zuschauer außerhalb des Hallennetzes brauchen einen Zwischenpunkt (Relay oder Streamingdienst), weil der Upload der Halle nicht für
mehrere Zuschauer pro Matte reicht (etwa 2,5 MBit/s je Matte). Dafür muss der Server den Strom als H.264 (HLS/RTMP) weitergeben, am besten
per ffmpeg `-c copy`, wenn der Client in H.264 aufnimmt.

## Grenzen
- Fällt die Verbindung aus, fehlt dem Live-Raster der Strom, bis sie zurück ist; der Clip selbst wird vollständig nachgeliefert.
- Der Zwischenspeicher des Browsers kann von diesem gelöscht werden (privates Fenster, Speicherknappheit); ohne ihn fragt der Browser beim Schließen nach.
- Zeitlimit 45 Minuten je Clip (danach endet er als „abgebrochen“); Größenlimit 3 GB je Clip.
- Das Canvas läuft nur zuverlässig, solange der Steuerungs-Tab sichtbar ist (Browser drosseln versteckte Tabs).

## Tests
`tests/unit/video.test.js` (Speicher) und `tests/unit/video-uebertragung.test.js` (Übertragung mit Wiederaufnahme, fehlende Bytes, Live-Weiterleitung, Fehlerfälle, Secondary, Löschen), `tests/e2e/video.spec.js`
(Fake-Kamera: Live zum Server, Live-Raster, Ansehen und Spulen in der Steuerung, vollständiger Clip mit Marken, Video-Archiv; Offline-Aufnahme mit Neuladen und späterer Nachlieferung).
