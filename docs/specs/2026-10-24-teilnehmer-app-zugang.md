# Teilnehmer-App: Zugang nur mit ausgehängtem QR-Code

## Ziel
Die Teilnehmer-App soll nur Personen offenstehen, die den in der Halle ausgehängten QR-Code gescannt haben. Wer die Cloud von außen abfragt, bekommt keine Turnierdaten.

## Ehrliche Grenze
Ein gedruckter QR-Code kann „nur in der Halle“ nicht erzwingen: ein weitergegebenes Foto funktioniert genauso. Das Modell begrenzt Reichweite und Dauer (Code je Turnier, Ablauf, Erneuern, Sperren); es verhindert, dass jemand Turniere errät oder auflistet.

## Modell
- Ein Zugangscode je Turnier (128 Bit zufällig, 22 Zeichen Base64url), Tabelle `live_zugang` (Migration `20261029100000`), Prüfung in `src/liveCloud/zugang.js`.
- QR-Inhalt: `<Cloud>/live/#z=<Code>`. Das Fragment gelangt nie in Server-/Proxy-Protokolle.
- Die App löst den Code über `POST /api/live/zugang/aufloesen` auf (Turnier, Name, Datum), entfernt ihn aus der Adresse, merkt ihn im Gerät (`teilnehmer-app/js/zugang.js`) und sendet ihn bei jeder Abfrage unter `/api/live/turniere/:key/*` im Kopf `X-Live-Zugang`.
- Gültigkeit: bis 06:00 Uhr (Europe/Berlin) am Tag nach dem Turniertag, oder `gueltig_bis`. Danach 403 `abgelaufen`; zurückgenommene Freigabe ebenfalls.
- Fehler: 401 `zugang` (falsch/fehlend, ein unbekanntes Turnier ist davon nicht zu unterscheiden), 403 `gesperrt`, 403 `abgelaufen`. Nur `zugang` zählt für die Ratenbegrenzung.
- Es gibt keine öffentliche Turnierliste (`GET /api/live/turniere` entfällt); der Start der App zeigt nur die auf dem Gerät gemerkten Turniere.
- Verwaltung durch den Veranstalter am Hallen-Server über das Token des Turniers: Dialog „Teilnehmer-App“ (Erneuern = alter Code sofort ungültig, Sperren), druckbarer Aushang `live-aushang.html` (A4 mit QR). Endpunkte Cloud: `GET /api/live/zugang`, `POST /zugang/erneuern`, `POST /zugang/sperren` (Bearer-Ingest-Token); Hallen-Server: `/api/live-app/zugang…`.
- Aufräumen: `loescheVerwaisteZugaenge` im stündlichen Aufbewahrungsjob.

## Tests
`tests/unit/liveZugang.test.js`, `liveCloudRoutes.test.js`, `liveCloudPushRoutes.test.js`, `liveAppDienst.test.js`; E2E `live-app.spec.js` (QR-Fluss, ohne Code, gesperrt, abgelaufen), Hilfen `tests/e2e/helpers/live-zugang.js`.
