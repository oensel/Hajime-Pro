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
