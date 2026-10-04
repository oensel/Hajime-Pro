// Baut die Android-App als APK nach dist-android/Hajime-Pro-<version>.apk:
//   1. Web-Verzeichnis der App (scripts/baue-android-www.mjs)
//   2. Capacitor-Sync in das Android-Projekt (mobil/android)
//   3. Gradle (JDK 21 und Android-SDK nötig, siehe mobil/README.md)
// Mit HAJIME_KEYSTORE (+ HAJIME_KEYSTORE_PASSWORD, HAJIME_KEY_ALIAS, HAJIME_KEY_PASSWORD) entsteht die
// signierte Release-APK, sonst eine Debug-APK (installierbar, aber mit dem Debug-Schlüssel signiert —
// ein Update über eine mit anderem Schlüssel signierte App geht nicht).
//   node scripts/baue-android-apk.mjs
import { execFileSync } from 'child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { baueAndroidWww } from './baue-android-www.mjs';

const wurzel = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mobil = path.join(wurzel, 'mobil');
const android = path.join(mobil, 'android');
const istWindows = process.platform === 'win32';

function findeAndroidSdk() {
    const kandidaten = [
        process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT,
        process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk'),
        path.join(os.homedir(), 'Android', 'Sdk'),
        path.join(os.homedir(), 'Library', 'Android', 'sdk')
    ].filter(Boolean);
    return kandidaten.find(k => existsSync(k)) || null;
}

function fuehreAus(befehl, argumente, optionen = {}) {
    execFileSync(befehl, argumente, { stdio: 'inherit', shell: istWindows, ...optionen });
}

const { version } = JSON.parse(readFileSync(path.join(wurzel, 'package.json'), 'utf8'));
const sdk = findeAndroidSdk();
if (!sdk) {
    console.error('Android-SDK nicht gefunden – ANDROID_HOME setzen (siehe mobil/README.md).');
    process.exit(1);
}
const release = !!process.env.HAJIME_KEYSTORE;
if (!release) console.warn('Hinweis: HAJIME_KEYSTORE nicht gesetzt – es entsteht eine Debug-APK (Debug-Schlüssel).');

if (!existsSync(path.join(mobil, 'node_modules'))) fuehreAus('npm', ['install'], { cwd: mobil });
baueAndroidWww({ version });
fuehreAus('npx', ['cap', 'sync', 'android'], { cwd: mobil });

const gradlew = istWindows ? '.\\gradlew.bat' : './gradlew';
fuehreAus(gradlew, [release ? 'assembleRelease' : 'assembleDebug', `-PhajimeVersion=${version}`], {
    cwd: android,
    env: { ...process.env, ANDROID_HOME: sdk }
});

const quelle = path.join(android, 'app/build/outputs/apk', release ? 'release/app-release.apk' : 'debug/app-debug.apk');
if (!existsSync(quelle)) {
    console.error(`APK nicht gefunden: ${quelle}`);
    process.exit(1);
}
const zielVerzeichnis = path.join(wurzel, 'dist-android');
mkdirSync(zielVerzeichnis, { recursive: true });
const ziel = path.join(zielVerzeichnis, `Hajime-Pro-${version}.apk`);
copyFileSync(quelle, ziel);
console.log(`APK gebaut (${release ? 'Release' : 'Debug'}): ${ziel}`);
