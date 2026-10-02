// Das Frontend muss im Hallenbetrieb ohne Internet vollständig laden: keine Schriften, Skripte,
// Stylesheets oder Bilder von fremden Hosts. Ein Stylesheet von einem nicht erreichbaren Host kann
// das Laden der Seite bis zum Timeout blockieren. Prüft die statischen Dateien in public/.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public');

function dateien(verzeichnis) {
    return fs.readdirSync(verzeichnis, { withFileTypes: true }).flatMap((e) => {
        const voll = path.join(verzeichnis, e.name);
        if (e.isDirectory()) return e.name === 'fonts' ? [] : dateien(voll);
        return /\.(html|css)$/.test(e.name) ? [voll] : [];
    });
}

// Eingebunden werden Ressourcen über src=, href= (nur <link>), url(...) und @import.
const MUSTER = [
    /<(?:script|img|source|iframe)\b[^>]*\bsrc\s*=\s*["']?(https?:)?\/\/[^"'\s>]+/gi,
    /<link\b[^>]*\bhref\s*=\s*["']?(https?:)?\/\/[^"'\s>]+/gi,
    /url\(\s*["']?(https?:)?\/\/[^)"']+/gi,
    /@import\s+(?:url\()?["']?(https?:)?\/\/[^"')\s;]+/gi
];

test('public/ bindet keine externen Ressourcen ein', () => {
    const funde = [];
    for (const datei of dateien(PUBLIC)) {
        const inhalt = fs.readFileSync(datei, 'utf8');
        for (const muster of MUSTER) {
            for (const treffer of inhalt.match(muster) || []) {
                funde.push(`${path.relative(PUBLIC, datei)}: ${treffer.slice(0, 120)}`);
            }
        }
    }
    assert.deepEqual(funde, [], `Externe Ressourcen gefunden:\n${funde.join('\n')}`);
});

test('die lokalen Schriftdateien aus schriften.css existieren', () => {
    const css = fs.readFileSync(path.join(PUBLIC, 'css/schriften.css'), 'utf8');
    const urls = [...css.matchAll(/url\('([^']+)'\)/g)].map((m) => m[1]);
    assert.ok(urls.length >= 4, 'schriften.css verweist auf keine Schriftdateien');
    for (const url of urls) {
        assert.ok(fs.existsSync(path.join(PUBLIC, url)), `Schriftdatei fehlt: ${url}`);
    }
});
