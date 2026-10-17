# Mehrere Turniere am Hallen-Server: planen, aktivieren, duplizieren

Stand: 2026-10-17 · Status: Entwurf, vom Nutzer im Mockup freigegeben

## Ziel

Der Hallen-Server hält bisher genau ein Turnier; ein neues Turnier ersetzt das alte komplett
(`vorTurnierwechsel` + `leereTurnierdaten`). Künftig können mehrere Turniere nebeneinander
angelegt werden. Es ist aber immer höchstens eines **aktiv**; die übrigen warten als Entwurf oder
„geplant“ auf ihren Wettkampftag oder sind abgeschlossen.

## Regeln

1. **Ein Turnier pro Tag.** Mehrtägige Turniere werden als je ein Turnier pro Tag angelegt.
   Zwei Turniere am selben Hallen-Server dürfen nicht dasselbe `datum` haben (Prüfung beim Anlegen,
   Ändern, Duplizieren und Importieren; abgesagte Turniere zählen nicht).
2. **Höchstens ein aktives Turnier.** „Aktiv“ ist das Turnier, an dem der Sync-Dienst hängt
   (`zustand.turnierId`/`instanz_id`). Alle Live-Seiten (Matten, Waage, Scoreboard, Dashboard,
   Anzeige, Live-Uplink, Client-Geräte) arbeiten ausschließlich mit diesem.
3. **Aktivieren per Knopfdruck, nur am Wettkampftag.** Der Knopf „Aktivieren“ erscheint nur,
   wenn `datum` heute ist, das Turnier nicht abgeschlossen/abgesagt ist und kein anderes Turnier
   aktiv ist. Ein laufendes Turnier muss zuerst mit „Durchführung beenden“ abgeschlossen werden.
   Der Server prüft dieselben Bedingungen erneut.
4. **Abgeschlossene Turniere** bleiben erhalten (SQL-Daten bleiben), werden aber ausgegraut und
   einzeilig dargestellt. Sie sind schreibgeschützt wie bisher und lassen sich duplizieren.
5. Am Secondary (Cluster) gelten Anlegen, Aktivieren und Duplizieren wie alle Schreibzugriffe nur
   am Master (`nurMaster`).

## Datenmodell und Sync

* Keine neue Tabelle. `turniere.instanz_id` existiert bereits; `aktiviereTurnier(turnierId)` wechselt
  die Dokument-DB (alte Instanz schließen/löschen, neue öffnen). Die relationale DB bleibt führend,
  die gelöschte Dokument-DB eines beendeten Turniers kostet nichts.
* `vorTurnierwechsel()`/`leereTurnierdaten()` werden beim **Anlegen und Importieren nicht mehr**
  aufgerufen. Nur noch `sync.deaktiviere...` (Abgleich stoppen, Instanz schließen) beim Beenden
  und `aktiviereTurnier` beim Aktivieren.
* Neues Turnier / Import legt das Turnier nur in der DB an, **ohne** es zu aktivieren. Ist noch
  kein Turnier aktiv und es ist der Wettkampftag, bietet die Liste „Aktivieren“ an.
* Beim Start (`syncDienst.js`, bisher „vorhandenes Turnier aktivieren“) wird das zuletzt aktive
  Turnier wieder aktiviert (`turniere.aktiv` bzw. gespeicherte `instanz_id` der Instanz); gibt es
  keins, bleibt der Server ohne aktives Turnier.
* Neue Spalte `turniere.aktiv boolean default false` (Migration), genau eine Zeile `true`
  (partieller Unique-Index wie bei `pools_verspaetet_eindeutig`). Wird mit dem Cluster
  repliziert, damit nach einem Failover dasselbe Turnier aktiv ist.
* Alle Stellen, die „das Turnier“ per `knex('turniere').first()` annehmen, werden auf das aktive
  Turnier umgestellt (Bestandsaufnahme im Plan: Controller, `clientAntworten.js`, Live-Snapshot,
  Dashboard, `menu.js`).

## API

| Route | Zweck |
| --- | --- |
| `GET /api/turniere` | liefert zusätzlich `aktiv`, `aktivierbar` (bool), `aktivierbar_grund` |
| `POST /api/turniere/:id/aktivieren` | prüft Regel 3, setzt `aktiv`, `sync.aktiviereTurnier`; 409 mit Grund, wenn nicht erlaubt |
| `POST /api/turniere/:id/duplizieren` | Body `{ datum, teilnehmerUebernehmen }`; legt Entwurf an, Antwort `{ turnierId }`; 409 bei Terminüberschneidung |

Der Status `aktiv` wird bei „Durchführung beenden“ zurückgenommen.

## Duplizieren

Neues Turnier im Status `entwurf` mit neuem `datum`, Titel unverändert (der Nutzer kann ihn
danach in `turnier.html` ändern).

* **Immer übernommen:** Stammdaten (Bezeichnung, Ort, PLZ, Bundesland, Ausrichter, Altersklassen,
  Mannschafts-Altersklassen, Gewichtsklassen-Schalter, Startgeld, Bankdaten, Ausschreibung,
  `farbe_kaempfer2`) und die Anzahl der Matten (`kampfflaechen` neu angelegt). Anmeldeschluss wird
  nicht übernommen (neu setzen).
* **Nie übernommen:** Pools, Mattenzuordnungen, Kämpfe, Mannschaften, Ergebnisse, Live-Freigabe,
  `instanz_id`.
* **Option „Teilnehmer übernehmen“:** alle `turnier_teilnehmer` werden kopiert mit
  * erhalten: Judopass-ID, Name, Geburtsjahr, Geschlecht, Verein, Graduierung, **Gewicht**,
    Alters- und Gewichtsklasse;
  * zurückgesetzt: Status → `angemeldet` (also nicht gewogen), `startgeld_bezahlt = false`,
    Lizenzprüfung zurückgesetzt, `pool_id = null`.
* Kopie in einer Transaktion; läuft über denselben Kern wie `importiereTurnierDaten`
  (`urspruengliche_id` bleibt leer).

### Offener Punkt

„Lizenz gültig“ ist in `turnier_teilnehmer` das Datum `lizenz_ablauf` (Pflichtfeld). Beim
Zurücksetzen bleibt das Datum erhalten; zurückgesetzt wird das Prüfergebnis „Lizenz gültig“ an
der Waage, soweit es als Statuswert gespeichert wird. Im Plan zuerst klären, wo dieses Ergebnis
liegt (Teilnehmer-Status oder eigenes Feld); liegt es nur im Status, genügt der Status `angemeldet`.

## Oberfläche (`turniere.html`)

Mockup freigegeben am 2026-10-17.

* Abschnitte: **Aktives Turnier** (höchstens eine Karte, Akzentrahmen), **Geplant und Entwürfe**
  (normale Karten), **Abgeschlossen** (einzeilig, grau: Name, Datum, Ort, Teilnehmerzahl,
  „Duplizieren“).
* Karten: „Duplizieren“ bei allen Turnieren; „Aktivieren“ (grün) nur wenn Regel 3 erfüllt ist.
  Nicht aktivierbare Turniere zeigen den Grund als Tooltip.
* Dialog „Turnier duplizieren“: Datum der Kopie (Pflicht, Überschneidungsprüfung direkt), Hinweis
  „Stammdaten, Matten und Klassen sind immer enthalten; Pools und Mattenzuordnungen werden nicht
  übernommen“, Kontrollkästchen „Teilnehmer übernehmen“ (Gewichte bleiben, Gewogen/Lizenz gültig/
  Startgeld werden zurückgesetzt).
* `turnier.html`: Kopfzeile bekommt „Aktivieren“ (gleiche Regel) und „Duplizieren“.
* Der Hinweis beim Anlegen („löscht alle Daten des bisherigen Turniers“, `turnier.js`) entfällt.

## Cloud

Duplizieren und die Terminregel gelten nur am Hallen-Server (Einzelbenutzerbetrieb). In der Cloud
(mehrere Vereine, parallele Turniere) bleibt alles wie bisher; „Aktivieren“ gibt es dort nicht.

## Tests

* Unit: Terminprüfung, Aktivierbarkeit (`aktivierbar` inkl. Grund), Kopierregeln der Teilnehmer.
* E2E (`tests/e2e/`): zwei Turniere anlegen (zweites ersetzt das erste nicht); gleicher Tag wird
  abgelehnt; Aktivieren nur am Wettkampftag; zweites Aktivieren bei laufendem Turnier abgelehnt;
  Duplizieren mit und ohne Teilnehmer (Gewicht bleibt, Gewogen/Startgeld weg); abgeschlossene
  Turniere kompakt.
* Sync-Suite: Turnierwechsel per Aktivieren, Client-Gerät übernimmt das neue Turnier.
* Bestehende Specs, die „Neues Turnier ersetzt das alte“ voraussetzen, werden angepasst.

## Nicht Teil dieses Schritts

Automatisches Aktivieren, Mehrtages-Turniere als ein Turnier, mehrere gleichzeitig aktive
Turniere, Duplizieren in der Cloud.
