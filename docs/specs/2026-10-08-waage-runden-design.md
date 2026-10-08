# Waage in Runden (Auslosung je Altersklasse) — Design

Stand: 2026-10-08 · Branch `feature/waage-runden`

## Ziel

Die Waage läuft an einem Turniertag in mehreren Runden, z.B. morgens U9/U11/U13, mittags U15, nachmittags
U18 und Männer/Frauen. Nach jeder Runde sollen für genau die gerade gewogenen Altersklassen Pools entstehen,
auf die Matten kommen und kämpfen, während die Waage für die übrigen Altersklassen weiterläuft.

**Erfolgskriterien**

- „Pools generieren“ lässt die Turnierleitung die Altersklassen wählen, die jetzt ausgelost werden; im
  Dialog erscheinen nur Altersklassen mit mindestens einem eingewogenen (kampfbereiten) Teilnehmer.
- Pools bereits ausgeloster Altersklassen, ihre Matten und Kämpfe bleiben von späteren Runden unberührt.
- Noch nicht gewogene Teilnehmer anderer Altersklassen bleiben „angemeldet“ (nicht „nicht erschienen“) und
  lassen sich auch nach den ersten Kämpfen noch einwiegen.
- Die neuen Pools lassen sich vor dem Verteilen anpassen (Teilnehmer verschieben, Wettkampfsystem, Zeiten);
  „Pools aufteilen“ hängt dann nur die noch nicht verteilten Pools an die Matten an.

**Nicht im Umfang**

- Nachzügler in eine bereits ausgeloste Altersklasse: gibt es fachlich nicht (die Altersklasse ist nach der
  Waage abgeschlossen). Das Generieren und das Anmelden weisen sie ab.
- Mannschaften: die manuelle Pool-Anlage bleibt unverändert; ihre Sperre hängt nur an laufenden Mannschafts-Pools.
- Neue Datenbankspalten: der Zustand einer Altersklasse wird aus den Pools abgeleitet.

## Begriffe

- **Offene Altersklasse:** für diese Altersklasse (`turnier_teilnehmer.altersklasse`) gibt es im Turnier noch
  keinen Einzel-Pool (`pools.typ <> 'mannschaft'`).
- **Ausgeloste Altersklasse:** es gibt mindestens einen Einzel-Pool mit dieser `altersklasse`.
- **Gewogen / eingewogen:** Status `kampfbereit` (wie bisher die Eintrittsbedingung der Poolbildung).

## Ablauf (Beispiel)

1. Vormittag: Waage U9–U13. „Pools generieren“ → Dialog zeigt U9, U11, U13 (U15 hat noch keinen Gewogenen und
   fehlt). Haken setzen, bestätigen → Pools für U9–U13, Teilnehmer dieser Klassen, die nicht gewogen wurden,
   werden „nicht erschienen“. Pools anpassen, auf `matten.html` „Pools aufteilen“ → Matten, Kämpfe beginnen.
2. Mittag: Waage U15 (Anmelden/Einwiegen funktioniert, obwohl U13 schon kämpft). „Pools generieren“ → Dialog
   zeigt nur U15. Pools anpassen, „Pools aufteilen“ hängt sie an die Matten an; U9–U13 bleiben, wie sie sind.
3. Nachmittag: dasselbe für U18, Männer, Frauen.

## Entwurf

### 1. Pools generieren — Dialog und Server

**Server** (`src/controllers/poolController.js`, `src/routes/poolRoutes.js`)

- `GET /api/pools/altersklassen-status?turnierId=` liefert je Altersklasse mit Einzel-Teilnehmern:
  `{ altersklasse, kampfbereit, angemeldet, gesamt, ausgelost, hatEchteKaempfe }`. Der Dialog zeigt
  `ausgelost === false && kampfbereit >= 1`. Für „Pools neu generieren“ zeigt er
  `ausgelost === true && hatEchteKaempfe === false`.
- `POST /api/pools/generieren` bekommt `altersklassen: string[]`. Ohne die Angabe: Verhalten wie bisher
  (alle Altersklassen), damit alte Aufrufer (Tests, Client-Geräte) weiterlaufen.
- `generierePools` arbeitet nur mit den gewählten Altersklassen:
  - nur deren kampfbereite Teilnehmer bilden Pools (Logik der Poolbildung unverändert);
  - „angemeldet“ → „nicht_erschienen“ nur für Teilnehmer der gewählten Altersklassen;
  - `loeschePoolZuordnungenFuerTurnier` löscht nicht mehr das ganze Turnier, sondern nur Pools der gewählten
    Altersklassen (nur mit `neuGenerieren`);
  - eine bereits ausgeloste Altersklasse wird ohne `neuGenerieren` mit 409 („schon ausgelost“) abgewiesen,
    mit `neuGenerieren` nur, wenn kein Pool dieser Altersklasse echte Kämpfe hat (sonst 409);
  - die Mindestanzahl (2 kampfbereite) gilt für die Auswahl insgesamt, die Startberechtigt-Prüfung für die
    kampfbereiten Teilnehmer der gewählten Altersklassen.
- Die Auslosung der Mixed-Altersklassen (`mixed_<AK>`) bleibt je Altersklasse; die Auswahl erfolgt nach dem
  Namen der Altersklasse, unabhängig vom Geschlecht.

**Frontend** (`public/pools.html`, `public/js/pools.js`)

- „Pools jetzt generieren“ öffnet den Dialog mit Checkboxen; Bestätigungstext „Waage für die gewählten
  Altersklassen schließen und auslosen“. Der Knopf bleibt aktiv, solange eine offene Altersklasse mit
  kampfbereiten Teilnehmern existiert; sonst Hinweis „Keine Altersklasse mit eingewogenen Teilnehmern“.
- „Pools neu generieren“ nutzt denselben Dialog mit den ausgelosten Altersklassen ohne echte Kämpfe.
- Die Warnung zu nicht kampfbereiten Teilnehmern bezieht sich nur auf die gewählten Altersklassen.

### 2. Auf Matten verteilen — nur neue Pools

**Algorithmus** wird aus `verteilePools` in eine reine Funktion `src/services/mattenVerteilung.js`
herausgelöst (bisher ca. 350 Zeilen im Controller, nicht testbar):
`verteilePoolsAufMatten({ pools, matten, startLasten, regeln })` → Zuordnung je Matte. Der Controller lädt
Daten, ruft sie auf und schreibt das Ergebnis.

- **Modus `neue`** (neuer Standard von „Pools aufteilen“): verteilt nur Einzel- und Mannschafts-Pools ohne
  Matte. `startLasten` = Restdauer der bereits zugeordneten Pools je Matte (nicht beendete Kämpfe mal
  Kampfzeit). Neue Pools gehen an die Matte mit der geringsten Last und werden mit
  `matte_reihenfolge = max + 1 …` **angehängt**; Sortierung unter den neuen Pools wie bisher (weiblich vor
  männlich, jünger vor älter, leicht vor schwer). Bestehende Zuordnungen und Reihenfolgen ändern sich nicht.
  Die Sonderregel „jüngste weibliche Altersklasse auf die erste Matte“ gilt nur, wenn noch keine Matte belegt
  ist (erste Runde: Ergebnis wie heute).
- **Modus `alle`** („Alle neu verteilen“, eigener Knopf mit Rückfrage): wie das bisherige `verteilePools`;
  Pools mit echten Kämpfen bleiben unberührt.
- `POST /api/pools/aufteilen` bekommt `modus: 'neue' | 'alle'` (Standard `neue`).
- Danach wie bisher: `planeKaempfeFuerKampfflaeche`, `aktualisierePoolStatusNachAuslosung`,
  `synchronisiereMattenStatus` für die betroffenen Matten.

**Frontend** (`public/matten.html`, `public/js/matten.js`): „Pools aufteilen“ (neue Pools) und „Alle neu
verteilen“; Meldung nennt die Zahl der verteilten Pools.

### 3. Sperre der Teilnehmerliste je Altersklasse

Heute sperrt `turnierHatEchteKaempfe` die gesamte Teilnehmerliste ab dem ersten echten Kampf
(`teilnehmerController.js` an den Stellen Anlegen, Ändern, Löschen/Zurückziehen, Import). Neu je Altersklasse:

- **Anmelden / Nachmelden** (Anlegen, Import) in eine **ausgeloste** Altersklasse: 409 („Die Altersklasse ist
  bereits ausgelost“).
- **Ändern, Wiegen, Löschen** eines Teilnehmers: gesperrt, wenn ein Pool seiner Altersklasse echte Kämpfe hat
  (die bisherige Regel, nur auf die eigene Altersklasse begrenzt). Teilnehmer offener Altersklassen bleiben
  bearbeitbar, auch wenn andere Altersklassen schon kämpfen.
- `GET /api/pools/vorhanden` liefert zusätzlich `gesperrteAltersklassen` und `ausgelosteAltersklassen`;
  `gesperrt` bleibt als Alias (`gesperrteAltersklassen.length > 0`), damit alte Clients weiterlaufen.
- `teilnehmer.js`: Banner nennt die gesperrten Altersklassen; Bearbeiten-, Wiegen- und Lösch-Aktionen nur für
  deren Teilnehmer deaktivieren. Client-Geräte: `src/shared/clientAntworten.js` (Berechnung von `gesperrt`
  aus den Dokumenten) auf dieselbe Struktur umstellen.
- Mannschaften (`mannschaftController.js`) und Mannschaftsmitglieder sind erst gesperrt, wenn ein Mannschafts-Pool
  des Turniers echte Kämpfe hatte (`mannschaftsPoolsHabenEchteKaempfe`); Einzelkämpfe sperren sie nicht.

### 4. Abgrenzung und Sicherheitsnetz

- Pools lassen sich weiter anpassen, solange der Pool keinen gestarteten/beendeten Kampf hat
  (`poolHatBereitsEchteKaempfe`), unabhängig von der Matten-Zuordnung.
- „Alle Pools löschen“ bleibt turnierweit; es wird weiterhin von echten Kämpfen blockiert.
- Die Regel „Pools können nicht neu generiert werden, da ein Pool echte Kämpfe enthält“ gilt nur noch für die
  betroffene Altersklasse.

## Tests

- **Unit** (`tests/unit/mattenVerteilung.test.js`): Anhängen an bestehende Lasten, Sortierung, Sonderregel nur
  bei leerer Belegung, Modus `alle` entspricht dem bisherigen Ergebnis.
- **E2E** (`tests/e2e/waage-runden.spec.js`, echter Server, zwei Matten): drei Runden (U9–U13, U15, U18).
  Prüft: Dialog zeigt nur Altersklassen mit Eingewogenen; frühere Pools, Matten, Reihenfolgen und Kämpfe
  bleiben nach der späteren Runde unverändert; nicht gewogene Teilnehmer anderer Altersklassen bleiben
  „angemeldet“; Einwiegen in U15 funktioniert, obwohl U13 kämpft; Nachmelden in ausgeloste Klasse → 409;
  Neu-Generieren nur ohne echte Kämpfe; „Pools aufteilen“ lässt bestehende Zuordnungen unberührt.
- Bestehende Specs zur Pool-Verteilung (`teilnehmer-pools-verteilung.spec.js`) und die Sync-Suite laufen
  unverändert grün (Standardverhalten ohne `altersklassen` bleibt erhalten).

## Risiken

- **`generierePools` ist lang** und verzweigt in zwei Strategien. Die Änderung beschränkt sich auf Auswahl und
  Löschumfang; die Poolbildung selbst bleibt unverändert.
- **Altersklassen-Schlüssel:** Teilnehmer tragen `altersklasse`, Pools `altersklasse` und `geschlecht`; Mixed
  fasst Geschlechter zusammen. Die Auswahl arbeitet auf dem Namen der Altersklasse; Tests decken Mixed ab.
- **Client-Geräte:** Die Sperrberechnung existiert doppelt (Server und `clientAntworten.js`). Beide müssen
  dieselbe Regel nutzen; der Sync-Test prüft das.

## Offene Punkte zur Prüfung

- **Sperre bestehender Teilnehmer ab dem ersten Kampf der Altersklasse** (statt ab der Auslosung): das ist die
  bisherige Regel, nur je Altersklasse begrenzt. Zwischen Auslosung und erstem Kampf lassen sich Daten eines
  Teilnehmers also weiter korrigieren (z.B. Gewicht), nur neue Teilnehmer sind sofort abgewiesen. Soll die
  Bearbeitung stattdessen schon ab der Auslosung gesperrt sein?
