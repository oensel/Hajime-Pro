// Lädt die Client-Dateien des GitHub-Releases zur aktuellen package.json-Version nach
// <CLIENT_DOWNLOADS_VERZEICHNIS>/<version>/ und prüft jede Signatur (Spec Desktop-Client 5.2).
// Braucht Internet. Der Server macht das beim Start selbst (src/sync/clientDateien.js), dieses Skript
// ist nur noch für den manuellen Abruf gedacht.
//   npm run client:holen            (öffentliches Repo)
//   CLIENT_RELEASE_TOKEN=... npm run client:holen   (privates Repo, auch GITHUB_TOKEN)
import path from 'path';
import { createRequire } from 'module';
import dotenv from 'dotenv';
import { holeClientRelease, liesOeffentlichenSchluessel } from '../src/sync/clientDateien.js';

dotenv.config({ quiet: true });
const require = createRequire(import.meta.url);
const { version } = require('../package.json');
const ziel = path.join(path.resolve(process.env.CLIENT_DOWNLOADS_VERZEICHNIS || './data/client-downloads'), version);

try {
    await holeClientRelease({
        repo: process.env.CLIENT_RELEASE_REPO || 'oensel/Hajime-Pro',
        version,
        token: process.env.CLIENT_RELEASE_TOKEN || process.env.GITHUB_TOKEN || '',
        ziel,
        schluessel: liesOeffentlichenSchluessel(),
        beiFortschritt: ({ datei, fertig, gesamt }) => console.log(`(${fertig + 1}/${gesamt}) ${datei} …`)
    });
    console.log(`Client ${version} bereit unter ${ziel}`);
} catch (err) {
    console.error(err.message);
    process.exit(1);
}
