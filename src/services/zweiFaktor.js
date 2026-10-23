// Zwei-Faktor-Anmeldung für Super-Admins (nur Cloud): Authenticator-App (TOTP, src/utils/totp.js) plus zehn einmalige
// Backup-Codes. Das Geheimnis liegt verschlüsselt (AES-256-GCM, Schlüssel aus JWT_SECRET) in benutzer.totp_secret und gilt
// erst mit totp_aktiv_am. Die Anmeldung läuft zweistufig (Passwort → Zwischen-Token → Code), eine halbfertige Sitzung
// gibt es nie. Reine Datenbanklogik ohne Express.
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import betriebsmodus from '../config/betriebsmodus.cjs';
import { erzeugeTotpGeheimnis, pruefeTotpCode, otpauthUrl } from '../utils/totp.js';

export const ANZAHL_BACKUP_CODES = 10;
export const MELDUNG_CODE_UNGUELTIG = 'Der Code ist ungültig oder wurde schon benutzt.';
const ZWISCHENTOKEN_MINUTEN = 10;
const MAX_FEHLVERSUCHE = 5;
const SPERRE_MS = 15 * 60_000;
const BACKUP_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

const jwtGeheimnis = () => process.env.JWT_SECRET || 'hajime_pro_secret_key_123456!';

/** Gilt die 2FA-Pflicht für Super-Admins? Nur in der Cloud, abschaltbar mit SUPER_ADMIN_2FA=false (z. B. für Tests). */
export function zweiFaktorPflicht(env = process.env) {
    return betriebsmodus.liesBetriebsmodus(env).istCloud && String(env.SUPER_ADMIN_2FA ?? '').trim().toLowerCase() !== 'false';
}

// --- Geheimnis verschlüsseln ---
function schluessel() {
    return crypto.createHash('sha256').update(`hajime-totp:${jwtGeheimnis()}`).digest();
}

export function verschluessele(klartext) {
    const iv = crypto.randomBytes(12);
    const chiffre = crypto.createCipheriv('aes-256-gcm', schluessel(), iv);
    const daten = Buffer.concat([chiffre.update(klartext, 'utf8'), chiffre.final()]);
    return [iv, chiffre.getAuthTag(), daten].map((b) => b.toString('base64')).join(':');
}

export function entschluessele(text) {
    const [iv, tag, daten] = String(text).split(':').map((t) => Buffer.from(t, 'base64'));
    const dechiffre = crypto.createDecipheriv('aes-256-gcm', schluessel(), iv);
    dechiffre.setAuthTag(tag);
    return Buffer.concat([dechiffre.update(daten), dechiffre.final()]).toString('utf8');
}

// --- Zwischen-Token (zwischen Passwort und Code), mit eigenem Schlüssel: als Sitzungs-Token unbrauchbar ---
const zwischenSchluessel = () => `${jwtGeheimnis()}:zwei-faktor`;

/** @param {'pruefen'|'einrichtung'} zweck */
export function erzeugeZwischenToken(benutzerId, zweck) {
    return jwt.sign({ id: benutzerId, zweck }, zwischenSchluessel(), { expiresIn: `${ZWISCHENTOKEN_MINUTEN}m` });
}

/** @returns {string|null} die Benutzer-ID, wenn das Token gültig ist und zum Zweck passt */
export function leseZwischenToken(token, zweck) {
    try {
        const daten = jwt.verify(String(token), zwischenSchluessel());
        return daten.zweck === zweck && daten.id ? daten.id : null;
    } catch {
        return null;
    }
}

// --- Fehlversuche (je Konto, im Speicher der Instanz) ---
const fehlversuche = new Map();

function istGesperrt(benutzerId) {
    const eintrag = fehlversuche.get(benutzerId);
    if (!eintrag) return false;
    if (Date.now() - eintrag.seit > SPERRE_MS) {
        fehlversuche.delete(benutzerId);
        return false;
    }
    return eintrag.anzahl >= MAX_FEHLVERSUCHE;
}

function merkeFehlversuch(benutzerId) {
    const eintrag = fehlversuche.get(benutzerId);
    if (!eintrag || Date.now() - eintrag.seit > SPERRE_MS) fehlversuche.set(benutzerId, { anzahl: 1, seit: Date.now() });
    else eintrag.anzahl += 1;
}

export function vergesseFehlversuche(benutzerId) {
    fehlversuche.delete(benutzerId);
}

// --- Backup-Codes ---
const normalisiereBackupCode = (text) => String(text ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const hashBackupCode = (code) => crypto.createHash('sha256').update(normalisiereBackupCode(code)).digest('hex');

function erzeugeBackupCode() {
    let text = '';
    for (const byte of crypto.randomBytes(10)) text += BACKUP_ALPHABET[byte % BACKUP_ALPHABET.length];
    return `${text.slice(0, 5)}-${text.slice(5)}`;
}

// --- Einrichtung ---
const fehler = (status, error) => ({ ok: false, status, error });

export async function hatZweiFaktor(knex, benutzerId) {
    const konto = await knex('benutzer').where({ id: benutzerId }).first('totp_aktiv_am');
    return !!(konto && konto.totp_aktiv_am);
}

/** Erzeugt ein neues, noch inaktives Geheimnis (ein früheres, unbestätigtes wird ersetzt). */
export async function starteEinrichtung(knex, benutzerId) {
    const konto = await knex('benutzer').where({ id: benutzerId }).first();
    if (!konto) return fehler(404, 'Konto nicht gefunden.');
    if (konto.totp_aktiv_am) return fehler(409, 'Die Zwei-Faktor-Anmeldung ist schon eingerichtet.');
    const geheimnis = erzeugeTotpGeheimnis();
    await knex('benutzer').where({ id: benutzerId }).update({ totp_secret: verschluessele(geheimnis), totp_letzter_schritt: null });
    return { ok: true, geheimnis, otpauthUrl: otpauthUrl({ geheimnis, konto: konto.email }) };
}

/** Schaltet die 2FA mit einem gültigen Code der App scharf und liefert die Backup-Codes (nur jetzt sichtbar). */
export async function bestaetigeEinrichtung(knex, benutzerId, code) {
    if (istGesperrt(benutzerId)) return fehler(429, 'Zu viele Fehlversuche. Bitte in 15 Minuten erneut versuchen.');
    const konto = await knex('benutzer').where({ id: benutzerId }).first();
    if (!konto || !konto.totp_secret) return fehler(400, 'Bitte die Einrichtung neu starten.');
    if (konto.totp_aktiv_am) return fehler(409, 'Die Zwei-Faktor-Anmeldung ist schon eingerichtet.');
    const pruefung = pruefeTotpCode(entschluessele(konto.totp_secret), code);
    if (!pruefung.ok) {
        merkeFehlversuch(benutzerId);
        return fehler(400, MELDUNG_CODE_UNGUELTIG);
    }
    const codes = Array.from({ length: ANZAHL_BACKUP_CODES }, erzeugeBackupCode);
    await knex.transaction(async (trx) => {
        await trx('benutzer').where({ id: benutzerId }).update({
            totp_aktiv_am: trx.fn.now(), totp_letzter_schritt: pruefung.schritt, updated_at: trx.fn.now()
        });
        await trx('totp_backup_codes').where({ benutzer_id: benutzerId }).del();
        await trx('totp_backup_codes').insert(codes.map((c) => ({ benutzer_id: benutzerId, code_hash: hashBackupCode(c) })));
    });
    vergesseFehlversuche(benutzerId);
    return { ok: true, backupCodes: codes };
}

/**
 * Prüft den zweiten Faktor: sechsstelliger Code der App oder ein Backup-Code (einmalig). Ein Code gilt nie zweimal.
 * @returns {Promise<{ ok: true, art: 'totp'|'backup', verbleibendeBackupCodes: number } | { ok: false, status: number, error: string }>}
 */
export async function pruefeZweitenFaktor(knex, benutzerId, eingabe) {
    if (istGesperrt(benutzerId)) return fehler(429, 'Zu viele Fehlversuche. Bitte in 15 Minuten erneut versuchen.');
    const konto = await knex('benutzer').where({ id: benutzerId }).first();
    if (!konto || !konto.totp_aktiv_am || !konto.totp_secret) return fehler(400, 'Die Zwei-Faktor-Anmeldung ist nicht eingerichtet.');

    const roh = String(eingabe ?? '').trim();
    let art = null;
    if (/^\d{3}\s?\d{3}$/.test(roh)) {
        const pruefung = pruefeTotpCode(entschluessele(konto.totp_secret), roh, { letzterSchritt: konto.totp_letzter_schritt });
        if (pruefung.ok) {
            // atomar: derselbe Schritt darf nur einmal verbraucht werden (auch bei gleichzeitigen Anfragen)
            const geaendert = await knex('benutzer').where({ id: benutzerId })
                .andWhere((q) => q.whereNull('totp_letzter_schritt').orWhere('totp_letzter_schritt', '<', pruefung.schritt))
                .update({ totp_letzter_schritt: pruefung.schritt });
            if (geaendert === 1) art = 'totp';
        }
    } else if (normalisiereBackupCode(roh).length === 10) {
        const verbraucht = await knex('totp_backup_codes')
            .where({ benutzer_id: benutzerId, code_hash: hashBackupCode(roh) }).whereNull('benutzt_am')
            .update({ benutzt_am: knex.fn.now() });
        if (verbraucht === 1) art = 'backup';
    }
    if (!art) {
        merkeFehlversuch(benutzerId);
        return fehler(401, MELDUNG_CODE_UNGUELTIG);
    }
    vergesseFehlversuche(benutzerId);
    const offen = await knex('totp_backup_codes').where({ benutzer_id: benutzerId }).whereNull('benutzt_am').count('* as n').first();
    return { ok: true, art, verbleibendeBackupCodes: parseInt(offen.n, 10) };
}

/** Entfernt die 2FA eines Kontos (Super-Admin setzt zurück, Notfall-Schlüssel); beim nächsten Login wird neu eingerichtet. */
export async function setzeZweiFaktorZurueck(knex, benutzerId) {
    await knex.transaction(async (trx) => {
        await trx('totp_backup_codes').where({ benutzer_id: benutzerId }).del();
        await trx('benutzer').where({ id: benutzerId }).update({ totp_secret: null, totp_aktiv_am: null, totp_letzter_schritt: null });
    });
    vergesseFehlversuche(benutzerId);
}

/**
 * Bestätigung sensibler Aktionen (Sicherung, Wiederherstellen, 2FA eines anderen Kontos zurücksetzen): der aktuelle Code
 * der App oder ein Backup-Code des handelnden Super-Admins. Ohne 2FA-Pflicht (Hallen-Server, Tests) entfällt die Prüfung.
 */
export async function pruefeCodeFuerAktion(knex, benutzerId, code) {
    if (!zweiFaktorPflicht()) return { ok: true };
    if (!(await hatZweiFaktor(knex, benutzerId))) {
        return fehler(403, 'Bitte richten Sie zuerst die Zwei-Faktor-Anmeldung ein (neu anmelden).');
    }
    // 403 statt 401: bei 401 leitet menu.js zur Anmeldeseite um, hier ist der Nutzer aber angemeldet und gibt nur einen falschen Code ein.
    if (typeof code !== 'string' || !code.trim()) return fehler(403, 'Bitte den aktuellen Code der Authenticator-App angeben.');
    const ergebnis = await pruefeZweitenFaktor(knex, benutzerId, code);
    return ergebnis.ok ? { ok: true } : { ...ergebnis, status: ergebnis.status === 401 ? 403 : ergebnis.status };
}

/** Stand der 2FA eines Kontos für die Oberfläche (Profil). */
export async function zweiFaktorStatus(knex, benutzerId) {
    const konto = await knex('benutzer').where({ id: benutzerId }).first('ist_super_admin', 'totp_aktiv_am');
    if (!konto) return null;
    const offen = await knex('totp_backup_codes').where({ benutzer_id: benutzerId }).whereNull('benutzt_am').count('* as n').first();
    return {
        pflicht: zweiFaktorPflicht(),
        istSuperAdmin: !!konto.ist_super_admin,
        aktiv: !!konto.totp_aktiv_am,
        aktivSeit: konto.totp_aktiv_am ? new Date(konto.totp_aktiv_am).toISOString() : null,
        backupCodesUebrig: parseInt(offen.n, 10)
    };
}

/** Ersetzt alle Backup-Codes durch zehn neue (die alten verfallen). @returns {Promise<string[]>} nur jetzt sichtbar */
export async function erzeugeNeueBackupCodes(knex, benutzerId) {
    const codes = Array.from({ length: ANZAHL_BACKUP_CODES }, erzeugeBackupCode);
    await knex.transaction(async (trx) => {
        await trx('totp_backup_codes').where({ benutzer_id: benutzerId }).del();
        await trx('totp_backup_codes').insert(codes.map((c) => ({ benutzer_id: benutzerId, code_hash: hashBackupCode(c) })));
    });
    return codes;
}
