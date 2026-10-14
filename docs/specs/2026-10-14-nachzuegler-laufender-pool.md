# Nachzügler in einem laufenden Pool — Design

Stand: 2026-10-14 · Ergänzt `2026-10-10-nachzuegler-pool-design.md` (dort: Einsortieren nur, solange im Pool noch
kein Kampf begonnen hat). Hier: was nach dem ersten Kampf noch möglich ist.

## Ziel

Auch für Alters- und Gewichtsklassen, die schon kämpfen, sollen verspätete Kämpfer noch eingewogen werden können.
Ein Pool wechselt dabei **nie** sein Wettkampfsystem; geht es nur mit anderem System, wird das beim Einwiegen
deutlich gemacht und der Teilnehmer kommt (wie bisher) in einen anderen Pool oder den Sammelpool.

## Regeln (`src/shared/nachzueglerEinfuegen.js`, `bewerteEinfuegen`)

| Zustand des Pools | Ergebnis |
|---|---|
| noch kein Kampf `gestartet`/`beendet` | `neuaufbau`: wie bisher, Kampfplan wird neu aufgebaut (Systemwechsel erlaubt) |
| Pool ausgekämpft (`kaempfe_beendet`/`abgeschlossen`) | gesperrt |
| Teilnehmerzahl +1 ergäbe ein anderes System | gesperrt, Begründung nennt beide Systeme |
| Gruppen-Überkreuz (genau 6 Teilnehmer) | gesperrt: mit 7 wäre es Doppel-KO-8 (Systemwechsel) |
| Doppel-KO-8/16/32, Teilnehmerzahl +1 passt noch ins Raster | `einfuegen`, wenn der Freilos-Platz frei ist und davon nichts begonnen hat (siehe unten); sonst gesperrt mit Nennung des Kampfes |
| Jeder-gegen-Jeden, weniger offene Kämpfe als der Nachzügler bestreiten müsste | gesperrt („Zu spät …“) |
| Jeder-gegen-Jeden, mindestens so viele offene Kämpfe wie neue nötig (n bisherige Teilnehmer = n neue Kämpfe) | `einfuegen` |

„Offen“ sind Kämpfe mit Status `bereit`, `angelegt`, `vorbereiten`; der gerade laufende Kampf zählt nicht mit.

## Einfügen

- `JederGegenJedenManager.ergaenzeTeilnehmer` legt nur die Kämpfe des Nachzüglers gegen alle bisherigen Teilnehmer
  an (`kaempfe.nachzuegler = true`, Migration `20261014100000`). Kein bestehender Kampf wird verändert.
- `POST /api/pools/nachzuegler/:id/einsortieren` entscheidet in einer Transaktion mit `bewerteEinfuegen`; Antwort bei
  Erfolg zusätzlich `eingefuegt` und `neueKaempfe`, sonst 409 mit der Begründung.
- Die Antwort von `GET /api/pools/nachzuegler` enthält je Pool `laeuft`, `moeglich`, `art`, `grund`, `neueKaempfe`;
  gesperrte Pools werden mit Begründung gelistet (vorher fehlten sie), der Vorschlag nimmt nur mögliche Pools.

## Doppel-KO: Einfügen über den Freilos-Platz

Im Doppel-KO sind bei N < Raster (8/16/32) Plätze als Freilos besetzt, in fester DJB-Reihenfolge
(`DOPPEL_KO_RASTER`, identisch zu den `DoppelKo*Manager`). Der (N+1)-te Teilnehmer nimmt den letzten dieser
Freilos-Plätze ein:

- **Möglich**, solange die Kämpfe, die vom Freilos-Kampf abhängen (Folgekampf der Hauptrunde, Trostrunde und alles
  danach, `ermittleAbhaengige`), weder `gestartet`, `vorbereiten` noch `beendet` sind. Ein ausgetragener Kampf ohne
  Bezug zu diesem Platz sperrt nicht.
- **Ablauf** (`services/doppelKoEinfuegen.js`): das Freilos-Spiel wird zum echten Kampf `bereit` zwischen dem bisher
  kampflos weitergekommenen Partner und dem Nachzügler; die abhängigen Kämpfe werden zurückgesetzt und von der
  Kaskade (`aktualisiereTurnier`) aus den vorhandenen Ergebnissen neu abgeleitet. Es entsteht kein zusätzlicher
  Kampf, ein Freilos wird zum Kampf (daher „1 zusätzlicher Kampf“).
- **Gesperrt** mit Nennung des Kampfes, sobald z. B. H6 (Sieger des Freilos-Kampfes H4) läuft oder beendet ist:
  „Der Platz im Turnierbaum (H4) ist nicht mehr frei: Kampf H6 hat bereits begonnen oder ist beendet.“
- Die Vereinstrennung der Auslosung wird dabei nicht neu gerechnet: der Nachzügler kann dort auf einen
  Vereinskameraden treffen.
- Gruppen-Überkreuz hat keine freien Plätze (immer genau 6); Doppel-KO mit vollem Raster (8/16/32) wäre mit +1 ein
  anderes System.

## Reihenfolge an der Matte

Die Kämpfe des Nachzüglers werden **zwischen** die übrigen offenen Kämpfe des Pools verteilt, nicht angehängt:
`ordneNachzueglerKaempfe` setzt den j-ten von k Kämpfen vor den `floor((j+1)*R/(k+1))`-ten der R übrigen. Der Planer
(`planeKaempfeFuerKampfflaeche`) baut daraus die Pool-Warteschlange und wendet wie gewohnt die Pausenregel an.
Da der Index immer kleiner als R ist, steht nie ein reiner Nachzügler-Block am Ende.

**Grenze:** Die Pausenregel trennt die Kämpfe des Nachzüglers voneinander. Sind wenig fremde Kämpfe offen, zieht der
Planer zwei seiner Kämpfe zusammen (der bekannte Rückfall „geringstes Pausendefizit“); die Steuerung warnt dann
wie bei jedem anderen Pausenproblem zur Laufzeit.

## Oberfläche

Dialog nach dem Einwiegen/Speichern (`public/js/nachzueglerDialog.js`): Pools, die nicht aufnehmen können, sind
ausgegraut mit Begründung; kommt kein Pool in Frage, steht ein deutlicher Hinweis, dass ein Systemwechsel nach
Beginn nicht möglich ist. Bei einem laufenden Pool, der aufnimmt, erklärt der Hinweis die zusätzlichen Kämpfe
bzw. den belegten Platz.

**Pflicht-Bestätigung:** Gibt es einen Hinweis, der nicht überlesen werden darf (ein laufender Pool, gesperrte Pools
oder kein Vorschlag), sind „Einsortieren“ und „Später“ erst bedienbar, nachdem das Häkchen „Ich habe den Hinweis
gelesen und verstanden“ gesetzt ist; Escape schließt den Dialog dann nicht. Ohne solchen Hinweis (offener Pool mit
Vorschlag) bleibt der Dialog wie bisher.

## Nicht im Umfang

Nachmelde-Pool aus dem Sammelpool, Zurückhalten von Pools bis Waage-Schluss, Begründung auf `pools.html` (dort
werden Nachzügler ohne Vorschlag weiterhin automatisch in den Sammelpool gelegt).
