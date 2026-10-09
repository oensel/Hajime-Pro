// Lokaler Vorab-Lauf der CI: wählt wie der `plan`-Job in .github/workflows/ci.yml anhand der
// geänderten Dateien aus, welche Test-Gruppen laufen, und führt die passenden npm-Befehle aus.
// Die Pfadfilter unten müssen mit denen in ci.yml übereinstimmen.
//
//   npm run ci:lokal                 geänderte Dateien gegen origin/main (+ uncommittete Änderungen)
//   npm run ci:lokal -- --alles      alle Gruppen (wie Nachtlauf/Tag), ohne Paket und Docker
//   npm run ci:lokal -- --nur-anzeigen   nur zeigen, was laufen würde
//   --base <ref>   Vergleichsbasis (Standard: origin/main, sonst main)
//   --weiter       nach einem Fehler die übrigen Gruppen trotzdem ausführen
//   --paket        zusätzlich Server-Paket bauen + Electron-Rauchtest (langsam)
//   --docker       zusätzlich cluster-installation (Docker mit systemd nötig)
//   --schlank      Variante für den Pre-Push-Hook: Unit-Tests + nur die zu den Änderungen passenden E2E-Specs
//                  (Dateiname/Inhalt nennt eine geänderte Datei, immer smoke.spec.js) statt der ganzen Suite;
//                  die Sync-Suite nur bei Änderungen an src/sync, src/shared, datenzugriff.js; Cluster-Suite nie.
//                  Basis ist der Upstream-Zweig (nur nicht gepushte Änderungen), sonst origin/main.
//                  Die vollständige Suite läuft in der CI auf GitHub (oder lokal mit `npm run ci:lokal`).
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';

const FILTER = {
    kern: ['src/**', 'public/**', 'migrations/**', 'tests/**', 'scripts/**', 'knexfile.cjs', 'setup_db.js',
        'package.json', 'package-lock.json', 'playwright*.js', '.github/workflows/ci.yml'],
    cluster: ['src/cluster/**', 'src/sync/**', 'src/shared/**', 'deploy/linux/**', 'tests/e2e-cluster/**',
        'scripts/test-cluster-install-docker.sh', 'playwright.cluster.config.js', 'package.json',
        'package-lock.json', '.github/workflows/ci.yml'],
    plattform: ['src/utils/eingebettetesPostgres.js', 'src/config/betriebsmodus.cjs',
        'scripts/smoke-server-eingebettet.mjs', 'migrations/**', 'package.json', 'package-lock.json',
        '.github/workflows/ci.yml'],
    shell: ['deploy/linux/**', 'scripts/*.sh'],
    paket: ['desktop/server/**', 'desktop/build/**', 'desktop/electron-builder.server.yml',
        'tests/electron-server/**', 'src/utils/eingebettetesPostgres.js', 'src/sync/clientDateien.js',
        'package.json', '.github/workflows/server-paket.yml'],
};

const args = process.argv.slice(2);
const hat = (f) => args.includes(f);
const wert = (f) => (args.includes(f) ? args[args.indexOf(f) + 1] : null);
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function git(...a) {
    const r = spawnSync('git', a, { encoding: 'utf8' });
    return r.status === 0 ? r.stdout : null;
}

function globRegex(muster) {
    const rx = muster.replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*');
    return new RegExp(`^${rx}$`);
}

function geaenderteDateien() {
    // Schlank (Pre-Push-Hook): nur die noch nicht gepushten Änderungen gegenüber dem Upstream-Zweig prüfen.
    const upstream = hat('--schlank') && git('rev-parse', '--verify', '-q', '@{upstream}') ? '@{upstream}' : null;
    const base = wert('--base') || upstream
        || (git('rev-parse', '--verify', '-q', 'origin/main') ? 'origin/main' : 'main');
    const mergeBase = git('merge-base', base, 'HEAD');
    if (!mergeBase) throw new Error(`Keine gemeinsame Basis mit "${base}" gefunden (--base angeben).`);
    const dateien = new Set();
    for (const out of [
        git('diff', '--name-only', mergeBase.trim(), 'HEAD'),
        git('diff', '--name-only', 'HEAD'),
        git('ls-files', '--others', '--exclude-standard'),
    ]) {
        (out || '').split('\n').filter(Boolean).forEach((d) => dateien.add(d));
    }
    console.log(`Basis: ${base} (${mergeBase.trim().slice(0, 8)}), ${dateien.size} geänderte Dateien`);
    return [...dateien];
}

const alles = hat('--alles');
const dateien = alles ? [] : geaenderteDateien();
const trifft = (gruppe) => alles || dateien.some((d) => FILTER[gruppe].some((m) => globRegex(m).test(d)));

function shellcheckVerfuegbar() {
    return spawnSync('shellcheck', ['--version'], { stdio: 'ignore' }).status === 0;
}

// Schlanker Modus: E2E-Specs wählen, die zu den geänderten Dateien passen. Ein Spec passt, wenn er selbst geändert
// wurde oder der Dateiname einer geänderten src-/public-Datei (ohne Endung, ab 5 Zeichen) in seinem Dateinamen oder
// Inhalt vorkommt. smoke.spec.js läuft immer.
const ZU_ALLGEMEIN = new Set(['common', 'index', 'helpers', 'client']);
function waehleE2eSpecs(geaendert) {
    const verzeichnis = 'tests/e2e';
    const specs = readdirSync(verzeichnis).filter((f) => f.endsWith('.spec.js'));
    const tokens = [...new Set(geaendert
        .filter((d) => /^(src|public)\//.test(d))
        .map((d) => d.split('/').pop().replace(/\.[^.]+$/, '').toLowerCase())
        .filter((t) => t.length >= 5 && !ZU_ALLGEMEIN.has(t)))];
    const gewaehlt = new Set(specs.filter((f) => f === 'smoke.spec.js'));
    for (const f of specs) {
        if (geaendert.includes(`${verzeichnis}/${f}`)) { gewaehlt.add(f); continue; }
        const inhalt = readFileSync(`${verzeichnis}/${f}`, 'utf8').toLowerCase();
        if (tokens.some((t) => f.toLowerCase().includes(t) || inhalt.includes(t))) gewaehlt.add(f);
    }
    return [...gewaehlt].sort().map((f) => `${verzeichnis}/${f}`);
}
const schlank = hat('--schlank');

const schritte = [{ name: 'unit', befehl: [npm, 'run', 'test:unit'] }];
if (trifft('shell')) {
    if (shellcheckVerfuegbar()) {
        schritte.push({
            name: 'shellcheck',
            befehl: ['bash', '-c', 'shellcheck -S warning deploy/linux/*.sh scripts/test-cluster-install-docker.sh'],
        });
    } else {
        console.log('shellcheck nicht installiert, Schritt übersprungen (CI prüft es trotzdem).');
    }
}
if (schlank) {
    if (trifft('kern')) {
        const specs = waehleE2eSpecs(dateien);
        console.log(`Schlank: ${specs.length} passende E2E-Specs (${specs.map((p) => p.split('/').pop()).join(', ')})`);
        schritte.push({ name: `e2e (${specs.length} Specs)`, befehl: [npm, 'run', 'test:e2e', '--', ...specs] });
        const syncRelevant = dateien.some((d) => /^src\/(sync|shared)\//.test(d) || d === 'public/js/datenzugriff.js'
            || d.startsWith('tests/e2e-sync/'));
        if (syncRelevant) schritte.push({ name: 'e2e:sync', befehl: [npm, 'run', 'test:e2e:sync'] });
    }
} else {
    if (trifft('kern')) {
        schritte.push({ name: 'e2e', befehl: [npm, 'run', 'test:e2e'] });
        schritte.push({ name: 'e2e:sync', befehl: [npm, 'run', 'test:e2e:sync'] });
    }
    if (trifft('cluster')) schritte.push({ name: 'e2e:cluster', befehl: [npm, 'run', 'test:e2e:cluster'] });
}
if (trifft('plattform')) {
    schritte.push({ name: 'server-selbststart', befehl: ['node', 'scripts/smoke-server-eingebettet.mjs'] });
}
if (hat('--paket')) {
    schritte.push({ name: 'server-paket-bauen', befehl: [npm, 'run', 'desktop:server:build'] });
    schritte.push({ name: 'server-paket-rauchtest', befehl: [npm, 'run', 'test:electron:server'] });
} else if (trifft('paket')) {
    console.log('Hinweis: Paket-Dateien geändert, Server-Paket läuft nur mit --paket (CI baut es).');
}
if (hat('--docker')) {
    schritte.push({ name: 'cluster-installation', befehl: ['bash', 'scripts/test-cluster-install-docker.sh'] });
}

console.log(`\nGeplant: ${schritte.map((s) => s.name).join(', ')}\n`);
if (hat('--nur-anzeigen')) process.exit(0);

const ergebnis = [];
for (const s of schritte) {
    console.log(`\n=== ${s.name}: ${s.befehl.join(' ')} ===`);
    const start = Date.now();
    const r = spawnSync(s.befehl[0], s.befehl.slice(1), { stdio: 'inherit', shell: s.befehl[0].endsWith('.cmd') });
    const ok = r.status === 0;
    ergebnis.push({ name: s.name, ok, sek: Math.round((Date.now() - start) / 1000) });
    if (!ok && !hat('--weiter')) break;
}

console.log('\n=== Ergebnis ===');
for (const e of ergebnis) console.log(`${e.ok ? 'OK    ' : 'FEHLER'} ${e.name} (${e.sek} s)`);
process.exit(ergebnis.every((e) => e.ok) && ergebnis.length === schritte.length ? 0 : 1);
