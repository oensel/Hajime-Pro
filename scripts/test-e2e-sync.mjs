// Startet die Shards der Sync-Suite (tests/e2e-sync/shards.js) gleichzeitig als eigene Playwright-Läufe, jeder mit
// eigenem Knotenpaar (HAJIME_SYNC_SHARD, siehe tests/e2e-sync/test-env.js). Exit-Code 0 nur, wenn alle bestehen.
//   npm run test:e2e:sync                   alle Shards parallel
//   npm run test:e2e:sync -- --shard 1      nur Shard 1 (Index oder Name)
//   weitere Argumente (z. B. -g "Testname") gehen an Playwright
// Direkt `npx playwright test -c playwright.sync.config.js <datei>` läuft ohne Shard (alles auf Shard-0-Ports).
import { spawn } from 'node:child_process';
import { SYNC_SHARDS } from '../tests/e2e-sync/shards.js';

const args = process.argv.slice(2);
let auswahl = SYNC_SHARDS.map((_, i) => i);
const si = args.indexOf('--shard');
if (si >= 0) {
    const w = args.splice(si, 2)[1];
    const i = /^\d+$/.test(w) ? Number(w) : SYNC_SHARDS.findIndex((s) => s.name === w);
    if (!SYNC_SHARDS[i]) { console.error(`Unbekannter Shard "${w}"`); process.exit(2); }
    auswahl = [i];
}

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const start = Date.now();

function lauf(i) {
    return new Promise((fertig) => {
        const name = SYNC_SHARDS[i].name;
        const t0 = Date.now();
        const kind = spawn(npx, ['playwright', 'test', '--config=playwright.sync.config.js', '--reporter=line', ...args], {
            env: { ...process.env, HAJIME_SYNC_SHARD: String(i) }, shell: process.platform === 'win32'
        });
        // Playwright-Ausgabe zeilenweise mit Shard-Präfix, damit parallele Läufe lesbar bleiben.
        const praefix = (strom, ziel) => {
            let rest = '';
            strom.on('data', (d) => {
                const zeilen = (rest + d).split(/\r?\n/);
                rest = zeilen.pop();
                for (const z of zeilen) if (z.trim()) ziel.write(`[${name}] ${z}\n`);
            });
            strom.on('end', () => rest.trim() && ziel.write(`[${name}] ${rest}\n`));
        };
        praefix(kind.stdout, process.stdout);
        praefix(kind.stderr, process.stderr);
        kind.on('close', (code) => fertig({ name, code: code ?? 1, sekunden: Math.round((Date.now() - t0) / 1000) }));
    });
}

const ergebnisse = await Promise.all(auswahl.map(lauf));
console.log('\nSync-Suite:');
for (const e of ergebnisse) console.log(`  ${e.code === 0 ? 'OK     ' : 'FEHLER '} ${e.name.padEnd(12)} ${e.sekunden} s`);
console.log(`  gesamt ${Math.round((Date.now() - start) / 1000)} s`);
process.exit(ergebnisse.every((e) => e.code === 0) ? 0 : 1);
