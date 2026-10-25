// Verschlüsselung einzelner Felder (Zahlungsdaten) mit AES-256-GCM.
// Format: z1:<kid>:<iv>:<tag>:<daten> (base64-Teile; kid = Kurzkennung des Schlüssels).
import crypto from 'node:crypto';
import { FachFehler } from './fachFehler.js';

export const SCHLUESSEL_MINDESTLAENGE = 32;

function holeRoh(env) {
    const roh = env?.ZAHLUNGSDATEN_SCHLUESSEL;
    return typeof roh === 'string' && roh.length >= SCHLUESSEL_MINDESTLAENGE ? roh : null;
}

export function schluesselVorhanden(env = process.env) {
    return holeRoh(env) !== null;
}

function leiteSchluesselAb(env) {
    const roh = holeRoh(env);
    if (!roh) throw new FachFehler(503, 'Zahlungsdaten-Schlüssel ist nicht eingerichtet.');
    const schluessel = crypto.createHash('sha256').update('hajime-zahlungsdaten:' + roh).digest();
    const kid = crypto.createHash('sha256').update(schluessel).digest('hex').slice(0, 8);
    return { schluessel, kid };
}

export function verschluesseleFeld(klartext, env = process.env) {
    const { schluessel, kid } = leiteSchluesselAb(env);
    const iv = crypto.randomBytes(12);
    const chiffre = crypto.createCipheriv('aes-256-gcm', schluessel, iv);
    const daten = Buffer.concat([chiffre.update(String(klartext), 'utf8'), chiffre.final()]);
    return ['z1', kid, iv.toString('base64'), chiffre.getAuthTag().toString('base64'), daten.toString('base64')].join(':');
}

export function entschluesseleFeld(text, env = process.env) {
    const { schluessel } = leiteSchluesselAb(env);
    const fehler = () => new FachFehler(500, 'Zahlungsdaten konnten nicht entschlüsselt werden.');
    const teile = String(text ?? '').split(':');
    if (teile.length !== 5 || teile[0] !== 'z1') throw fehler();
    try {
        const dechiffre = crypto.createDecipheriv('aes-256-gcm', schluessel, Buffer.from(teile[2], 'base64'));
        dechiffre.setAuthTag(Buffer.from(teile[3], 'base64'));
        return Buffer.concat([dechiffre.update(Buffer.from(teile[4], 'base64')), dechiffre.final()]).toString('utf8');
    } catch {
        throw fehler();
    }
}
