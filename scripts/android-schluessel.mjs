// Erzeugt einmalig den Signaturschlüssel (Keystore) der Android-App und gibt die vier GitHub-Secrets aus,
// die release.yml für die signierte APK braucht. Mit demselben Schlüssel müssen ALLE späteren Versionen
// signiert sein, sonst lässt sich eine neue APK nicht über die alte installieren — den Keystore daher
// sicher aufbewahren (Passwortmanager, Backup), aber NICHT ins Repository legen.
//   npm run android:schluessel [zielordner]     (braucht keytool aus dem JDK)
import { execFileSync } from 'child_process';
import { randomBytes } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';

const ordner = path.resolve(process.argv[2] || 'android-schluessel');
const datei = path.join(ordner, 'hajime-android.jks');
if (existsSync(datei)) {
    console.error(`${datei} existiert schon – nichts überschrieben. Den vorhandenen Schlüssel weiterverwenden oder die Datei bewusst löschen.`);
    process.exit(1);
}
mkdirSync(ordner, { recursive: true });

const passwort = randomBytes(18).toString('base64url');
const alias = 'hajime';
const keytool = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', 'keytool') : 'keytool';
try {
    execFileSync(keytool, [
        '-genkeypair', '-keystore', datei, '-alias', alias, '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000',
        '-storepass', passwort, '-keypass', passwort, '-dname', 'CN=Hajime Pro, O=Hajime Pro, C=DE'
    ], { stdio: 'inherit' });
} catch (err) {
    console.error('keytool nicht ausführbar – JDK installieren bzw. JAVA_HOME setzen.');
    process.exit(1);
}

console.log(`\nKeystore: ${datei}`);
console.log('Diese vier Werte als Secrets im GitHub-Repository eintragen (Settings → Secrets and variables → Actions):\n');
console.log(`ANDROID_KEYSTORE_PASSWORD = ${passwort}`);
console.log(`ANDROID_KEY_ALIAS         = ${alias}`);
console.log(`ANDROID_KEY_PASSWORD      = ${passwort}`);
writeFileSync(`${datei}.base64.txt`, readFileSync(datei).toString('base64'));
console.log(`ANDROID_KEYSTORE_BASE64   = Inhalt der Datei ${datei}.base64.txt (nach dem Eintragen löschen)`);
console.log('\nDen Keystore selbst und das Passwort sicher aufbewahren – ohne sie sind keine Updates der App möglich.');
