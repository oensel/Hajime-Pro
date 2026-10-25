# Cloud-Live-Betrieb: Turniere live aus der Cloud führen

Stand: 2026-10-24. Entwurf nach Brainstorming mit Bastian Haas.

## Absicht und Hintergrund

Heute läuft der Wettkampftag nur am Hallen-Server: Matten-Notebooks, Waage und Scoreboard
koppeln sich per WLAN (Kopplungs-QR, `SYNC_SECRET`) an ihn, die Cloud dient nur der Planung
(Anmeldung, Auslosung, Helferplan) und der Übergabe per Export. Fällt der Hallen-Server aus oder
gibt es keinen, ist der Wettkampftag nicht führbar.

Neu: Die Cloud kann ein Turnier **live führen**, so wie ein Hallen-Server, nur über das Internet.
Für Geräte (Notebooks, Android-Handys, Android-App) soll sich die Benutzung nicht unterscheiden.
Ein Admin vor Ort schaltet das Turnier in der Cloud live und steuert es von dort. Der Hallen-Server
bleibt der **bevorzugte** Weg, die Cloud ist die zweite Möglichkeit.

## Typische Halle (Randbedingungen)

- Ein Notebook je Matte (Scoreboard/Steuerung, Mattenansicht).
- Ein bis zwei Android-Handys an der Waage (App, Wiegen per Judopass-QR).
- Ein WLAN mit Internetzugang.
- In der Cloud laufen bis zu **10 Turniere verschiedener Vereine gleichzeitig** live, auch am
  selben Tag zur selben Zeit.

## Ziele

1. Die Cloud führt ein Turnier live (Dokument-DB, Abgleich, Brücke wie am Hallen-Server).
2. Geräte verbinden sich per **Kopplungs-QR** mit der Cloud, genau wie mit dem Hallen-Server.
3. Beim Start suchen Geräte zuerst einen Hallen-Server im WLAN; ohne Fund fragen sie den Benutzer,
   ob sie sich mit der Cloud verbinden sollen (nie ohne Rückfrage).
4. Bis zu 10 Live-Turniere parallel, streng getrennt nach Turnier (und damit Verein).
5. Ein Admin schaltet ein Turnier bewusst live und beendet den Live-Betrieb wieder.
6. Android-Handys können wiegen und senden die Daten an die Cloud (wenn dort live) oder an den
   Hallen-Server (wenn dort).

## Nicht-Ziele

- **Kein Mischen:** Ein Turnier läuft entweder am Hallen-Server **oder** in der Cloud, nie an
  beiden. Kein Übernehmen eines laufenden Turniers von einem zum anderen.
- **Keine Durchsage** in der Cloud (braucht den Audio-Ausgang des Hallen-Servers).
- **Kein Live-Streaming von Videos und kein Server-Archiv** in der Cloud. Der Videobeweis läuft
  im Cloud-Betrieb **lokal auf den Matten-Clients** (Aufnahme und Ansicht auf dem Gerät, keine
  Übertragung). Streaming (`video-live.html`) und Server-Ablage gibt es nur mit Hallen-Server.
- Kein Cluster-Betrieb der Cloud (ein Cloud-Prozess genügt für 10 Turniere).
- Keine Änderung des Hallen-Server-Betriebs, der Teilnehmer-App-Uplink-Logik oder der
  Planungsfunktionen der Cloud.

## Anti-Ziele (wäre ein Fehlschlag, auch wenn es technisch läuft)

- Ein Gerät sieht oder verändert Daten eines fremden Turniers.
- Ein Turnier ist gleichzeitig live in der Cloud und am Hallen-Server (zwei „führende“ Quellen).
- Geräte wechseln ohne Rückfrage von Hallen-Server zur Cloud.
- Merklich andere Bedienung an der Matte oder Waage als im Hallennetz.

## Entscheidungen (von Bastian)

- Kopplung per QR/Code wie beim Hallen-Server (kein Benutzerlogin auf den Geräten).
- Live-Schalten ist eine bewusste Aktion des Admins in der Cloud, Hallen-Server bleibt bevorzugt.
- Entweder Hallen-Server oder Cloud, nie gemischt.
- Bis zu 10 Turniere parallel in der Cloud.
- Audio-Durchsage nur am Hallen-Server; Videobeweis lokal auf den Matten-Clients, Streaming nur
  mit Hallen-Server.
- **Bedient wird nur an Geräten:** Der Admin schaltet in der Cloud live und zeigt den
  Kopplungs-QR. Matte und Waage laufen auf den gekoppelten Notebooks/Handys mit lokaler
  Dokument-DB, die sich an die Cloud statt an den Hallen-Server hängen. Es gibt **keine**
  Steuerung (`steuerung.html`) direkt im Browser auf der Cloud ohne Client-Gerät.
- **Teilnehmer-App** funktioniert auch bei einem in der Cloud live geführten Turnier. Die Cloud
  speist das vorhandene Lesemodell (`live_*`-Tabellen) direkt aus dem Live-Turnier, ohne den
  Uplink eines Hallen-Servers.

## Berechtigungen und Abschottung (festgelegt von Claude, bitte prüfen)

- **Geräte-Rechte:** Das Geheimnis aus dem QR ist die Berechtigung, ohne Benutzerkonto, wie am
  Hallen-Server. Es gilt für die Dokument-DB genau eines Turniers.
- **Abschottung (Anti-Ziel „fremdes Turnier“):** Der `/db`-Schutz der Cloud lässt je Geheimnis
  genau einen Datenbanknamen zu und sperrt globale Endpunkte (`_all_dbs`, `_replicate`,
  `_users` u. ä.). Die Brücke lehnt Dokumente ab, die auf ein anderes Turnier zeigen, und wendet
  Änderungen nur im Rahmen des eigenen Turniers an.
- **Kopplungsdaten je Turnier** (in der Cloud-DB): Das Geheimnis liegt lesbar, weil der QR es
  wieder anzeigen muss. Der 6-stellige Code gilt nur zusammen mit dem Turnierschlüssel im QR/Link.
  Fehlversuche werden je IP und je Turnier begrenzt (Vorbild `erzeugeSperre`). Der Zugang ist
  erneuerbar und sperrbar und läuft um 06:00 Uhr (Berliner Zeit) am Tag nach dem Turniertag ab
  (Vorbild Zugang der Teilnehmer-App, `src/liveCloud/zugang.js`) oder mit „Live beenden“.
- **Live beenden:** Schreibt den letzten Stand der Dokument-DB in die relationale Datenbank
  zurück (wie `deaktiviereTurnier` am Hallen-Server), schließt die Kopplung und löscht die
  Dokument-DB. Die relationale DB bleibt führend. Vorher zeigt die Cloud, wie viele Geräte noch
  ungesendete Änderungen haben (Heartbeat-Feld `ausstehend`); der Admin kann warten oder
  trotzdem beenden. Spätere Replikation wird danach abgelehnt, das Gerät sichert seine
  ungesendeten Änderungen wie beim Turnierwechsel unter `<SYNC_DATENVERZEICHNIS>/verworfen/`.
- **Sperre gegen Mischen:** Die Cloud merkt sich, wenn ein Turnier über die Holen-Aktion auf
  einen Hallen-Server geholt wurde. Live-Schalten verlangt dann eine ausdrückliche Bestätigung
  mit Warnhinweis, die der Admin bewusst übergehen kann (die Cloud erfährt nicht, ob der
  Hallen-Server wirklich läuft). Umgekehrt ist ein in der Cloud live geführtes Turnier nicht
  holbar, bis es beendet ist. Am Hallen-Server ändert sich nichts.
- **Neustart und Ausfall:** Die Cloud öffnet beim Start alle als live markierten Turniere neu.
  Ein Cloud-Ausfall bricht den Tag nicht ab, weil die Geräte lokal weiterarbeiten und danach
  nachreplizieren. Hochverfügbarkeit der Cloud ist nicht nötig. Ressourcenbudget: bis zu 10
  gleichzeitig geöffnete Turnier-Instanzen in einem Prozess.
- **Offline-Verhalten** der Geräte bleibt wie heute: lokale PouchDB, Nachreplikation bei
  Wiederverbindung, auch bei Internetausfall im Cloud-Betrieb.

## Funktionen im Cloud-Live-Betrieb

- Funktionieren wie am Hallen-Server: Waage, Matte/Scoreboard, Zeitprognose, Pool-Beginn-Hinweis,
  Sync-Konflikte, Teilnehmer-App.
- Entfallen: Durchsage, Video-Streaming und Server-Archiv, Cluster, Turnierleitungs-Passwort
  (die Geräte sind per Kopplung berechtigt, der Admin per Konto beim Live-Schalten).
- Welche weiteren Funktionen `turniere.aktiv` bzw. Einzelbenutzerbetrieb voraussetzen, prüft der
  Builder und meldet Abweichungen.

## Bestehende Architektur, an die angeknüpft wird (Befund aus dem Code)

- Dokument-DB je Turnier existiert bereits (`turnier_<instanz_id>`, `src/shared/dokumentNamen.js`);
  Replikation läuft über URL + Header `x-hajime-sync-secret`.
- `src/sync/syncDienst.js` hält genau **eine** Instanz (ein `zustand`-Objekt mit Dokument-DB,
  Abgleich, Brücke) und lädt über `turniere.aktiv` genau ein Turnier. Das muss für die Cloud auf
  mehrere gleichzeitige Instanzen erweitert werden (Verwalter, der je Live-Turnier ein solches
  Bündel öffnet/schließt).
- `src/sync/kopplung.js` kennt ein Geheimnis und einen 6-stelligen Code je Server (Datei
  `kopplung.json`). In der Cloud müssen Geheimnis und Code je Turnier in der Datenbank liegen;
  die Fehlversuch-Sperre je IP (`erzeugeSperre`) bleibt nutzbar.
- Der `/db`-Schutz prüft heute ein globales Geheimnis und nur die Datenbank der aktuellen
  Instanz. In der Cloud muss er zusätzlich sicherstellen, dass ein Gerät nur die Datenbank
  seines Turniers erreicht.
- Cloud-Modus (`BETRIEBSMODUS=cloud`) hat heute keine Sync-Schicht; Mehrbenutzer-Login ist dort
  Standard, `requireWriteAuth` kennt nur Einzelbenutzer-/Passwort-Betrieb.

## Geräteseite

- Client-Geräte (Desktop-Client, Node-Client, Android-App) bekommen eine Serverauswahl:
  1. mDNS-Suche nach einem Hallen-Server (`_hajime._tcp`) im WLAN.
  2. Gefunden: wie heute verbinden.
  3. Nicht gefunden: Rückfrage „Kein Turnier-Server gefunden. Mit der Cloud verbinden?“;
     bei Ja Kopplung per QR/Code gegen die Cloud-Adresse.
- Die gekoppelte Cloud-Adresse und das Geheimnis werden wie heute lokal gemerkt.
- Waage-Handys (Android-App) nutzen dieselbe Auswahl und senden Wiegungen in die Dokument-DB des
  jeweiligen Servers.

## Offen, dem Builder überlassen

- Genaue Gestalt des Instanz-Verwalters, Speicher-/Verbindungsgrenzen bei 10 Turnieren.
- Datenbankmodell für Live-Zustand, Geheimnis und Code je Turnier (Migration).
- Ablauf der Wiederaufnahme nach Neustart der Cloud (laufende Live-Turniere erneut öffnen).
- Bedienoberfläche für „Live schalten/beenden“ und Kopplungs-QR in der Cloud (Vorbild:
  `client-konfig.html`, `turniere.html`).
- Wie Client-Geräte die Cloud-Adresse nach der Kopplung auflösen, wenn sie dieselben
  `/api/…`-Aufrufe wie am Hallen-Server absetzen (Client-API bleibt lokal, nur Replikation geht
  zur Cloud).
- Wie die Android-App die WLAN-Suche nach dem Hallen-Server bekommt (heute koppelt sie nur per
  QR, die mDNS-Suche gibt es bisher nur im Desktop-Client); eventuell ein Capacitor-Plugin.
- Lokaler Videobeweis auf den Clients ohne Server-Archiv (Aufnahme ist bereits lokal in
  IndexedDB, Ansicht/Löschen ohne Server-Pfad muss ergänzt werden).
- Test-Strategie (Sync-Suite um Cloud-Knoten mit mehreren Turnieren erweitern).
