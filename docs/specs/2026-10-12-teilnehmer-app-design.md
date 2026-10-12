# Teilnehmer-App „Hajime Live": Verfolgen, Übersicht, Push, Livestream

Status: Entwurf zur Freigabe · Branch `feature/teilnehmer-app` · 2026-10-12

## 1. Ziel und Abgrenzung

Teilnehmer, Eltern und Trainer verfolgen am Wettkampftag von ihrem Handy aus, **wann** ein Teilnehmer auf **welcher Matte**
dran ist, werden per Push gewarnt, wenn es noch 3 Kämpfe bis zum Einsatz sind, und können (später) einen Matten-Livestream
auf der Website ansehen. Die Daten kommen aus der Cloud, nicht vom Hallen-Server.

Nicht Teil dieses Entwurfs (bewusst):
- Konten/Anmeldung in der Teilnehmer-App (nur anonymes Geräte-Token). Trainer-Funktionen über den vorhandenen Cloud-Login wären eine eigene Erweiterung.
- Ein eigenes Teilnehmer-WLAN in der Halle (der Entwurf lässt die Tür offen, siehe 11).
- IP-Kameras, Umbau des Videobeweises auf serverseitiges Schneiden, Videoarchiv/Replay in der Cloud.
- Mannschaftskämpfe in der Übersicht (Phase 1–3 behandeln nur Einzelpools; Mannschaftsbegegnungen folgen separat).
- Push vom Hallen-Netz aus (Push sendet allein die Cloud).

## 2. Entscheidungen

| # | Entscheidung | Begründung |
|---|---|---|
| 1 | **Zwei getrennte Apps.** Die bestehende Turnierleitungs-App (Waage, Matte, Steuerung) bleibt unverändert im Hallen-LAN; die Teilnehmer-App ist ein eigenes Produkt („Hajime Live"). | Anderes Vertrauensmodell (Schreibrechte vs. öffentlich), Versionskopplung Client/Server, kein Login im Hallenbetrieb. |
| 2 | Teilnehmer-App ist eine **PWA**, ausgeliefert von der Cloud. Eine Capacitor-Hülle für Stores ist später möglich. | Android und iOS ohne Store, Web-Push (VAPID). |
| 3 | **Kein Konto**, nur ein Geräte-Token. Sterne und Glocken liegen im Gerät und werden beim Abruf an die Cloud gemeldet (idempotent, volle Liste). | Eltern in der Halle sollen in unter 30 s starten. |
| 4 | **Verfolgen gilt nur für das jeweilige Turnier.** | Kein turnierübergreifender Personenbezug, Löschen nach dem Turnier. |
| 5 | **Datenfluss nur Richtung Cloud.** Der Uplink wertet von der Antwort nur den HTTP-Statuscode aus; es gibt keine Befehle, Konfiguration oder Daten aus der Cloud zum Hallen-Netz. | Sicherheit, einfache Begründbarkeit. |
| 6 | Der **Live-Prozess läuft als zweiter Prozess auf dem Slave** (Secondary), liest den PostgreSQL-Standby nur lesend, und sendet ausgehend. | Master wird nicht beeinflusst, Master hat kein Internet. |
| 7 | **Internet nur am Slave**, per USB-Tethering oder Starlink direkt am Slave. Die Fritz!Box hat keinen Internetzugang. | Strenge physische Trennung. |
| 8 | Die Live-Anzeige gilt **je physischem Rechner mit Internet**, nicht je Rolle. | Failover ändert nichts am Zielpfad. |
| 9 | **Kein Teilnehmer-WLAN.** Eltern nutzen Mobilfunk. | Vorgabe; vereinfacht Zertifikate, DNS, Isolation. |
| 10 | **Livestream in Phase 4 über denselben Encoder** wie der Videobeweis-Clip (gleiche Blöcke an Master und Slave); Umcodierung zu HLS in der Cloud. Kein zweiter Encoder. | Alte Matten-Notebooks (Linux/Windows). |
| 11 | **Live-Schalter bleibt nach Neuladen aus.** | Kein stilles Weitersenden von Kinderbildern. |

## 3. Architektur

```
Hallen-LAN (Fritz!Box)                                  Internet
┌──────────────────────────────────────────────────┐
│ Master/VIP  (PostgreSQL primary, Hajime-App)     │
│      │ Replikation (vorhanden)                    │
│ Slave/Secondary (PostgreSQL standby)              │       ┌────────────────────┐
│   └─ Live-Prozess (neu, eigener Systemdienst)     │ HTTPS │ Cloud (BETRIEBSMODUS │
│        liest Views mit Rolle live_ro, alle 5 s    ├──────►│ =cloud)             │
│        sendet Snapshot nur bei Änderung           │ nur   │  /api/live/ingest   │
│        (Phase 4: Stream-Relay, LAN-Listener)      │ aus-  │  Lesemodell, Push,  │
│ USB-Tethering / Starlink nur hier                 │ gehend│  App-API, Player    │
│ Matten-Notebooks ── Technik-WLAN                  │       └─────────┬──────────┘
└──────────────────────────────────────────────────┘                 │
                                                          Handys (Mobilfunk): PWA, Push
```

Neue Bausteine:

| Baustein | Ort | Zweck |
|---|---|---|
| `src/shared/liveKachel.js` | geteilt | Reine Berechnung: Kachelzustand, Abstand n, Platz. Kein DB-/DOM-Zugriff. |
| `src/live/` (Live-Prozess) | Slave | Snapshot-Builder (SQL → Snapshot), Uplink, später Stream-Relay. |
| `migrations/…_live_views.js` | alle Datenbanken | Schema `live`, Views, Rolle `live_ro`. |
| `src/routes/liveRoutes.js` | Cloud | Ingest, App-API; nur im Modus `cloud` eingehängt. |
| `teilnehmer-app/` | Cloud ausgeliefert | PWA. |
| Spalte `turniere.live_freigabe` | Datenbank | Schalter „Live freigeben" am Master. |

## 4. Kachel und Abstand

Eine Kachel je verfolgtem Teilnehmer:

```
Anna Muster · U15 w −44 kg · Matte 2
nächster Kampf: in 3 Kämpfen | als Nächstes | läuft jetzt | keine weiteren Kämpfe
Abgeschlossen · Platz 3                      (nur bei abgeschlossenem Pool; Platz nur 1–3)
```

**Abstand n** = Anzahl noch nicht beendeter Kämpfe vor dem nächsten eigenen Kampf auf derselben Matte (nach `matten_reihenfolge`);
ein laufender Kampf zählt mit. Mehrere eigene Kämpfe: maßgeblich ist der nächste offene.

| Zustand (aus Pool-/Teilnehmer-/Kampfstatus) | Zeile 2 | Zeile 3 |
|---|---|---|
| Teilnehmer `angemeldet` / `kampfbereit`, Pool noch nicht ausgelost | Hinweis „noch nicht ausgelost" | – |
| ausgelost, Pool ohne Matte (`pools.kampfflaeche_id` leer) | Hinweis „noch keine Matte zugeteilt" | – |
| Sammelpool „Verspätet" (`pools.verspaetet`) | Hinweis „nachgemeldet, Einteilung folgt" | – |
| eigener Kampf `gestartet` | läuft jetzt | – |
| n = 0 | als Nächstes | – |
| n ≥ 1 | in n Kämpfen (bei 1: „in 1 Kampf") | – |
| Kampf mit nur einem bekannten Kämpfer (Folgekampf, Gegner offen) | wie n (Position steht fest) | – |
| keine offenen Kämpfe, Pool läuft noch (`nicht_angetreten`, `disqualifiziert`, ausgeschieden) | keine weiteren Kämpfe | – |
| Pool `abgeschlossen` | entfällt | Abgeschlossen · Platz 1–3 (sonst nur „Abgeschlossen") |

Die Platzierung kommt aus `src/shared/platzierungen.js` (dieselbe Quelle wie Siegerliste und Urkunden), nur für abgeschlossene Pools.
Hinweise gelten **je Teilnehmer/Pool**, nicht global (Waage in Runden: Altersklassen werden zu verschiedenen Zeiten ausgelost).

**Push-Regel:** Je (Teilnehmer, Kampf) höchstens einmal, sobald n ≤ 3 erstmals erreicht wird (nicht „== 3": Folgekämpfe werden im
Doppel-KO erst befüllt, wenn beide Vorkämpfe feststehen, und können mit n < 3 neu entstehen; Umsortierung kann n springen lassen).
Wird die Reihenfolge später geändert (Drag & Drop, Matte neu verteilt), gibt es keinen zweiten Push für denselben Kampf.

## 5. Phase 1: Live-Prozess auf dem Slave

### 5.1 Datenzugriff
- Schema `live` mit Views, die nur die benötigten Spalten liefern: Turnier (Freigabe, Name, Datum), Teilnehmer (Name, Verein,
  Alters-/Gewichtsklasse, Geschlecht, Status, Pool), Pool (Bezeichnung, Matte, Status, `verspaetet`), Kampf (Status, Matte,
  Reihenfolge, Kämpfer-Schlüssel), Platzierung.
- **Nicht** in den Views: Geburtsdatum, Gewicht, Passnummer, Zahlungs-/Anmeldedaten, E-Mail.
- Rolle `live_ro`: `LOGIN`, nur `SELECT` auf `live.*`, `default_transaction_read_only = on`, `statement_timeout = 3s`;
  `pg_hba` erlaubt sie nur von localhost. Der Prozess hat keine Zugangsdaten für andere Rollen.
- Abfrage **alle 5 s**, ein Statement, Ergebnis im Speicher gehalten. `LISTEN/NOTIFY` entfällt (auf einem Standby nicht möglich).
- Läuft auf dem Standby (Hot Standby). `synchronous_commit` bleibt `on` (nicht `remote_apply`), sonst könnte eine Leseabfrage am
  Standby den Master ausbremsen; `hot_standby_feedback = on` ist laut `deploy/linux/postgresql/hajime-cluster.conf` bereits gesetzt,
  die Abfrage bleibt kurz und harmlos.
- Wird der Slave zum Master, liest der Prozess den Primary mit derselben Rolle weiter.

### 5.2 Snapshot
- Aufbau: Turnier-Kopf (`turnierKey`, Name, Datum, `stand`, `sequenz`), Teilnehmerliste (`key`, Name, Verein, Verein-Schlüssel,
  Alters-/Gewichtsklasse, Pool, Matte, Zustand), Matten-Warteschlangen (Kampf-Schlüssel, Position, Teilnehmer-Schlüssel, Status),
  Platzierungen abgeschlossener Pools. Die Kachelzustände werden an der Quelle mit `liveKachel.js` berechnet.
- **Stabile Schlüssel:** `turniere.urspruengliche_id` identifiziert das Turnier. Teilnehmer-IDs ändern sich bei Export/Import,
  daher `key = HMAC(turnierSalz, turnierKey + judopass_id)`; die Passnummer selbst wird nie ausgeliefert.
- **Vereine:** `turnier_teilnehmer.verein` ist Freitext. Der Verein-Schlüssel entsteht durch Normalisierung (Kleinschreibung,
  Leerzeichen, Rechtsformzusätze wie „e.V."); als Anzeigename dient die häufigste Schreibweise. Die Vereinsauswahl listet nur im
  Turnier vorkommende Vereine.
- Gesendet wird bei Änderung (Hash-Vergleich), spätestens alle 60 s als Lebenszeichen/voller Stand. Nach einer Unterbrechung
  wird der volle aktuelle Stand gesendet, es gibt keine Warteschlange alter Ereignisse.
- Mehr als ein Turnier: der Prozess sendet nur Turniere mit `live_freigabe = true`.

### 5.3 Uplink
- `POST /api/live/ingest` über HTTPS, Zertifikatsprüfung, Token im Header (in der Cloud sperrbar, an das Turnier gebunden),
  gzip. Antwort: nur Statuscode. Wiederholung mit Backoff.
- Kein Listener in Phase 1.

### 5.4 Netzwerk
- USB-Tethering oder Starlink direkt am Slave. `net.ipv4.ip_forward = 0`. Die Fritz!Box hat keinen Internetzugang.
- nftables auf der Internet-Schnittstelle: **ausgehend** nur HTTPS zum Cloud-Host, DNS, NTP; **eingehend** alles verworfen.
- Automatische OS-Updates laufen darüber nicht (bewusst; Update-Fenster separat).
- Fällt der Slave oder das Internet aus, läuft das Turnier weiter. Die App zeigt „Stand von hh:mm · Halle nicht verbunden".

## 6. Phase 2: Cloud-Lesemodell und App

### 6.1 Cloud
- Eigene Tabellen (Lesemodell), nicht die operativen: `live_turniere`, `live_teilnehmer`, `live_kampf_positionen`,
  `live_verfolgungen` (Geräte-Token, Teilnehmer- oder Vereins-Schlüssel, Glocke), `push_geraete`, `push_log`.
- Ingest ersetzt den Stand des Turniers atomar (Sequenznummer, ältere Pakete werden verworfen).
- App-API (nur Lesen, Rate-Limit, keine Aufzählung ohne Suchbegriff): Turnierliste, Vereinsliste, Suche (ab 2 Zeichen, Treffer
  „Name · Verein · Klasse"), Pool mit allen Teilnehmern, Übersicht zu den verfolgten Schlüsseln, `stand` des Turniers.
- Aufbewahrung: Live-Daten werden nach dem Turnier gelöscht (Frist festlegen, Vorschlag: 7 Tage).

### 6.2 App
- **Startbildschirm:** Turnierauswahl (heutiges zuerst), Suche nach Name oder Vorname mit Autovervollständigung, Auswahl nach Verein.
- **Teilnehmer wählen →** Pool-Ansicht mit allen Teilnehmern des Pools. Jeder Teilnehmer hat **Stern** (verfolgen) und **Glocke** (Push).
- **Stern auf einem Teilnehmer:** Glocke standardmäßig an. **Stern auf einem Verein:** Regel „alle Teilnehmer des Vereins", Glocke
  standardmäßig aus, mit Schalter „Glocke für alle" und Ausnahmen je Teilnehmer; Nachzügler erscheinen automatisch.
- **Menüpunkt „Übersicht":** alle gesternten Teilnehmer (und alle Teilnehmer gesternter Vereine) als Kacheln nach Abschnitt 4.
  Statuszeile mit `stand` und Verbindungszustand.
- Bevor der Pool eines Teilnehmers eine Matte hat: Hinweis nach Tabelle in Abschnitt 4 (die Suche selbst funktioniert immer).
- Sterne und Glocken liegen in `localStorage` je Turnier und werden beim Abruf an die Cloud gemeldet.

## 7. Phase 3: Push

- Web-Push (VAPID). Die Glocke ist nur aktivierbar, wenn die Benachrichtigung erlaubt ist, sonst erklärt die App warum
  (insbesondere auf iOS: nur als installierte PWA).
- Absender ist **ausschließlich die Cloud**. Auslöser ist der Übergang n ≤ 3 im neu eingegangenen Snapshot (Abschnitt 4).
- **Bündelung:** gleichzeitig ausgelöste Teilnehmer eines Geräts in einer Meldung („Anna, Max: noch 3 Kämpfe").
- Push funktioniert nur mit Uplink **und** Mobilfunk des Handys; fällt eines weg, gibt es keine Meldung. Die App zeigt den Zustand.

## 8. Phase 4: Livestream

Voraussetzung: Spike (siehe 12). Der Livestream ist **Live-Anteil der Videobeweis-Clips**:

```
Kamera (GoPro/Handy/Webcam, USB) ─► Matten-Notebook: ein Canvas (Overlay), ein Encoder
                                       ├─ Blöcke ─► Master (Clip, unverändert)
                                       └─ dieselben Blöcke ─LAN, Token─► Slave: Stream-Relay ─► Cloud
Cloud: ffmpeg VP8/WebM → H.264/HLS ─► Website (iOS und Android)
```

- **Client (`video.js`):** zusätzlich zum Upload zum Master ein zweiter WebSocket zum Slave, best effort ohne Wiederaufnahme.
  Stream-Ziel teilt der Master den Clients über die vorhandene Konfiguration mit (feste Adresse des Rechners mit Internet,
  nicht die VIP). Kamera-Verlust (`ended`) wird erkannt und die Kamera neu geöffnet.
- **Slave:** Stream-Relay als Modul des Live-Prozesses mit eigenem Listener nur auf der LAN-Schnittstelle (nicht auf der
  Internet-Schnittstelle), Token (`SYNC_SECRET`), Ringpuffer im Speicher (keine Platte), Ausgang ratenbegrenzt und mit
  getrennter Verbindung; der Snapshot hat Vorrang. Bei Überlast werden ganze Segmente verworfen, nicht verzögert.
- **Cloud:** ingest, Umcodierung zu HLS, Player auf der Website; kein Archiv. Zwischen Kämpfen zeigt die Website eine Tafel
  „Matte 2 · als Nächstes: A gegen B" aus dem Snapshot.
- **Zuschauer:** öffentlich auf der Website (wenige Personen). Matte, Beschriftung und Kachelknopf „▶ Matte 2 live" über die Matten-ID.
- **Qualität:** gleich der Clip-Qualität (480p/720p/1080p). 480p (ca. 1 Mbit/s) spart Datenvolumen.

### 8.1 Schalter und Statusanzeige in der Steuerung (`steuerung.html`, Panel „Video")

- **Zwei unabhängige Schieber:** „Videobeweis" (bisher `videoAktiv`, Verhalten unverändert) und „Live-Stream" (neu, `videoLiveAktiv`).
  Beide standardmäßig aus; Live ist nach einem Neuladen **immer aus** (wird nicht aus dem Speicher wiederhergestellt).
- **Voraussetzungen für Live** (sonst gesperrt, mit Klartext-Grund darunter): Turnier ist am Master freigegeben, Stream-Ziel bekannt und
  erreichbar, Kamera läuft. Erstes Einschalten fragt nach („Das Bild ist öffentlich im Internet sichtbar"). Der Master wird alle
  ~10 s auf die Freigabe abgefragt; wird sie zurückgenommen, schaltet der Client den Stream selbst ab.

| Videobeweis | Live | Verhalten |
|---|---|---|
| aus | aus | Kamera und Encoder aus |
| an | aus | wie bisher |
| aus | an | Encoder läuft, Blöcke gehen **nur** an den Slave, keine Speicherung (kein Clip, kein Zwischenspeicher) |
| an | an | dieselben Blöcke an Master und Slave |

- **Anzeige:** Chips in der Kopfleiste neben Matte/Pool/Zeit und Badge am Menüknopf „Video":
  `● REC` (Videobeweis, mit Zahl nicht übertragener Clips) und `▶ LIVE` mit Zustand: grau „wartet", rot „sendet · 1,9 Mbit/s",
  gelb „gedrosselt", orange „Fehler/nicht freigegeben". Umsetzung über ein Ereignis `hajime:video-status` aus `video.js`
  (Muster wie `hajime:kampf`), `steuerungMenue.js` setzt Badge und Chips (das Abfragen der Checkbox im Sekundentakt entfällt).

## 9. Datenmengen (Schätzung)

| Strecke | Menge |
|---|---|
| Snapshot-Uplink (150 Teilnehmer, ca. 400 Kämpfe, 8 h, Änderungsversand, gzip) | ca. 20–30 MB pro Tag (Delta: 3–5 MB) |
| Livestream 720p, 2,5 Mbit/s, nur während Kämpfen, 4 Matten, 8 h | ca. 20 GB (Dauerbetrieb: ca. 35 GB) |
| Livestream 480p, ca. 1 Mbit/s, 4 Matten | ca. 8–14 GB |
| Handys (Abruf, Push) | 1–3 MB pro Gerät und Stunde; Cloud-Ausgang bei 300 Geräten ca. 3–7 GB |

Der Upload am Standort ist vorher zu messen (Phase 4 braucht bei 4 Matten bis zu 10 Mbit/s).

## 10. Datenschutz und Recht

- Opt-in je Turnier durch den Veranstalter (`live_freigabe`); ohne Freigabe sendet der Live-Prozess nichts.
- Minimale Felder: Name, Verein, Klasse, Matte, Position; kein Geburtsdatum, Gewicht, keine Passnummer.
- Hinweis zur Veröffentlichung bei der Anmeldung/Ausschreibung (Eltern), Löschung nach dem Turnier.
- Livestream öffentlich: Hinweis in der Ausschreibung und Aushang in der Halle, keine Aufzeichnung in der Cloud, Möglichkeit, eine
  Matte vom Stream auszunehmen (Schalter ist je Matte). **Vorab mit Landesverband/Datenschutzbeauftragtem klären** (keine
  Rechtsberatung in diesem Dokument).
- Rate-Limit und keine Aufzählung ohne Suchbegriff in der App-API.

## 11. Fehlerfälle

| Fall | Verhalten |
|---|---|
| Uplink oder Internet am Slave fällt aus | Cloud behält den letzten Stand, App zeigt `stand` und „Halle nicht verbunden", kein Push |
| Slave-Rechner fällt aus | wie oben; das Turnier läuft weiter (Cluster schaltet die Replikation auf asynchron) |
| Mobilfunk des Handys fehlt | keine Aktualisierung/Push; angezeigt wird der zuletzt geladene Stand |
| Reihenfolge ändert sich (Drag & Drop, Matte verteilt, Nachzügler) | Kachel zeigt den aktuellen Wert; kein zweiter Push für denselben Kampf |
| Nachzügler im Sammelpool | Hinweis, keine Matte, kein Abstand |
| Cloud nicht erreichbar | Wiederholung mit Backoff, voller Stand danach |
| Teilnehmer nicht angetreten / disqualifiziert | „keine weiteren Kämpfe", ggf. „Abgeschlossen" bei abgeschlossenem Pool |
| Kamera getrennt/GoPro schläft | Live-Zustand „Fehler", Kamera wird neu geöffnet; Videobeweis-Clip folgt der bestehenden Wiederaufnahme |
| Teilnehmer-WLAN gewünscht (später) | Snapshot-Builder und `liveKachel.js` bleiben unverändert; neuer Auslieferungsweg (HTTPS mit echter Domain, Split-DNS) wäre ein eigenes Vorhaben |

## 12. Tests und Spikes

**Automatisiert:**
- Unit: `tests/unit/liveKachel.test.js` (alle Zustände, Abstand, Platz, Push-Übergang), Snapshot-Builder gegen eingebettetes
  PostgreSQL (`tests/helpers/testPostgres.js`), Rolle `live_ro` (kein Zugriff auf andere Tabellen, kein Schreiben), Hash-/Delta-Logik.
- E2E (Cloud-Modus): Ingest → App-API (Suche, Pool, Übersicht), Sperre ohne Freigabe, Rate-Limit.
- E2E Steuerung: die vier Schalterkombinationen, gesperrter Zustand, Aus-nach-Neuladen, Statuschips (`tests/e2e/video.spec.js`, Fake-Kamera).

**Spikes vor Phase 4:**
1. GoPro-Webcam-Modus: 8 h Dauerbetrieb (Wärme), Wiederverbinden nach Standby/Kabelzug, 5 m USB-2-Kabel mit Hub und Netzteil.
2. CPU der alten Matten-Notebooks mit Clip plus zweitem Senden; Verfügbarkeit von H.264 im Chromium des Desktop-Clients.
3. Cloud-Umcodierung VP8 → HLS: Latenz und CPU bei bis zu 4 Matten.
4. Upload der Standort-Verbindung (Tethering/Starlink) mit Messung in der Halle.

## 13. Phasen

1. **Phase 1** Live-Prozess, Views/Rolle, Snapshot, Uplink, Freigabeschalter am Turnier, Netzwerk-Anleitung.
2. **Phase 2** Cloud-Lesemodell, App-API, PWA (Suche, Pool-Ansicht, Stern, Übersicht).
3. **Phase 3** Push und Glocke, Bündelung.
4. **Phase 4** Livestream (nach Spikes): Schalter/Statusanzeige, Zweit-Upload, Stream-Relay, Cloud-Umcodierung, Player, Kachelknopf.

## 14. Offene Punkte

- Aufbewahrungsfrist der Live-Daten in der Cloud (Vorschlag 7 Tage).
- Produktname und URL der Teilnehmer-App.
- Zielwert für Livestream-Qualität nach Messung des Uplinks.
- Mannschaftskämpfe in der Übersicht (eigene Regel für Begegnung vs. Einzelkampf).
