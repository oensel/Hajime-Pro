# Prozesse: Betroffenenrechte und Datenpannen

> Entwurf. Die SQL-Abfragen sind für einen Super-Admin mit Datenbankzugang gedacht (Supabase SQL-Editor oder `psql`); **erst lesen, dann ändern, vorher sichern**. Rechtliche Prüfung empfohlen
> ([README](README.md)).

## 1. Anfragen von Betroffenen (Auskunft, Berichtigung, Löschung, Export, Widerspruch)

**Frist:** unverzüglich, **spätestens einen Monat** nach Eingang (Art. 12 Abs. 3 DSGVO), bei Komplexität um zwei Monate verlängerbar (mit Begründung innerhalb des ersten Monats).

### Ablauf

1. **Eingang** unter `datenschutz@…` (steht in der Datenschutzerklärung). Datum notieren.
2. **Wer ist verantwortlich?**
   - Geht es um **Turnierdaten** (Teilnehmende, Helfende)? Verantwortlich ist der **Veranstalter**: Anfrage an den Verein weiterleiten (unverzüglich, in Kopie an die Person) und ihn bei der Erfüllung unterstützen (AV-Vertrag § 4 Nr. 3).
   - Geht es um das **Benutzerkonto**, Anmeldung oder Protokolle? Verantwortlich ist der **Betreiber**: selbst bearbeiten.
3. **Identität prüfen** (kein Auskunftsrisiko für Dritte): Anfrage von der hinterlegten E-Mail-Adresse, sonst Rückfrage; bei Kindern Erziehungsberechtigte.
4. **Bearbeiten** (siehe Abfragen unten), **antworten** (verständlich, Kopie der Daten als Datei, Hinweis auf Löschverzögerung in Sicherungen), **dokumentieren** (Datum, Anfrage, Maßnahme).

### Abfragen

**Benutzerkonto finden** (`E-Mail` ersetzen):

```sql
SELECT id, vorname, nachname, email, created_at, email_bestaetigt_am, gesperrt FROM benutzer WHERE lower(email) = lower('E-MAIL');
SELECT v.name AS verein, bv.rolle, bv.freigegeben FROM benutzer_vereine bv JOIN vereine v ON v.id = bv.verein_id WHERE bv.benutzer_id = 'BENUTZER-ID';
SELECT zeitpunkt, aktion, beschreibung, ip FROM aktionsprotokoll WHERE benutzer_id = 'BENUTZER-ID' ORDER BY zeitpunkt DESC;
SELECT zeitpunkt, meldung, pfad FROM fehlerprotokoll WHERE benutzer = 'E-MAIL' ORDER BY zeitpunkt DESC;
```

**Teilnehmerdaten einer Person finden** (Auskunft, Veranstalter fragen nach):

```sql
SELECT t.id, t.turnier_id, tu.bezeichnung AS turnier, tu.datum, t.judopass_id, t.vorname, t.nachname, t.geburtsjahr, t.geschlecht,
       t.verein, t.gewicht, t.altersklasse, t.gewichtsklasse, t.graduierung, t.status
FROM turnier_teilnehmer t JOIN turniere tu ON tu.id = t.turnier_id
WHERE t.judopass_id = 'PASS-NR' OR (lower(t.vorname) = lower('VORNAME') AND lower(t.nachname) = lower('NACHNAME'))
ORDER BY tu.datum DESC;
```

**Kämpfe und Ergebnisse dazu:** über `kaempfe.kaempfer1_id`, `kaempfer2_id`, `sieger_id` = `turnier_teilnehmer.id` (die ID aus der ersten Abfrage).

### Löschen und Berichtigen

- **Benutzerkonto löschen:** Seite „Benutzer“ (Super-Admin) bzw. „Mitglieder“ (Vereins-Admin) → Löschen. Mitgliedschaften und Einmal-Links werden mitgelöscht.
- **Protokolleinträge** des gelöschten Kontos anonymisieren, wenn die Person es verlangt (andernfalls laufen sie nach 365 Tagen aus):

  ```sql
  UPDATE aktionsprotokoll SET benutzer_name = 'Gelöschtes Konto', benutzer_email = NULL, ip = NULL WHERE benutzer_id = 'BENUTZER-ID';
  UPDATE fehlerprotokoll SET benutzer = NULL WHERE benutzer = 'E-MAIL';
  ```

- **Teilnehmerdaten:** Hat der Teilnehmer **keine Kämpfe** (nicht ausgelost), löscht der Veranstalter ihn auf der Seite „Teilnehmer“. Sind **Kämpfe und Ergebnisse** betroffen, würde ein Löschen die Ergebnislisten anderer
  zerstören: dann **anonymisieren** (nach Absprache mit dem Veranstalter, vorher sichern):

  ```sql
  UPDATE turnier_teilnehmer
  SET vorname = 'Anonymisiert', nachname = '', judopass_id = '', verein = '', geburtsjahr = 0
  WHERE id = TEILNEHMER-ID;
  ```

  Die Angaben `altersklasse`, `gewichtsklasse` und das Ergebnis bleiben, damit die Wertung stimmt.
- **Live-Daten:** laufen nach 7 Tagen von selbst aus; ist es dringend, das Turnier in der Teilnehmer-App sofort zurücknehmen (Live-Freigabe aus).
- **Berichtigung:** der Veranstalter ändert die Angabe auf der Seite „Teilnehmer“ bzw. der Betroffene sein Profil.
- **Widerspruch gegen die Veröffentlichung in der Teilnehmer-App:** Der Veranstalter nimmt die Person aus der Freigabe heraus bzw. schaltet die Live-Anzeige ab. `[offen: Option „Name kürzen“]`.

### Hinweis in der Antwort zur Löschung

> „Wir haben Ihre Daten gelöscht. In unseren verschlüsselten Datensicherungen können sie noch bis zu `[60]` Tage verbleiben, danach sind auch diese Kopien gelöscht. Bis dahin sind sie nicht zugänglich und werden nicht verwendet.“

## 2. Datenpanne (Verletzung des Schutzes personenbezogener Daten)

**Beispiele:** Konto-Übernahme, Zugriff Unbefugter auf die Datenbank oder Sicherungen, verlorene Sicherung ohne Verschlüsselung, falsch versendete E-Mail mit Teilnehmerdaten, gestohlenes Gerät mit Zugang.

**Frist:** Meldung an die **Aufsichtsbehörde innerhalb von 72 Stunden** nach Bekanntwerden, **es sei denn**, die Verletzung führt voraussichtlich nicht zu einem Risiko für die Betroffenen (Art. 33 DSGVO).
Als **Auftragsverarbeiter** meldet der Betreiber **unverzüglich (hier: spätestens 24 Stunden)** an den betroffenen Verein (Verantwortlicher), der seinerseits an die Behörde meldet. Bei **hohem Risiko**
(z. B. Daten Minderjähriger offen im Netz) werden zusätzlich die Betroffenen informiert (Art. 34).

### Sofortmaßnahmen

1. **Eindämmen:** Zugang sperren (Konto sperren, Passwort ändern, 2FA zurücksetzen, `SUPER_ADMIN_INITIAL_PASSWORD` und `JWT_SECRET` wechseln, Server vom Netz nehmen, Live-Freigaben ausschalten).
2. **Beweise sichern:** Seite „Konsole“ und „Protokoll“ exportieren (Bildschirmfoto/Abfrage), Server-Protokolle sichern, nichts löschen.
3. **Umfang klären:** welche Daten, welche Betroffenen, welcher Zeitraum (Aktionsprotokoll nach auffälligen Konten und IPs durchsuchen).
4. **Entscheiden und melden:** Risiko bewerten (Art, Menge, Minderjährige, Missbrauchsfolgen), Meldung an die zuständige Aufsichtsbehörde (Online-Formular der Landesbehörde), Verein informieren.
5. **Dokumentieren** (auch bei nicht gemeldeten Fällen, Art. 33 Abs. 5): Vorfall, Auswirkungen, Maßnahmen, Entscheidung.
6. **Nachbereiten:** Ursache beheben, Maßnahmen anpassen, Passwörter und Schlüssel erneuern.

### Inhalt der Meldung an die Behörde (Art. 33 Abs. 3)

Art der Verletzung (Kategorien und ungefähre Zahl der Betroffenen und Datensätze), Name und Kontakt des Ansprechpartners, wahrscheinliche Folgen, ergriffene oder vorgeschlagene Maßnahmen.

### Vorlage: Meldung des Betreibers an den Verein

> Betreff: Meldung einer Verletzung des Schutzes personenbezogener Daten (Hajime Pro)
> Am `[Datum, Uhrzeit]` haben wir `[Art der Verletzung]` festgestellt. Betroffen sind voraussichtlich `[Datenkategorien, Zahl der Betroffenen]` Ihres Vereins `[Turniere]`.
> Mögliche Folgen: `[…]`. Ergriffene Maßnahmen: `[…]`. Ansprechpartner: `[Name, Telefon, E-Mail]`. Wir halten Sie über neue Erkenntnisse auf dem Laufenden und unterstützen Sie bei Ihrer Meldung nach Art. 33 DSGVO.

## 3. Weitere regelmäßige Aufgaben

| Aufgabe | Rhythmus |
|---|---|
| Wiederherstellungstest einer Sicherung (am besten gegen eine Kopie der Datenbank) | halbjährlich |
| Kopie am anderen Ort prüfen (`scripts/sicherung.mjs pruefen <Datei>`) | monatlich |
| Verzeichnis der Verarbeitungstätigkeiten, Unterauftragnehmer und Datenschutzerklärung auf Aktualität prüfen | jährlich und bei jeder Änderung |
| Berechtigungen (Super-Admins, Vereins-Admins, Server-Zugänge) prüfen | halbjährlich |
| Abgeschlossene Turniere löschen oder anonymisieren (Frist `[2]` Jahre) | jährlich |
