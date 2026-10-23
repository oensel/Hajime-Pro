import crypto from 'crypto';

// Passwort-Prüfwerte: PBKDF2-HMAC-SHA512 mit 210.000 Durchläufen (OWASP-Empfehlung) und Salz je Passwort, gespeichert als
// `v2$<Durchläufe>$<Salz>$<Hash>`. Ältere Prüfwerte (`<Salz>:<Hash>` mit nur 1.000 Durchläufen) werden weiter akzeptiert und beim nächsten
// erfolgreichen Login erneuert (brauchtNeuenHash, authController.login).
export const DURCHLAEUFE = 210_000;
const DURCHLAEUFE_ALT = 1000;

export function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, DURCHLAEUFE, 64, 'sha512').toString('hex');
    return `v2$${DURCHLAEUFE}$${salt}$${hash}`;
}

function zerlege(stored) {
    if (typeof stored !== 'string' || !stored) return null;
    if (stored.startsWith('v2$')) {
        const [, durchlaeufe, salt, hash] = stored.split('$');
        const n = parseInt(durchlaeufe, 10);
        if (!(n >= DURCHLAEUFE_ALT && n <= 10_000_000) || !salt || !hash) return null;
        return { n, salt, hash };
    }
    if (stored.includes(':')) {
        const [salt, hash] = stored.split(':');
        return salt && hash ? { n: DURCHLAEUFE_ALT, salt, hash } : null;
    }
    return null;
}

export function verifyPassword(password, stored) {
    const teile = zerlege(stored);
    if (!teile || typeof password !== 'string') return false;
    const hashVerify = crypto.pbkdf2Sync(password, teile.salt, teile.n, 64, 'sha512').toString('hex');

    const hashBuf = Buffer.from(teile.hash, 'hex');
    const verifyBuf = Buffer.from(hashVerify, 'hex');
    if (hashBuf.length !== verifyBuf.length) return false;

    return crypto.timingSafeEqual(hashBuf, verifyBuf);
}

/** Ist der gespeicherte Prüfwert älter oder schwächer als der aktuelle (dann beim Login erneuern)? */
export function brauchtNeuenHash(stored) {
    const teile = zerlege(stored);
    return !!teile && (!String(stored).startsWith('v2$') || teile.n < DURCHLAEUFE);
}
