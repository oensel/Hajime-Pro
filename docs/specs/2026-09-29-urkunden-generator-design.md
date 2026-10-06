# Urkunden-Generator — Design

Stand: 2026-09-29 · Branch `feature/urkunden-generator`

## Ziel

Nach einem Turnier sollen ca. 100 individuelle Urkunden in einem Durchgang erzeugt, im Browser
geprüft und gedruckt werden können. Der Turniermanager lädt dazu eine Blanko-Urkunde (PDF) hoch,
platziert Textfelder mit Platzhaltern per Canvas-Editor und lässt den Server daraus ein einziges
mehrseitiges PDF erzeugen.

**Erfolgskriterien**

- Eine Vorlage wird einmal pro Verein angelegt und für alle künftigen Turniere wiederverwendet.
- Ein Klick erzeugt ein PDF mit einer Seite pro Urkunde für die gewählten Pools und Platzierungen
  (1.–3., 1.–5., 1.–7., alle); Einzel- und Mannschaftswettkämpfe.
- Die Platzierungen stimmen mit der Siegerliste überein (eine gemeinsame Berechnung).
- Kein Text ragt über den vorgesehenen Rahmen hinaus (automatische Verkleinerung).
- Namen mit Zeichen außerhalb von WinAnsi (Ł, Ş, Đ, …) werden korrekt gedruckt.
- Funktioniert in der Cloud und auf dem Hallen-Server, nicht auf Client-Geräten.

**Nicht im Umfang**

- Mehrseitige Vorlagen (nur Seite 1 des Blanko-PDFs wird genutzt).
- Eigene Schrift-Uploads (feste, mitgelieferte Auswahl; später nachrüstbar).
- Bilder/Logos als eigene Felder (gehören in das Blanko-PDF).
- Rück-Synchronisierung von Vorlagen-Änderungen vom Hallen-Server in die Cloud.
- Mehrzeilige Textfelder.

## Fachliche Regeln

### Platzierungen je Modus

| Modus | Platz 1/2 | Platz 3 | Platz 5 | Platz 7 |
|---|---|---|---|---|
| Doppel-KO-8 | Finale `F` | Sieger `T3`, `T4` | Verlierer `T3`, `T4` | Verlierer `T1`, `T2` |
| Doppel-KO-16 | Finale `F1` | Sieger `T11`, `T12` | Verlierer `T11`, `T12` | Verlierer `T9`, `T10` |
| Doppel-KO-32 | Finale `F1` | Sieger `T27`, `T28` | Verlierer `T27`, `T28` | Verlierer `T25`, `T26` |
| Gruppen-Überkreuz | Finale `F1` | Verlierer `HF1`, `HF2` (kein kleines Finale; ältere Pools mit `F2`: Sieger `F2`, Platz 4 = Verlierer `F2`) | Gruppenplatz 3 beider Gruppen (geteilt) | Gruppenplatz 4 beider Gruppen (geteilt) |

- **Jeder-gegen-Jeden:** fortlaufende Rangfolge 1, 2, 3, 4, 5 … nach Siegen, dann
  Wertungspunkten (Regel wie bisher in `siegerliste.js`).
- **Pool mit einem Teilnehmer:** Platz 1.
- Aus einem `freilos`-Kampf entsteht kein Verlierer-Platz.
- **Platzbereich** 1.–N umfasst alle Einträge mit `platz <= N` (also bei Jeder-gegen-Jeden
  auch Platz 4).
- **„alle":** jede:r Teilnehmer:in eines gewählten Pools erhält eine Urkunde; wer keinen Platz hat,
  bekommt `{Platzierung}` = „Teilnahme".
- **Mannschafts-Pools** (Jeder-gegen-Jeden, Doppel-KO-8/16) nach denselben Regeln auf Ebene der
  Begegnungen (`mannschaftskaempfe.sieger_mannschaft_id`; bei Jeder-gegen-Jeden Rangfolge nach
  Begegnungssiegen, dann Einzelsiegen, dann Wertungspunkten). Jedes in `mannschaft_mitglieder`
  eingetragene Mitglied der platzierten Mannschaft erhält eine eigene Urkunde — unabhängig davon,
  ob es gekämpft hat.

### Platzhalter

| Platzhalter | Quelle | Beispiel |
|---|---|---|
| `{Name}` | `vorname + ' ' + nachname` | Anna Muster |
| `{Verein}` | `turnier_teilnehmer.verein` (Verein des Teilnehmers) | JC Musterstadt |
| `{Platzierung}` | berechnet | „1. Platz" / „Teilnahme" |
| `{Altersklasse}` | Pool | U15 |
| `{Geschlecht}` | Pool (`m`/`w` → „männlich"/„weiblich") | weiblich |
| `{Gewichtsklasse}` | Pool; bei Mannschaftsmitgliedern die Gewichtsklassen-Position des Mitglieds | -44 kg |
| `{Mannschaft}` | `mannschaften.bezeichnung`; bei Einzelurkunden leer | JC Musterstadt I |

Ein Textfeld enthält beliebigen Text, in dem Platzhalter vorkommen dürfen
(z. B. `{Altersklasse} · {Gewichtsklasse}`). Ein Feld ohne Platzhalter ist ein **fester Text**
(Turniername, Datum, Ort, …). Unbekannte `{…}` bleiben unverändert stehen.

Feste Texte werden im Editor über **„+ Freier Text"** angelegt und wie Platzhalterfelder
positioniert und formatiert. Da Vorlagen vereinsweit für alle Turniere gelten, wird ein festes
Datum/Ort vor dem Turnier in der Vorlage angepasst — oder die Vorlage pro Turnier dupliziert.

### Reihenfolge der Seiten

Pools sortiert nach Altersklasse → Geschlecht → Gewichtsklasse (wie Siegerliste), Einzel- vor
Mannschafts-Pools. Innerhalb eines Pools wählbar:

- **Siegerehrung** (Standard): letzter Platz → 1. Platz („Teilnahme" zuerst)
- **Aufsteigend**: 1. Platz → letzter Platz

Bei gleichem Platz: nach Nachname; Mannschaftsmitglieder nach Gewichtsklassen-Position.

## Architektur

```
urkunden.html / urkunden.js ──(REST)──► /api/urkunden  (requireWriteAuth)
   │  Fabric.js + pdf.js                    │
   │  shared/urkundenText.js ◄──────────────┤  controllers/urkundenController.js
   │  shared/urkundenSchriften.js ◄─────────┤  services/urkundenRenderer.js (pdf-lib + fontkit)
   │                                        │  services/urkundenDaten.js   (DB → Datensätze)
   └── siegerliste.js ──► shared/platzierungen.js ◄──┘
```

### Datenmodell — neue Tabelle `urkunden_vorlagen`

| Spalte | Typ | Inhalt |
|---|---|---|
| `id` | increments | |
| `verein_id` | integer FK `vereine.id`, `ON DELETE CASCADE` | Besitzer |
| `name` | string, not null | `unique(verein_id, name)` |
| `pdf` | binary, not null | Blanko-PDF |
| `pdf_dateiname` | string | Anzeige |
| `seiten_breite_pt`, `seiten_hoehe_pt` | float | beim Upload aus Seite 1 gelesen (`/Rotate` berücksichtigt) |
| `felder` | text (JSON), Standard `[]` | Feldliste |
| `platzbereich` | string, Standard `'3'` | Voreinstellung: `'3'` \| `'5'` \| `'7'` \| `'alle'` |
| `reihenfolge` | string, Standard `'siegerehrung'` | Voreinstellung: `'siegerehrung'` \| `'aufsteigend'` |
| `bei_abschluss_anbieten` | boolean, Standard `false` | Druck beim Pool-Abschluss anbieten; höchstens eine Vorlage je Verein (Setzen löscht das Flag der anderen) |
| `created_at`, `updated_at` | timestamps | |

Feld-JSON (Koordinaten in PDF-Punkten, Ursprung **oben links**, `y` = Oberkante der Zeile):

```json
[{ "id": "f1", "text": "{Platzierung}", "x": 97.6, "y": 410, "breite": 400,
   "schrift": "noto-serif-bold", "groesse": 36, "farbe": "#1a1a1a",
   "ausrichtung": "zentriert" }]
```

`ausrichtung` ∈ `links` | `zentriert` | `rechts`, bezogen auf den Rahmen `x … x+breite`.
Serverseitige Validierung: bekannte Schrift-ID, `groesse` 4–200, Farbe `#rrggbb`, Rahmen
innerhalb der Seite, höchstens 50 Felder, Text höchstens 200 Zeichen.

### Gemeinsame Module (`src/shared/`, framework-/DB-frei)

- **`platzierungen.js`**
  - `berechnePlatzierungen(pool, kaempfe, teilnehmer)` →
    `{ abgeschlossen, eintraege: [{ platz: number|null, teilnehmer }] }`
  - `berechneMannschaftsPlatzierungen(pool, begegnungen, mannschaften)` →
    `{ abgeschlossen, eintraege: [{ platz: number|null, mannschaft }] }`
  - `abgeschlossen` = alle platzrelevanten Kämpfe/Begegnungen sind `beendet`/`freilos`
    (Jeder-gegen-Jeden: alle). Noch offene Plätze bleiben `null`.
  - Für die Gruppenränge beim Überkreuz wird `berechneGruppenRangliste` aus
    `gruppenUeberkreuzProgression.js` exportiert und wiederverwendet.
- **`urkundenText.js`**
  - `ersetzePlatzhalter(text, datensatz)`
  - `passeGroesseAn(text, groesse, breite, misstBreite)` → `{ groesse, passt }` — verkleinert in
    0,5-pt-Schritten bis höchstens 50 % der Ausgangsgröße; `misstBreite(text, groesse)` wird
    injiziert (Browser: Canvas `measureText`, Server: `font.widthOfTextAtSize`).
  - `berechneX(ausrichtung, x, breite, textBreite)`
- **`urkundenSchriften.js`** — Liste `{ id, anzeigename, datei }` der mitgelieferten Schriften.

Der Browser lädt die Module über den vorhandenen Static-Mount `/js/shared`.
`siegerliste.js` wird auf `platzierungen.js` umgestellt (Anzeige bleibt Platz 1–3,
Vereinswertung unverändert).

### Schriften

Mitgeliefert unter `public/fonts/urkunden/` (SIL Open Font License, Lizenztexte daneben):
Noto Sans (Regular, Bold), Noto Serif (Regular, Bold), Great Vibes (Schreibschrift), Cinzel
(Titel). Der Browser lädt sie per `FontFace`, der Server liest dieselben Dateien und bettet sie
per `@pdf-lib/fontkit` mit **Subsetting** ein. Zeichen, die die gewählte Schrift nicht kennt,
erzeugen eine Warnung.

### Server

**Neue Abhängigkeiten:** `pdf-lib`, `@pdf-lib/fontkit` (Server); `fabric`, `pdfjs-dist`
(Frontend, ausgeliefert aus `node_modules` wie `material-components-web`).

**Routen `src/routes/urkundenRoutes.js`** (`getUrkundenRoutes(knex)`, gemountet unter
`/api/urkunden` mit `requireWriteAuth`):

| Methode | Pfad | Zweck |
|---|---|---|
| GET | `/vorlagen?turnierId=` | Vorlagen des Ausrichter-Vereins (ohne PDF-Binary) |
| GET | `/vorlagen/:id/pdf` | Blanko-PDF für den Editor |
| POST | `/vorlagen` | `{ turnierId, name, pdf_base64, pdf_dateiname }` — anlegen |
| POST | `/vorlagen/:id/duplizieren` | `{ name }` |
| PUT | `/vorlagen/:id` | `{ name?, felder?, platzbereich?, reihenfolge?, bei_abschluss_anbieten? }` |
| DELETE | `/vorlagen/:id` | löschen |
| GET | `/uebersicht?turnierId=` | Pools mit Status, `abgeschlossen` (Plätze stehen fest) und Anzahl Urkunden je Platzbereich; Beispieldatensatz (längster Name, längster Verein) für den Editor |
| GET | `/abschluss-angebot?poolId=` | `{ vorlage: { id, name, platzbereich, reihenfolge } \| null, anzahl }` — die Vorlage mit `bei_abschluss_anbieten` des Ausrichter-Vereins und die Zahl der Urkunden für diesen Pool mit ihren Voreinstellungen |
| POST | `/generieren` | `{ turnierId, vorlageId, platzbereich: 3\|5\|7\|'alle', poolIds, reihenfolge: 'siegerehrung'\|'aufsteigend' }` → `application/pdf` |

- **Rechte:** nur freigegebene Mitglieder des ausrichtenden Vereins
  (`hatVereinsZugriffAufTurnier`), im Offline-Betrieb wie der übrige Offline-Zugriff. Eine
  Vorlage darf nur verwenden/ändern, wer Zugriff auf ihren Verein hat.
- **PDF-Upload:** höchstens 10 MB, muss sich mit `PDFDocument.load` öffnen lassen, verschlüsselte
  PDFs werden abgelehnt (400). Body-Limit nur für diese Route anheben.
- **`services/urkundenDaten.js`:** lädt Pools, Kämpfe, Teilnehmer, Mannschaften, Mitglieder und
  Begegnungen des Turniers, ruft `platzierungen.js` auf, filtert nach Platzbereich/Pools, sortiert
  und liefert flache Datensätze `{ Name, Verein, Platzierung, Altersklasse, Geschlecht,
  Gewichtsklasse, Mannschaft }`.
- **`services/urkundenRenderer.js`:** lädt das Blanko-PDF einmal, bettet die verwendeten Schriften
  einmal ein, kopiert Seite 1 per `copyPages` je Datensatz und zeichnet die Felder
  (`pdfY = seitenHoehe - y - ascent(groesse)`). Ergebnis `{ bytes, warnungen: [{ seite, name,
  feld, grund }] }`.
- **Antwort `/generieren`:** `application/pdf`,
  `Content-Disposition: inline; filename="urkunden_<turnierId>_<datum>.pdf"`, Header
  `X-Urkunden-Anzahl` und `X-Urkunden-Warnungen` (URL-kodiertes JSON, höchstens 50 Einträge).
  Keine Datensätze → 422 mit Meldung.
- **Cluster:** `nurMaster` blockiert jeden POST auf dem Secondary. `/urkunden/generieren` schreibt
  nichts und wird in `AUSNAHMEN` aufgenommen, damit auch am Secondary gedruckt werden kann. Die
  Vorlagen-Routen bleiben gesperrt (409).
- **Sync:** Vorlagen sind keine Live-Daten und werden nicht in die Dokument-DB gespiegelt.

### Turnier-Export/-Import

- `exportTurnier` hängt `urkunden_vorlagen: [{ name, pdf_base64, pdf_dateiname,
  seiten_breite_pt, seiten_hoehe_pt, felder, platzbereich, reihenfolge, bei_abschluss_anbieten }]`
  des Ausrichter-Vereins an.
- `importTurnier` (Hallen-Server) legt sie beim per Ausrichter-Name zugeordneten Verein an bzw.
  überschreibt gleichnamige Vorlagen dieses Vereins. Ältere Exportdateien ohne das Feld
  funktionieren unverändert.
- `importTurnierErgebnisse` (Rückweg in die Cloud) rührt Vorlagen nicht an. Die Oberfläche weist
  am Hallen-Server darauf hin: „Änderungen an Vorlagen werden nicht in die Cloud übertragen."

### Frontend — `urkunden.html` + `public/js/urkunden.js`

Menüpunkt „Urkunden" in `menu.js` direkt nach „Siegerliste" (mit `turnierId`-Parameter wie die
übrigen). Auf Client-Geräten nicht verfügbar (Hinweis wie andere Verwaltungsseiten).

**Karte „Vorlagen"**

- Auswahl der Vereinsvorlagen, Knöpfe *Neu* (Name + PDF), *Duplizieren*, *Umbenennen*, *Löschen*.
- Canvas: `pdfjs-dist` rendert Seite 1 als Hintergrund eines Fabric-Canvas (auf Kartenbreite
  skaliert, Faktor px/pt gemerkt, Neurender bei Größenänderung).
- Felder als Fabric-`Textbox` (einzeilig, feste Breite; verschieben und Breite ziehen; Höhe und
  Drehung gesperrt).
- Werkzeugleiste des gewählten Feldes: Textinhalt, Platzhalter-Knöpfe (einfügen an der
  Cursorposition), Schrift, Größe, Farbe, Ausrichtung, „auf Seite zentrieren", Löschen.
- Knöpfe **„+ Platzhalterfeld"** (startet mit `{Name}`) und **„+ Freier Text"**.
- Schalter **„Beispieldaten"**: zeigt die Felder mit dem Beispieldatensatz und derselben
  Verkleinerungsregel wie der Server.
- Explizites *Speichern* (Rückrechnung in pt), Warnung beim Verlassen mit ungespeicherten
  Änderungen.
- **Voreinstellungen der Vorlage:** Platzbereich, Reihenfolge und Schalter
  „Beim Pool-Abschluss Druck anbieten" (werden mit *Speichern* übernommen).

**Karte „Urkunden generieren"**

- Vorlage, Platzbereich (1.–3. / 1.–5. / 1.–7. / alle), Reihenfolge (Siegerehrung / aufsteigend);
  Platzbereich und Reihenfolge werden beim Wählen einer Vorlage aus deren Voreinstellungen
  vorbelegt.
- Pool-Liste mit Checkboxen, gruppiert Einzel/Mannschaft; standardmäßig angehakt sind Pools mit
  Status `abgeschlossen` (am Tisch bestätigt); nicht abgeschlossene tragen den Hinweis „noch nicht
  abgeschlossen" und liefern bei Auswahl nur die bereits feststehenden Plätze. Anzeige
  „≈ N Urkunden".
- *Urkunden generieren* → Vorschau-Modal (siehe unten). Warnungen werden unter der Vorschau
  gelistet (Seite, Name, Feld).

**Gemeinsames Modul `public/js/urkundenDruck.js`**

- `zeigeUrkundenVorschau(parameter)`: `fetch` auf `/generieren` → Blob → Modal mit `<iframe>`
  (Object-URL) und Knöpfen *Drucken* (`iframe.contentWindow.print()`), *In neuem Tab öffnen*,
  *Herunterladen*; Warnungsliste. Wird von `urkunden.js`, `pools.js` und `mannschaften.js` genutzt.
- `bieteUrkundenNachAbschlussAn(turnierId, poolId)`: siehe nächster Abschnitt.

### Druck direkt nach dem Pool-Abschluss

Damit Urkunden in kleinen Stapeln pro Pool gedruckt werden können:

1. Nach erfolgreichem `POST /api/pools/:id/abschliessen` rufen `pools.js`
   (`confirmFightplanBtn`) und `mannschaften.js` (`.confirm-pool-btn`)
   `bieteUrkundenNachAbschlussAn(turnierId, poolId)` auf.
2. Das Modul fragt `GET /api/urkunden/abschluss-angebot?poolId=`. Keine Vorlage mit
   `bei_abschluss_anbieten`, `anzahl = 0`, 403 oder Netzwerkfehler → nichts passiert (der
   Abschluss selbst ist davon unabhängig und bereits erledigt).
3. Sonst Bestätigungsdialog: „Urkunden für U15 w -44 kg drucken? Vorlage *Standard*, Platz 1–5,
   Siegerehrung · 5 Urkunden" mit *Drucken* / *Später*.
4. *Drucken* → `zeigeUrkundenVorschau({ turnierId, vorlageId, platzbereich, reihenfolge,
   poolIds: [poolId] })`; nach dem Laden des PDFs wird der Druckdialog automatisch geöffnet.
   Lässt der Browser das nicht zu, bleibt die Vorschau mit dem Knopf *Drucken* offen.

Die Seiten `pools.html` und `mannschaften.html` binden dafür `urkundenDruck.js` ein. Auf dem
Secondary im Cluster ist das Abschließen ohnehin gesperrt, der Dialog erscheint dort nicht.

## Fehlerfälle

| Fall | Verhalten |
|---|---|
| Ungültiges, verschlüsseltes oder zu großes PDF | 400, Meldung im Upload-Dialog |
| Vorlagenname im Verein doppelt | 409, Meldung |
| Vorlage ohne Felder | Generieren möglich, Hinweis im Formular |
| Keine Urkunden für die Auswahl | 422 „Für diese Auswahl gibt es keine Urkunden." |
| Text passt auch bei 50 % nicht | gedruckt, Warnung |
| Zeichen fehlt in der Schrift | gedruckt, Warnung |
| Kein Vereinszugriff | 403 |
| Secondary im Cluster | Vorlagen ändern → 409, Generieren funktioniert |

## Tests

- **Unit (`tests/unit/`, `node:test`)**
  - `platzierungen.test.js`: alle Modi inkl. Platz 5/7, Freilose, unvollständige Pools,
    Jeder-gegen-Jeden-Rangfolge, Überkreuz-Gruppenplätze, Mannschafts-Pools.
  - `urkundenText.test.js`: Platzhalter-Ersetzung (inkl. unbekannter), Verkleinerung,
    Ausrichtungs-x.
  - `urkundenRenderer.test.js`: Blanko-PDF mit `pdf-lib` erzeugen, 3 Datensätze rendern →
    3 Seiten; Sonderzeichen (Ł, Ş); Warnung bei zu langem Text.
- **E2E (`tests/e2e/urkunden.spec.js`)** auf Basis von `helpers/pool-fixture-turnier.js`:
  Vorlage hochladen (Test-PDF in `tests/e2e/fixtures/`), Feld anlegen, speichern, neu laden →
  Feld vorhanden; Generieren 1.–3. / 1.–7. / alle → Seitenzahl des PDFs prüfen (`pdf-lib` im
  Test); Mannschafts-Pool → eine Seite je Mitglied; Siegerliste zeigt nach der Umstellung
  unverändert dieselben Plätze 1–3; Vorlage mit „Beim Pool-Abschluss Druck anbieten" und
  Platz 1–5 → Pool abschließen → Dialog erscheint, *Drucken* öffnet die Vorschau mit den
  Urkunden nur dieses Pools; ohne markierte Vorlage erscheint kein Dialog.
- **Export/Import:** vorhandenen Export/Import-Test um eine Vorlage erweitern (Rundreise von Name,
  Feldern und PDF).

## Überarbeitung 2026-09-30

Ersetzt die abweichenden Angaben weiter oben:

- **Seiten:** `urkunden.html` dient nur noch dem Generieren. Der Editor liegt auf
  `urkunden-designer.html` (eigener Menüpunkt „Urkunden-Designer“). Die Bearbeitungsfläche hat
  die halbe Kartenbreite, die Werkzeuge stehen daneben.
- **Vorlagen-Auswahl:** Ein Popup zeigt die Vorlagen mit Mini-Ansicht. Diese ist Seite 1 einer
  Beispiel-Urkunde von `GET /vorlagen/:id/vorschau`, gerendert per pdf.js.
- **Reihenfolge:** `absteigend` („letzter Platz zuerst“, Standard) und `aufsteigend`
  („1. Platz zuerst“). `siegerehrung` wird als alter Name von `absteigend` weiter angenommen.
- **Voreinstellungen entfallen:** Platzbereich, Reihenfolge und `bei_abschluss_anbieten` werden
  im Designer nicht mehr gepflegt. Die Spalten bleiben in der DB und im Export, werden aber nicht
  mehr ausgewertet.
- **Druck beim Pool-Abschluss:** wird immer angeboten, sobald der Ausrichter-Verein mindestens
  eine Vorlage hat. Im Dialog wählt man:
  - die Vorlage (Mini-Ansicht, vorausgewählt ist die zuletzt genutzte aus `localStorage`),
  - die Platzierungen (Standard 1.–3.),
  - die Reihenfolge.

  `GET /abschluss-angebot` liefert dazu `{ vorlagen: [{ id, name }], anzahl: { '3', '5', '7', 'alle' } }`.
- **Linien:** Waagerechte Linien werden als Feld gespeichert:
  `{ typ: 'linie', x, y, breite, staerke (0,5–10 pt), stil, farbe }`.
  - `stil` ist `durchgezogen`, `gepunktet` oder `gestrichelt`.
  - `y` ist die Linienmitte.
  - Das Strichmuster ist gemeinsam für Editor und Renderer in `src/shared/urkundenLinien.js`
    festgelegt.
  - Textfelder tragen optional `typ: 'text'`.
- **Hallen-Server:** Der Designer bleibt nutzbar. Änderungen dort gehen weiterhin nicht zurück in
  die Cloud.

### Ergänzung: Bilder, Standard-Rahmen, weitere Schriften

- **Bilder:** Bildfelder haben die Form `{ typ: 'bild', bild_id, x, y, breite, hoehe }`.
  - Erlaubt sind PNG oder JPEG bis 2 MB, höchstens 10 Bilder je Vorlage.
  - GIF wandelt der Designer im Browser in ein PNG mit Alphakanal um, weil pdf-lib kein GIF
    einbetten kann (bei animierten GIFs zählt das erste Bild). Transparente Bereiche von PNG
    (Alphakanal oder Palette mit `tRNS`) landen im PDF als Transparenzmaske (`SMask`).
  - Die Bilddaten liegen in der neuen Spalte `urkunden_vorlagen.bilder` (JSON
    `{ <bild_id>: { typ, daten } }`, Migration `20260930100000`).
  - `POST /vorlagen/:id/bilder` lädt ein Bild hoch, `GET /vorlagen/:id/bilder/:bildId` liefert es.
  - Beim Speichern der Felder werden Bilder entfernt, auf die kein Feld mehr verweist.
  - Duplizieren sowie Turnier-Export und -Import nehmen die Bilder mit. Beim Import werden
    ungültige Bilder verworfen; zeigt ein Feld auf ein fehlendes Bild, ist die Vorlage ungültig.
  - Der Renderer zeichnet in dieser Reihenfolge: Hintergrund → Bilder → Linien → Text.
  - Im Editor lassen sich Bilder nur über die Ecken skalieren, das Seitenverhältnis bleibt fest.
- **Standard-Rahmen:** Es gibt fünf Rahmen im Format A4 hoch: Klassisch, Ornament, Modern, Judo
  und Schlicht.
  - Sie liegen als Vektor-PDFs in `public/urkunden-rahmen/`, erzeugt von
    `scripts/erzeuge-urkunden-rahmen.mjs`.
  - `POST /vorlagen` nimmt statt `pdf_base64` auch `rahmen_id` an.
  - Der Designer bietet die Rahmen bei „Neue Vorlage“ und als Startauswahl an, solange es noch
    keine Vorlage gibt.
- **Schriften:** Neu sind Pinyon Script, Alex Brush (beide Schreibschrift) und
  UnifrakturMaguntia (Fraktur), jeweils unter SIL OFL.

### Ergänzung: gespeichertes PDF je Pool

- **Tabelle `urkunden_pdfs`** (Migration `20260930110000`): höchstens eine Zeile je Pool mit
  `pool_id` (eindeutig, wird mit dem Pool gelöscht), `vorlage_id`/`vorlage_name`, `platzbereich`,
  `reihenfolge`, `anzahl`, `pdf` und `erzeugt_am` (ISO-Text).
- **Speichern:** `POST /generieren` legt das erzeugte PDF je Pool ab und ersetzt das bisherige.
  - Bei mehreren Pools wird das Gesamt-PDF mit `teilePdf` (`urkundenRenderer.js`) je Pool zerlegt.
  - Der Header `X-Urkunden-Gespeichert` ist `1` oder `0`.
  - Am Secondary wird nichts gespeichert, der Druck funktioniert dort weiterhin. Ein Fehler beim
    Speichern verhindert den Druck nicht.
- **Routen:** `GET /pools/:poolId/pdf` liefert das PDF, `DELETE /pools/:poolId/pdf` löscht es.
  `GET /uebersicht` liefert je Pool zusätzlich `pdf: { vorlage_id, vorlage_name, platzbereich,
  reihenfolge, anzahl, erzeugt_am } | null`.
- **`urkunden.html`:** Pools mit PDF zeigen eine Markierung mit Erzeugungszeit und drei Knöpfen:
  - *Öffnen* zeigt das gespeicherte PDF in der Vorschau.
  - *Neu erzeugen* rendert mit den Einstellungen des vorhandenen PDFs. Gibt es dessen Vorlage
    nicht mehr, gilt die auf der Seite gewählte.
  - *Löschen* entfernt das PDF nach Rückfrage.
- **Nicht umgesetzt:** Das PDF wandert nicht mit dem Turnier-Export. Ob sich die Platzierungen
  seit dem Erzeugen geändert haben, wird nicht erkannt.
