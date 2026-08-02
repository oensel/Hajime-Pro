import crypto from 'crypto';

export function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
    return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
    if (!stored || !stored.includes(':')) return false;
    const [salt, hash] = stored.split(':');
    const hashVerify = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');

    const hashBuf = Buffer.from(hash, 'hex');
    const verifyBuf = Buffer.from(hashVerify, 'hex');
    if (hashBuf.length !== verifyBuf.length) return false;

    return crypto.timingSafeEqual(hashBuf, verifyBuf);
}
