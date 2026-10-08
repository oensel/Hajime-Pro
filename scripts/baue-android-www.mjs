// Baut das Web-Verzeichnis der Android-App (mobil/www): die Client-Seiten aus public/ plus alles,
// was der Hallen-Server sonst aus node_modules/ und src/shared/ ausliefert (siehe die
// express.static-Einbindungen in src/app.js), dazu die Browser-Laufzeit aus mobil/web/. In jede
// Seite wird die Laufzeit (boot.js) eingefügt, die die /api/-Aufrufe der Seiten beantwortet.
//   node scripts/baue-android-www.mjs [zielverzeichnis]
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const wurzel = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Seiten, die ein Client-Gerät hat (wie ERLAUBTE_SEITEN in src/sync/clientApi.js, ohne login.html –
// die App hat keinen Login) plus die Kopplungsseite der App.
export const APP_SEITEN = ['client', 'teilnehmer', 'steuerung', 'kampf', 'anzeige', 'overlay', 'verbinden'];

const POUCHDB_TAG = '<script src="/js/pouchdb/pouchdb.min.js"></script>';
const LAUFZEIT_TAGS = `${POUCHDB_TAG}<script src="/js/mobil/boot.js"></script>`;
const NEU_KOPPELN = '<p style="text-align:center;margin:16px 0 72px;"><a href="/verbinden.html?neu=1">Mit anderem Hallen-Server koppeln</a></p>';

export function bereiteSeiteVor(html, seite) {
    // PouchDB kommt jetzt einmal vorab (die Laufzeit braucht es vor den Seitenskripten).
    let ergebnis = html.split(POUCHDB_TAG).join('');
    const kopf = /<head[^>]*>/i.exec(ergebnis);
    if (!kopf) throw new Error(`${seite}.html hat kein <head> – Laufzeit kann nicht eingefügt werden.`);
    ergebnis = ergebnis.slice(0, kopf.index + kopf[0].length) + LAUFZEIT_TAGS + ergebnis.slice(kopf.index + kopf[0].length);
    if (seite === 'client') ergebnis = ergebnis.replace('</body>', `${NEU_KOPPELN}</body>`);
    return ergebnis;
}

export function baueAndroidWww({ ziel = path.join(wurzel, 'mobil/www'), version } = {}) {
    const kopiere = (von, nach, optionen = {}) => {
        if (!existsSync(von)) throw new Error(`Fehlt: ${von} (npm install ausgeführt?)`);
        cpSync(von, path.join(ziel, nach), { recursive: true, ...optionen });
    };
    rmSync(ziel, { recursive: true, force: true });
    mkdirSync(ziel, { recursive: true });

    // Statische Anteile des Frontends.
    kopiere(path.join(wurzel, 'public/css'), 'css');
    kopiere(path.join(wurzel, 'public/js'), 'js');
    kopiere(path.join(wurzel, 'public/fonts/schriften'), 'fonts/schriften');
    kopiere(path.join(wurzel, 'public/sounds'), 'sounds');
    kopiere(path.join(wurzel, 'public/hajime_pro.png'), 'hajime_pro.png');
    kopiere(path.join(wurzel, 'public/hajime_zeichen.png'), 'hajime_zeichen.png');
    // Was src/app.js aus node_modules/ und src/shared/ unter /js/... bereitstellt.
    kopiere(path.join(wurzel, 'src/shared'), 'js/shared');
    kopiere(path.join(wurzel, 'node_modules/jsqr/dist/jsQR.js'), 'js/qr/jsQR.js');
    kopiere(path.join(wurzel, 'node_modules/qrcode-generator/dist/qrcode.js'), 'js/qrgen/qrcode.js');
    kopiere(path.join(wurzel, 'node_modules/qrcode-generator/dist/qrcode_UTF8.js'), 'js/qrgen/qrcode_UTF8.js');
    kopiere(path.join(wurzel, 'node_modules/pouchdb/dist/pouchdb.min.js'), 'js/pouchdb/pouchdb.min.js');
    kopiere(path.join(wurzel, 'node_modules/material-components-web/dist/material-components-web.css'), 'css/material/dist/material-components-web.css');
    kopiere(path.join(wurzel, 'node_modules/@material-design-icons/font/material-icons.woff2'), 'icons/material/material-icons.woff2');
    // Statische Konfiguration, die der Server unter /api/djb-klassen und /api/graduierungen liefert.
    kopiere(path.join(wurzel, 'src/config/altersklassen.json'), 'config/altersklassen.json');
    kopiere(path.join(wurzel, 'src/config/graduierungen.json'), 'config/graduierungen.json');
    // Browser-Laufzeit und Kopplungsseite der App.
    kopiere(path.join(wurzel, 'mobil/web/js/mobil'), 'js/mobil');

    const appVersion = version || JSON.parse(readFileSync(path.join(wurzel, 'package.json'), 'utf8')).version;
    writeFileSync(path.join(ziel, 'js/mobil/appVersion.js'), `export const APP_VERSION = ${JSON.stringify(appVersion)};\n`);

    for (const seite of APP_SEITEN) {
        const quelle = seite === 'verbinden'
            ? path.join(wurzel, 'mobil/web/verbinden.html')
            : path.join(wurzel, `public/${seite}.html`);
        writeFileSync(path.join(ziel, `${seite}.html`), bereiteSeiteVor(readFileSync(quelle, 'utf8'), seite));
    }
    writeFileSync(path.join(ziel, 'index.html'),
        '<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><title>Hajime Pro</title></head><body><script>location.replace("/client.html");</script></body></html>\n');
    return { ziel, version: appVersion, seiten: [...APP_SEITEN, 'index'] };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const ergebnis = baueAndroidWww({ ziel: process.argv[2] ? path.resolve(process.argv[2]) : undefined });
    console.log(`App-Web-Verzeichnis ${ergebnis.ziel} gebaut (Version ${ergebnis.version}): ${ergebnis.seiten.join(', ')}`);
}
