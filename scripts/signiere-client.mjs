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
    { endung: '.AppImage', plattform: 'linux-x64', rollen: ['installieren', 'aktualisieren'] },
    { endung: '.apk', plattform: 'android', rollen: ['installieren'] }
];

export function erzeugeVersionJson({ verzeichnis, version, privaterSchluessel }) {
    const dateien = {};
    for (const datei of readdirSync(verzeichnis).sort()) {
        const regel = ZUORDNUNG.find(z => datei.endsWith(z.endung));
        if (!regel) continue;
        const sha256 = sha256Hex(readFileSync(path.join(verzeichnis, datei)));
        const signatur = sign(null, Buffer.from(signaturNachricht({ datei, version, sha256 })), privaterSchluessel).toString('base64');
        dateien[regel.plattform] = dateien[regel.plattform] || {};
        for (const rolle of regel.rollen) {
            // Zwei passende Dateien (z.B. Reste eines älteren Builds) — welche gemeint ist, wäre
            // Zufall der Sortierung. Lieber abbrechen als die falsche Datei ausliefern.
            const bisher = dateien[regel.plattform][rolle];
            if (bisher) throw new Error(`${regel.plattform}/${rolle} doppelt belegt: ${bisher.datei} und ${datei} – nur eine Datei je Plattform und Rolle im Verzeichnis lassen.`);
            dateien[regel.plattform][rolle] = { datei, sha256, signatur };
        }
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
    let vj;
    try {
        vj = erzeugeVersionJson({ verzeichnis, version, privaterSchluessel: schluessel });
    } catch (err) {
        console.error(`Signieren abgebrochen: ${err.message}`);
        process.exit(1);
    }
    console.log(`version.json für ${version}: ${Object.keys(vj.dateien).join(', ')}`);
}
