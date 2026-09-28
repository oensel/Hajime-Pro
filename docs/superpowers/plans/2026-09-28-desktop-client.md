# Desktop-Client (Electron) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Helfer installieren den Hajime-Pro-Client einmal von `turnier.local/download` (Windows/Linux/macOS), koppeln ihn einmal per Code, danach aktualisiert er sich bei jedem Start selbst vom Hallen-Server; eine GitHub-Actions-Pipeline testet alles und baut/signiert/veröffentlicht die Clients.

**Architecture:** Der Electron-Main-Prozess setzt die Umgebungsvariablen eines Client-Knotens und lädt das unveränderte `src/app.js` (`SYNC_ROLLE=client`) auf einem freien localhost-Port; das Fenster zeigt `client.html`. Davor sucht er den Server per mDNS (`_hajime._tcp`), vergleicht die Version, tauscht sich bei Abweichung selbst aus (Ed25519-signierte Dateien) und holt beim ersten Start per Kopplungscode das `SYNC_SECRET`. Der Hallen-Server kündigt sich per mDNS an, liefert Download-Seite, `version.json` und Client-Dateien aus und verwaltet Kopplungscode/Geheimnis.

**Tech Stack:** Node.js (ESM), Express, Electron + electron-builder, `bonjour-service` + `multicast-dns`, Node-`crypto` (Ed25519), `node:test`, Playwright (inkl. `_electron`), GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-28-desktop-client-design.md`

## Global Constraints

- Code, Kommentare, Bezeichner, UI-Texte und Commit-Messages auf **Deutsch**, im Stil des umgebenden Codes (Kommentardichte wie in `src/sync/*.js`). Commits enden mit `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Plattformen: `win32-x64`, `darwin-universal`, `linux-x64` — exakt diese drei Plattform-Schlüssel.
- Client-Version = Server-Version = `package.json`-Version. Update bei **jeder Abweichung** (auch nach unten).
- mDNS-Dienst: Typ `hajime` (→ `_hajime._tcp`), Host `<MDNS_NAME>.local`, Standard `MDNS_NAME=turnier`; TXT `version`, `knoten`, `rolle`.
- Neue Umgebungsvariablen (Server): `MDNS_AKTIV` (Standard `true`), `MDNS_NAME` (Standard `turnier`), `PORT80_WEITERLEITUNG` (Standard `true`), `CLIENT_DOWNLOADS_VERZEICHNIS` (Standard `./data/client-downloads`). Alle Test-Suites mit Server-Rolle setzen `MDNS_AKTIV=false` und `PORT80_WEITERLEITUNG=false`.
- Kopplungscode: 6 Ziffern; Sperre nach 5 Fehlversuchen pro IP innerhalb 60 s, Sperrdauer 60 s.
- Schleifenschutz: höchstens 2 Update-Versuche je Zielversion.
- Signatur: Ed25519 über die UTF-8-Nachricht `` `${datei}\n${version}\n${sha256}` `` (sha256 hex), Signatur base64; Schlüssel als PEM (`spki`/`pkcs8`).
- `test:e2e:vollablauf` läuft nie in CI.
- `src/shared/` bleibt DB-/Framework-frei; neue reine Logik des Desktop-Clients liegt in `desktop/updateLogik.js` (kein Electron-Import).
- Kein neues npm-Paket außer: `bonjour-service`, `multicast-dns` (dependencies), `electron`, `electron-builder` (devDependencies).
- **Bewusste Abweichung von Spec §8** („Gegenprobe `/api/cluster/status`“): entfällt, weil die TXT-`rolle` live aus `sync.modus()` stammt und nur der Master ankündigt; bei mehreren Treffern gewinnt `rolle=master`, sonst der erste.

## Review Focus

- **Server mit altem `.env`-Client ohne `SYNC_SECRET`**: Erzeugt der Server nun selbst ein Geheimnis, lehnt er solche Clients mit 401 ab. Erwartet: klare Log-Meldung am Server beim Erzeugen („SYNC_SECRET automatisch erzeugt – Clients neu koppeln oder SYNC_SECRET aus kopplung.json übernehmen“) und Hinweis in CLAUDE.md. → Task 2, Schritt „Log-Meldung“ + Test in `kopplung.test.js`.
- **Kopplungscode mit Leerzeichen/Bindestrich** („482 913“, „482-913“, so wie er auf `matten.html` angezeigt wird). Erwartet: wird akzeptiert. → Task 1, Test `normalisiereCode`.
- **Server hat keine Client-Dateien für seine Version** (frisch installiert, `client:holen` nicht gelaufen). Erwartet: `/api/client/version` 404, Client startet ohne Update, Download-Seite zeigt verständlichen Hinweis statt leerer Liste. → Task 2 + Task 3 Tests.
- **Update-Datei unvollständig geladen / WLAN bricht mitten im Download ab.** Erwartet: sha256 passt nicht → Datei verworfen, alte Version startet, kein Absturz. → Task 5, Test „abgeschnittene Datei“.
- **Server wird gefunden, antwortet aber nicht (hängt)**. Erwartet: nach 3 s Zeitlimit normaler Start. → Task 8, `holeServerVersion` mit `AbortSignal.timeout(3000)` + Unit-Test mit hängendem Server.

---

## Dateistruktur

| Datei | Neu/Ändern | Verantwortung |
|---|---|---|
| `src/sync/kopplung.js` | neu | Geheimnis + Kopplungscode laden/erzeugen/erneuern, Fehlversuchs-Sperre (rein + dünne Datei-Schicht) |
| `src/routes/clientVerteilungRoutes.js` | neu | `/api/client/*`-Endpunkte |
| `src/middleware/auth.js` | ändern | `requireSteuerungPasswort` (Passwort auch für GET) |
| `src/app.js` | ändern | Kopplung, Routen, `/downloads`, `/download`, Ankündigung, Port 80, `export { app }` |
| `public/download.html`, `public/js/download.js` | neu | Download-Seite |
| `public/matten.html`, `public/js/kopplungKarte.js` | ändern/neu | Karte „Neues Gerät koppeln“ |
| `src/sync/ankuendigung.js` | neu | mDNS-Dienst + A-Record-Antworten für `turnier.local` |
| `src/sync/port80.js` | neu | Weiterleitung Port 80 → `PORT` |
| `src/sync/replikation.js`, `src/sync/clientDienst.js`, `src/routes/syncRoutes.js` | ändern | `abgelehnt`-Status, `setzeVerbindung()`, Test-Endpunkt |
| `desktop/updateLogik.js` | neu | reine Logik: Versionen, Plattform, Signatur, Schleifenschutz, Serverauswahl |
| `scripts/client-schluessel.mjs`, `scripts/signiere-client.mjs`, `scripts/hole-client-release.mjs` | neu | Schlüssel, Signieren, Release holen |
| `desktop/main.js`, `desktop/einstellungen.js`, `desktop/serverSuche.js`, `desktop/linuxIntegration.js`, `desktop/fenster/*` | neu | Electron-Hülle |
| `desktop/updater.js` | neu | Download + plattformspezifischer Austausch |
| `desktop/electron-builder.yml`, `desktop/build/icon.png`, `scripts/erzeuge-app-icon.mjs` | neu | Build |
| `.github/workflows/ci.yml`, `.github/workflows/release.yml` | neu | Pipeline |
| `tests/unit/*.test.js`, `tests/e2e-sync/client-verteilung.spec.js`, `tests/e2e-sync/verbindung-wechseln.spec.js`, `tests/electron/rauchtest.spec.js`, `playwright.electron.config.js` | neu | Tests |
| `desktop/README.md`, `CLAUDE.md`, `deploy/linux/systemd/*` | ändern/neu | Doku |

**Empfohlene Modelle für subagent-driven-development** (Nutzerwunsch: einfache Aufgaben auf einfachere Modelle): Task 1, 5, 6, 10, 11 → `haiku`; Task 2, 3, 4, 7 → `sonnet`; Task 8, 9 → `opus` (Electron-Startablauf/Selbstaustausch, schwer automatisiert zu testen).

---

### Task 1: Kopplungs-Modul (Server) — `haiku`

**Files:**
- Create: `src/sync/kopplung.js`
- Test: `tests/unit/kopplung.test.js`

**Interfaces:**
- Produces:
  - `normalisiereCode(eingabe: string): string` — entfernt alles außer Ziffern.
  - `erzeugeCode(): string` — 6 Ziffern, führende Nullen erlaubt.
  - `ladeKopplung({ datenverzeichnis: string, envSecret: string }): { secret: string, code: string, secretErzeugt: boolean }` — liest/schreibt `<datenverzeichnis>/kopplung.json` (`{ secret?, code }`); `secret` aus `envSecret`, falls gesetzt (dann wird kein Secret in die Datei geschrieben), sonst aus Datei, sonst neu erzeugt (`randomBytes(32).toString('hex')`, `secretErzeugt: true`).
  - `erneuereCode({ datenverzeichnis }): string`
  - `erzeugeSperre({ maxVersuche = 5, fensterMs = 60000, sperrMs = 60000, jetzt = () => Date.now() })` → `{ pruefe(ip): { gesperrt: boolean, restMs: number }, fehlversuch(ip): void, erfolg(ip): void }`

- [ ] **Step 1: Failing tests schreiben** — `tests/unit/kopplung.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { normalisiereCode, erzeugeCode, ladeKopplung, erneuereCode, erzeugeSperre } from '../../src/sync/kopplung.js';

const verzeichnis = () => mkdtempSync(path.join(tmpdir(), 'kopplung-'));

test('normalisiereCode akzeptiert Leerzeichen und Bindestrich', () => {
    assert.equal(normalisiereCode('482 913'), '482913');
    assert.equal(normalisiereCode(' 482-913 '), '482913');
    assert.equal(normalisiereCode(''), '');
});

test('erzeugeCode liefert genau 6 Ziffern', () => {
    for (let i = 0; i < 50; i++) assert.match(erzeugeCode(), /^\d{6}$/);
});

test('ohne envSecret wird ein Geheimnis erzeugt und beim zweiten Laden wiederverwendet', () => {
    const dir = verzeichnis();
    const erst = ladeKopplung({ datenverzeichnis: dir, envSecret: '' });
    assert.equal(erst.secretErzeugt, true);
    assert.match(erst.secret, /^[0-9a-f]{64}$/);
    const zweit = ladeKopplung({ datenverzeichnis: dir, envSecret: '' });
    assert.equal(zweit.secretErzeugt, false);
    assert.equal(zweit.secret, erst.secret);
    assert.equal(zweit.code, erst.code);
});

test('envSecret hat Vorrang und wird nicht in die Datei geschrieben', () => {
    const dir = verzeichnis();
    const k = ladeKopplung({ datenverzeichnis: dir, envSecret: 'aus-env' });
    assert.equal(k.secret, 'aus-env');
    assert.equal(k.secretErzeugt, false);
    const datei = JSON.parse(readFileSync(path.join(dir, 'kopplung.json'), 'utf8'));
    assert.equal(datei.secret, undefined);
    assert.match(datei.code, /^\d{6}$/);
});

test('erneuereCode ändert nur den Code, nicht das Geheimnis', () => {
    const dir = verzeichnis();
    const vorher = ladeKopplung({ datenverzeichnis: dir, envSecret: '' });
    let neu = erneuereCode({ datenverzeichnis: dir });
    while (neu === vorher.code) neu = erneuereCode({ datenverzeichnis: dir });
    const nachher = ladeKopplung({ datenverzeichnis: dir, envSecret: '' });
    assert.equal(nachher.code, neu);
    assert.equal(nachher.secret, vorher.secret);
});

test('Sperre nach 5 Fehlversuchen innerhalb 60 s, Ende nach 60 s', () => {
    let t = 0;
    const s = erzeugeSperre({ jetzt: () => t });
    for (let i = 0; i < 4; i++) s.fehlversuch('1.2.3.4');
    assert.equal(s.pruefe('1.2.3.4').gesperrt, false);
    s.fehlversuch('1.2.3.4');
    const p = s.pruefe('1.2.3.4');
    assert.equal(p.gesperrt, true);
    assert.equal(p.restMs, 60000);
    assert.equal(s.pruefe('5.6.7.8').gesperrt, false);
    t = 60001;
    assert.equal(s.pruefe('1.2.3.4').gesperrt, false);
});

test('Fehlversuche außerhalb des Fensters zählen nicht, erfolg setzt zurück', () => {
    let t = 0;
    const s = erzeugeSperre({ jetzt: () => t });
    for (let i = 0; i < 4; i++) s.fehlversuch('ip');
    t = 61000;
    s.fehlversuch('ip');
    assert.equal(s.pruefe('ip').gesperrt, false);
    for (let i = 0; i < 3; i++) s.fehlversuch('ip');
    s.erfolg('ip');
    s.fehlversuch('ip');
    assert.equal(s.pruefe('ip').gesperrt, false);
});
```

- [ ] **Step 2: Test laufen lassen, muss fehlschlagen**
Run: `node --test tests/unit/kopplung.test.js` — Expected: FAIL (Modul fehlt).

- [ ] **Step 3: Implementierung** — `src/sync/kopplung.js`:

```js
// Kopplung neuer Client-Geräte (Desktop-Client, Spec Desktop-Client Abschnitt 5.4): Der Hallen-
// Server hält ein gemeinsames Geheimnis (SYNC_SECRET) und einen 6-stelligen Kopplungscode, den die
// Turnierleitung auf matten.html sieht. Ein neues Gerät tauscht den Code einmalig gegen das
// Geheimnis. Ohne SYNC_SECRET in der .env erzeugt der Server das Geheimnis selbst (zero-config).
import { randomBytes, randomInt } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';

const DATEI = 'kopplung.json';

export function normalisiereCode(eingabe) {
    return String(eingabe || '').replace(/\D/g, '');
}

export function erzeugeCode() {
    return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

function dateipfad(datenverzeichnis) {
    return path.join(path.resolve(datenverzeichnis), DATEI);
}

function lies(datenverzeichnis) {
    const datei = dateipfad(datenverzeichnis);
    if (!existsSync(datei)) return {};
    try { return JSON.parse(readFileSync(datei, 'utf8')); } catch { return {}; }
}

function schreibe(datenverzeichnis, inhalt) {
    mkdirSync(path.resolve(datenverzeichnis), { recursive: true });
    writeFileSync(dateipfad(datenverzeichnis), JSON.stringify(inhalt, null, 2));
}

export function ladeKopplung({ datenverzeichnis, envSecret }) {
    const inhalt = lies(datenverzeichnis);
    let geaendert = false;
    let secretErzeugt = false;
    if (!inhalt.code) { inhalt.code = erzeugeCode(); geaendert = true; }
    if (!envSecret && !inhalt.secret) {
        inhalt.secret = randomBytes(32).toString('hex');
        secretErzeugt = true;
        geaendert = true;
    }
    if (geaendert) schreibe(datenverzeichnis, inhalt);
    return { secret: envSecret || inhalt.secret, code: inhalt.code, secretErzeugt };
}

export function erneuereCode({ datenverzeichnis }) {
    const inhalt = lies(datenverzeichnis);
    inhalt.code = erzeugeCode();
    schreibe(datenverzeichnis, inhalt);
    return inhalt.code;
}

// Fehlversuchs-Sperre je IP (gegen Durchprobieren der 10^6 Codes).
export function erzeugeSperre({ maxVersuche = 5, fensterMs = 60000, sperrMs = 60000, jetzt = () => Date.now() } = {}) {
    const versuche = new Map(); // ip -> Zeitstempel der Fehlversuche
    const gesperrtBis = new Map();
    return {
        pruefe(ip) {
            const bis = gesperrtBis.get(ip) || 0;
            const rest = bis - jetzt();
            if (rest > 0) return { gesperrt: true, restMs: rest };
            if (bis) gesperrtBis.delete(ip);
            return { gesperrt: false, restMs: 0 };
        },
        fehlversuch(ip) {
            const t = jetzt();
            const liste = (versuche.get(ip) || []).filter(z => t - z < fensterMs);
            liste.push(t);
            if (liste.length >= maxVersuche) {
                gesperrtBis.set(ip, t + sperrMs);
                versuche.delete(ip);
            } else {
                versuche.set(ip, liste);
            }
        },
        erfolg(ip) {
            versuche.delete(ip);
            gesperrtBis.delete(ip);
        }
    };
}
```

- [ ] **Step 4: Tests grün** — Run: `node --test tests/unit/kopplung.test.js` — Expected: alle PASS.
- [ ] **Step 5: Commit** — `git add src/sync/kopplung.js tests/unit/kopplung.test.js && git commit -m "feat(desktop): Kopplungs-Modul mit Geheimnis, Code und Fehlversuchs-Sperre"`

---

### Task 2: Client-Verteilungs-API am Server — `sonnet`

**Files:**
- Create: `src/routes/clientVerteilungRoutes.js`, `tests/e2e-sync/client-verteilung.spec.js`, `tests/e2e-sync/fixtures/client-downloads/<VERSION>/version.json` (wird im Test zur Laufzeit erzeugt, s. u.)
- Modify: `src/middleware/auth.js` (neue Export-Funktion am Dateiende), `src/app.js` (Server-Zweig), `tests/e2e-sync/test-env.js`, `tests/e2e-cluster/test-env.js`

**Interfaces:**
- Consumes (Task 1): `ladeKopplung`, `erneuereCode`, `erzeugeSperre`, `normalisiereCode`.
- Produces:
  - `requireSteuerungPasswort(req, res, next)` in `src/middleware/auth.js`.
  - `getClientVerteilungRoutes({ datenverzeichnis, downloadsVerzeichnis, version, kopplung })` → Express-Router; `kopplung` ist das Objekt `{ secret, code }` aus `ladeKopplung` (Code wird beim Erneuern im Objekt aktualisiert).
  - HTTP: `GET /api/client/version` → Inhalt von `<downloads>/<version>/version.json` oder 404 `{ success:false, error }`; `POST /api/client/koppeln` `{ code, clientId }` → 200 `{ secret }` | 401 `{ error:'Code falsch' }` | 429 `{ error, restSekunden }`; `GET /api/client/kopplungscode` → `{ code }`; `POST /api/client/kopplungscode/erneuern` → `{ code }`; statisch `/downloads/*` aus `downloadsVerzeichnis`.
  - `version.json`-Format (gilt für Task 5/6/8):
    ```json
    { "version": "1.2.0",
      "dateien": {
        "win32-x64":        { "installieren": { "datei": "…exe", "sha256": "…", "signatur": "…" }, "aktualisieren": { … } },
        "darwin-universal": { "installieren": { "datei": "…dmg", … }, "aktualisieren": { "datei": "…zip", … } },
        "linux-x64":        { "installieren": { "datei": "…AppImage", … }, "aktualisieren": { … } } } }
    ```
    Dateipfade sind relativ zu `/downloads/<version>/`.
  - `src/app.js` exportiert am Ende `export { app };`.

- [ ] **Step 1: Test-Umgebung ergänzen** — in `tests/e2e-sync/test-env.js` im `syncServerEnv` ergänzen:

```js
    MDNS_AKTIV: 'false',
    PORT80_WEITERLEITUNG: 'false',
    CLIENT_DOWNLOADS_VERZEICHNIS: SYNC_TEST_DOWNLOADS,
```
und oben `export const SYNC_TEST_DOWNLOADS = './data/test-sync-downloads';`; `SYNC_TEST_DOWNLOADS` in `playwright.sync.config.js` in die Aufräumliste (`for (const pfad of [...])`) aufnehmen. In `tests/e2e-cluster/test-env.js` bei **beiden** Server-Env-Blöcken (Zeilen ~45 und ~64) `MDNS_AKTIV: 'false', PORT80_WEITERLEITUNG: 'false',` ergänzen.

- [ ] **Step 2: Failing E2E-Test** — `tests/e2e-sync/client-verteilung.spec.js`:

```js
import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { SYNC_TEST_DOWNLOADS, SYNC_TEST_DOKUMENTE } from './test-env.js';

const { version } = createRequire(import.meta.url)('../../package.json');
const ordner = path.join(SYNC_TEST_DOWNLOADS, version);

test.describe.serial('Client-Verteilung', () => {
    test('ohne Client-Dateien liefert /api/client/version 404', async ({ request }) => {
        rmSync(SYNC_TEST_DOWNLOADS, { recursive: true, force: true });
        const resp = await request.get('/api/client/version');
        expect(resp.status()).toBe(404);
    });

    test('mit version.json wird sie ausgeliefert, Dateien liegen unter /downloads', async ({ request }) => {
        mkdirSync(ordner, { recursive: true });
        const vj = { version, dateien: { 'win32-x64': {
            installieren: { datei: 'a.exe', sha256: 'x', signatur: 'y' },
            aktualisieren: { datei: 'a.exe', sha256: 'x', signatur: 'y' } } } };
        writeFileSync(path.join(ordner, 'version.json'), JSON.stringify(vj));
        writeFileSync(path.join(ordner, 'a.exe'), 'INHALT');
        const resp = await request.get('/api/client/version');
        expect(resp.ok()).toBeTruthy();
        expect(await resp.json()).toEqual(vj);
        const datei = await request.get(`/downloads/${version}/a.exe`);
        expect(await datei.text()).toBe('INHALT');
    });

    test('Kopplung: richtiger Code (mit Leerzeichen) liefert das Geheimnis', async ({ request }) => {
        const { code } = await (await request.get('/api/client/kopplungscode')).json();
        expect(code).toMatch(/^\d{6}$/);
        const resp = await request.post('/api/client/koppeln', { data: { code: `${code.slice(0, 3)} ${code.slice(3)}`, clientId: 'test-client' } });
        expect(resp.status()).toBe(200);
        expect((await resp.json()).secret).toBe('test-geheimnis');
    });

    test('Kopplung: 5 falsche Codes sperren, auch der richtige Code gilt dann nicht', async ({ request }) => {
        const { code } = await (await request.get('/api/client/kopplungscode')).json();
        const falsch = code === '000000' ? '111111' : '000000';
        for (let i = 0; i < 5; i++) {
            const r = await request.post('/api/client/koppeln', { data: { code: falsch, clientId: 'x' } });
            expect(r.status()).toBe(401);
        }
        const gesperrt = await request.post('/api/client/koppeln', { data: { code, clientId: 'x' } });
        expect(gesperrt.status()).toBe(429);
        expect((await gesperrt.json()).restSekunden).toBeGreaterThan(0);
    });

    test('Erneuern ändert den Code', async ({ request }) => {
        const vorher = (await (await request.get('/api/client/kopplungscode')).json()).code;
        let neu = vorher;
        for (let i = 0; i < 5 && neu === vorher; i++) {
            neu = (await (await request.post('/api/client/kopplungscode/erneuern')).json()).code;
        }
        expect(neu).not.toBe(vorher);
        expect((await (await request.get('/api/client/kopplungscode')).json()).code).toBe(neu);
    });
});
```
Hinweis: Die Sperre bleibt nach dem 4. Test 60 s für `127.0.0.1` aktiv — deshalb laufen Kopplungs-Tests, die Erfolg erwarten, vor dem Sperr-Test. Folgende Spec-Dateien der Suite koppeln nicht.

- [ ] **Step 3: Test fehlschlägt** — Run: `npx playwright test -c playwright.sync.config.js tests/e2e-sync/client-verteilung.spec.js` — Expected: FAIL (404 auf `/api/client/kopplungscode`).

- [ ] **Step 4: `requireSteuerungPasswort`** — am Ende von `src/middleware/auth.js`:

```js
// Wie requireWriteAuth, aber auch für GET: für Daten, die nur die Turnierleitung sehen darf
// (z.B. den Kopplungscode für neue Client-Geräte). Ohne STEUERUNG_PASSWORD offen wie alle
// Verwaltungsseiten im Hallenbetrieb.
export function requireSteuerungPasswort(req, res, next) {
    const password = process.env.STEUERUNG_PASSWORD;
    if (!password || req.headers['x-steuerung-password'] === password) return next();
    return res.status(401).json({ success: false, error: 'Passwort erforderlich.' });
}
```

- [ ] **Step 5: Router** — `src/routes/clientVerteilungRoutes.js`:

```js
// Verteilung des Desktop-Clients (Spec Desktop-Client Abschnitt 5): version.json der zur
// Serverversion passenden Client-Dateien, Kopplung neuer Geräte per Code, Kopplungscode für die
// Turnierleitung (matten.html). Nur Hallen-Server (SYNC_ROLLE=server).
import express from 'express';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { requireSteuerungPasswort } from '../middleware/auth.js';
import { erneuereCode, erzeugeSperre, normalisiereCode } from '../sync/kopplung.js';

export function getClientVerteilungRoutes({ datenverzeichnis, downloadsVerzeichnis, version, kopplung }) {
    const router = express.Router();
    const sperre = erzeugeSperre();

    router.get('/version', (req, res) => {
        const datei = path.join(path.resolve(downloadsVerzeichnis), version, 'version.json');
        if (!existsSync(datei)) {
            return res.status(404).json({ success: false, error: `Für Version ${version} liegen am Server keine Client-Dateien vor.` });
        }
        res.type('application/json').send(readFileSync(datei, 'utf8'));
    });

    router.post('/koppeln', (req, res) => {
        const ip = req.socket.remoteAddress || '';
        const pruefung = sperre.pruefe(ip);
        if (pruefung.gesperrt) {
            return res.status(429).json({ error: 'Zu viele Fehlversuche.', restSekunden: Math.ceil(pruefung.restMs / 1000) });
        }
        if (normalisiereCode(req.body && req.body.code) !== kopplung.code) {
            sperre.fehlversuch(ip);
            return res.status(401).json({ error: 'Code falsch' });
        }
        sperre.erfolg(ip);
        console.log(`[Kopplung] Gerät ${String(req.body.clientId || '?')} (${ip}) gekoppelt.`);
        res.json({ secret: kopplung.secret });
    });

    router.get('/kopplungscode', requireSteuerungPasswort, (req, res) => res.json({ code: kopplung.code }));

    router.post('/kopplungscode/erneuern', requireSteuerungPasswort, (req, res) => {
        kopplung.code = erneuereCode({ datenverzeichnis });
        res.json({ code: kopplung.code });
    });

    return router;
}
```

- [ ] **Step 6: Einbindung in `src/app.js`** — Imports oben ergänzen:

```js
import { ladeKopplung } from './sync/kopplung.js';
import { getClientVerteilungRoutes } from './routes/clientVerteilungRoutes.js';
```
Im Server-Zweig **direkt vor** `const sync = await starteSyncDienst({` einfügen:

```js
    // Kopplung neuer Desktop-Clients: ohne SYNC_SECRET in der .env erzeugt der Hallen-Server das
    // Geheimnis selbst (zero-config). Es muss VOR dem Sync-Dienst feststehen, der es prüft.
    const kopplung = syncKonfig.istServer ? ladeKopplung({ datenverzeichnis: syncKonfig.datenverzeichnis, envSecret: syncKonfig.secret }) : null;
    if (kopplung) {
        syncKonfig.secret = kopplung.secret;
        if (kopplung.secretErzeugt) {
            console.warn('[Kopplung] SYNC_SECRET automatisch erzeugt – Client-Geräte mit .env neu koppeln oder SYNC_SECRET aus kopplung.json übernehmen.');
        }
    }
```
Direkt **nach** `app.use(express.static(path.join(__dirname, '../public')));` im Server-Zweig einfügen:

```js
    if (kopplung) {
        const downloadsVerzeichnis = process.env.CLIENT_DOWNLOADS_VERZEICHNIS || './data/client-downloads';
        app.use('/downloads', express.static(path.resolve(downloadsVerzeichnis)));
        app.get('/download', (req, res) => res.sendFile(path.join(__dirname, '../public/download.html')));
        app.use('/api/client', getClientVerteilungRoutes({
            datenverzeichnis: syncKonfig.datenverzeichnis,
            downloadsVerzeichnis,
            version: require('../package.json').version,
            kopplung
        }));
    }
```
(`require` ist oben in `app.js` bereits per `createRequire` definiert.) Da `public/download.html` erst in Task 3 entsteht, liefert `/download` bis dahin 404 — das ist in Ordnung. Ganz am Dateiende nach `app.listen(...)` ergänzen: `export { app };`

- [ ] **Step 7: Tests grün** — Run: `npx playwright test -c playwright.sync.config.js` (ganze Sync-Suite, weil sich das Server-Geheimnis-Verhalten ändert) und `npm run test:unit` — Expected: alle PASS.
- [ ] **Step 8: Commit** — `git add -A src/routes/clientVerteilungRoutes.js src/middleware/auth.js src/app.js tests/e2e-sync tests/e2e-cluster/test-env.js playwright.sync.config.js && git commit -m "feat(desktop): Client-Verteilungs-API (version.json, Kopplung, Downloads) am Hallen-Server"`

---

### Task 3: Download-Seite und Kopplungskarte — `sonnet`

**Files:**
- Create: `public/download.html`, `public/js/download.js`, `public/js/kopplungKarte.js`
- Modify: `public/matten.html` (neue Karte nach `#syncKonflikteKarte`, Script-Tag), `tests/e2e-sync/client-verteilung.spec.js` (Tests ergänzen)

**Interfaces:**
- Consumes (Task 2): `GET /api/client/version`, `GET /api/client/kopplungscode`, `POST /api/client/kopplungscode/erneuern`, `/downloads/<version>/<datei>`.
- Produces: Element-IDs für Tests: `#downloadEmpfehlung` (Link `a#downloadHauptlink`), `#downloadWeitere`, `#downloadHinweis`, `#kopplungKarte`, `#kopplungCode`, `#kopplungErneuernBtn`.

- [ ] **Step 1: Failing Tests** — an `tests/e2e-sync/client-verteilung.spec.js` innerhalb des `describe.serial` **nach** dem Test „mit version.json …“ und **vor** den Kopplungs-Tests einfügen (die Fixture aus dem vorigen Test enthält nur `win32-x64`; für diese Tests alle drei Plattformen schreiben):

```js
    test('Download-Seite empfiehlt die Datei passend zum Betriebssystem', async ({ browser }) => {
        const d = (datei) => ({ datei, sha256: 'x', signatur: 'y' });
        writeFileSync(path.join(ordner, 'version.json'), JSON.stringify({ version, dateien: {
            'win32-x64': { installieren: d('w.exe'), aktualisieren: d('w.exe') },
            'darwin-universal': { installieren: d('m.dmg'), aktualisieren: d('m.zip') },
            'linux-x64': { installieren: d('l.AppImage'), aktualisieren: d('l.AppImage') } } }));
        const faelle = [
            ['Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'w.exe'],
            ['Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)', 'm.dmg'],
            ['Mozilla/5.0 (X11; Linux x86_64)', 'l.AppImage']
        ];
        for (const [ua, datei] of faelle) {
            const ctx = await browser.newContext({ userAgent: ua });
            const page = await ctx.newPage();
            await page.goto('/download');
            await expect(page.locator('#downloadHauptlink')).toHaveAttribute('href', `/downloads/${version}/${datei}`);
            await expect(page.locator('#downloadWeitere a')).toHaveCount(2);
            await ctx.close();
        }
    });

    test('Download-Seite ohne Client-Dateien zeigt einen Hinweis', async ({ page }) => {
        rmSync(path.join(ordner, 'version.json'));
        await page.goto('/download');
        await expect(page.locator('#downloadHinweis')).toContainText('keine Client-Dateien');
        await expect(page.locator('#downloadHauptlink')).toHaveCount(0);
        // Fixture für die folgenden Tests wiederherstellen
        writeFileSync(path.join(ordner, 'version.json'), JSON.stringify({ version, dateien: {} }));
    });

    // Navigation auf matten.html wie in den bestehenden Sync-Tests (grep -rn "matten.html" tests/e2e-sync) —
    // ggf. vorher ein Turnier per richteDk8TurnierEin anlegen, falls die Seite eines erwartet.
    test('matten.html zeigt die Kopplungskarte, Erneuern aktualisiert den Code', async ({ page, request }) => {
        await page.goto('/matten.html');
        const code = (await (await request.get('/api/client/kopplungscode')).json()).code;
        await expect(page.locator('#kopplungKarte')).toBeVisible();
        await expect(page.locator('#kopplungCode')).toHaveText(`${code.slice(0, 3)} ${code.slice(3)}`);
        await page.locator('#kopplungErneuernBtn').click();
        await expect(page.locator('#kopplungCode')).not.toHaveText(`${code.slice(0, 3)} ${code.slice(3)}`);
    });
```
(Der Erneuern-Test ändert den Code; die nachfolgenden Kopplungs-Tests lesen den Code jeweils frisch.)

- [ ] **Step 2: Fehlschlag prüfen** — Run: `npx playwright test -c playwright.sync.config.js tests/e2e-sync/client-verteilung.spec.js` — Expected: FAIL.

- [ ] **Step 3: `public/download.html`** — schlichte Seite ohne Login/Menü (öffentlich, Helfer-Gerät); Stylesheet `/css/common.css` wie die übrigen Seiten:

```html
<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Hajime Pro – Client herunterladen</title>
    <link rel="stylesheet" href="/css/common.css">
    <style>
        body { max-width: 640px; margin: 40px auto; padding: 0 16px; font-family: sans-serif; }
        #downloadHauptlink { display: inline-block; padding: 14px 24px; font-size: 18px; text-decoration: none; }
        .anleitung { background: #f5f5f5; padding: 12px 16px; border-radius: 6px; font-size: 14px; }
        code { user-select: all; }
    </style>
</head>
<body>
    <img src="/hajime_pro.png" alt="Hajime Pro" style="max-width: 240px;">
    <h1>Client herunterladen</h1>
    <p id="downloadHinweis"></p>
    <div id="downloadEmpfehlung"></div>
    <div id="downloadAnleitung" class="anleitung" style="display:none;"></div>
    <h3>Andere Betriebssysteme</h3>
    <div id="downloadWeitere"></div>
    <script src="/js/download.js"></script>
</body>
</html>
```

- [ ] **Step 4: `public/js/download.js`**:

```js
// Download-Seite des Desktop-Clients (turnier.local/download): erkennt das Betriebssystem am
// User-Agent und bietet die passende Installationsdatei der aktuellen Serverversion an.
(async () => {
    const NAMEN = { 'win32-x64': 'Windows', 'darwin-universal': 'macOS', 'linux-x64': 'Linux' };
    const ANLEITUNG = {
        'win32-x64': 'Datei öffnen. Erscheint „Der Computer wurde durch Windows geschützt“: <b>Weitere Informationen → Trotzdem ausführen</b>. Danach liegt „Hajime Pro“ auf dem Desktop.',
        'darwin-universal': 'Datei öffnen und „Hajime Pro“ in den Ordner <b>Programme</b> ziehen. Beim ersten Start: <b>Systemeinstellungen → Datenschutz &amp; Sicherheit → Trotzdem öffnen</b>.',
        'linux-x64': 'Datei ausführbar machen und starten. Unter Ubuntu ab 22.04 einmalig nötig: <code>sudo apt install libfuse2</code> (ab 24.04: <code>sudo apt install libfuse2t64</code>).'
    };
    const ua = navigator.userAgent;
    const eigene = /Windows/i.test(ua) ? 'win32-x64' : /Mac OS X|Macintosh/i.test(ua) ? 'darwin-universal' : /Linux|X11/i.test(ua) ? 'linux-x64' : null;

    const hinweis = document.getElementById('downloadHinweis');
    const resp = await fetch('/api/client/version').catch(() => null);
    if (!resp || !resp.ok) {
        hinweis.textContent = 'Auf diesem Server liegen noch keine Client-Dateien vor. Bitte die Turnierleitung, „npm run client:holen“ auszuführen.';
        return;
    }
    const { version, dateien } = await resp.json();
    const link = (schluessel) => `/downloads/${encodeURIComponent(version)}/${encodeURIComponent(dateien[schluessel].installieren.datei)}`;
    hinweis.textContent = `Version ${version}`;

    if (eigene && dateien[eigene]) {
        const a = document.createElement('a');
        a.id = 'downloadHauptlink';
        a.className = 'btn btn-primary';
        a.href = link(eigene);
        a.textContent = `Für ${NAMEN[eigene]} herunterladen`;
        document.getElementById('downloadEmpfehlung').appendChild(a);
        const anleitung = document.getElementById('downloadAnleitung');
        anleitung.innerHTML = ANLEITUNG[eigene];
        anleitung.style.display = '';
    }
    const weitere = document.getElementById('downloadWeitere');
    for (const schluessel of Object.keys(NAMEN)) {
        if (schluessel === eigene || !dateien[schluessel]) continue;
        const p = document.createElement('p');
        const a = document.createElement('a');
        a.href = link(schluessel);
        a.textContent = NAMEN[schluessel];
        p.appendChild(a);
        weitere.appendChild(p);
    }
})();
```
(Existiert `.btn-primary` in `common.css` nicht, `btn btn-outlined` verwenden — vorher mit `grep -n "btn-" public/css/common.css` prüfen.)

- [ ] **Step 5: Kopplungskarte** — in `public/matten.html` direkt nach dem schließenden `</div>` von `#syncKonflikteKarte` einfügen:

```html
<div class="mdc-card" id="kopplungKarte" style="display: none; margin-top: 24px; padding: 16px 24px;">
    <div class="form-title-area">
        <span class="material-icons">devices</span>
        <h1>Neues Gerät koppeln</h1>
        <span class="material-icons">devices</span>
    </div>
    <p style="color: var(--text-muted); font-size: 13px; margin-top: 0;">Client-Software unter <b>turnier.local/download</b> installieren und beim ersten Start diesen Code eingeben.</p>
    <div style="display: flex; align-items: center; gap: 24px; flex-wrap: wrap;">
        <span id="kopplungCode" style="font-size: 40px; font-weight: bold; letter-spacing: 4px;">…</span>
        <button type="button" class="btn btn-outlined" id="kopplungErneuernBtn">Code erneuern</button>
    </div>
</div>
```
und nach `<script src="/js/konflikte.js"></script>` ergänzen: `<script src="/js/kopplungKarte.js"></script>`.

`public/js/kopplungKarte.js`:

```js
// Karte "Neues Gerät koppeln" auf matten.html (nur Hallen-Server): zeigt den Kopplungscode, den
// ein neu installierter Desktop-Client beim ersten Start abfragt. Erneuern macht den alten Code
// ungültig; bereits gekoppelte Geräte bleiben gekoppelt.
document.addEventListener('DOMContentLoaded', async () => {
    const karte = document.getElementById('kopplungKarte');
    const anzeige = document.getElementById('kopplungCode');
    if (!karte || !anzeige) return;
    const zeige = (code) => { anzeige.textContent = `${code.slice(0, 3)} ${code.slice(3)}`; };

    const resp = await fetch('/api/client/kopplungscode').catch(() => null);
    if (!resp || !resp.ok) return; // kein Hallen-Server oder kein Passwort
    zeige((await resp.json()).code);
    karte.style.display = '';

    document.getElementById('kopplungErneuernBtn').addEventListener('click', async () => {
        const r = await fetch('/api/client/kopplungscode/erneuern', { method: 'POST' });
        if (r.ok) zeige((await r.json()).code);
        else if (window.zeigeNotification) window.zeigeNotification('Code konnte nicht erneuert werden.', 'error');
    });
});
```

- [ ] **Step 6: Tests grün** — Run: `npx playwright test -c playwright.sync.config.js` — Expected: PASS. Zusätzlich `npm run test:e2e -- tests/e2e/` für Seiten mit `matten.html` (Karte bleibt ohne Server-Rolle unsichtbar): `npx playwright test -g "matte"` — Expected: PASS.
- [ ] **Step 7: Commit** — `git add public/download.html public/js/download.js public/js/kopplungKarte.js public/matten.html tests/e2e-sync/client-verteilung.spec.js && git commit -m "feat(desktop): Download-Seite und Kopplungskarte auf matten.html"`

---

### Task 4: mDNS-Ankündigung und Port-80-Weiterleitung — `sonnet`

**Files:**
- Create: `src/sync/ankuendigung.js`, `src/sync/port80.js`, `tests/unit/ankuendigung.test.js`, `deploy/linux/systemd/` (Ergänzung, s. Step 6)
- Modify: `package.json` (dependencies), `src/app.js`

**Interfaces:**
- Consumes: `sync.modus()` (`src/sync/syncDienst.js:183`, liefert `'master'|'secondary'`).
- Produces:
  - `beantworteAnfrage(fragen: Array<{name,type}>, { hostname: string, adressen: string[] }): Array<{name,type:'A',ttl:120,data:string}>` (rein)
  - `lokaleIpv4Adressen(netzwerk = os.networkInterfaces()): string[]` (rein)
  - `starteAnkuendigung({ name, port, version, knoten, modus: () => string }) → { stoppe(): void }`
  - `starteWeiterleitung({ zielPort: number }) → { stoppe(): void }`

- [ ] **Step 1: Abhängigkeiten** — Run: `npm install bonjour-service multicast-dns`

- [ ] **Step 2: Failing Unit-Test** — `tests/unit/ankuendigung.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { beantworteAnfrage, lokaleIpv4Adressen } from '../../src/sync/ankuendigung.js';

test('A-Anfrage für den eigenen Namen wird mit allen Adressen beantwortet', () => {
    const a = beantworteAnfrage([{ name: 'turnier.local', type: 'A' }], { hostname: 'turnier.local', adressen: ['192.168.1.5', '10.0.0.2'] });
    assert.deepEqual(a, [
        { name: 'turnier.local', type: 'A', ttl: 120, data: '192.168.1.5' },
        { name: 'turnier.local', type: 'A', ttl: 120, data: '10.0.0.2' }
    ]);
});

test('ANY-Anfrage, Groß-/Kleinschreibung egal; fremde Namen und AAAA werden ignoriert', () => {
    assert.equal(beantworteAnfrage([{ name: 'Turnier.Local', type: 'ANY' }], { hostname: 'turnier.local', adressen: ['1.2.3.4'] }).length, 1);
    assert.equal(beantworteAnfrage([{ name: 'anderer.local', type: 'A' }], { hostname: 'turnier.local', adressen: ['1.2.3.4'] }).length, 0);
    assert.equal(beantworteAnfrage([{ name: 'turnier.local', type: 'AAAA' }], { hostname: 'turnier.local', adressen: ['1.2.3.4'] }).length, 0);
});

test('lokaleIpv4Adressen ohne interne und ohne IPv6', () => {
    const netz = {
        lo: [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
        eth0: [{ family: 'IPv4', address: '192.168.1.5', internal: false }, { family: 'IPv6', address: 'fe80::1', internal: false }],
        wlan: [{ family: 4, address: '10.0.0.2', internal: false }]
    };
    assert.deepEqual(lokaleIpv4Adressen(netz), ['192.168.1.5', '10.0.0.2']);
});
```

- [ ] **Step 3: Fehlschlag** — Run: `node --test tests/unit/ankuendigung.test.js` — Expected: FAIL.

- [ ] **Step 4: `src/sync/ankuendigung.js`**:

```js
// mDNS-Ankündigung des Hallen-Servers (Spec Desktop-Client Abschnitt 5.1): Desktop-Clients finden
// den Server über den Dienst _hajime._tcp, Browser erreichen ihn als <MDNS_NAME>.local (z.B.
// turnier.local/download). Im Cluster kündigt nur der Master an — der Zustand wird alle 2 s aus
// sync.modus() übernommen, damit Beförderung/Rückstufung keine eigene Verdrahtung brauchen.
import os from 'os';
import { Bonjour } from 'bonjour-service';
import multicastDns from 'multicast-dns';

const PRUEF_MS = 2000;

export function lokaleIpv4Adressen(netzwerk = os.networkInterfaces()) {
    const ergebnis = [];
    for (const eintraege of Object.values(netzwerk)) {
        for (const e of eintraege || []) {
            if ((e.family === 'IPv4' || e.family === 4) && !e.internal) ergebnis.push(e.address);
        }
    }
    return ergebnis;
}

export function beantworteAnfrage(fragen, { hostname, adressen }) {
    const gesucht = fragen.some(f => String(f.name).toLowerCase() === hostname.toLowerCase() && (f.type === 'A' || f.type === 'ANY'));
    return gesucht ? adressen.map(data => ({ name: hostname, type: 'A', ttl: 120, data })) : [];
}

export function starteAnkuendigung({ name, port, version, knoten, modus }) {
    const hostname = `${name}.local`;
    const bonjour = new Bonjour();
    const mdns = multicastDns();
    let dienst = null;
    let aktiv = false;

    // A-Records für <name>.local — damit auch Browser (nicht nur der Desktop-Client) den Namen auflösen.
    mdns.on('query', (anfrage) => {
        if (!aktiv) return;
        const antworten = beantworteAnfrage(anfrage.questions || [], { hostname, adressen: lokaleIpv4Adressen() });
        if (antworten.length) mdns.respond({ answers: antworten });
    });
    mdns.on('error', (err) => console.warn('[mDNS] Fehler:', err.message));

    function abgleichen() {
        const sollAktiv = modus() === 'master';
        if (sollAktiv === aktiv) return;
        aktiv = sollAktiv;
        if (aktiv) {
            dienst = bonjour.publish({ name: `Hajime Pro (${knoten || name})`, type: 'hajime', port, host: hostname, txt: { version, knoten: knoten || '', rolle: 'master' } });
            console.log(`[mDNS] Kündige ${hostname}:${port} an.`);
        } else if (dienst) {
            dienst.stop();
            dienst = null;
            console.log('[mDNS] Ankündigung beendet (kein Master).');
        }
    }
    abgleichen();
    const timer = setInterval(abgleichen, PRUEF_MS);
    timer.unref();

    return {
        stoppe() {
            clearInterval(timer);
            aktiv = false;
            bonjour.unpublishAll(() => bonjour.destroy());
            mdns.destroy();
        }
    };
}
```

- [ ] **Step 5: `src/sync/port80.js`**:

```js
// Leitet http://<name>.local/... (Port 80) auf den eigentlichen Port weiter, damit Helfer
// "turnier.local/download" ohne Portangabe öffnen können. Fehlen die Rechte für Port 80 (Linux ohne
// CAP_NET_BIND_SERVICE) oder ist er belegt, wird das nur geloggt — alles läuft weiter unter :PORT.
import http from 'http';

export function starteWeiterleitung({ zielPort }) {
    const server = http.createServer((req, res) => {
        const host = String(req.headers.host || 'localhost').replace(/:\d+$/, '');
        res.writeHead(302, { Location: `http://${host}:${zielPort}${req.url}` });
        res.end();
    });
    server.on('error', (err) => console.warn(`[Port 80] Weiterleitung nicht aktiv (${err.code || err.message}) – erreichbar unter :${zielPort}.`));
    server.listen(80);
    return { stoppe: () => server.close() };
}
```

- [ ] **Step 6: Einbindung `src/app.js`** — Imports ergänzen:

```js
import { starteAnkuendigung } from './sync/ankuendigung.js';
import { starteWeiterleitung } from './sync/port80.js';
```
Im Server-Zweig direkt nach dem Block `if (kopplung) { … app.use('/api/client', …) }` (Task 2) einfügen:

```js
    if (sync && process.env.MDNS_AKTIV !== 'false') {
        starteAnkuendigung({
            name: process.env.MDNS_NAME || 'turnier',
            port: Number(PORT),
            version: require('../package.json').version,
            knoten: clusterKonfig.aktiv ? clusterKonfig.knoten : '',
            modus: () => sync.modus()
        });
    }
    if (sync && process.env.PORT80_WEITERLEITUNG !== 'false' && Number(PORT) !== 80) {
        starteWeiterleitung({ zielPort: Number(PORT) });
    }
```
(Feldname für den Knoten vorher prüfen: `grep -n "knoten" src/cluster/konfig.js` — ggf. anpassen.)

`deploy/linux/systemd/`: in der vorhandenen Service-Datei (Name per `ls deploy/linux/systemd` ermitteln) im `[Service]`-Abschnitt ergänzen: `AmbientCapabilities=CAP_NET_BIND_SERVICE`; in `deploy/linux/README.md` einen Absatz „Erreichbarkeit als turnier.local“ (mDNS über UDP 5353 in der Firewall erlauben: `sudo ufw allow 5353/udp`, Port 80 per Capability).

- [ ] **Step 7: Tests grün + manuelle Prüfung** — Run: `npm run test:unit` und `npm run test:e2e:sync` (Ankündigung dort aus) — Expected: PASS. Manuell (Windows-Entwicklungsrechner, einmalig): lokalen Server mit `SYNC_ROLLE=server` starten, dann in PowerShell `Resolve-DnsName turnier.local -Type A` → liefert die eigene LAN-IP; Browser `http://turnier.local/download` öffnet die Seite. Ergebnis im Commit-Text notieren.
- [ ] **Step 8: Commit** — `git add package.json package-lock.json src/sync/ankuendigung.js src/sync/port80.js src/app.js tests/unit/ankuendigung.test.js deploy/linux && git commit -m "feat(desktop): mDNS-Ankündigung turnier.local/_hajime._tcp und Port-80-Weiterleitung"`

---

### Task 5: Reine Update-Logik des Clients — `haiku`

**Files:**
- Create: `desktop/updateLogik.js`, `tests/unit/updateLogik.test.js`

**Interfaces:**
- Produces:
  - `plattformSchluessel(platform: string, arch: string): 'win32-x64'|'darwin-universal'|'linux-x64'|null` (darwin: jede arch → `darwin-universal`; win32/linux nur `x64`)
  - `signaturNachricht({ datei, version, sha256 }): string` → `` `${datei}\n${version}\n${sha256}` ``
  - `sha256Hex(puffer: Buffer): string`
  - `pruefeDatei({ puffer: Buffer, eintrag: {datei,sha256,signatur}, version: string, oeffentlicherSchluessel: string }): { ok: boolean, grund?: 'sha256'|'signatur' }`
  - `entscheideUpdate({ eigeneVersion, serverVersion, versuche: Record<string, number> }): 'kein'|'aktualisieren'|'aufgegeben'` (MAX 2)
  - `waehleServer(kandidaten: Array<{ url: string, rolle?: string }>): { url, rolle } | null`

- [ ] **Step 1: Failing Test** — `tests/unit/updateLogik.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'crypto';
import { plattformSchluessel, signaturNachricht, sha256Hex, pruefeDatei, entscheideUpdate, waehleServer } from '../../desktop/updateLogik.js';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const pub = publicKey.export({ type: 'spki', format: 'pem' });
function signiert(puffer, datei = 'a.exe', version = '1.2.0') {
    const sha256 = sha256Hex(puffer);
    const signatur = sign(null, Buffer.from(signaturNachricht({ datei, version, sha256 })), privateKey).toString('base64');
    return { datei, sha256, signatur };
}

test('plattformSchluessel', () => {
    assert.equal(plattformSchluessel('win32', 'x64'), 'win32-x64');
    assert.equal(plattformSchluessel('darwin', 'arm64'), 'darwin-universal');
    assert.equal(plattformSchluessel('darwin', 'x64'), 'darwin-universal');
    assert.equal(plattformSchluessel('linux', 'x64'), 'linux-x64');
    assert.equal(plattformSchluessel('linux', 'arm64'), null);
    assert.equal(plattformSchluessel('win32', 'arm64'), null);
});

test('korrekt signierte Datei wird akzeptiert', () => {
    const puffer = Buffer.from('INHALT');
    assert.deepEqual(pruefeDatei({ puffer, eintrag: signiert(puffer), version: '1.2.0', oeffentlicherSchluessel: pub }), { ok: true });
});

test('abgeschnittene Datei (Download abgebrochen) scheitert an sha256', () => {
    const puffer = Buffer.from('INHALT-VOLLSTAENDIG');
    const eintrag = signiert(puffer);
    assert.deepEqual(pruefeDatei({ puffer: puffer.subarray(0, 5), eintrag, version: '1.2.0', oeffentlicherSchluessel: pub }), { ok: false, grund: 'sha256' });
});

test('manipulierte Datei mit passend neu berechnetem sha256 scheitert an der Signatur', () => {
    const echt = signiert(Buffer.from('ECHT'));
    const boese = Buffer.from('BOESE');
    const eintrag = { ...echt, sha256: sha256Hex(boese) };
    assert.deepEqual(pruefeDatei({ puffer: boese, eintrag, version: '1.2.0', oeffentlicherSchluessel: pub }), { ok: false, grund: 'signatur' });
});

test('Signatur einer anderen Version wird nicht akzeptiert', () => {
    const puffer = Buffer.from('X');
    const eintrag = signiert(puffer, 'a.exe', '1.1.0');
    assert.equal(pruefeDatei({ puffer, eintrag, version: '1.2.0', oeffentlicherSchluessel: pub }).ok, false);
});

test('kaputte Signatur (kein base64) wirft nicht, sondern scheitert', () => {
    const puffer = Buffer.from('X');
    const eintrag = { ...signiert(puffer), signatur: '###' };
    assert.equal(pruefeDatei({ puffer, eintrag, version: '1.2.0', oeffentlicherSchluessel: pub }).ok, false);
});

test('entscheideUpdate: gleich, abweichend (auch nach unten), Schleifenschutz', () => {
    assert.equal(entscheideUpdate({ eigeneVersion: '1.2.0', serverVersion: '1.2.0', versuche: {} }), 'kein');
    assert.equal(entscheideUpdate({ eigeneVersion: '1.2.0', serverVersion: '1.3.0', versuche: {} }), 'aktualisieren');
    assert.equal(entscheideUpdate({ eigeneVersion: '1.2.0', serverVersion: '1.1.0', versuche: {} }), 'aktualisieren');
    assert.equal(entscheideUpdate({ eigeneVersion: '1.2.0', serverVersion: '1.3.0', versuche: { '1.3.0': 1 } }), 'aktualisieren');
    assert.equal(entscheideUpdate({ eigeneVersion: '1.2.0', serverVersion: '1.3.0', versuche: { '1.3.0': 2 } }), 'aufgegeben');
    assert.equal(entscheideUpdate({ eigeneVersion: '1.2.0', serverVersion: null, versuche: {} }), 'kein');
});

test('waehleServer bevorzugt rolle=master, sonst den ersten, leer -> null', () => {
    assert.equal(waehleServer([]), null);
    assert.deepEqual(waehleServer([{ url: 'http://a' }, { url: 'http://b', rolle: 'master' }]), { url: 'http://b', rolle: 'master' });
    assert.deepEqual(waehleServer([{ url: 'http://a' }, { url: 'http://b' }]), { url: 'http://a' });
});
```

- [ ] **Step 2: Fehlschlag** — Run: `node --test tests/unit/updateLogik.test.js` — Expected: FAIL.

- [ ] **Step 3: `desktop/updateLogik.js`**:

```js
// Reine Entscheidungslogik des Desktop-Client-Updaters (Spec Desktop-Client Abschnitt 6) — ohne
// Electron-, Netz- oder Dateizugriff, damit sie per node:test prüfbar ist.
import { createHash, verify } from 'crypto';

export const MAX_UPDATE_VERSUCHE = 2;

export function plattformSchluessel(platform, arch) {
    if (platform === 'darwin') return 'darwin-universal';
    if (platform === 'win32' && arch === 'x64') return 'win32-x64';
    if (platform === 'linux' && arch === 'x64') return 'linux-x64';
    return null;
}

export function signaturNachricht({ datei, version, sha256 }) {
    return `${datei}\n${version}\n${sha256}`;
}

export function sha256Hex(puffer) {
    return createHash('sha256').update(puffer).digest('hex');
}

export function pruefeDatei({ puffer, eintrag, version, oeffentlicherSchluessel }) {
    if (sha256Hex(puffer) !== eintrag.sha256) return { ok: false, grund: 'sha256' };
    let gueltig = false;
    try {
        gueltig = verify(null, Buffer.from(signaturNachricht({ datei: eintrag.datei, version, sha256: eintrag.sha256 })),
            oeffentlicherSchluessel, Buffer.from(String(eintrag.signatur), 'base64'));
    } catch {
        gueltig = false;
    }
    return gueltig ? { ok: true } : { ok: false, grund: 'signatur' };
}

// Versionskopplung: jede Abweichung ist ein Update (auch nach unten). Je Zielversion höchstens
// MAX_UPDATE_VERSUCHE, damit ein kaputtes Update nicht bei jedem Start erneut scheitert.
export function entscheideUpdate({ eigeneVersion, serverVersion, versuche }) {
    if (!serverVersion || serverVersion === eigeneVersion) return 'kein';
    return (versuche[serverVersion] || 0) >= MAX_UPDATE_VERSUCHE ? 'aufgegeben' : 'aktualisieren';
}

export function waehleServer(kandidaten) {
    if (!kandidaten.length) return null;
    return kandidaten.find(k => k.rolle === 'master') || kandidaten[0];
}
```

- [ ] **Step 4: Tests grün** — Run: `node --test tests/unit/updateLogik.test.js` — Expected: PASS. `package.json`-Script `test:unit` erfasst `tests/unit/**/*.test.js` bereits.
- [ ] **Step 5: Commit** — `git add desktop/updateLogik.js tests/unit/updateLogik.test.js && git commit -m "feat(desktop): reine Update-Logik (Plattform, Signatur, Schleifenschutz, Serverauswahl)"`

---

### Task 6: Schlüssel-, Signier- und Release-Skripte — `haiku`

**Files:**
- Create: `scripts/client-schluessel.mjs`, `scripts/signiere-client.mjs`, `scripts/hole-client-release.mjs`, `tests/unit/signiere-client.test.js`
- Modify: `package.json` (Scripts)

**Interfaces:**
- Consumes (Task 5): `sha256Hex`, `signaturNachricht`, `pruefeDatei`, `plattformSchluessel`-Schlüsselnamen.
- Produces:
  - `erzeugeVersionJson({ verzeichnis: string, version: string, privaterSchluessel: string }): object` (exportiert aus `scripts/signiere-client.mjs`; CLI: `node scripts/signiere-client.mjs <verzeichnis> <version>` mit Schlüssel aus `CLIENT_SIGNATUR_SCHLUESSEL`, schreibt `<verzeichnis>/version.json`)
  - Zuordnung per Dateiendung: `.exe` → `win32-x64` (installieren + aktualisieren), `.dmg` → `darwin-universal.installieren`, `.zip` → `darwin-universal.aktualisieren`, `.AppImage` → `linux-x64` (installieren + aktualisieren). Andere Dateien (`.blockmap`, `.yml`) werden ignoriert.
  - npm-Scripts: `client:schluessel`, `client:signieren`, `client:holen`.

- [ ] **Step 1: Failing Test** — `tests/unit/signiere-client.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'crypto';
import { mkdtempSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { erzeugeVersionJson } from '../../scripts/signiere-client.mjs';
import { pruefeDatei } from '../../desktop/updateLogik.js';

test('version.json ordnet Dateien den Plattformen zu und die Signaturen sind prüfbar', () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const dir = mkdtempSync(path.join(tmpdir(), 'signieren-'));
    for (const [n, inhalt] of [['H-1.2.0-win-x64.exe', 'W'], ['H-1.2.0-mac-universal.dmg', 'D'], ['H-1.2.0-mac-universal.zip', 'Z'],
        ['H-1.2.0-linux-x86_64.AppImage', 'L'], ['H-1.2.0-win-x64.exe.blockmap', 'B']]) {
        writeFileSync(path.join(dir, n), inhalt);
    }
    const vj = erzeugeVersionJson({ verzeichnis: dir, version: '1.2.0', privaterSchluessel: privateKey.export({ type: 'pkcs8', format: 'pem' }) });
    assert.equal(vj.version, '1.2.0');
    assert.equal(vj.dateien['win32-x64'].installieren.datei, 'H-1.2.0-win-x64.exe');
    assert.equal(vj.dateien['win32-x64'].aktualisieren.datei, 'H-1.2.0-win-x64.exe');
    assert.equal(vj.dateien['darwin-universal'].installieren.datei, 'H-1.2.0-mac-universal.dmg');
    assert.equal(vj.dateien['darwin-universal'].aktualisieren.datei, 'H-1.2.0-mac-universal.zip');
    assert.equal(vj.dateien['linux-x64'].aktualisieren.datei, 'H-1.2.0-linux-x86_64.AppImage');
    const pub = publicKey.export({ type: 'spki', format: 'pem' });
    const eintrag = vj.dateien['darwin-universal'].aktualisieren;
    assert.deepEqual(pruefeDatei({ puffer: readFileSync(path.join(dir, eintrag.datei)), eintrag, version: '1.2.0', oeffentlicherSchluessel: pub }), { ok: true });
    assert.deepEqual(JSON.parse(readFileSync(path.join(dir, 'version.json'), 'utf8')), vj);
});
```

- [ ] **Step 2: Fehlschlag** — Run: `node --test tests/unit/signiere-client.test.js` — Expected: FAIL.

- [ ] **Step 3: `scripts/signiere-client.mjs`**:

```js
// Signiert die gebauten Client-Dateien (Ed25519) und schreibt version.json (Spec Desktop-Client
// Abschnitt 6.1). Läuft in der Pipeline (Job "veroeffentlichen") mit dem privaten Schlüssel aus dem
// GitHub-Secret CLIENT_SIGNATUR_SCHLUESSEL.
//   node scripts/signiere-client.mjs <verzeichnis> <version>
import { readdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { sign } from 'crypto';
import { fileURLToPath } from 'url';
import { sha256Hex, signaturNachricht } from '../desktop/updateLogik.js';

const ZUORDNUNG = [
    { endung: '.exe', plattform: 'win32-x64', rollen: ['installieren', 'aktualisieren'] },
    { endung: '.dmg', plattform: 'darwin-universal', rollen: ['installieren'] },
    { endung: '.zip', plattform: 'darwin-universal', rollen: ['aktualisieren'] },
    { endung: '.AppImage', plattform: 'linux-x64', rollen: ['installieren', 'aktualisieren'] }
];

export function erzeugeVersionJson({ verzeichnis, version, privaterSchluessel }) {
    const dateien = {};
    for (const datei of readdirSync(verzeichnis).sort()) {
        const regel = ZUORDNUNG.find(z => datei.endsWith(z.endung));
        if (!regel) continue;
        const sha256 = sha256Hex(readFileSync(path.join(verzeichnis, datei)));
        const signatur = sign(null, Buffer.from(signaturNachricht({ datei, version, sha256 })), privaterSchluessel).toString('base64');
        dateien[regel.plattform] = dateien[regel.plattform] || {};
        for (const rolle of regel.rollen) dateien[regel.plattform][rolle] = { datei, sha256, signatur };
    }
    const inhalt = { version, dateien };
    writeFileSync(path.join(verzeichnis, 'version.json'), JSON.stringify(inhalt, null, 2));
    return inhalt;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const [verzeichnis, version] = process.argv.slice(2);
    const schluessel = process.env.CLIENT_SIGNATUR_SCHLUESSEL;
    if (!verzeichnis || !version || !schluessel) {
        console.error('Aufruf: CLIENT_SIGNATUR_SCHLUESSEL=<pem> node scripts/signiere-client.mjs <verzeichnis> <version>');
        process.exit(1);
    }
    const vj = erzeugeVersionJson({ verzeichnis, version, privaterSchluessel: schluessel });
    console.log(`version.json für ${version}: ${Object.keys(vj.dateien).join(', ')}`);
}
```

- [ ] **Step 4: `scripts/client-schluessel.mjs`**:

```js
// Erzeugt einmalig das Ed25519-Schlüsselpaar für die Update-Signatur (Spec Desktop-Client 6.1).
// Öffentlicher Teil -> desktop/update-schluessel.pub (committen), privater Teil wird NUR
// ausgegeben und gehört als Repository-Secret CLIENT_SIGNATUR_SCHLUESSEL zu GitHub.
import { generateKeyPairSync } from 'crypto';
import { existsSync, writeFileSync } from 'fs';

const ZIEL = 'desktop/update-schluessel.pub';
if (existsSync(ZIEL) && !process.argv.includes('--ueberschreiben')) {
    console.error(`${ZIEL} existiert bereits. Neuer Schlüssel macht alle bisherigen Clients update-unfähig – nur mit --ueberschreiben.`);
    process.exit(1);
}
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
writeFileSync(ZIEL, publicKey.export({ type: 'spki', format: 'pem' }));
console.log(`Öffentlicher Schlüssel geschrieben: ${ZIEL}\n`);
console.log('Privaten Schlüssel als GitHub-Secret CLIENT_SIGNATUR_SCHLUESSEL hinterlegen (Settings → Secrets and variables → Actions → New repository secret), danach diese Ausgabe löschen:\n');
console.log(privateKey.export({ type: 'pkcs8', format: 'pem' }));
```

- [ ] **Step 5: `scripts/hole-client-release.mjs`**:

```js
// Lädt die Client-Dateien des GitHub-Releases zur aktuellen package.json-Version nach
// <CLIENT_DOWNLOADS_VERZEICHNIS>/<version>/ und prüft jede Signatur (Spec Desktop-Client 5.2).
// Braucht Internet; später ruft das Server-Auto-Update (Teilprojekt C) dieses Skript auf.
//   npm run client:holen            (öffentliches Repo)
//   GITHUB_TOKEN=... npm run client:holen   (privates Repo)
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { createRequire } from 'module';
import dotenv from 'dotenv';
import { pruefeDatei } from '../desktop/updateLogik.js';

dotenv.config();
const require = createRequire(import.meta.url);
const { version } = require('../package.json');
const REPO = process.env.CLIENT_RELEASE_REPO || 'oensel/Hajime-Pro';
const ziel = path.join(path.resolve(process.env.CLIENT_DOWNLOADS_VERZEICHNIS || './data/client-downloads'), version);
const oeffentlich = readFileSync(new URL('../desktop/update-schluessel.pub', import.meta.url), 'utf8');
const kopf = { Accept: 'application/vnd.github+json', ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) };

const release = await fetch(`https://api.github.com/repos/${REPO}/releases/tags/v${version}`, { headers: kopf });
if (!release.ok) { console.error(`Kein Release v${version} gefunden (HTTP ${release.status}).`); process.exit(1); }
const { assets } = await release.json();

async function lade(asset) {
    const r = await fetch(asset.url, { headers: { ...kopf, Accept: 'application/octet-stream' } });
    if (!r.ok) throw new Error(`${asset.name}: HTTP ${r.status}`);
    return Buffer.from(await r.arrayBuffer());
}

const vjAsset = assets.find(a => a.name === 'version.json');
if (!vjAsset) { console.error('Release enthält keine version.json.'); process.exit(1); }
const vj = JSON.parse((await lade(vjAsset)).toString('utf8'));
if (vj.version !== version) { console.error(`version.json nennt ${vj.version}, erwartet ${version}.`); process.exit(1); }

mkdirSync(ziel, { recursive: true });
const namen = new Set(Object.values(vj.dateien).flatMap(p => Object.values(p).map(e => e.datei)));
for (const name of namen) {
    const eintrag = Object.values(vj.dateien).flatMap(p => Object.values(p)).find(e => e.datei === name);
    const asset = assets.find(a => a.name === name);
    if (!asset) { console.error(`Datei ${name} fehlt im Release.`); process.exit(1); }
    console.log(`Lade ${name} …`);
    const puffer = await lade(asset);
    const pruefung = pruefeDatei({ puffer, eintrag, version, oeffentlicherSchluessel: oeffentlich });
    if (!pruefung.ok) { console.error(`${name}: Prüfung fehlgeschlagen (${pruefung.grund}).`); process.exit(1); }
    writeFileSync(path.join(ziel, name), puffer);
}
writeFileSync(path.join(ziel, 'version.json'), JSON.stringify(vj, null, 2));
console.log(`Client ${version} bereit unter ${ziel}`);
```

- [ ] **Step 6: npm-Scripts** — in `package.json` `scripts` ergänzen:

```json
    "client:schluessel": "node scripts/client-schluessel.mjs",
    "client:signieren": "node scripts/signiere-client.mjs",
    "client:holen": "node scripts/hole-client-release.mjs",
```

- [ ] **Step 7: Tests grün** — Run: `npm run test:unit` — Expected: PASS.
- [ ] **Step 8: Commit** — `git add scripts/client-schluessel.mjs scripts/signiere-client.mjs scripts/hole-client-release.mjs tests/unit/signiere-client.test.js package.json && git commit -m "feat(desktop): Skripte für Signaturschlüssel, Signieren und Laden des Client-Releases"`

---

### Task 7: Client-Dienst — Verbindung zur Laufzeit wechseln — `sonnet`

**Files:**
- Modify: `src/sync/replikation.js` (Zustand `abgelehnt`), `src/sync/clientDienst.js` (`setzeVerbindung`), `src/routes/syncRoutes.js` (Test-Endpunkt)
- Create: `tests/e2e-sync/verbindung-wechseln.spec.js`
- Modify: `tests/e2e-sync/helpers.js` (Helfer)

**Interfaces:**
- Produces:
  - `replikation.status()` enthält zusätzlich `abgelehnt: boolean` (true nach 401/403, false nach erfolgreicher Änderung/`active`/Neustart).
  - `clientDienst.setzeVerbindung({ serverUrl?: string, secret?: string }): Promise<void>` — ändert `konfig.serverUrl`/`konfig.secret` (dasselbe Objekt nutzt `replikation.remoteDb`), startet die Replikation für die aktuelle DB neu und stößt `pruefeSeriell()` an.
  - Test-Endpunkt (nur `NODE_ENV=test`, nur Client): `POST /api/sync/test/verbindung` `{ serverUrl?, secret? }`.
  - Helfer `clientVerbindungSetzen(request, { serverUrl, secret })` in `tests/e2e-sync/helpers.js`.

- [ ] **Step 1: Failing E2E-Test** — `tests/e2e-sync/verbindung-wechseln.spec.js`:

```js
import { test, expect } from '@playwright/test';
import { CLIENT_BASE_URL, SYNC_BASE_URL, SYNC_TEST_SECRET } from './test-env.js';
import { richteDk8TurnierEin, syncLeerlauf, clientVerbindungSetzen } from './helpers.js';

test.describe.serial('Client wechselt Server-Adresse und Geheimnis zur Laufzeit', () => {
    test('falsches Geheimnis -> abgelehnt, richtiges -> wieder verbunden', async ({ request }) => {
        await richteDk8TurnierEin(request, 'Verbindungswechsel');
        await syncLeerlauf(request);
        await clientVerbindungSetzen(request, { secret: 'falsch' });
        await expect.poll(async () => (await (await request.get(`${CLIENT_BASE_URL}/api/sync/status`)).json()).fehler, { timeout: 15000 })
            .toContain('abgelehnt');
        await clientVerbindungSetzen(request, { secret: SYNC_TEST_SECRET });
        await expect.poll(async () => (await (await request.get(`${CLIENT_BASE_URL}/api/sync/status`)).json()).verbunden, { timeout: 15000 })
            .toBe(true);
    });

    test('andere Server-URL (127.0.0.1 statt localhost) repliziert ohne Datenverlust weiter', async ({ request }) => {
        const neueUrl = SYNC_BASE_URL.replace('localhost', '127.0.0.1');
        await clientVerbindungSetzen(request, { serverUrl: neueUrl });
        await syncLeerlauf(request);
        const status = await (await request.get(`${CLIENT_BASE_URL}/api/sync/status`)).json();
        expect(status.verbunden).toBe(true);
        expect(status.ausstehend).toBe(0);
        await clientVerbindungSetzen(request, { serverUrl: SYNC_BASE_URL });
    });
});
```
(`richteDk8TurnierEin`/`syncLeerlauf` existieren in `helpers.js`; Signatur vorher mit `grep -n "export async function" tests/e2e-sync/helpers.js` prüfen und ggf. Aufruf anpassen.)

In `tests/e2e-sync/helpers.js` ergänzen:

```js
export async function clientVerbindungSetzen(request, verbindung) {
    const resp = await request.post(`${CLIENT_BASE_URL}/api/sync/test/verbindung`, { data: verbindung });
    expect(resp.ok(), await resp.text()).toBeTruthy();
}
```
(`CLIENT_BASE_URL`/`expect` sind in `helpers.js` voraussichtlich schon importiert — sonst ergänzen.)

- [ ] **Step 2: Fehlschlag** — Run: `npx playwright test -c playwright.sync.config.js tests/e2e-sync/verbindung-wechseln.spec.js` — Expected: FAIL (404 Test-Endpunkt).

- [ ] **Step 3: `replikation.js`** — `const zustand = { aktiv: false, ruhend: false, fehler: null };` → `const zustand = { aktiv: false, ruhend: false, fehler: null, abgelehnt: false };`. Im `sync.on('change', …)`-Handler neben `zustand.fehler = null;` ergänzen `zustand.abgelehnt = false;`; im `'active'`-Handler ebenso `zustand.abgelehnt = false;`. Im `'error'`-Handler vor der Zuweisung von `zustand.fehler`:

```js
            zustand.abgelehnt = !!(err && (err.status === 401 || err.status === 403));
```
In `status:` das Feld `abgelehnt: zustand.abgelehnt` ergänzen.

- [ ] **Step 4: `clientDienst.js`** — im Objekt `dienst` nach `async verbinden() { … },` ergänzen:

```js
        // Desktop-Client (desktop/main.js): Server-Adresse (neuer Master nach mDNS-Suche) oder
        // Geheimnis (nach erneuter Kopplung) zur Laufzeit ändern. konfig ist dasselbe Objekt, das
        // replikation.js für die Remote-DB liest — ein Neustart der Replikation genügt.
        async setzeVerbindung({ serverUrl, secret } = {}) {
            if (serverUrl) konfig.serverUrl = String(serverUrl).replace(/\/+$/, '');
            if (secret !== undefined) konfig.secret = secret;
            if (zustand.db) await replikation.starte(zustand.db);
            await pruefeSeriell();
        },
```
(`replikation.starte` ruft intern zuerst `stoppe()` auf — siehe `replikation.js:82-83`.)

- [ ] **Step 5: Test-Endpunkt** — in `src/routes/syncRoutes.js` im `if (process.env.NODE_ENV === 'test')`-Block nach `/test/verbinden` ergänzen:

```js
        router.post('/test/verbindung', async (req, res) => {
            const sync = holeSync();
            if (!sync || sync.rolle !== 'client') return res.status(400).json({ success: false });
            await sync.setzeVerbindung(req.body || {});
            res.json({ success: true });
        });
```

- [ ] **Step 6: Tests grün** — Run: `npm run test:e2e:sync` — Expected: PASS (ganze Suite, da Replikationszustand geändert).
- [ ] **Step 7: Commit** — `git add src/sync/replikation.js src/sync/clientDienst.js src/routes/syncRoutes.js tests/e2e-sync && git commit -m "feat(sync): Client-Verbindung (Server-URL/Geheimnis) zur Laufzeit wechseln, abgelehnt-Status"`

---

### Task 8: Electron-Hülle — Startablauf, Serversuche, Kopplung, Build — `opus`

**Files:**
- Create: `desktop/main.js`, `desktop/einstellungen.js`, `desktop/serverSuche.js`, `desktop/linuxIntegration.js`, `desktop/fenster/start.html`, `desktop/fenster/start.js`, `desktop/fenster/preload.cjs`, `desktop/electron-builder.yml`, `desktop/build/icon.png`, `scripts/erzeuge-app-icon.mjs`, `tests/unit/einstellungen.test.js`, `tests/electron/rauchtest.spec.js`, `playwright.electron.config.js`
- Modify: `package.json` (`main`, devDependencies, Scripts), `.gitignore` (`/dist-desktop/`)

**Interfaces:**
- Consumes: `waehleServer`, `plattformSchluessel` (Task 5); `app` aus `src/app.js` (Task 2: `export { app }`), `app.get('sync')` → Client-Dienst mit `zustand.serverErreichbar`, `replikation.status().abgelehnt`, `setzeVerbindung()` (Task 7); `POST /api/client/koppeln` (Task 2).
- Produces:
  - `erzeugeEinstellungen(datei: string) → { lade(): Einstellungen, speichere(teil: Partial<Einstellungen>): Einstellungen }` mit `Einstellungen = { serverUrl: string|null, secret: string|null, clientId: string, updateVersuche: Record<string, number> }` (clientId beim ersten Laden per `randomUUID()` erzeugt und gespeichert).
  - `sucheServer({ timeoutMs = 5000 } = {}) → Promise<{ url: string, rolle?: string, version?: string } | null>`
  - `richteLinuxIntegrationEin({ appImage: string, iconQuelle: string }) → void`
  - Preload-API im Fenster: `window.hajime = { onStatus(cb: (text: string) => void), koppeln(code: string): Promise<{ ok: boolean, fehler?: string }>, onKopplungNoetig(cb: (grund: string) => void) }`
  - Hook für Task 9: `main.js` ruft `await pruefeUndAktualisiere({ serverUrl, einstellungen, status })` aus `desktop/updater.js` auf und beendet sich, wenn es `'neustart'` liefert. **In diesem Task** wird `desktop/updater.js` als Stub angelegt: `export async function pruefeUndAktualisiere() { return 'weiter'; }` — Task 9 ersetzt ihn.

- [ ] **Step 1: Abhängigkeiten** — Run: `npm install -D electron electron-builder`. In `package.json` ergänzen: `"main": "desktop/main.js"` und Scripts:

```json
    "desktop:start": "electron .",
    "desktop:icon": "node scripts/erzeuge-app-icon.mjs",
    "desktop:build": "electron-builder --config desktop/electron-builder.yml",
    "test:electron": "playwright test -c playwright.electron.config.js",
```
`.gitignore` ergänzen: `/dist-desktop/`.

- [ ] **Step 2: Failing Unit-Test Einstellungen** — `tests/unit/einstellungen.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { erzeugeEinstellungen } from '../../desktop/einstellungen.js';

test('erste Ladung erzeugt clientId und Standardwerte, speichere ergänzt und bleibt erhalten', () => {
    const datei = path.join(mkdtempSync(path.join(tmpdir(), 'einst-')), 'einstellungen.json');
    const e = erzeugeEinstellungen(datei);
    const erst = e.lade();
    assert.match(erst.clientId, /^[0-9a-f-]{36}$/);
    assert.deepEqual({ ...erst, clientId: 'x' }, { serverUrl: null, secret: null, clientId: 'x', updateVersuche: {} });
    e.speichere({ serverUrl: 'http://1.2.3.4:3000', updateVersuche: { '1.3.0': 1 } });
    const zweit = erzeugeEinstellungen(datei).lade();
    assert.equal(zweit.clientId, erst.clientId);
    assert.equal(zweit.serverUrl, 'http://1.2.3.4:3000');
    assert.deepEqual(zweit.updateVersuche, { '1.3.0': 1 });
});

test('kaputte Datei führt zu Standardwerten statt Absturz', () => {
    const datei = path.join(mkdtempSync(path.join(tmpdir(), 'einst-')), 'einstellungen.json');
    writeFileSync(datei, '{kaputt');
    assert.equal(erzeugeEinstellungen(datei).lade().serverUrl, null);
});
```
Run: `node --test tests/unit/einstellungen.test.js` — Expected: FAIL.

- [ ] **Step 3: `desktop/einstellungen.js`**:

```js
// Persistente Einstellungen des Desktop-Clients im Benutzerprofil (app.getPath('userData')),
// außerhalb des Programmordners — Updates überschreiben sie nie.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

const STANDARD = { serverUrl: null, secret: null, updateVersuche: {} };

export function erzeugeEinstellungen(datei) {
    function lade() {
        let inhalt = {};
        if (existsSync(datei)) {
            try { inhalt = JSON.parse(readFileSync(datei, 'utf8')); } catch { inhalt = {}; }
        }
        const werte = { ...STANDARD, ...inhalt };
        if (!werte.clientId) {
            werte.clientId = randomUUID();
            schreibe(werte);
        }
        return werte;
    }
    function schreibe(werte) {
        mkdirSync(path.dirname(datei), { recursive: true });
        writeFileSync(datei, JSON.stringify(werte, null, 2));
    }
    return {
        lade,
        speichere(teil) {
            const werte = { ...lade(), ...teil };
            schreibe(werte);
            return werte;
        }
    };
}
```
Run: `node --test tests/unit/einstellungen.test.js` — Expected: PASS.

- [ ] **Step 4: `desktop/serverSuche.js`**:

```js
// Findet den Hallen-Server per mDNS (Dienst _hajime._tcp, angekündigt von src/sync/ankuendigung.js)
// — unabhängig davon, ob das Betriebssystem .local-Namen auflöst. Gibt die URL mit IPv4-Adresse
// zurück. Ein Master beendet die Suche sofort, sonst entscheidet waehleServer nach Ablauf.
import { Bonjour } from 'bonjour-service';
import { waehleServer } from './updateLogik.js';

export function sucheServer({ timeoutMs = 5000 } = {}) {
    return new Promise((resolve) => {
        const bonjour = new Bonjour();
        const kandidaten = [];
        let fertig = false;
        const ende = (ergebnis) => {
            if (fertig) return;
            fertig = true;
            clearTimeout(timer);
            browser.stop();
            bonjour.destroy();
            resolve(ergebnis);
        };
        const browser = bonjour.find({ type: 'hajime' }, (dienst) => {
            const ipv4 = (dienst.addresses || []).find(a => /^\d+\.\d+\.\d+\.\d+$/.test(a)) || (dienst.referer && dienst.referer.address);
            if (!ipv4) return;
            const kandidat = { url: `http://${ipv4}:${dienst.port}`, rolle: dienst.txt && dienst.txt.rolle, version: dienst.txt && dienst.txt.version };
            kandidaten.push(kandidat);
            if (kandidat.rolle === 'master') ende(kandidat);
        });
        const timer = setTimeout(() => ende(waehleServer(kandidaten)), timeoutMs);
    });
}
```

- [ ] **Step 5: `desktop/linuxIntegration.js`**:

```js
// Linux (AppImage): legt beim ersten Start einen Startmenü-Eintrag und eine Verknüpfung auf dem
// Schreibtisch an. Der AppImage-Pfad bleibt bei Updates gleich (Datei wird ersetzt), das Symbol
// bleibt also gültig. Fehler sind nie fatal.
import { copyFileSync, chmodSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { execFileSync } from 'child_process';
import os from 'os';
import path from 'path';

export function richteLinuxIntegrationEin({ appImage, iconQuelle }) {
    try {
        const home = os.homedir();
        const iconZiel = path.join(home, '.local/share/icons/hajime-pro.png');
        mkdirSync(path.dirname(iconZiel), { recursive: true });
        copyFileSync(iconQuelle, iconZiel);
        const inhalt = ['[Desktop Entry]', 'Type=Application', 'Name=Hajime Pro', 'Comment=Judo-Turnier (Waage/Matte)',
            `Exec="${appImage}" --no-sandbox`, `Icon=${iconZiel}`, 'Terminal=false', 'Categories=Utility;', ''].join('\n');
        const menue = path.join(home, '.local/share/applications/hajime-pro.desktop');
        mkdirSync(path.dirname(menue), { recursive: true });
        writeFileSync(menue, inhalt);
        let schreibtisch = path.join(home, 'Desktop');
        try { schreibtisch = execFileSync('xdg-user-dir', ['DESKTOP'], { encoding: 'utf8' }).trim() || schreibtisch; } catch { /* Standard */ }
        if (existsSync(schreibtisch)) {
            const verknuepfung = path.join(schreibtisch, 'hajime-pro.desktop');
            writeFileSync(verknuepfung, inhalt);
            chmodSync(verknuepfung, 0o755);
            try { execFileSync('gio', ['set', verknuepfung, 'metadata::trusted', 'true']); } catch { /* nicht GNOME */ }
        }
    } catch (err) {
        console.warn('[Linux] Desktop-Integration fehlgeschlagen:', err.message);
    }
}
```

- [ ] **Step 6: Start-Fenster** — `desktop/fenster/preload.cjs`:

```js
// Brücke Start-Fenster <-> Main-Prozess (contextIsolation).
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('hajime', {
    onStatus: (cb) => ipcRenderer.on('status', (_e, text) => cb(text)),
    onKopplungNoetig: (cb) => ipcRenderer.on('kopplung-noetig', (_e, grund) => cb(grund)),
    koppeln: (code) => ipcRenderer.invoke('koppeln', code)
});
```
`desktop/fenster/start.html`:

```html
<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' 'unsafe-inline'">
    <title>Hajime Pro</title>
    <style>
        body { font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #fafafa; }
        #status { margin-top: 24px; color: #555; min-height: 1.2em; }
        #kopplung { display: none; margin-top: 24px; text-align: center; }
        #code { font-size: 28px; width: 8em; text-align: center; letter-spacing: 4px; }
        #fehler { color: #c62828; min-height: 1.2em; }
    </style>
</head>
<body>
    <img src="../build/icon.png" width="128" height="128" alt="">
    <div id="status">Starte …</div>
    <form id="kopplung">
        <p id="kopplungGrund">Dieses Gerät ist noch nicht mit dem Turnier-Server gekoppelt.<br>Code von der Turnierleitung (Seite „Kampfflächen“) eingeben:</p>
        <input id="code" inputmode="numeric" autocomplete="off" autofocus>
        <button type="submit">Koppeln</button>
        <p id="fehler"></p>
    </form>
    <script src="start.js"></script>
</body>
</html>
```
`desktop/fenster/start.js`:

```js
const status = document.getElementById('status');
const form = document.getElementById('kopplung');
const fehler = document.getElementById('fehler');
window.hajime.onStatus((text) => { status.textContent = text; });
window.hajime.onKopplungNoetig((grund) => {
    if (grund) document.getElementById('kopplungGrund').textContent = grund;
    form.style.display = 'block';
    document.getElementById('code').focus();
});
form.addEventListener('submit', async (e) => {
    e.preventDefault();
    fehler.textContent = '';
    const ergebnis = await window.hajime.koppeln(document.getElementById('code').value);
    if (ergebnis.ok) form.style.display = 'none';
    else fehler.textContent = ergebnis.fehler;
});
```

- [ ] **Step 7: `desktop/main.js`**:

```js
// Electron-Hauptprozess des Desktop-Clients (Spec Desktop-Client Abschnitte 3, 4): Server per mDNS
// suchen, ggf. selbst aktualisieren, einmalig koppeln, dann den bestehenden Client-Knoten
// (src/app.js mit SYNC_ROLLE=client) auf einem freien localhost-Port starten und client.html zeigen.
import { app, BrowserWindow, ipcMain, session, systemPreferences } from 'electron';
import net from 'net';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { erzeugeEinstellungen } from './einstellungen.js';
import { sucheServer } from './serverSuche.js';
import { pruefeUndAktualisiere } from './updater.js';
import { richteLinuxIntegrationEin } from './linuxIntegration.js';

const hier = path.dirname(fileURLToPath(import.meta.url));
const VERBINDUNG_WEG_MS = 10000;
const UEBERWACHUNG_MS = 5000;

if (!app.requestSingleInstanceLock()) app.quit();

// --user-data-dir=<pfad> (Rauchtest, mehrere Profile auf einem Gerät) MUSS vor der ersten Nutzung
// von app.getPath('userData') wirken.
const eigenesProfil = process.argv.find(a => a.startsWith('--user-data-dir='));
if (eigenesProfil) app.setPath('userData', eigenesProfil.slice('--user-data-dir='.length));

let startFenster = null;
let hauptFenster = null;
const einstellungen = erzeugeEinstellungen(path.join(app.getPath('userData'), 'einstellungen.json'));

function status(text) {
    if (startFenster && !startFenster.isDestroyed()) startFenster.webContents.send('status', text);
}

function freierPort() {
    return new Promise((resolve, reject) => {
        const s = net.createServer();
        s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
        s.on('error', reject);
    });
}

async function warteAufServer(url, maxMs = 30000) {
    const ende = Date.now() + maxMs;
    while (Date.now() < ende) {
        try { if ((await fetch(url)).ok) return; } catch { /* startet noch */ }
        await new Promise(r => setTimeout(r, 200));
    }
    throw new Error('Lokaler Client-Dienst startet nicht.');
}

// Kopplung: zeigt das Formular im Start-Fenster und löst auf, sobald der Server einen Code akzeptiert.
function koppeln(serverUrl, grund) {
    return new Promise((resolve) => {
        ipcMain.removeHandler('koppeln');
        ipcMain.handle('koppeln', async (_e, code) => {
            try {
                const r = await fetch(`${serverUrl}/api/client/koppeln`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ code, clientId: einstellungen.lade().clientId }),
                    signal: AbortSignal.timeout(5000)
                });
                const daten = await r.json().catch(() => ({}));
                if (r.status === 429) return { ok: false, fehler: `Zu viele Fehlversuche – bitte ${daten.restSekunden} s warten.` };
                if (!r.ok) return { ok: false, fehler: 'Code falsch.' };
                einstellungen.speichere({ secret: daten.secret, serverUrl });
                resolve(daten.secret);
                return { ok: true };
            } catch {
                return { ok: false, fehler: 'Server nicht erreichbar.' };
            }
        });
        startFenster.webContents.send('kopplung-noetig', grund || '');
    });
}

async function starteClientKnoten({ serverUrl, secret }) {
    const port = await freierPort();
    Object.assign(process.env, {
        SYNC_ROLLE: 'client',
        SYNC_SERVER_URL: serverUrl || 'http://127.0.0.1:9', // ohne bekannte Adresse: offline, bis die Suche einen Server findet
        SYNC_SECRET: secret || '',
        SYNC_DATENVERZEICHNIS: path.join(app.getPath('userData'), 'dokumente'),
        PORT: String(port)
    });
    const { app: expressApp } = await import(pathToFileURL(path.join(hier, '../src/app.js')).href);
    const basis = `http://localhost:${port}`;
    await warteAufServer(`${basis}/client.html`);
    return { basis, clientDienst: () => expressApp.get('sync') };
}

// Im Betrieb: fehlt der Server > 10 s, neu suchen (Master-Wechsel); lehnt er das Geheimnis ab,
// einmalig neu koppeln.
function ueberwache(clientDienst) {
    let wegSeit = null;
    let kopplungLaeuft = false;
    setInterval(async () => {
        const dienst = clientDienst();
        if (!dienst) return;
        if (dienst.replikation.status().abgelehnt && !kopplungLaeuft) {
            kopplungLaeuft = true;
            const url = einstellungen.lade().serverUrl;
            await zeigeStartFenster();
            const secret = await koppeln(url, 'Der Server hat die Kopplung nicht angenommen (neuer Server oder Code erneuert). Bitte neuen Code eingeben:');
            await dienst.setzeVerbindung({ secret });
            startFenster.close();
            kopplungLaeuft = false;
            return;
        }
        if (dienst.zustand.serverErreichbar) { wegSeit = null; return; }
        wegSeit = wegSeit || Date.now();
        if (Date.now() - wegSeit < VERBINDUNG_WEG_MS) return;
        const gefunden = await sucheServer({ timeoutMs: 3000 });
        if (gefunden && gefunden.url !== einstellungen.lade().serverUrl) {
            einstellungen.speichere({ serverUrl: gefunden.url });
            await dienst.setzeVerbindung({ serverUrl: gefunden.url });
            wegSeit = null;
        }
    }, UEBERWACHUNG_MS).unref();
}

function zeigeStartFenster() {
    startFenster = new BrowserWindow({
        width: 480, height: 420, resizable: false, title: 'Hajime Pro',
        webPreferences: { preload: path.join(hier, 'fenster/preload.cjs') }
    });
    startFenster.setMenuBarVisibility(false);
    return startFenster.loadFile(path.join(hier, 'fenster/start.html'));
}

async function start() {
    session.defaultSession.setPermissionRequestHandler((_wc, recht, cb) => cb(recht === 'media'));
    if (process.platform === 'darwin') systemPreferences.askForMediaAccess('camera').catch(() => {});
    if (process.platform === 'linux' && process.env.APPIMAGE) {
        richteLinuxIntegrationEin({ appImage: process.env.APPIMAGE, iconQuelle: path.join(hier, 'build/icon.png') });
    }
    await zeigeStartFenster();

    status('Suche Turnier-Server …');
    let gefunden = await sucheServer({ timeoutMs: 5000 });
    let werte = einstellungen.lade();
    if (gefunden) werte = einstellungen.speichere({ serverUrl: gefunden.url });

    if (gefunden) {
        const ergebnis = await pruefeUndAktualisiere({ serverUrl: gefunden.url, einstellungen, status });
        if (ergebnis === 'neustart') return; // der Updater beendet die App
    }

    while (!werte.secret) {
        if (!gefunden) {
            status('Kein Turnier-Server gefunden – WLAN prüfen. Suche weiter …');
            gefunden = await sucheServer({ timeoutMs: 5000 });
            if (gefunden) werte = einstellungen.speichere({ serverUrl: gefunden.url });
            continue;
        }
        status(`Server gefunden: ${gefunden.url}`);
        await koppeln(gefunden.url);
        werte = einstellungen.lade();
    }

    status('Starte …');
    const { basis, clientDienst } = await starteClientKnoten({ serverUrl: werte.serverUrl, secret: werte.secret });
    hauptFenster = new BrowserWindow({ width: 1280, height: 860, title: 'Hajime Pro', show: false });
    hauptFenster.setMenuBarVisibility(false);
    await hauptFenster.loadURL(`${basis}/client.html`);
    hauptFenster.maximize();
    hauptFenster.show();
    startFenster.close();
    ueberwache(clientDienst);
}

app.on('second-instance', () => { if (hauptFenster) { hauptFenster.restore(); hauptFenster.focus(); } });
app.on('window-all-closed', () => app.quit());
app.whenReady().then(start).catch((err) => {
    console.error(err);
    status(`Fehler beim Start: ${err.message}`);
});
```
Stub `desktop/updater.js` (wird in Task 9 ersetzt):

```js
// Platzhalter bis Task 9 (Selbst-Update).
export async function pruefeUndAktualisiere() { return 'weiter'; }
```

- [ ] **Step 8: App-Icon** — `scripts/erzeuge-app-icon.mjs` (rendert `public/hajime_pro.png`, 824×252, zentriert auf eine quadratische 1024×1024-Fläche; nutzt das vorhandene Playwright-Chromium):

```js
// Erzeugt desktop/build/icon.png (1024x1024) aus dem Logo — electron-builder braucht ein
// quadratisches Icon >= 512 px für alle drei Plattformen.
import { chromium } from '@playwright/test';
import { readFileSync } from 'fs';

const logo = readFileSync('public/hajime_pro.png').toString('base64');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
await page.setContent(`<body style="margin:0;width:1024px;height:1024px;display:flex;align-items:center;justify-content:center;background:#fff;border-radius:180px;">
  <img src="data:image/png;base64,${logo}" style="width:900px"></body>`);
await page.screenshot({ path: 'desktop/build/icon.png', omitBackground: true });
await browser.close();
console.log('desktop/build/icon.png erzeugt');
```
Run: `npm run desktop:icon` — Expected: Datei existiert; per Read-Tool ansehen, dass das Logo mittig und vollständig ist.

- [ ] **Step 9: `desktop/electron-builder.yml`**:

```yaml
# Build des Desktop-Clients (Spec Desktop-Client Abschnitte 3, 6.3). Aus dem Repo-Root aufrufen:
#   npm run desktop:build            (eigene Plattform)
appId: de.hajime-pro.client
productName: Hajime Pro
directories:
  output: dist-desktop
  buildResources: desktop/build
# asar aus: express.static, PouchDB/LevelDB und native Module lesen direkt vom Dateisystem —
# vermeidet eine ganze Fehlerklasse zum Preis etwas größerer Pakete.
asar: false
files:
  - desktop/**
  - src/**
  - public/**
  - knexfile.cjs
  - package.json
  - "!**/*.test.js"
  - "!tests/**"
  - "!data/**"
  - "!docs/**"
artifactName: "Hajime-Pro-${version}-${os}-${arch}.${ext}"
win:
  target: [{ target: nsis, arch: [x64] }]
nsis:
  oneClick: true
  perMachine: false
  createDesktopShortcut: always
  createStartMenuShortcut: true
  shortcutName: Hajime Pro
mac:
  target:
    - { target: dmg, arch: [universal] }
    - { target: zip, arch: [universal] }
  category: public.app-category.sports
  extendInfo:
    NSCameraUsageDescription: Die Waage liest Judopass-QR-Codes mit der Kamera.
  identity: null
linux:
  target: [{ target: AppImage, arch: [x64] }]
  category: Utility
  executableArgs: ["--no-sandbox"]
publish: null
```
Hinweis zu `npm ci` in `files`: `node_modules` (Produktionsabhängigkeiten) nimmt electron-builder automatisch mit; devDependencies nicht.

- [ ] **Step 10: Lokaler Build + Rauchtest** — `playwright.electron.config.js`:

```js
import { defineConfig } from '@playwright/test';
// Rauchtest der GEBAUTEN App (Pfad per HAJIME_APP_PFAD, sonst Entwicklungsstart per "electron .").
export default defineConfig({ testDir: './tests/electron', workers: 1, retries: 0, reporter: [['list']], timeout: 90_000 });
```
`tests/electron/rauchtest.spec.js`:

```js
import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtempSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

// Ohne Server: Suche läuft ins Leere; mit vorab gespeicherter Kopplung muss die App trotzdem
// offline client.html zeigen (Spec Desktop-Client Abschnitt 4, Punkt 6).
test('startet ohne Server offline mit client.html', async () => {
    const userData = mkdtempSync(path.join(tmpdir(), 'hajime-e2e-'));
    mkdirSync(userData, { recursive: true });
    writeFileSync(path.join(userData, 'einstellungen.json'), JSON.stringify({ serverUrl: 'http://127.0.0.1:9', secret: 'x', clientId: '00000000-0000-0000-0000-000000000000', updateVersuche: {} }));
    const pfad = process.env.HAJIME_APP_PFAD;
    const app = await electron.launch(pfad
        ? { executablePath: pfad, args: [`--user-data-dir=${userData}`] }
        : { args: ['.', `--user-data-dir=${userData}`] });
    const fenster = await app.waitForEvent('window', { predicate: (w) => w.url().includes('client.html'), timeout: 60_000 });
    await expect(fenster.locator('body')).toBeVisible();
    expect(fenster.url()).toMatch(/^http:\/\/localhost:\d+\/client\.html$/);
    await app.close();
});
```
`--user-data-dir` wertet `desktop/main.js` selbst aus (`app.setPath('userData', …)` vor der ersten Nutzung).

Run (Windows-Entwicklungsrechner):
1. `npm run test:electron` (Entwicklungsstart) — Expected: PASS.
2. `npm run desktop:build` — Expected: `dist-desktop/Hajime-Pro-1.0.0-win-x64.exe` entsteht (`electron-builder` baut native Module automatisch für Electron neu).
3. `$env:HAJIME_APP_PFAD = "dist-desktop\win-unpacked\Hajime Pro.exe"; npm run test:electron` — Expected: PASS.

- [ ] **Step 11: Manuelle Kurzprüfung Kopplung** — lokalen Hallen-Server starten (`SYNC_ROLLE=server`, mDNS an), `npm run desktop:start` in einem zweiten Terminal ohne gespeicherte Einstellungen: Start-Fenster findet den Server, fragt den Code, nach Eingabe des Codes von `matten.html` erscheint `client.html` und die Statusleiste meldet „verbunden“. Ergebnis im Commit-Text notieren.
- [ ] **Step 12: Commit** — `git add desktop package.json package-lock.json .gitignore scripts/erzeuge-app-icon.mjs tests/unit/einstellungen.test.js tests/electron playwright.electron.config.js && git commit -m "feat(desktop): Electron-Hülle mit Serversuche, Kopplung, Offline-Start und Build-Konfiguration"`

---

### Task 9: Selbst-Update je Plattform — `opus`

**Files:**
- Modify (ersetzen): `desktop/updater.js`
- Create: `tests/unit/updater.test.js`, `desktop/update-schluessel.pub` (per `npm run client:schluessel`, falls noch nicht vorhanden — der Nutzer hinterlegt danach das Secret, siehe Task 11)

**Interfaces:**
- Consumes (Task 5): `plattformSchluessel`, `entscheideUpdate`, `pruefeDatei`; (Task 8) `einstellungen`, `status`.
- Produces:
  - `holeServerVersion(serverUrl: string, { timeoutMs = 3000 } = {}): Promise<object|null>` (null bei Fehler/Timeout/404)
  - `pruefeUndAktualisiere({ serverUrl, einstellungen, status }): Promise<'weiter'|'neustart'>`
  - Beim ersten Start nach erfolgreichem Update (eigene Version == Zielversion mit Versuchszähler) wird der Zähler dieser Version gelöscht.

- [ ] **Step 1: Failing Unit-Test** — `tests/unit/updater.test.js` (nur der netzbezogene, Electron-freie Teil; `updater.js` darf `electron` deshalb nur **dynamisch** in `pruefeUndAktualisiere` importieren):

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import { holeServerVersion } from '../../desktop/updater.js';

function server(handler) {
    return new Promise((resolve) => {
        const s = http.createServer(handler).listen(0, '127.0.0.1', () => resolve(s));
    });
}

test('liefert version.json', async () => {
    const s = await server((req, res) => { res.setHeader('Content-Type', 'application/json'); res.end('{"version":"1.3.0","dateien":{}}'); });
    assert.deepEqual(await holeServerVersion(`http://127.0.0.1:${s.address().port}`), { version: '1.3.0', dateien: {} });
    s.close();
});

test('404 -> null', async () => {
    const s = await server((req, res) => { res.statusCode = 404; res.end('{}'); });
    assert.equal(await holeServerVersion(`http://127.0.0.1:${s.address().port}`), null);
    s.close();
});

test('hängender Server -> null nach Zeitlimit', async () => {
    const s = await server(() => { /* antwortet nie */ });
    const start = Date.now();
    assert.equal(await holeServerVersion(`http://127.0.0.1:${s.address().port}`, { timeoutMs: 300 }), null);
    assert.ok(Date.now() - start < 2000);
    s.closeAllConnections(); s.close();
});
```
Run: `node --test tests/unit/updater.test.js` — Expected: FAIL.

- [ ] **Step 2: `desktop/updater.js`**:

```js
// Selbst-Update des Desktop-Clients vor dem eigentlichen Start (Spec Desktop-Client Abschnitt 6):
// Version beim Server erfragen, bei Abweichung die Datei der eigenen Plattform laden, sha256 und
// Ed25519-Signatur prüfen, dann plattformspezifisch austauschen und neu starten. Jeder Fehler führt
// zum normalen Start der vorhandenen Version.
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, accessSync, constants } from 'fs';
import { spawn, execFileSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { plattformSchluessel, entscheideUpdate, pruefeDatei } from './updateLogik.js';

const hier = path.dirname(fileURLToPath(import.meta.url));

export async function holeServerVersion(serverUrl, { timeoutMs = 3000 } = {}) {
    try {
        const r = await fetch(`${serverUrl}/api/client/version`, { signal: AbortSignal.timeout(timeoutMs) });
        return r.ok ? await r.json() : null;
    } catch {
        return null;
    }
}

async function ladeDatei(url, status) {
    const r = await fetch(url, { signal: AbortSignal.timeout(10 * 60 * 1000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const gesamt = Number(r.headers.get('content-length')) || 0;
    const teile = [];
    let geladen = 0;
    for await (const teil of r.body) {
        teile.push(teil);
        geladen += teil.length;
        if (gesamt) status(`Lade Update … ${Math.round(geladen / gesamt * 100)} %`);
    }
    return Buffer.concat(teile);
}

// macOS: .app-Bundle-Pfad aus dem Programmpfad (…/Hajime Pro.app/Contents/MacOS/Hajime Pro).
function macAppPfad() {
    return path.resolve(process.execPath, '../../..');
}

function macAustauschbar(appPfad) {
    if (appPfad.startsWith('/Volumes/') || appPfad.includes('/AppTranslocation/')) return false;
    try { accessSync(path.dirname(appPfad), constants.W_OK); return true; } catch { return false; }
}

function tauscheAus({ app, plattform, datei }) {
    if (plattform === 'win32-x64') {
        // NSIS still installieren (pro Benutzer, ohne Admin); --force-run startet danach die neue Version.
        spawn(datei, ['/S', '--force-run'], { detached: true, stdio: 'ignore' }).unref();
        app.quit();
        return;
    }
    if (plattform === 'darwin-universal') {
        const appPfad = macAppPfad();
        const entpackt = `${datei}-entpackt`;
        rmSync(entpackt, { recursive: true, force: true });
        execFileSync('ditto', ['-x', '-k', datei, entpackt]);
        const neu = path.join(entpackt, path.basename(appPfad));
        const skript = `while kill -0 ${process.pid} 2>/dev/null; do sleep 0.2; done; rm -rf "${appPfad}" && mv "${neu}" "${appPfad}" && open "${appPfad}"`;
        spawn('/bin/sh', ['-c', skript], { detached: true, stdio: 'ignore' }).unref();
        app.quit();
        return;
    }
    // Linux: neue AppImage neben die alte, atomar umbenennen (die laufende Datei bleibt bis zum Ende gültig).
    const ziel = process.env.APPIMAGE;
    const neu = `${ziel}.neu`;
    renameSync(datei, neu);
    chmodSync(neu, 0o755);
    renameSync(neu, ziel);
    const env = { ...process.env };
    for (const v of ['APPIMAGE', 'APPDIR', 'OWD', 'ARGV0']) delete env[v];
    spawn(ziel, [], { detached: true, stdio: 'ignore', env }).unref();
    app.quit();
}

export async function pruefeUndAktualisiere({ serverUrl, einstellungen, status }) {
    const { app } = await import('electron');
    const eigeneVersion = app.getVersion();
    const werte = einstellungen.lade();
    if (werte.updateVersuche[eigeneVersion]) {
        const { [eigeneVersion]: _erledigt, ...rest } = werte.updateVersuche;
        einstellungen.speichere({ updateVersuche: rest });
    }
    if (!app.isPackaged) return 'weiter'; // Entwicklungsstart: nie selbst ersetzen

    status('Prüfe auf Updates …');
    const vj = await holeServerVersion(serverUrl);
    const entscheidung = entscheideUpdate({ eigeneVersion, serverVersion: vj && vj.version, versuche: einstellungen.lade().updateVersuche });
    if (entscheidung === 'kein') return 'weiter';
    if (entscheidung === 'aufgegeben') {
        status(`Update auf ${vj.version} mehrfach fehlgeschlagen – starte Version ${eigeneVersion}.`);
        return 'weiter';
    }
    const plattform = plattformSchluessel(process.platform, process.arch);
    const eintrag = plattform && vj.dateien[plattform] && vj.dateien[plattform].aktualisieren;
    if (!eintrag) return 'weiter';
    if (plattform === 'darwin-universal' && !macAustauschbar(macAppPfad())) {
        status('Update nicht möglich: Bitte „Hajime Pro“ in den Ordner Programme verschieben.');
        await new Promise(r => setTimeout(r, 4000));
        return 'weiter';
    }
    if (plattform === 'linux-x64' && !process.env.APPIMAGE) return 'weiter';

    const versuche = einstellungen.lade().updateVersuche;
    einstellungen.speichere({ updateVersuche: { ...versuche, [vj.version]: (versuche[vj.version] || 0) + 1 } });
    try {
        const puffer = await ladeDatei(`${serverUrl}/downloads/${encodeURIComponent(vj.version)}/${encodeURIComponent(eintrag.datei)}`, status);
        const schluessel = readFileSync(path.join(hier, 'update-schluessel.pub'), 'utf8');
        const pruefung = pruefeDatei({ puffer, eintrag, version: vj.version, oeffentlicherSchluessel: schluessel });
        if (!pruefung.ok) {
            status(`Update verworfen (${pruefung.grund === 'sha256' ? 'unvollständig' : 'Signatur ungültig'}) – starte Version ${eigeneVersion}.`);
            return 'weiter';
        }
        const ordner = path.join(app.getPath('userData'), 'updates');
        mkdirSync(ordner, { recursive: true });
        const datei = path.join(ordner, eintrag.datei);
        writeFileSync(datei, puffer);
        status(`Installiere Version ${vj.version} …`);
        tauscheAus({ app, plattform, datei });
        return 'neustart';
    } catch (err) {
        status(`Update fehlgeschlagen (${err.message}) – starte Version ${eigeneVersion}.`);
        return 'weiter';
    }
}
```
Run: `node --test tests/unit/updater.test.js` — Expected: PASS (der Test importiert `electron` nicht, weil der Import dynamisch in `pruefeUndAktualisiere` steht).

- [ ] **Step 3: Statusleisten-Hinweis „aufgegeben“ (Spec §6.2)** — Die Meldung im Start-Fenster ist flüchtig; der Hinweis muss im Betrieb in der Statusleiste stehen bleiben. Weg: Umgebungsvariable, die `main.js` vor dem Import von `src/app.js` gesetzt hat.
  1. In `pruefeUndAktualisiere` im Zweig `entscheidung === 'aufgegeben'` vor `return 'weiter'` ergänzen:
     ```js
     process.env.HAJIME_UPDATE_HINWEIS = `Update auf ${vj.version} fehlgeschlagen – bitte Client neu installieren (turnier.local/download).`;
     ```
  2. In `src/sync/clientDienst.js` in `status()` das Feld `update_hinweis: process.env.HAJIME_UPDATE_HINWEIS || null,` ergänzen.
  3. In `public/js/syncStatus.js` dort, wo `status.fehler` angezeigt wird (`grep -n "fehler" public/js/syncStatus.js`), zusätzlich `status.update_hinweis` in derselben Darstellung anzeigen, wenn gesetzt.

- [ ] **Step 4: Manuelle Update-Prüfung (Windows, lokal)** —
1. `npm run client:schluessel` (falls `desktop/update-schluessel.pub` fehlt), privaten Schlüssel in `$env:CLIENT_SIGNATUR_SCHLUESSEL` setzen.
2. Version 1.0.0 bauen (`npm run desktop:build`) und installieren (`dist-desktop\Hajime-Pro-1.0.0-win-x64.exe`).
3. `package.json`-Version temporär auf `1.0.1`, erneut bauen, `node scripts/signiere-client.mjs dist-desktop 1.0.1`, Dateien `*.exe` + `version.json` nach `data/client-downloads/1.0.1/` kopieren, Hallen-Server mit `SYNC_ROLLE=server` starten (liefert Version 1.0.1).
4. Installierte App über das Desktop-Symbol starten → Start-Fenster zeigt Download-Fortschritt, App startet neu, `Hilfe`/Titel bzw. `app.getVersion()` (DevTools: `require` nicht verfügbar — stattdessen `%LOCALAPPDATA%\Programs\Hajime Pro\resources\app\package.json` prüfen) zeigt 1.0.1.
5. Manipulationstest: ein Byte in `data/client-downloads/1.0.1/*.exe` ändern → App startet 1.0.0 mit Meldung „Update verworfen“.
6. `package.json` zurück auf `1.0.0` setzen.
Ergebnis im Commit-Text notieren.

- [ ] **Step 5: Tests** — Run: `npm run test:unit` und `npm run test:electron` — Expected: PASS.
- [ ] **Step 6: Commit** — `git add desktop/updater.js desktop/update-schluessel.pub tests/unit/updater.test.js src/sync/clientDienst.js public/js/syncStatus.js && git commit -m "feat(desktop): Selbst-Update mit Signaturprüfung für Windows, macOS und Linux"`

---

### Task 10: CI-/Release-Pipeline — `haiku`

**Files:**
- Create: `.github/workflows/ci.yml`, `.github/workflows/release.yml`

**Interfaces:**
- Consumes: npm-Scripts `test:unit`, `test:e2e`, `test:e2e:sync`, `test:e2e:cluster`, `test:electron`, `desktop:icon` (nicht in CI — Icon ist committet), `desktop:build`, `client:signieren`; Secret `CLIENT_SIGNATUR_SCHLUESSEL`.

- [ ] **Step 1: `.github/workflows/ci.yml`**:

```yaml
# Tests bei jedem Push/PR; release.yml ruft diesen Workflow vor dem Build auf.
# test:e2e:vollablauf läuft bewusst NICHT hier (schreibt in die echte Cloud-DB).
name: CI
on:
  push:
    branches: ['**']
  pull_request:
  workflow_call:

jobs:
  unit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm run test:unit

  e2e:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        suite: [test:e2e, test:e2e:sync, test:e2e:cluster]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npm run ${{ matrix.suite }}
        env: { NODE_ENV: test }
      - if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: bericht-${{ strategy.job-index }}
          path: |
            test-results/
            playwright-report/
            data/test-cluster/logs/
          if-no-files-found: ignore
```
Vor dem Commit prüfen, ob die Suites `NODE_ENV=test` selbst setzen (`grep -n NODE_ENV tests/e2e*/test-env.js`); falls ja, `env`-Zeile entfernen.

- [ ] **Step 2: `.github/workflows/release.yml`**:

```yaml
# Release bei Tag v* (npm version <patch|minor|major> && git push --follow-tags):
# Tests -> Versionsprüfung -> Build je Plattform (+ Rauchtest) -> signieren + GitHub-Release.
name: Release
on:
  push:
    tags: ['v*']

permissions:
  contents: write

jobs:
  tests:
    uses: ./.github/workflows/ci.yml

  pruefen:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Tag muss package.json-Version entsprechen
        run: |
          VERSION=$(node -p "require('./package.json').version")
          test "v$VERSION" = "$GITHUB_REF_NAME" || { echo "Tag $GITHUB_REF_NAME passt nicht zu Version $VERSION"; exit 1; }

  build:
    needs: [tests, pruefen]
    strategy:
      fail-fast: false
      matrix:
        os: [windows-latest, ubuntu-latest, macos-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npx playwright install chromium
      - run: npm run desktop:build
        env: { CSC_IDENTITY_AUTO_DISCOVERY: 'false' }
      - name: Rauchtest (Windows)
        if: runner.os == 'Windows'
        run: npm run test:electron
        env: { HAJIME_APP_PFAD: 'dist-desktop\win-unpacked\Hajime Pro.exe' }
      - name: Rauchtest (macOS)
        if: runner.os == 'macOS'
        run: npm run test:electron
        env: { HAJIME_APP_PFAD: 'dist-desktop/mac-universal/Hajime Pro.app/Contents/MacOS/Hajime Pro' }
      - name: Rauchtest (Linux)
        if: runner.os == 'Linux'
        run: xvfb-run -a npm run test:electron
        env: { HAJIME_APP_PFAD: 'dist-desktop/linux-unpacked/hajime-pro' }
      - uses: actions/upload-artifact@v4
        with:
          name: client-${{ runner.os }}
          path: |
            dist-desktop/*.exe
            dist-desktop/*.dmg
            dist-desktop/*.zip
            dist-desktop/*.AppImage
          if-no-files-found: error

  veroeffentlichen:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - uses: actions/download-artifact@v4
        with: { path: release, merge-multiple: true }
      - name: Signieren und version.json erzeugen
        run: node scripts/signiere-client.mjs release "${GITHUB_REF_NAME#v}"
        env: { CLIENT_SIGNATUR_SCHLUESSEL: '${{ secrets.CLIENT_SIGNATUR_SCHLUESSEL }}' }
      - name: GitHub-Release anlegen
        run: gh release create "$GITHUB_REF_NAME" release/* --title "Hajime Pro $GITHUB_REF_NAME" --generate-notes
        env: { GH_TOKEN: '${{ secrets.GITHUB_TOKEN }}' }
```
Der Linux-Programmname unter `linux-unpacked/` ist der `name` aus `package.json` (`hajime-pro`) — nach dem ersten CI-Lauf im Artefakt-Log prüfen und ggf. anpassen. `scripts/signiere-client.mjs` importiert nur Node-Built-ins und `desktop/updateLogik.js` → kein `npm ci` im Job nötig.

- [ ] **Step 3: YAML prüfen** — Run: `npx --yes yaml-lint .github/workflows/*.yml` (oder `node -e "…"` mit dem vorhandenen Parser, falls `yaml-lint` nicht lädt) — Expected: keine Fehler.
- [ ] **Step 4: Commit** — `git add .github/workflows && git commit -m "ci: Tests bei jedem Push, Release-Pipeline mit Client-Build für Windows, Linux und macOS"`
- [ ] **Step 5: Erster CI-Lauf** — nach Push des Branches (nur mit Zustimmung des Nutzers pushen) im Actions-Tab bzw. `gh run list --workflow CI --limit 1` prüfen; Fehler beheben (typisch: fehlende Systempakete für `embedded-postgres`, Timeouts). Den Release-Workflow erst nach Hinterlegen des Secrets (Task 11) per Test-Tag auslösen.

---

### Task 11: Dokumentation — `haiku`

**Files:**
- Create: `desktop/README.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: `desktop/README.md`** mit genau diesen Abschnitten:
  1. **Überblick** — 3 Sätze: was der Client ist (Electron-Hülle um `src/app.js` mit `SYNC_ROLLE=client`), Einstellungen unter `userData` (`einstellungen.json`, `dokumente/`, `updates/`).
  2. **Einmalige Einrichtung (Entwickler)** — `npm run client:schluessel`; `desktop/update-schluessel.pub` committen; privaten Schlüssel auf GitHub unter *Settings → Secrets and variables → Actions → New repository secret*, Name `CLIENT_SIGNATUR_SCHLUESSEL`, Wert = komplette PEM-Ausgabe inkl. `-----BEGIN/END PRIVATE KEY-----`; Ausgabe danach löschen. Warnung: neuer Schlüssel = alle installierten Clients können sich nicht mehr aktualisieren (Neuinstallation nötig).
  3. **Release** — `npm version patch|minor|major`, `git push --follow-tags`; Pipeline baut und veröffentlicht; auf dem Hallen-Server `git pull && npm ci && npm run client:holen` (bei privatem Repo `GITHUB_TOKEN` mit Leserecht auf Releases in der `.env`).
  4. **Lokal entwickeln** — `npm run desktop:start`, `npm run desktop:build`, `npm run test:electron`.
  5. **Manuelle Update-Checkliste je Plattform** — Windows (Schritte aus Task 9 Step 4), macOS (dmg installieren → nach Programme ziehen → Gatekeeper „Trotzdem öffnen“ → neue Version am Server → Neustart tauscht aus; Test: aus dem dmg gestartet → Hinweis „in Programme verschieben“), Linux (AppImage, `libfuse2`, Desktop-Symbol vorhanden, neue Version → Neustart tauscht Datei aus, Symbol funktioniert weiter).
  6. **Bekannte Grenzen** — aus Spec §6.4 übernehmen.

- [ ] **Step 2: `CLAUDE.md`** — ergänzen:
  - Unter **Commands**: Zeilen für `npm run desktop:start|desktop:build|desktop:icon|test:electron`, `npm run client:schluessel|client:signieren|client:holen`; neue Server-Variablen `MDNS_AKTIV`, `MDNS_NAME`, `PORT80_WEITERLEITUNG`, `CLIENT_DOWNLOADS_VERZEICHNIS`; Hinweis: ohne `SYNC_SECRET` erzeugt der Hallen-Server es selbst in `<SYNC_DATENVERZEICHNIS>/kopplung.json` (bestehende `.env`-Clients brauchen dann dieses Geheimnis).
  - Unter **Zentrale Architekturkonzepte** einen Punkt **Desktop-Client (`desktop/`)**: Electron-Main startet `src/app.js` als Client-Knoten, mDNS-Suche `_hajime._tcp` (`src/sync/ankuendigung.js` am Server, nur Master), Kopplung (`src/sync/kopplung.js`, `/api/client/*`, Karte auf `matten.html`), Selbst-Update mit Ed25519-Signatur (`desktop/updater.js`, `desktop/updateLogik.js`), Versionskopplung Client = Server; Spec/Plan-Verweise.
  - Unter **Commands/E2E**: Pipeline `.github/workflows/ci.yml` (alle Suites außer vollablauf) und `release.yml` (Tag `v*`).
  - Unter **Seitenstruktur**: `download` (öffentlich, Client-Download).
- [ ] **Step 3: Commit** — `git add desktop/README.md CLAUDE.md && git commit -m "docs(desktop): README für Client-Build/Release/Update-Checkliste, CLAUDE.md ergänzt"`

---

## Abschluss

- [ ] Gesamte lokale Verifikation: `npm run test:unit`, `npm run test:e2e`, `npm run test:e2e:sync`, `npm run test:e2e:cluster`, `npm run test:electron` — alle grün.
- [ ] Whole-Branch-Review (superpowers:requesting-code-review).
