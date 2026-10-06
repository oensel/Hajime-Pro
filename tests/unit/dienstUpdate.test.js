import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { dienstUpdateAktiv, installiereDienstPaket, pruefeUndAktualisiereDienst } from '../../src/utils/dienstUpdate.js';

const stumm = { log() {}, warn() {}, error() {} };
function stummeAnzeige(meldungen = []) { return { meldung: (t) => meldungen.push(t), fortschritt() {}, ende() {}, meldungen }; }
const hatTar = (() => { try { execFileSync('tar', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } })();

test('dienstUpdateAktiv: nur Hallen-Server unter systemd, kein Cluster, nicht abgeschaltet', () => {
    const basis = { BETRIEBSMODUS: 'server', INVOCATION_ID: 'x' };
    assert.equal(dienstUpdateAktiv(basis), true);
    assert.equal(dienstUpdateAktiv({ ...basis, INVOCATION_ID: undefined }), false);          // kein systemd (Entwicklung, Server-Paket)
    assert.equal(dienstUpdateAktiv({ ...basis, CLUSTER_KNOTEN: 'server1' }), false);
    assert.equal(dienstUpdateAktiv({ ...basis, HAJIME_SELBSTUPDATE: 'false' }), false);
    assert.equal(dienstUpdateAktiv({ ...basis, NODE_ENV: 'test' }), false);
    assert.equal(dienstUpdateAktiv({ BETRIEBSMODUS: 'cloud', INVOCATION_ID: 'x' }), false);
    assert.equal(dienstUpdateAktiv({ BETRIEBSMODUS: 'client', INVOCATION_ID: 'x' }), false);
});

// Baut eine Installation (Version 1.0.0) und ein Paket (Version 2.0.0) als echte tar.gz.
function baue() {
    const wurzel = mkdtempSync(path.join(tmpdir(), 'dienstupdate-'));
    const installDir = path.join(wurzel, 'opt');
    for (const [datei, inhalt] of [
        ['src/app.js', 'alt'], ['package.json', '{"version":"1.0.0"}'], ['package-lock.json', '{}'], ['knexfile.cjs', 'alt'],
        ['public/index.html', 'alt'], ['migrations/001.cjs', 'alt'], ['node_modules/x/index.js', 'alt'],
        ['.env', 'GEHEIM=1'], ['data/dokumente/turnier.txt', 'turnier']
    ]) {
        mkdirSync(path.dirname(path.join(installDir, datei)), { recursive: true });
        writeFileSync(path.join(installDir, datei), inhalt);
    }
    const quelle = path.join(wurzel, 'quelle/hajime-pro');
    for (const [datei, inhalt] of [
        ['src/app.js', 'neu'], ['package.json', '{"version":"2.0.0"}'], ['package-lock.json', '{}'], ['knexfile.cjs', 'neu'],
        ['public/index.html', 'neu'], ['migrations/001.cjs', 'neu'], ['migrations/002.cjs', 'neu']
    ]) {
        mkdirSync(path.dirname(path.join(quelle, datei)), { recursive: true });
        writeFileSync(path.join(quelle, datei), inhalt);
    }
    const paket = path.join(wurzel, 'paket.tar.gz');
    execFileSync('tar', ['czf', paket, '-C', path.join(wurzel, 'quelle'), 'hajime-pro']);
    return { installDir, paket };
}

// npm ci und knex werden ersetzt: npm legt node_modules an, knex tut nichts (oder schlägt fehl).
function fuehreAusDouble({ migrationFehlt = false } = {}) {
    const aufrufe = [];
    const fn = async (befehl, args, opt = {}) => {
        aufrufe.push([befehl, ...args]);
        if (befehl === 'tar') return execFileSync(befehl, args);
        if (befehl === 'npm') { mkdirSync(path.join(opt.cwd, 'node_modules/neu'), { recursive: true }); return ''; }
        if (args.includes('migrate:latest') && migrationFehlt) throw new Error('Migration kaputt');
        return '';
    };
    fn.aufrufe = aufrufe;
    return fn;
}

test('installiereDienstPaket: tauscht Code und node_modules aus, .env und data bleiben, alte Version liegt beiseite', { skip: !hatTar }, async () => {
    const { installDir, paket } = baue();
    const fuehreAus = fuehreAusDouble();
    const { alt } = await installiereDienstPaket({ paket, installDir, aktuelleVersion: '1.0.0', neueVersion: '2.0.0', fuehreAus, log: stumm });

    assert.equal(readFileSync(path.join(installDir, 'src/app.js'), 'utf8'), 'neu');
    assert.equal(JSON.parse(readFileSync(path.join(installDir, 'package.json'), 'utf8')).version, '2.0.0');
    assert.ok(existsSync(path.join(installDir, 'migrations/002.cjs')));
    assert.ok(existsSync(path.join(installDir, 'node_modules/neu')));
    assert.ok(!existsSync(path.join(installDir, 'node_modules/x')));
    assert.equal(readFileSync(path.join(installDir, '.env'), 'utf8'), 'GEHEIM=1');
    assert.equal(readFileSync(path.join(installDir, 'data/dokumente/turnier.txt'), 'utf8'), 'turnier');
    assert.equal(readFileSync(path.join(alt, 'src/app.js'), 'utf8'), 'alt');
    assert.ok(fuehreAus.aufrufe.some(a => a[0] === 'npm' && a.includes('ci')));
    assert.ok(fuehreAus.aufrufe.some(a => a.includes('migrate:latest')));
});

test('installiereDienstPaket: scheitert die Migration, bleibt die Installation unverändert', { skip: !hatTar }, async () => {
    const { installDir, paket } = baue();
    await assert.rejects(installiereDienstPaket({
        paket, installDir, aktuelleVersion: '1.0.0', neueVersion: '2.0.0', fuehreAus: fuehreAusDouble({ migrationFehlt: true }), log: stumm
    }), /Migration kaputt/);
    assert.equal(readFileSync(path.join(installDir, 'src/app.js'), 'utf8'), 'alt');
    assert.ok(existsSync(path.join(installDir, 'node_modules/x')));
});

test('installiereDienstPaket: unvollständiges Paket wird abgelehnt', { skip: !hatTar }, async () => {
    const { installDir } = baue();
    const leer = path.join(path.dirname(installDir), 'leer.tar.gz');
    mkdirSync(path.join(path.dirname(installDir), 'l/hajime-pro/src'), { recursive: true });
    writeFileSync(path.join(path.dirname(installDir), 'l/hajime-pro/src/x.js'), '');
    execFileSync('tar', ['czf', leer, '-C', path.join(path.dirname(installDir), 'l'), 'hajime-pro']);
    await assert.rejects(installiereDienstPaket({ paket: leer, installDir, aktuelleVersion: '1.0.0', neueVersion: '2.0.0', fuehreAus: fuehreAusDouble(), log: stumm }), /unvollständig/);
    assert.equal(readFileSync(path.join(installDir, 'src/app.js'), 'utf8'), 'alt');
});

test('pruefeUndAktualisiereDienst: Ergebnis der Prüfung entscheidet über Neustart oder Weiterlaufen', async () => {
    const { installDir } = baue();
    const mit = (status, extra = {}, installiere = async () => ({ alt: '/alt' })) => pruefeUndAktualisiereDienst({
        installDir, aktuelleVersion: '1.0.0', schluessel: 'k', log: stumm, installiere, anzeige: stummeAnzeige(), neustartSekunden: 0,
        pruefeUndLadeFn: async (opt) => {
            assert.equal(opt.plattformName, 'linux-dienst');
            assert.deepEqual(opt.unterstuetzt, ['linux-dienst']);
            return { status, ...extra };
        }
    });
    assert.equal(await mit('aktuell', { version: '1.0.0' }), 'weiter');
    assert.equal(await mit('keine-verbindung'), 'weiter');
    assert.equal(await mit('aufgegeben', { version: '2.0.0' }), 'weiter');
    assert.equal(await mit('fehler', { grund: 'x' }), 'weiter');
    assert.equal(await mit('bereit', { version: '2.0.0', datei: '/p' }), 'neustart');
    assert.equal(await mit('bereit', { version: '2.0.0', datei: '/p' }, async () => { throw new Error('npm kaputt'); }), 'weiter');
    // Fehlversuche werden gezählt, damit ein kaputtes Update nicht bei jedem Start wiederholt wird.
    const zaehler = JSON.parse(readFileSync(path.join(installDir, 'data/selbstupdate.json'), 'utf8'));
    assert.equal(zaehler['2.0.0'], 2);
});

test('Anzeige: Meldungen in der Reihenfolge Suche, Hole aus git, Installationsschritte, Neustart', { skip: !hatTar }, async () => {
    const { installDir, paket } = baue();
    const anzeige = stummeAnzeige();
    const erg = await pruefeUndAktualisiereDienst({
        installDir, aktuelleVersion: '1.0.0', schluessel: 'k', log: stumm, anzeige, neustartSekunden: 0,
        pruefeUndLadeFn: async (opt) => {
            opt.beiFortschritt({ version: '2.0.0', geladen: 1, gesamt: 2 });
            return { status: 'bereit', version: '2.0.0', datei: paket };
        },
        installiere: (opt) => installiereDienstPaket({ ...opt, fuehreAus: fuehreAusDouble() })
    });
    assert.equal(erg, 'neustart');
    const m = anzeige.meldungen;
    assert.equal(m[0], 'Suche nach Updates …');
    assert.match(m[1], /Hole Update 2\.0\.0 aus git/);
    assert.match(m[2], /^\(1\/4\) Entpacke/);
    assert.match(m[3], /^\(2\/4\) Installiere Abhängigkeiten/);
    assert.match(m[4], /^\(3\/4\) Migriere/);
    assert.match(m[5], /^\(4\/4\) Tausche/);
    assert.match(m.at(-2), /installiert/);
    assert.match(m.at(-1), /Neustart in 0 Sekunden/);
});

test('Anzeige: aktuell und keine Verbindung werden gemeldet', async () => {
    const { installDir } = baue();
    for (const [status, erwartet] of [['aktuell', /Kein Update: Version 1\.0\.0 ist aktuell/], ['keine-verbindung', /Keine Verbindung zu GitHub/]]) {
        const anzeige = stummeAnzeige();
        await pruefeUndAktualisiereDienst({ installDir, aktuelleVersion: '1.0.0', schluessel: 'k', log: stumm, anzeige, pruefeUndLadeFn: async () => ({ status }) });
        assert.equal(anzeige.meldungen[0], 'Suche nach Updates …');
        assert.match(anzeige.meldungen[1], erwartet);
    }
});

// Das Cloud-Docker-Image enthält desktop/ nicht (.dockerignore). Was src/app.js statisch (transitiv) importiert, darf deshalb nie
// in desktop/ liegen — solche Module müssen per await import() erst im jeweiligen Betriebsmodus geladen werden.
test('src/app.js importiert statisch nichts aus desktop/ (Cloud-Image hat kein desktop/)', async () => {
    const { readFileSync, existsSync } = await import('fs');
    const wurzel = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
    const gesehen = new Set();
    const verbotene = [];
    const besuche = (datei) => {
        if (gesehen.has(datei) || !existsSync(datei)) return;
        gesehen.add(datei);
        const quelltext = readFileSync(datei, 'utf8');
        // nur statische Importe am Zeilenanfang (await import() ist erlaubt)
        for (const m of quelltext.matchAll(/^(?:import|export)\s[^;]*?from\s+['"](\.[^'"]+)['"]/gm)) {
            const ziel = path.resolve(path.dirname(datei), m[1]);
            if (ziel.startsWith(path.join(wurzel, 'desktop') + path.sep)) verbotene.push(`${path.relative(wurzel, datei)} -> ${path.relative(wurzel, ziel)}`);
            else if (ziel.endsWith('.js')) besuche(ziel);
        }
    };
    besuche(path.join(wurzel, 'src/app.js'));
    assert.deepEqual(verbotene, []);
    assert.ok(gesehen.size > 20, 'Importgraph wurde durchlaufen');
});
