# Mannschaftskämpfe

Ausgelagert aus der CLAUDE.md; nur lesen, wenn das Thema die Aufgabe betrifft.

Mannschafts-Pools (`pools.typ = 'mannschaft'`) laufen als Team-vs-Team-Begegnungen: pro fest
definierter Gewichtsklassen-Position (`pools.mannschafts_gewichtsklassen`, DJB-Vorlage für U15/U18
m/w, sonst aus den Einzelwettkampf-Gewichtsklassen übernommen oder frei editierbar) ein
Einzelkampf; Sieger der Begegnung = mehr Kampfsiege, bei Gleichstand Wertungspunkte, bei
vollständigem Gleichstand automatischer Stichkampf. Unterstützte Turniersysteme: Jeder-gegen-Jeden
und Doppel-KO-8/16 (Doppel-KO-32 und Gruppen-Überkreuz für Mannschaften bewusst noch nicht
umgesetzt). Mannschafts-Pools werden manuell angelegt (kein automatisches Bulk-Auslosen aus
Einzelanmeldungen) und komplett auf der eigenen Seite `mannschaften.html` verwaltet — sie
erscheinen bewusst nicht in `pools.html`/`pools.js`, deren Rendering strukturell auf
Einzelwettkampf-Pools zugeschnitten ist. Bundesliga-Ligabetrieb (Startgenehmigungen,
Transferfenster, Kampfgemeinschaften, Fremdstarter-Kontingente) ist explizit außerhalb des Scopes
— das ist überjährige Vereinsverwaltung, kein Turniertag.
