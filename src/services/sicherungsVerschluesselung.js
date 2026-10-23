// Verschlüsselung der Sicherungsdateien (siehe datensicherung.js): AES-256-GCM in Blöcken, Schlüssel aus einem langen Passwort per scrypt.
// Eingeschaltet wird sie mit SICHERUNG_PASSWORT (oder SICHERUNG_PASSWORT_DATEI = Pfad einer Datei mit dem Passwort, z. B. ein Docker-Secret);
// mindestens 20 Zeichen. Ist ein Passwort gesetzt, entstehen alle Sicherungen verschlüsselt (.hajime-sicherung.gz.enc), jede mit eigenem
// Salz und damit eigenem Schlüssel; unverschlüsselte ältere Sicherungen lassen sich weiter einspielen.
//
// Dateiformat:
//   Kopf (29 Byte): "HJMSICH1" · log2(N) für scrypt (1 Byte, r=8, p=1) · Salz (16 Byte) · Blockgröße (4 Byte, Big Endian)
//   danach je Block: Kennzeichen (1 Byte: 0 = weitere Blöcke folgen, 1 = letzter Block) · Länge (4 Byte) · Chiffretext · GCM-Prüfwert (16 Byte)
// Jeder Block hat sein eigenes Nonce (Blockzähler) und prüft Kopf, Kennzeichen und Reihenfolge (zusätzliche authentifizierte Daten): ein
// vertauschter, fehlender oder abgeschnittener Block fällt auf, und es wird nie Klartext vor der Prüfung seines Blocks weitergegeben.
import crypto from 'crypto';
import fs from 'fs';
import { Transform } from 'stream';

export const MAGIC = Buffer.from('HJMSICH1');
export const MIN_PASSWORT_LAENGE = 20;
const KOPF_LAENGE = 29;
const SCRYPT_LOG2_N = 16; // 64 MiB Speicher je Schlüsselableitung
const SCRYPT_MAXMEM = 256 * 1024 * 1024;
const BLOCK = 64 * 1024;
const TAG = 16;

export class EntschluesselungsFehler extends Error {
    constructor(message) {
        super(message);
        this.code = 'SICHERUNG_ENTSCHLUESSELUNG';
        this.status = 400;
    }
}

/** Das eingestellte Passwort oder null; ein zu kurzes Passwort ist ein Fehler (es wird nie stillschweigend unverschlüsselt gesichert). */
export function leseSicherungsPasswort(env = process.env) {
    let passwort = null;
    if (env.SICHERUNG_PASSWORT_DATEI) {
        try {
            passwort = fs.readFileSync(env.SICHERUNG_PASSWORT_DATEI, 'utf8').replace(/[\r\n]+$/, '');
        } catch (err) {
            throw Object.assign(new Error(`SICHERUNG_PASSWORT_DATEI ist nicht lesbar: ${err.message}`), { status: 500 });
        }
    } else if (env.SICHERUNG_PASSWORT) {
        passwort = String(env.SICHERUNG_PASSWORT);
    }
    if (passwort === null) return null;
    if (passwort.length < MIN_PASSWORT_LAENGE) {
        throw Object.assign(new Error(`Das Sicherungspasswort ist zu kurz (mindestens ${MIN_PASSWORT_LAENGE} Zeichen).`), { status: 500 });
    }
    return passwort;
}

export const istVerschluesselt = (bytes) => Buffer.isBuffer(bytes) && bytes.length >= MAGIC.length && bytes.subarray(0, MAGIC.length).equals(MAGIC);

const schluesselVon = (passwort, salz, log2N) => new Promise((resolve, reject) => {
    crypto.scrypt(passwort, salz, 32, { N: 2 ** log2N, r: 8, p: 1, maxmem: SCRYPT_MAXMEM }, (err, schluessel) => (err ? reject(err) : resolve(schluessel)));
});

function nonceFuer(zaehler) {
    const nonce = Buffer.alloc(12);
    nonce.writeBigUInt64BE(BigInt(zaehler), 4);
    return nonce;
}

const aad = (kopf, letzter) => Buffer.concat([kopf, Buffer.from([letzter ? 1 : 0])]);

/** Transform: Klartext hinein, verschlüsselter Strom (mit Kopf) heraus. */
export function erzeugeVerschluesselung(passwort) {
    const salz = crypto.randomBytes(16);
    const kopf = Buffer.alloc(KOPF_LAENGE);
    MAGIC.copy(kopf, 0);
    kopf.writeUInt8(SCRYPT_LOG2_N, 8);
    salz.copy(kopf, 9);
    kopf.writeUInt32BE(BLOCK, 25);
    let schluessel = null;
    let puffer = Buffer.alloc(0);
    let zaehler = 0;
    let kopfGesendet = false;

    const block = (daten, letzter) => {
        const chiffre = crypto.createCipheriv('aes-256-gcm', schluessel, nonceFuer(zaehler));
        chiffre.setAAD(aad(kopf, letzter));
        zaehler += 1;
        const text = Buffer.concat([chiffre.update(daten), chiffre.final()]);
        const rahmen = Buffer.alloc(5);
        rahmen.writeUInt8(letzter ? 1 : 0, 0);
        rahmen.writeUInt32BE(text.length, 1);
        return Buffer.concat([rahmen, text, chiffre.getAuthTag()]);
    };
    const vorbereiten = async (strom) => {
        if (schluessel) return;
        schluessel = await schluesselVon(passwort, salz, SCRYPT_LOG2_N);
        if (!kopfGesendet) { strom.push(kopf); kopfGesendet = true; }
    };

    return new Transform({
        async transform(stueck, _enc, fertig) {
            try {
                await vorbereiten(this);
                puffer = puffer.length ? Buffer.concat([puffer, stueck]) : stueck;
                // erst ab BLOCK + 1 Byte ausgeben: der letzte Block muss als solcher gekennzeichnet werden können
                while (puffer.length > BLOCK) {
                    this.push(block(puffer.subarray(0, BLOCK), false));
                    puffer = puffer.subarray(BLOCK);
                }
                fertig();
            } catch (err) { fertig(err); }
        },
        async flush(fertig) {
            try {
                await vorbereiten(this);
                this.push(block(puffer, true));
                fertig();
            } catch (err) { fertig(err); }
        }
    });
}

/** Transform: verschlüsselter Strom hinein, Klartext heraus; wirft EntschluesselungsFehler bei falschem Passwort, Veränderung oder Abbruch. */
export function erzeugeEntschluesselung(passwort) {
    let puffer = Buffer.alloc(0);
    let kopf = null;
    let schluessel = null;
    let blockGroesse = 0;
    let zaehler = 0;
    let fertigGelesen = false;
    const falsch = () => new EntschluesselungsFehler('Passwort falsch oder die Sicherung ist beschädigt.');

    return new Transform({
        async transform(stueck, _enc, fertig) {
            try {
                if (fertigGelesen) throw new EntschluesselungsFehler('Die Sicherung ist beschädigt (Daten nach dem letzten Block).');
                puffer = puffer.length ? Buffer.concat([puffer, stueck]) : stueck;
                if (!kopf) {
                    if (puffer.length < KOPF_LAENGE) return fertig();
                    kopf = Buffer.from(puffer.subarray(0, KOPF_LAENGE));
                    if (!istVerschluesselt(kopf)) throw new EntschluesselungsFehler('Das ist keine verschlüsselte Hajime-Pro-Sicherung.');
                    const log2N = kopf.readUInt8(8);
                    blockGroesse = kopf.readUInt32BE(25);
                    if (log2N < 14 || log2N > 20 || blockGroesse < 1 || blockGroesse > 16 * 1024 * 1024) throw new EntschluesselungsFehler('Die Sicherung hat einen ungültigen Kopf.');
                    schluessel = await schluesselVon(passwort, kopf.subarray(9, 25), log2N);
                    puffer = puffer.subarray(KOPF_LAENGE);
                }
                for (;;) {
                    if (puffer.length < 5) break;
                    const letzter = puffer.readUInt8(0);
                    const laenge = puffer.readUInt32BE(1);
                    if (letzter > 1 || laenge > blockGroesse) throw falsch();
                    if (puffer.length < 5 + laenge + TAG) break;
                    const text = puffer.subarray(5, 5 + laenge);
                    const tag = puffer.subarray(5 + laenge, 5 + laenge + TAG);
                    const chiffre = crypto.createDecipheriv('aes-256-gcm', schluessel, nonceFuer(zaehler));
                    chiffre.setAAD(aad(kopf, letzter === 1));
                    chiffre.setAuthTag(tag);
                    let klar;
                    try {
                        klar = Buffer.concat([chiffre.update(text), chiffre.final()]);
                    } catch { throw falsch(); }
                    zaehler += 1;
                    puffer = puffer.subarray(5 + laenge + TAG);
                    if (klar.length) this.push(klar);
                    if (letzter === 1) {
                        fertigGelesen = true;
                        if (puffer.length) throw new EntschluesselungsFehler('Die Sicherung ist beschädigt (Daten nach dem letzten Block).');
                        break;
                    }
                }
                fertig();
            } catch (err) { fertig(err); }
        },
        flush(fertig) {
            if (!kopf || !fertigGelesen) return fertig(new EntschluesselungsFehler('Die Sicherung ist unvollständig (abgeschnitten).'));
            return fertig();
        }
    });
}
