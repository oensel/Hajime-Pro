// Erzeugt einmalig das Ed25519-Schlüsselpaar für die Update-Signatur (Spec Desktop-Client 6.1).
// Öffentlicher Teil -> desktop/update-schluessel.pub (committen), privater Teil wird NUR
// ausgegeben und gehört als Repository-Secret CLIENT_SIGNATUR_SCHLUESSEL zu GitHub.
import { generateKeyPairSync } from 'crypto';
import { existsSync, writeFileSync } from 'fs';

const ZIEL = 'desktop/update-schluessel.pub';
if (existsSync(ZIEL) && !process.argv.includes('--ueberschreiben')) {
    console.error(`${ZIEL} existiert bereits. Neuer Schlüssel macht alle bisherigen Clients update-unfähig – nur mit --ueberschreiben.`);
    process.exit(1);
}
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
writeFileSync(ZIEL, publicKey.export({ type: 'spki', format: 'pem' }));
console.log(`Öffentlicher Schlüssel geschrieben: ${ZIEL}\n`);
console.log('Privaten Schlüssel als GitHub-Secret CLIENT_SIGNATUR_SCHLUESSEL hinterlegen (Settings → Secrets and variables → Actions → New repository secret), danach diese Ausgabe löschen:\n');
console.log(privateKey.export({ type: 'pkcs8', format: 'pem' }));
