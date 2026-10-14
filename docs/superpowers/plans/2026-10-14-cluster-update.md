# Cluster-Update aus cluster.html Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auf `cluster.html` die eingesetzte Version beider Server zeigen und je Server einen „Update“-Knopf anbieten, der nur am jeweils älteren Server (bei Gleichstand am Secondary) erscheint und das volle Update (`update.sh`) per Root-Skript auslöst.

**Architecture:** Reine Entscheidungsfunktion `entscheideUpdate` (Server und Seite nutzen dieselbe Regel), ein `updateDienst` (Release-Prüfung bei GitHub mit Zwischenspeicher, Start des Befehls, Statusdatei), Integration in `clusterDienst`/`clusterRoutes` (Status, `POST /api/cluster/update`, vorgemerktes Update nach der Master-Übergabe) und ein Root-Skript `hajime-update.sh` über sudoers (wie die Rückstufung).

**Tech Stack:** Node.js (ES-Module), Express, `node:test`, Playwright (Cluster-Suite), Bash.

**Spec:** `docs/specs/2026-10-14-cluster-update-design.md`

## Global Constraints

- Deutsche Kommentare, Meldungen und Commit-Texte; Commit-Trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Zielversion nur im Format `^\d+\.\d+\.\d+$`; sie fließt nie ungeprüft in einen Shell-Befehl.
- Der Befehl für das Update stammt aus der `.env` (`CLUSTER_UPDATE_BEFEHL`), nie aus Anfragedaten; Standard `sudo -n /usr/local/bin/hajime-update.sh`.
- Statusdatei des Updates: `CLUSTER_UPDATE_STATUS_DATEI`, Standard `/var/lib/hajime/update-status.json` (vom Root-Skript geschrieben, vom Dienst gelesen).
- Test-Überschreibungen (`CLUSTER_VERSION`, `CLUSTER_RELEASE_VERSION`) gelten nur mit `NODE_ENV=test`.
- Kein Downgrade, nie zwei Updates gleichzeitig, nie beide Server gleichzeitig.
- Die Seite blendet nach `update.knopf` ein, entscheidet aber der Server (`POST /update` prüft erneut, 409 mit Grund).
- `.claude/launch.json` nie committen.

## Review Focus

- Unbekannte Eingaben: ungültige Versionsstrings (`"abc"`, `"1.0"`, `null`) dürfen nie einen Knopf oder einen Befehl ergeben.
- Partner nicht erreichbar oder ohne `version` (älterer Stand): kein Knopf, kein Absturz in der Seite.
- Zweiter Klick/zweiter Aufruf während `laeuft`: 409, kein zweiter Prozess.
- Master-Fall: scheitert die Übergabe, bleibt kein vorgemerktes Update zurück.
- GitHub nicht erreichbar/Rate-Limit: `neuesteVersion = null`, Seite bleibt benutzbar.

---

### Task 1: Entscheidungslogik `updateLogik.js`

**Files:**
- Create: `src/cluster/updateLogik.js`
- Test: `tests/unit/cluster-updateLogik.test.js`

**Interfaces:**
- Produces: `istVersion(v) → boolean`, `vergleicheVersionen(a, b) → -1|0|1|null`,
  `entscheideUpdate({ eigeneVersion, partnerVersion, neuesteVersion, rolle, laeuft }) → { knopf: boolean, aktion: 'direkt'|'nach_uebergabe'|null, ziel: string|null, grund: string|null }`

- [ ] **Step 1: Failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { istVersion, vergleicheVersionen, entscheideUpdate } from '../../src/cluster/updateLogik.js';

test('Versionen: Format und Vergleich (numerisch, nicht textuell)', () => {
    assert.equal(istVersion('1.0.18'), true);
    for (const v of ['abc', '1.0', '', null, undefined, '1.0.18-beta', 'v1.0.18']) assert.equal(istVersion(v), false);
    assert.equal(vergleicheVersionen('1.0.9', '1.0.10'), -1);
    assert.equal(vergleicheVersionen('1.0.18', '1.0.18'), 0);
    assert.equal(vergleicheVersionen('2.0.0', '1.9.9'), 1);
    assert.equal(vergleicheVersionen('x', '1.0.0'), null);
});

const e = (extra) => entscheideUpdate({ eigeneVersion: '1.0.17', partnerVersion: '1.0.17', neuesteVersion: '1.0.18', rolle: 'secondary', laeuft: false, ...extra });

test('Beide gleich alt, Release neuer: nur der Secondary bekommt den Knopf', () => {
    assert.deepEqual(e({}), { knopf: true, aktion: 'direkt', ziel: '1.0.18', grund: null });
    const master = e({ rolle: 'master' });
    assert.equal(master.knopf, false);
    assert.match(master.grund, /Secondary/);
});

test('Secondary ist neuer als der Master: nur der Master bekommt den Knopf (nach Übergabe)', () => {
    const master = e({ rolle: 'master', partnerVersion: '1.0.18' });
    assert.deepEqual(master, { knopf: true, aktion: 'nach_uebergabe', ziel: '1.0.18', grund: null });
    const secondary = e({ rolle: 'secondary', eigeneVersion: '1.0.18', partnerVersion: '1.0.17', neuesteVersion: '1.0.18' });
    assert.equal(secondary.knopf, false);
});

test('Secondary ist älter als der Master (nach einer Übergabe): Secondary bekommt den Knopf', () => {
    const r = e({ rolle: 'secondary', partnerVersion: '1.0.18' });
    assert.deepEqual(r, { knopf: true, aktion: 'direkt', ziel: '1.0.18', grund: null });
});

test('Kein Knopf: aktuell, Release/Partner unbekannt, laufendes Update, ungültige Version', () => {
    assert.equal(e({ eigeneVersion: '1.0.18', partnerVersion: '1.0.18' }).knopf, false);
    assert.match(e({ neuesteVersion: null }).grund, /Release/);
    assert.match(e({ partnerVersion: null }).grund, /Partner/);
    assert.match(e({ laeuft: true }).grund, /läuft/);
    assert.equal(e({ eigeneVersion: 'abc' }).knopf, false);
    assert.equal(e({ neuesteVersion: '1.0.17' }).knopf, false); // kein Downgrade, nichts Neueres
    assert.equal(e({ partnerVersion: '1.0.19' }).knopf, false); // Partner schon über dem bekannten Release hinaus
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `node --test tests/unit/cluster-updateLogik.test.js`
Expected: FAIL (Modul fehlt).

- [ ] **Step 3: Implement**

```js
// Entscheidung, ob und wo der Update-Knopf der Cluster-Seite erscheint (Spec 2026-10-14-cluster-update-design.md).
// Rein und ohne Abhängigkeiten, damit Server und Tests dieselbe Regel nutzen.
const VERSION = /^\d+\.\d+\.\d+$/;

export function istVersion(v) {
    return typeof v === 'string' && VERSION.test(v);
}

export function vergleicheVersionen(a, b) {
    if (!istVersion(a) || !istVersion(b)) return null;
    const x = a.split('.').map(Number);
    const y = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
        if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
    }
    return 0;
}

const nein = (grund) => ({ knopf: false, aktion: null, ziel: null, grund });

// rolle: 'master' | 'secondary'. Es wird immer der ÄLTERE Server aktualisiert, bei Gleichstand der Secondary.
export function entscheideUpdate({ eigeneVersion, partnerVersion, neuesteVersion, rolle, laeuft }) {
    if (laeuft) return nein('Ein Update läuft bereits.');
    if (!istVersion(eigeneVersion)) return nein('Die eigene Version ist unbekannt.');
    if (!istVersion(partnerVersion)) return nein('Die Version des Partners ist nicht bekannt (Partner nicht erreichbar).');
    if (!istVersion(neuesteVersion)) return nein('Das neueste Release ist nicht prüfbar (kein Internet?).');
    if (vergleicheVersionen(neuesteVersion, eigeneVersion) <= 0) return nein('Dieser Server ist auf dem neuesten Stand.');
    if (vergleicheVersionen(neuesteVersion, partnerVersion) < 0) return nein('Der Partner hat bereits eine neuere Version als das bekannte Release.');

    const gegenPartner = vergleicheVersionen(eigeneVersion, partnerVersion);
    if (gegenPartner > 0) return nein('Der andere Server ist älter und wird zuerst aktualisiert.');
    if (gegenPartner === 0 && rolle !== 'secondary') return nein('Zuerst den Secondary aktualisieren.');
    return { knopf: true, aktion: rolle === 'master' ? 'nach_uebergabe' : 'direkt', ziel: neuesteVersion, grund: null };
}
```

- [ ] **Step 4: Run, expect PASS**

Run: `node --test tests/unit/cluster-updateLogik.test.js`
Expected: PASS (4 Tests).

- [ ] **Step 5: Commit**

```bash
git add src/cluster/updateLogik.js tests/unit/cluster-updateLogik.test.js
git commit -m "feat: Entscheidungslogik für das Cluster-Update"
```

---

### Task 2: `updateDienst.js` und Konfiguration

**Files:**
- Create: `src/cluster/updateDienst.js`
- Modify: `src/cluster/konfig.js` (zwei Felder)
- Test: `tests/unit/cluster-updateDienst.test.js`, `tests/unit/cluster-rollenLogik.test.js` (Konfig-Test ergänzen)

**Interfaces:**
- Consumes: `istVersion` aus Task 1.
- Produces:
  `erzeugeUpdateDienst({ repo, token, statusDatei, updateBefehl, fuehreBefehlAus, fetchFn = fetch, jetzt = () => Date.now(), env = process.env })` →
  `{ neuesteVersion(): Promise<string|null>, status(): { zustand, ziel, meldung, zeit } | null, laeuft(): boolean, starte(ziel): Promise<void> }`
- `liesClusterKonfig` liefert zusätzlich `updateBefehl`, `updateStatusDatei`.

- [ ] **Step 1: Failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { erzeugeUpdateDienst } from '../../src/cluster/updateDienst.js';

const antwort = (tag, ok = true) => async () => ({ ok, json: async () => ({ tag_name: tag }) });

test('neueste Version: v-Präfix entfernt, 10 Minuten zwischengespeichert, Fehler ergeben null', async () => {
    let zeit = 0;
    let aufrufe = 0;
    const dienst = erzeugeUpdateDienst({
        repo: 'a/b', statusDatei: '/nicht/da', updateBefehl: 'x', fuehreBefehlAus: async () => {},
        fetchFn: async (...a) => { aufrufe++; return antwort('v1.0.18')(...a); }, jetzt: () => zeit, env: {}
    });
    assert.equal(await dienst.neuesteVersion(), '1.0.18');
    zeit = 9 * 60_000;
    assert.equal(await dienst.neuesteVersion(), '1.0.18');
    assert.equal(aufrufe, 1);
    zeit = 11 * 60_000;
    await dienst.neuesteVersion();
    assert.equal(aufrufe, 2);

    const kaputt = erzeugeUpdateDienst({ repo: 'a/b', statusDatei: '/x', updateBefehl: 'x', fuehreBefehlAus: async () => {}, fetchFn: async () => { throw new Error('offline'); }, env: {} });
    assert.equal(await kaputt.neuesteVersion(), null);
    const unsinn = erzeugeUpdateDienst({ repo: 'a/b', statusDatei: '/x', updateBefehl: 'x', fuehreBefehlAus: async () => {}, fetchFn: antwort('nightly'), env: {} });
    assert.equal(await unsinn.neuesteVersion(), null);
});

test('Test-Überschreibung CLUSTER_RELEASE_VERSION nur mit NODE_ENV=test', async () => {
    const mk = (env) => erzeugeUpdateDienst({ repo: 'a/b', statusDatei: '/x', updateBefehl: 'x', fuehreBefehlAus: async () => {}, fetchFn: async () => { throw new Error('offline'); }, env });
    assert.equal(await mk({ NODE_ENV: 'test', CLUSTER_RELEASE_VERSION: '9.9.9' }).neuesteVersion(), '9.9.9');
    assert.equal(await mk({ CLUSTER_RELEASE_VERSION: '9.9.9' }).neuesteVersion(), null);
});

test('Start: nur gültige Version, Befehl mit Version, zweiter Start abgelehnt, Status aus der Datei', async () => {
    const ordner = mkdtempSync(path.join(os.tmpdir(), 'hajime-upd-'));
    const statusDatei = path.join(ordner, 'update-status.json');
    const befehle = [];
    let fertig;
    const dienst = erzeugeUpdateDienst({
        repo: 'a/b', statusDatei, updateBefehl: 'sudo -n /usr/local/bin/hajime-update.sh',
        fuehreBefehlAus: (b) => { befehle.push(b); return new Promise((r) => { fertig = r; }); }, env: {}
    });
    await assert.rejects(() => dienst.starte('1.0; rm -rf /'), /ungültig/i);
    assert.equal(befehle.length, 0);

    const l = dienst.starte('1.0.18');
    assert.equal(dienst.laeuft(), true);
    await assert.rejects(() => dienst.starte('1.0.18'), /läuft bereits/);
    assert.deepEqual(befehle, ['sudo -n /usr/local/bin/hajime-update.sh 1.0.18']);
    fertig('');
    await l;
    assert.equal(dienst.laeuft(), false);

    writeFileSync(statusDatei, JSON.stringify({ zustand: 'fertig', ziel: '1.0.18', meldung: 'ok', zeit: 't' }));
    assert.equal(dienst.status().zustand, 'fertig');
    assert.equal(erzeugeUpdateDienst({ repo: 'a/b', statusDatei: path.join(ordner, 'nix.json'), updateBefehl: 'x', fuehreBefehlAus: async () => {}, env: {} }).status(), null);
});
```

- [ ] **Step 2: Run, expect FAIL** — `node --test tests/unit/cluster-updateDienst.test.js` → Modul fehlt.

- [ ] **Step 3: Implement**

```js
// Update-Dienst eines Cluster-Servers: kennt das neueste Release (GitHub, zwischengespeichert), startet das Root-Skript
// (CLUSTER_UPDATE_BEFEHL) und liest dessen Statusdatei. Die Zielversion ist ausschließlich x.y.z und fließt nur geprüft
// in den Befehl (Spec 2026-10-14-cluster-update-design.md).
import { readFileSync } from 'fs';
import { istVersion } from './updateLogik.js';

const ZWISCHENSPEICHER_MS = 10 * 60_000;
const ABFRAGE_TIMEOUT_MS = 5000;

export function erzeugeUpdateDienst({ repo, token = '', statusDatei, updateBefehl, fuehreBefehlAus, fetchFn = fetch, jetzt = () => Date.now(), env = process.env }) {
    let zwischen = null; // { version, zeit }
    let laeuftGerade = false;

    async function neuesteVersion() {
        if (env.NODE_ENV === 'test' && env.CLUSTER_RELEASE_VERSION) return env.CLUSTER_RELEASE_VERSION;
        if (zwischen && jetzt() - zwischen.zeit < ZWISCHENSPEICHER_MS) return zwischen.version;
        let version = null;
        try {
            const antwort = await fetchFn(`https://api.github.com/repos/${repo}/releases/latest`, {
                signal: AbortSignal.timeout(ABFRAGE_TIMEOUT_MS),
                headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'hajime-pro', ...(token ? { Authorization: `Bearer ${token}` } : {}) }
            });
            if (antwort.ok) {
                const tag = String((await antwort.json()).tag_name || '').replace(/^v/, '');
                version = istVersion(tag) ? tag : null;
            }
        } catch {
            version = null;
        }
        zwischen = { version, zeit: jetzt() };
        return version;
    }

    function status() {
        try {
            return JSON.parse(readFileSync(statusDatei, 'utf-8'));
        } catch {
            return null;
        }
    }

    async function starte(ziel) {
        if (!istVersion(ziel)) throw Object.assign(new Error('Ungültige Zielversion.'), { status: 400 });
        if (laeuftGerade) throw Object.assign(new Error('Ein Update läuft bereits.'), { status: 409 });
        laeuftGerade = true;
        try {
            await fuehreBefehlAus(`${updateBefehl} ${ziel}`);
        } finally {
            laeuftGerade = false;
        }
    }

    return { neuesteVersion, status, laeuft: () => laeuftGerade, starte };
}
```

`src/cluster/konfig.js`: im Rückgabeobjekt nach `rueckstufenBefehl` ergänzen:

```js
        // Volles Update dieses Servers (deploy/linux/hajime-update.sh, per sudoers freigegeben).
        updateBefehl: env.CLUSTER_UPDATE_BEFEHL || 'sudo -n /usr/local/bin/hajime-update.sh',
        updateStatusDatei: env.CLUSTER_UPDATE_STATUS_DATEI || '/var/lib/hajime/update-status.json'
```
(Komma hinter der `rueckstufenBefehl`-Zeile setzen.) Im Konfig-Test (`cluster-rollenLogik.test.js`, erster Test) ergänzen:
`assert.match(k.updateBefehl, /hajime-update\.sh/);`

- [ ] **Step 4: Run, expect PASS** — `node --test tests/unit/cluster-updateDienst.test.js tests/unit/cluster-rollenLogik.test.js`

- [ ] **Step 5: Commit** — `git add src/cluster tests/unit && git commit -m "feat: Update-Dienst mit Release-Prüfung, Befehlsstart und Statusdatei"`

---

### Task 3: Integration in Cluster-Dienst und Routen

**Files:**
- Modify: `src/cluster/clusterDienst.js`, `src/routes/clusterRoutes.js`, `src/app.js`

**Interfaces:**
- Consumes: `entscheideUpdate` (Task 1), `erzeugeUpdateDienst` (Task 2).
- Produces:
  - `starteClusterDienst({ …, version })`; `eigenerStatus()` enthält zusätzlich `version`.
  - `status()` enthält `update: { knopf, aktion, ziel, grund, neuesteVersion, zustand, meldung, laeuft, vorgemerkt }`.
  - `updateStarten() → Promise<{ ok: true, aktion }>` (wirft `{status: 409}` bei Verstoß).
  - `POST /api/cluster/update` (`requireWriteAuth`).

- [ ] **Step 1: clusterDienst.js ändern**

Importe ergänzen:

```js
import { existsSync, unlinkSync } from 'fs';   // zur vorhandenen fs-Importzeile hinzufügen
import { entscheideUpdate } from './updateLogik.js';
import { erzeugeUpdateDienst } from './updateDienst.js';
```

Signatur und Anfang von `starteClusterDienst`:

```js
export function starteClusterDienst({ knex, clusterKonfig, syncKonfig, sync, version = null, updateEnv = process.env }) {
    const { knoten, partnerKnoten, partnerUrl } = clusterKonfig;
    const eigeneVersion = (updateEnv.NODE_ENV === 'test' && updateEnv.CLUSTER_VERSION) || version;
```

Nach `fuehreBefehlAus` (Funktion existiert) den Update-Dienst anlegen:

```js
    const update = erzeugeUpdateDienst({
        repo: updateEnv.CLIENT_RELEASE_REPO || 'oensel/Hajime-Pro',
        token: updateEnv.CLIENT_RELEASE_TOKEN || updateEnv.GITHUB_TOKEN || '',
        statusDatei: clusterKonfig.updateStatusDatei,
        updateBefehl: clusterKonfig.updateBefehl,
        fuehreBefehlAus,
        env: updateEnv
    });
    const vorgemerktDatei = path.resolve(syncKonfig.datenverzeichnis, 'update-vorgemerkt.json');
    const vorgemerkt = () => ladeDatei(vorgemerktDatei);
    const loescheVorgemerkt = () => { try { unlinkSync(vorgemerktDatei); } catch { /* nicht vorhanden */ } };
```

In `eigenerStatus()` nach `knoten,` ergänzen: `version: eigeneVersion,`.

Neue Funktionen vor `return {` des Dienstes:

```js
    async function updateEntscheidung(partner) {
        return entscheideUpdate({
            eigeneVersion,
            partnerVersion: partner && partner.version ? partner.version : null,
            neuesteVersion: await update.neuesteVersion(),
            rolle,
            laeuft: update.laeuft() || !!vorgemerkt()
        });
    }

    // Update nach einer Master-Übergabe: erst starten, wenn dieser Server wieder Standby ist.
    async function arbeiteVorgemerktesUpdateAb() {
        const v = vorgemerkt();
        if (!v || rolle !== 'secondary' || rueckstufungLaeuft || (zustand && zustand.rueckstufung_erforderlich)) return;
        const pgRolle = await pgRolleOderNull();
        if (pgRolle !== 'standby') return;
        loescheVorgemerkt();
        protokolliere('update_gestartet', { ziel: v.ziel });
        update.starte(v.ziel).catch(err => console.error('[Cluster] Update fehlgeschlagen:', err.message));
    }

    function updateStarten() {
        return seriell(async () => {
            const partner = await holePartner();
            const e = await updateEntscheidung(partner);
            if (!e.knopf) throw Object.assign(new Error(e.grund), { status: 409 });
            if (e.aktion === 'nach_uebergabe') {
                ( mkdirSync(path.dirname(vorgemerktDatei), { recursive: true }), writeFileSync(vorgemerktDatei, JSON.stringify({ ziel: e.ziel })) );
                try {
                    await uebergebenOhneSerie();
                } catch (err) {
                    loescheVorgemerkt();
                    throw err;
                }
                return { ok: true, aktion: e.aktion };
            }
            protokolliere('update_gestartet', { ziel: e.ziel });
            update.starte(e.ziel).catch(err => console.error('[Cluster] Update fehlgeschlagen:', err.message));
            return { ok: true, aktion: e.aktion };
        });
    }
```

Damit `updateStarten` nicht in `seriell` auf `uebergeben()` (das selbst `seriell` nutzt, Deadlock) wartet: den Rumpf von `uebergeben()` in eine innere Funktion `uebergebenOhneSerie` auslagern und `uebergeben` darauf aufbauen:

```js
    async function uebergebenOhneSerie() {
        /* bisheriger Rumpf von uebergeben() ab "if (rolle !== 'master') …" bis "return { ok: true };" unverändert */
    }
    function uebergeben() {
        return seriell(uebergebenOhneSerie);
    }
```

Im Intervall von `starte()` nach `seriell(pruefzyklus)` nicht ändern; zusätzlich im `setInterval`-Rumpf, direkt nach dem `finally`-Block, nichts; stattdessen am Ende von `pruefzyklus` aufrufen: `await arbeiteVorgemerktesUpdateAb();` (letzte Zeile der Funktion `pruefzyklus`, nur wenn dort bereits `rolle` aktuell ist; Fehler werden vom vorhandenen `.catch` geloggt).

`status()` erweitern:

```js
        async status() {
            const eigen = await eigenerStatus();
            const clients = await sync.listeClients().catch(() => []);
            const partner = letzterPartner || await holePartner();
            const e = await updateEntscheidung(partner);
            const s = update.status();
            return {
                aktiv: true, eigen, partner, clients,
                update: {
                    ...e, neuesteVersion: await update.neuesteVersion(),
                    zustand: s ? s.zustand : null, meldung: s ? s.meldung : null,
                    laeuft: update.laeuft(), vorgemerkt: !!vorgemerkt()
                }
            };
        },
```

Rückgabeobjekt um `updateStarten,` ergänzen. Ereignis-Textliste in `public/js/cluster.js` folgt in Task 4.

- [ ] **Step 2: Route und app.js**

`clusterRoutes.js` nach der `/uebergeben`-Zeile:

```js
    router.post('/update', requireWriteAuth, mitCluster, antworte(req => req.cluster.updateStarten()));
```

`app.js` (Zeile mit `starteClusterDienst({ knex, clusterKonfig, syncKonfig, sync })`): `version` aus der `package.json` übergeben. Die Datei liest bereits `aktuelleVersion` nur im `dienstUpdateAktiv()`-Block; daher oberhalb von `const syncKonfig = liesSyncKonfig();` ergänzen:

```js
const appVersion = JSON.parse(readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8')).version;
```

und den Aufruf ändern zu `starteClusterDienst({ knex, clusterKonfig, syncKonfig, sync, version: appVersion })`.

- [ ] **Step 3: Bestehende Tests laufen lassen**

Run: `npm run test:unit`
Expected: PASS (keine Regression).

- [ ] **Step 4: Commit** — `git add src && git commit -m "feat: Cluster-Dienst kennt Version, Update-Entscheidung und vorgemerktes Update nach Übergabe"`

---

### Task 4: Oberfläche (cluster.html / cluster.js)

**Files:**
- Modify: `public/cluster.html`, `public/js/cluster.js`

- [ ] **Step 1: cluster.html** — nach dem `#clusterKnoten`-Block und vor dem Übergabe-Knopf einfügen:

```html
    <div id="clusterUpdate" style="margin-top: 16px;">
        <p id="updateZeile" style="font-size: 13px; margin: 0 0 8px;"></p>
        <p id="updateHinweis" style="font-size: 13px; margin: 0 0 8px; display: none;" class="zustand-warn"></p>
        <button type="button" class="btn btn-outlined" id="btnUpdate" style="display: none; align-items: center; gap: 8px;">
            <span class="material-icons" style="font-size: 18px;">system_update_alt</span>
            <span id="btnUpdateText">Update</span>
        </button>
    </div>
```

- [ ] **Step 2: cluster.js** — in `EREIGNISSE` ergänzen `update_gestartet: 'Update gestartet'`. In `knotenKarte` nach der Zeile `zeile('Epoche', …)` einfügen:

```js
        zeile('Version', s.version || 'unbekannt').dataset.feld = 'version';
```

Im `lade()` nach der Übergabe-Knopf-Logik anfügen:

```js
        zeigeUpdate(daten);
```

und vor `lade();` am Dateiende diese Funktionen:

```js
    function zeigeUpdate(daten) {
        const { eigen, partner, update } = daten;
        if (!update) return;
        const zeile = document.getElementById('updateZeile');
        const hinweis = document.getElementById('updateHinweis');
        const btn = document.getElementById('btnUpdate');
        const anderer = partner && partner.version ? partner.version : null;
        zeile.textContent = `Diese Version: ${eigen.version || 'unbekannt'} · neueste verfügbar: ${update.neuesteVersion || 'nicht prüfbar'}`
            + (update.zustand === 'laeuft' || update.laeuft ? ' · Update läuft …' : '')
            + (update.zustand === 'fehler' ? ` · Letztes Update fehlgeschlagen: ${update.meldung || ''}` : '');
        const verschieden = anderer && eigen.version && anderer !== eigen.version;
        hinweis.style.display = verschieden ? 'block' : 'none';
        hinweis.textContent = verschieden
            ? `Dieser Server ist auf Version ${eigen.version}, ${eigen.partner_knoten} auf ${anderer}. Der andere Server braucht ebenfalls ein manuell angestoßenes Update (dort cluster.html öffnen und „Update“ klicken).`
            : '';
        btn.style.display = update.knopf ? 'inline-flex' : 'none';
        document.getElementById('btnUpdateText').textContent = update.aktion === 'nach_uebergabe'
            ? `Übergeben und auf ${update.ziel} aktualisieren`
            : `Auf ${update.ziel} aktualisieren`;
    }

    document.getElementById('btnUpdate').addEventListener('click', async () => {
        if (!aktuell || !aktuell.update || !aktuell.update.knopf) return;
        const u = aktuell.update;
        const andere = aktuell.eigen.partner_knoten;
        const text = u.aktion === 'nach_uebergabe'
            ? `Master-Rolle an ${andere} übergeben und diesen Server auf ${u.ziel} aktualisieren?\n\nDie Umschaltung dauert einige Sekunden.`
            : `Diesen Server auf ${u.ziel} aktualisieren?\n\nDer Dienst startet dabei neu.`;
        if (!confirm(`${text}\n\nDanach muss der andere Server (${andere}) ebenfalls aktualisiert werden: dort cluster.html öffnen und „Update“ klicken.`)) return;
        const antwort = await fetch('/api/cluster/update', { method: 'POST' });
        const daten = await antwort.json().catch(() => ({}));
        if (!antwort.ok) {
            alert(`Update nicht möglich: ${daten.error || antwort.status}`);
            return;
        }
        lade();
    });
```

- [ ] **Step 3: Sichtprüfung** — `preview_start` mit der Cluster-Suite ist aufwändig; stattdessen die E2E-Prüfung in Task 6 abwarten. Keine eigene Ausführung hier.

- [ ] **Step 4: Commit** — `git add public && git commit -m "feat: cluster.html zeigt Versionen und Update-Knopf mit Hinweis auf den zweiten Server"`

---

### Task 5: Root-Skript, sudoers, Installation, Dokumentation

**Files:**
- Create: `deploy/linux/hajime-update.sh`
- Modify: `deploy/linux/sudoers.hajime`, `deploy/linux/install-cluster.sh`, `tests/unit/install-cluster.test.js`, `deploy/linux/README.md`, `CLAUDE.md`, `docs/betrieb.md`

- [ ] **Step 1: Test ergänzen** (`tests/unit/install-cluster.test.js`, neben der `PARTNER_PG_HOST`-Prüfung):

```js
    assert.match(lies('cluster.env'), /^KLON=.+$/m);
```

Run: `node --test tests/unit/install-cluster.test.js` → Expected: FAIL (KLON fehlt).

- [ ] **Step 2: `install-cluster.sh`** — in `rendere_cluster_env` nach `REPL_USER=$REPL_USER` die Zeile `KLON=$QUELLE` ergänzen; nach der `hajime-rueckstufen.sh`-Installationszeile:

```bash
install -m 755 "$QUELLE/deploy/linux/hajime-update.sh" /usr/local/bin/hajime-update.sh
```

- [ ] **Step 3: sudoers** — an `deploy/linux/sudoers.hajime` anhängen:

```
# Dasselbe für das Update aus der Cluster-Seite (nur mit einer Versionsnummer als Argument, vom Skript geprüft).
hajime ALL=(root) NOPASSWD: /usr/local/bin/hajime-update.sh
```

- [ ] **Step 4: `deploy/linux/hajime-update.sh`**

```bash
#!/bin/bash
# Volles Update dieses Cluster-Servers auf ein Release (Cluster-Seite, Spec 2026-10-14-cluster-update-design.md).
# Aufgerufen von der App (CLUSTER_UPDATE_BEFEHL, Standard "sudo -n /usr/local/bin/hajime-update.sh <x.y.z>").
# Das eigentliche Update (update.sh im Klon, GIT_REF=v<x.y.z>) läuft losgelöst als systemd-Einheit, weil es den
# Dienst neu startet, der dieses Skript aufgerufen hat. Fortschritt: /var/lib/hajime/update-status.json, Log:
# /var/log/hajime-update.log.
set -euo pipefail

STATUS=/var/lib/hajime/update-status.json
LOG=/var/log/hajime-update.log

schreibe() { # zustand meldung
    mkdir -p "$(dirname "$STATUS")"
    printf '{"zustand":"%s","ziel":"%s","meldung":"%s","zeit":"%s"}\n' "$1" "$ZIEL" "$2" "$(date -Is)" > "$STATUS.tmp"
    mv "$STATUS.tmp" "$STATUS"
}

if [ "${1:-}" = "--lauf" ]; then
    ZIEL="${2:-}"
    source /etc/hajime/cluster.env
    if GIT_REF="v$ZIEL" bash "$KLON/update.sh" >> "$LOG" 2>&1; then
        schreibe fertig "Update auf $ZIEL abgeschlossen"
    else
        schreibe fehler "Update auf $ZIEL fehlgeschlagen (siehe $LOG)"
        exit 1
    fi
    exit 0
fi

ZIEL="${1:-}"
[[ "$ZIEL" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "Ungültige Version: $ZIEL" >&2; exit 2; }
source /etc/hajime/cluster.env
[ -n "${KLON:-}" ] && [ -f "$KLON/update.sh" ] || { echo "Klon mit update.sh nicht gefunden (KLON in /etc/hajime/cluster.env)." >&2; exit 2; }

schreibe laeuft "Update auf $ZIEL gestartet"
systemd-run --unit="hajime-update-$ZIEL-$(date +%s)" --collect --quiet /bin/bash "$0" --lauf "$ZIEL"
echo "Update auf $ZIEL gestartet"
```

Danach `git update-index --add --chmod=+x deploy/linux/hajime-update.sh`.

- [ ] **Step 5: Doku** — `deploy/linux/README.md` (Abschnitt Update): Absatz „Update aus der Oberfläche“ mit Voraussetzung (erstes Einspielen von Hand, Klon `KLON`, Internet), Reihenfolgeregel und Hinweis auf `/var/log/hajime-update.log`; `CLAUDE.md` Eintrag „Server-Cluster“ um zwei Sätze (Version/Update-Knopf, `updateLogik.js`, `hajime-update.sh`, `CLUSTER_UPDATE_*`); `docs/betrieb.md` Zeile bei „Selbst-Update des Linux-Dienstes“: im Cluster stattdessen Update-Knopf auf `cluster.html`.

- [ ] **Step 6: Test grün** — `node --test tests/unit/install-cluster.test.js` → PASS; `bash -n deploy/linux/hajime-update.sh` → keine Ausgabe.

- [ ] **Step 7: Commit** — `git add deploy docs CLAUDE.md tests && git commit -m "feat: Root-Skript und sudoers für das Update aus der Cluster-Seite"`

---

### Task 6: Cluster-E2E

**Files:**
- Create: `tests/e2e-cluster/fake-update.js`
- Modify: `tests/e2e-cluster/test-env.js`, `tests/e2e-cluster/cluster.spec.js`

- [ ] **Step 1: `fake-update.js`** (ersetzt das Root-Skript im Test)

```js
// Testersatz für hajime-update.sh: schreibt die Statusdatei wie das Root-Skript und merkt sich den Aufruf.
import { writeFileSync, appendFileSync, mkdirSync } from 'fs';
import path from 'path';

const [, , statusDatei, ziel] = process.argv;
mkdirSync(path.dirname(statusDatei), { recursive: true });
appendFileSync(`${statusDatei}.aufrufe`, `${ziel}\n`);
writeFileSync(statusDatei, JSON.stringify({ zustand: 'fertig', ziel, meldung: 'Testupdate', zeit: new Date().toISOString() }));
```

- [ ] **Step 2: `test-env.js` → `serverEnv`** — nach `CLUSTER_RUECKSTUFEN_BEFEHL` ergänzen:

```js
        CLUSTER_VERSION: '1.0.17',
        CLUSTER_RELEASE_VERSION: '1.0.18',
        CLUSTER_UPDATE_STATUS_DATEI: path.join(BASIS, `update-status-${name}.json`),
        CLUSTER_UPDATE_BEFEHL: `node "${path.join(PROJEKT, 'tests', 'e2e-cluster', 'fake-update.js')}" "${path.join(BASIS, `update-status-${name}.json`)}"`,
```

- [ ] **Step 3: Test in `cluster.spec.js`** direkt nach dem ersten Test (Grundzustand) einfügen:

```js
test('Update: nur der Secondary bekommt den Knopf, der Master wird abgelehnt, Version beider Server sichtbar', async ({ request }) => {
    const master = await (await request.get(`${KNOTEN.server1.url}/api/cluster/status`)).json();
    const secondary = await (await request.get(`${KNOTEN.server2.url}/api/cluster/status`)).json();
    expect(master.eigen.version).toBe('1.0.17');
    expect(master.partner.version).toBe('1.0.17');
    expect(master.update.knopf).toBe(false);
    expect(secondary.update).toMatchObject({ knopf: true, aktion: 'direkt', ziel: '1.0.18' });

    const abgelehnt = await request.post(`${KNOTEN.server1.url}/api/cluster/update`);
    expect(abgelehnt.status()).toBe(409);

    const erlaubt = await request.post(`${KNOTEN.server2.url}/api/cluster/update`);
    expect(erlaubt.ok(), await erlaubt.text()).toBeTruthy();
    await expect.poll(async () => (await (await request.get(`${KNOTEN.server2.url}/api/cluster/status`)).json()).update.zustand, { timeout: 10_000 }).toBe('fertig');
});
```

- [ ] **Step 4: Ausführen** — `npm run test:e2e:cluster -- -g "Update:"` ist wegen der Serie nicht einzeln lauffähig; stattdessen `npm run test:e2e:cluster` komplett. Expected: alle grün.

- [ ] **Step 5: Gesamtprüfung** — `npm run test:unit` → PASS.

- [ ] **Step 6: Commit** — `git add tests && git commit -m "test: Cluster-E2E für den Update-Knopf"`

---

## Nach der Umsetzung (nicht Teil des Plans)

Die erste Version mit diesem Feature wird auf beiden Servern einmal von Hand eingespielt (`sudo bash update.sh`), damit `hajime-update.sh` und die sudoers-Regel installiert werden. Der Master-Fall (Übergabe, dann Update) ist per Unit- und E2E-Test nicht vollständig abgedeckt und wird bei der ersten echten Umstellung geprüft.
