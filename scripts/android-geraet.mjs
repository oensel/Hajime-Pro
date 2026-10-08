// Baut die Debug-APK und installiert sie per USB (adb) auf dem angeschlossenen Android-Gerät.
//   npm run android:geraet            (bauen + installieren + App starten)
//   npm run android:geraet -- --ohne-bauen   (nur installieren)
import { execFileSync, spawnSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const wurzel = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(readFileSync(path.join(wurzel, 'package.json'), 'utf8'));
const sdk = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT,
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk'),
    path.join(os.homedir(), 'Android', 'Sdk')].filter(Boolean).find(existsSync);
const adb = sdk && path.join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
if (!adb || !existsSync(adb)) { console.error('adb nicht gefunden – Android-SDK mit platform-tools installieren.'); process.exit(1); }

const geraete = execFileSync(adb, ['devices']).toString().split('\n').slice(1).map(z => z.trim().split(/\s+/)).filter(z => z[0]);
const bereit = geraete.filter(z => z[1] === 'device');
if (!bereit.length) {
    const problem = geraete.find(z => z[1] === 'unauthorized');
    console.error(problem
        ? 'Handy gefunden, aber nicht autorisiert: auf dem Handy "USB-Debugging zulassen" bestätigen und erneut starten.'
        : 'Kein Gerät gefunden: USB-Kabel (Datenkabel) prüfen, Entwickleroptionen > USB-Debugging aktivieren.');
    process.exit(1);
}
if (!process.argv.includes('--ohne-bauen')) {
    execFileSync('npm', ['run', 'android:apk'], { cwd: wurzel, stdio: 'inherit', shell: process.platform === 'win32' });
}
const apk = path.join(wurzel, 'dist-android', `Hajime-Pro-${version}.apk`);
execFileSync(adb, ['-s', bereit[0][0], 'install', '-r', apk], { stdio: 'inherit' });
const paket = JSON.parse(readFileSync(path.join(wurzel, 'mobil', 'capacitor.config.json'), 'utf8')).appId;
spawnSync(adb, ['-s', bereit[0][0], 'shell', 'monkey', '-p', paket, '-c', 'android.intent.category.LAUNCHER', '1'], { stdio: 'ignore' });
console.log(`Installiert und gestartet auf ${bereit[0][0]}.`);
