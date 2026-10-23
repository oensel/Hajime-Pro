# Super-Admin-Modus statt Dauer-Allmacht

Stand: 2026-10-22 · Status: Entwurf zur Freigabe

## Ziel und Hintergrund

Ein Konto kann gleichzeitig Admin in Verein A, Benutzer in Verein B und Super-Admin der ganzen Anwendung sein. Bisher gilt
`benutzer.ist_super_admin` überall, unabhängig vom aktiven Verein; die Rolle in den eigenen Vereinen spielt für einen
Super-Admin keine Rolle, und die Benutzerliste vermischt beides in einer Rollenauswahl.

Neu: Ein Super-Admin arbeitet in genau einem von zwei Zuständen.

- **Super-Admin-Modus**: die globalen Rechte wie bisher (Benutzer, Vereine, Server-Update, Turniere aller Vereine,
  Erstregistrierungen freigeben, Rollen in allen Vereinen ändern).
- **Vereinsmodus** (ein Verein, in dem das Konto Mitglied ist): nur die Rechte, die seine Rolle in diesem Verein erlaubt
  (Admin, Benutzer oder Helfer), im Menü **und** auf dem Server.

Nach jedem Login startet ein Super-Admin im Super-Admin-Modus. Gewechselt wird über den Vereinswechsler in der Kopfleiste.

## Nicht-Ziele

- Keine neue Vereinsrolle „Super-Admin“. Die globale Rolle bleibt `benutzer.ist_super_admin`, die Vereinsrollen bleiben
  `admin ⊃ benutzer ⊃ helfer`.
- Kein Wechsel in Vereine ohne Mitgliedschaft (auch nicht für Super-Admins).
- Kein Einzelbenutzerbetrieb betroffen (Hallen-Server, Client-Geräte): dort gibt es keine Super-Admins und keinen Wechsler
  mit Super-Admin-Eintrag.
- Keine Zustand pro Browser-Tab: der Modus gehört zum Konto (siehe Datenmodell).

## Datenmodell

Neue Spalte `benutzer.super_admin_modus` (boolean, Standard `false`, Migration). `aktiver_verein_id` bleibt unverändert und
merkt sich weiter den zuletzt gewählten Verein, auch im Super-Admin-Modus (Rückweg „später per Verein wieder zurück“).
Bewusst **nicht** „kein aktiver Verein“ als Marker: Registrierung und Einladung füllen `aktiver_verein_id` bei NULL
automatisch.

Wirksamer Super-Admin: `super_admin_aktiv = ist_super_admin AND super_admin_modus`.

- Migration: `super_admin_modus = true` für alle bestehenden Super-Admins.
- Login (`baueAnmeldeAntwort`) setzt `super_admin_modus = ist_super_admin`.
- Super-Admin ernennen (`POST /api/nutzer/:id/super-admin`, `wert: true`) setzt `super_admin_modus = true`; Entziehen setzt
  `false`.

## Server

`ladeBenutzerMitAktivemVerein` liefert zusätzlich `super_admin_aktiv`; `ist_super_admin` bleibt das Konto-Merkmal. Alle
rechteentscheidenden Stellen wechseln auf `super_admin_aktiv`:

| Stelle | Änderung |
|---|---|
| `middleware/auth.js`: `requireSuperAdmin`, `requireVereinFreigabe`, `requireRolle` | `super_admin_aktiv` statt `ist_super_admin`; `requireSuperAdmin` lädt über `ladeBenutzerMitAktivemVerein` |
| `utils/vereinHelper.js`: `hatVereinsZugriffAufTurnier`, `hatHelferZugriffAufVerein` | `super_admin_aktiv` |
| `controllers/turnierController.js` (Liste/Anlegen), `teilnehmerController.js` (`istPrivilegiert`), `helferController.js`, `orgaController.js` (Zeile 277) | `super_admin_aktiv` |
| `services/vereinsRollen.js` (`istSuperAdmin`, `darfVereinVerwalten`, Entscheidungen) | `super_admin_aktiv` |
| Routen mit `requireSuperAdmin` (`/api/nutzer`, `/api/cloud-update`, `/api/vereine/super/*`) | antworten im Vereinsmodus 403 |

`getMe` und `baueAnmeldeAntwort` melden zusätzlich `super_admin_aktiv`.

Wechsel: `POST /api/vereine/aktiv` akzeptiert `{ vereinId }` (setzt `aktiver_verein_id` und `super_admin_modus = false`)
oder `{ superAdmin: true }` (nur für Super-Admins, setzt `super_admin_modus = true`; `aktiver_verein_id` bleibt).

Konto-Verwaltung (`nutzerController`) bleibt unverändert, sie arbeitet auf dem Konto-Merkmal.

## Frontend

- **Vereinswechsler (`menu.js`)**: für Super-Admins erster Eintrag „Super-Admin“, darunter die Vereine mit Mitgliedschaft.
  Der Kopf zeigt im Modus „Super-Admin“, sonst den Vereinsnamen. Der Wechsler erscheint auch, wenn der Super-Admin nur
  einen Verein hat. Super-Admin ohne Mitgliedschaft: nur „Super-Admin“ (kein Dropdown). Vereine, in denen das Konto nur
  Helfer ist oder noch nicht freigegeben ist, bleiben wie bisher nur eingeschränkt wählbar (Verwaltung braucht
  Benutzer/Admin; ein Super-Admin kann sie als Helfer-Verein wählen und landet dann in der Helfer-App).
- **Menürechte (`shared/menueRechte.js`)**: `menueFuerRolle` bekommt `istSuperAdmin = super_admin_aktiv`. Im Vereinsmodus
  also Rolle des Vereins; „Benutzer“, „Vereine“, „Server-Update“ nur im Super-Admin-Modus; die Helfer-App wird sichtbar,
  sobald der Modus nicht „Super-Admin“ ist.
- **Weitere Seiten** (`login.html`, `profil.html`, `turniere.html`, `turnier.js`, `waage-modal.js`, Warteschlangen-Hinweis
  im `menu.js`): Prüfungen auf `ist_super_admin` werden zu `super_admin_aktiv`. `turniere.html` zeigt „Turniere aller
  Vereine“ nur im Super-Admin-Modus.
- **Nach dem Login**: Super-Admin → Startseite des Super-Admin-Modus (Turniere).
- **Benutzerliste (`admin-nutzer.html`)**: Rolle-Auswahl nur Admin/Benutzer/Helfer je Verein (Super-Admin raus).
  Hinter der Überschrift „Super-Admins“ steht „Hinzufügen“: Suchfeld mit Autovervollständigung über alle bereits geladenen
  Konten, die noch keine Super-Admins sind (Name, E-Mail); Auswahl → Bestätigungsdialog → `POST /api/nutzer/:id/super-admin
  { wert: true }`. Jede Zeile im Bereich „Super-Admins“ bekommt die Aktion „Super-Admin entziehen“ (Bestätigung, `wert:
  false`); Konto und Vereinsrollen bleiben unverändert, der letzte (aktive) Super-Admin bleibt serverseitig geschützt.

## Tests

- Unit: Berechtigungen je Modus (`hatVereinsZugriffAufTurnier`, `requireSuperAdmin`/`requireRolle` mit Modus an/aus),
  `menueFuerRolle` mit beiden Modi, Wechsel-Endpunkt (Modus an/aus, kein Wechsel in Fremdverein).
- E2E (`admin-benutzer.spec.js` erweitern): Rollenauswahl ohne Super-Admin, Hinzufügen mit Autovervollständigung und
  Bestätigung, Entziehen; Wechsler zeigt „Super-Admin“ + Mitgliedschaften und schaltet das Menü um.

## Entscheidungen, die ich getroffen habe (bitte prüfen)

- Der Modus ist pro Konto gespeichert, nicht pro Tab; ein Login auf einem zweiten Gerät setzt ihn zurück.
- Im Vereinsmodus liefern die Verwaltungsrouten 403 (statt unsichtbar zu sein).
- Frisch ernannte Super-Admins starten sofort im Super-Admin-Modus.
