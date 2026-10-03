// Statischer Server für die Mobil-Suite: baut das Web-Verzeichnis der Android-App neu und liefert es
// aus (kein Cache, keine CORS-Header — wie die lokalen Dateien in der Capacitor-WebView).
import http from 'http';
import { existsSync, readFileSync, statSync } from 'fs';
import path from 'path';
import { baueAndroidWww } from '../../scripts/baue-android-www.mjs';
import { APP_PORT, APP_WWW } from './test-env.js';

const wurzel = path.resolve(APP_WWW);
baueAndroidWww({ ziel: wurzel });

const TYPEN = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.json': 'application/json'
};

http.createServer((req, res) => {
    const pfad = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let datei = path.join(wurzel, pfad === '/' ? 'index.html' : pfad);
    if (!datei.startsWith(wurzel) || !existsSync(datei) || statSync(datei).isDirectory()) {
        res.writeHead(404).end('nicht gefunden');
        return;
    }
    res.writeHead(200, { 'Content-Type': TYPEN[path.extname(datei)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(readFileSync(datei));
}).listen(APP_PORT, () => console.log(`App-Server auf http://localhost:${APP_PORT}`));
