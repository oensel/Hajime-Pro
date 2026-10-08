import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Das Cloud-Docker-Image enthält desktop/ nicht (.dockerignore). Was src/app.js statisch (transitiv) importiert, darf deshalb nie
// in desktop/ liegen — solche Module müssen per await import() erst im jeweiligen Betriebsmodus geladen werden.
test('src/app.js importiert statisch nichts aus desktop/ (Cloud-Image hat kein desktop/)', () => {
    const wurzel = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
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
