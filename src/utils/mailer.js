import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import betriebsmodus from '../config/betriebsmodus.cjs';
dotenv.config({ quiet: true });

let transporter = null;
let testVersand = null;

/**
 * Nur für Tests: ersetzt den Versand (die Funktion erhält das ganze Objekt { to, subject, text, replyTo, absenderName,
 * anhaenge }); null stellt ihn wieder her. Gibt sie nichts zurück, gilt die Mail als versendet; wirft sie, als Fehler.
 */
export function setzeTestVersand(fn) {
    testVersand = typeof fn === 'function' ? fn : null;
}
let transporterKonfiguriert = false;

function ladeTransporter() {
    if (transporterKonfiguriert) return transporter;
    transporterKonfiguriert = true;

    if (!process.env.SMTP_HOST) {
        return null;
    }

    transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT, 10) || 587,
        secure: process.env.SMTP_SECURE === 'true',
        auth: process.env.SMTP_USER
            ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
            : undefined
    });
    return transporter;
}

const STANDARD_ABSENDER = '"Hajime Pro" <no-reply@hajime-pro.local>';

/** Adresse aus einem From-Text wie `"Name" <adresse>`, `Name <adresse>` oder `adresse`. */
function adresseAus(from) {
    const text = String(from || '').trim();
    const m = /<([^<>]+)>\s*$/.exec(text);
    return (m ? m[1] : text).trim();
}

/**
 * Baut die nodemailer-Optionen. `absenderName` ersetzt nur den Anzeigenamen aus SMTP_FROM (die Adresse bleibt,
 * nodemailer kümmert sich um das Quoting), `anhaenge` ([{ dateiname, inhalt, typ }]) werden zu `attachments`.
 */
export function baueMailOptionen({ to, subject, text, replyTo = null, absenderName = null, anhaenge = [] }, smtpFrom = STANDARD_ABSENDER) {
    const name = typeof absenderName === 'string' ? absenderName.replace(/[\r\n]+/g, ' ').trim() : '';
    const optionen = {
        from: name ? { name, address: adresseAus(smtpFrom) } : smtpFrom,
        to,
        subject,
        text
    };
    if (replyTo) optionen.replyTo = replyTo;
    if (Array.isArray(anhaenge) && anhaenge.length > 0) {
        optionen.attachments = anhaenge.map((a) => ({
            filename: a.dateiname,
            content: Buffer.isBuffer(a.inhalt) ? a.inhalt : Buffer.from(a.inhalt),
            contentType: a.typ || 'application/octet-stream'
        }));
    }
    return optionen;
}

/**
 * Versendet eine E-Mail über den konfigurierten SMTP-Server. Ist kein SMTP_HOST gesetzt (z.B.
 * lokale Entwicklung), wird die Mail nur geloggt statt versendet — Registrierungs-/Freigabe-
 * Abläufe dürfen niemals an fehlender Mail-Konfiguration scheitern. Fehler werden nie geworfen,
 * sondern im Ergebnis gemeldet (bisherige Aufrufer ignorieren es).
 * @param {Object} options
 * @param {string|string[]} options.to
 * @param {string} options.subject
 * @param {string} options.text
 * @param {string|null} [options.replyTo]
 * @param {string|null} [options.absenderName] ersetzt den Anzeigenamen aus SMTP_FROM
 * @param {Array<{ dateiname: string, inhalt: Buffer|Uint8Array, typ: string }>} [options.anhaenge]
 * @returns {Promise<{ versendet: boolean, grund: 'kein_smtp'|'fehler'|null }>}
 */
export async function sendeMail({ to, subject, text, replyTo = null, absenderName = null, anhaenge = [] }) {
    if (testVersand) {
        try {
            const ergebnis = await testVersand({ to, subject, text, replyTo, absenderName, anhaenge });
            return ergebnis && typeof ergebnis === 'object' ? ergebnis : { versendet: true, grund: null };
        } catch (error) {
            console.error('[Mailer-Fehler]:', error?.message);
            return { versendet: false, grund: 'fehler' };
        }
    }
    const t = ladeTransporter();
    if (!t) {
        // In der Cloud nur Empfänger und Betreff: der Text enthält Einmal-Links (Bestätigung, Freischaltung), die
        // im Server-Log nichts zu suchen haben. In Entwicklung/Test bleibt der volle Text, dort braucht man die Links.
        // Anhänge werden nie geloggt (Rechnungen enthalten Bankdaten).
        if (betriebsmodus.liesBetriebsmodus().istCloud) {
            console.log(`[Mailer] SMTP nicht konfiguriert – E-Mail nicht versendet (Text wird nicht geloggt).\nAn: ${to}\nBetreff: ${subject}`);
        } else {
            console.log(`[Mailer] SMTP nicht konfiguriert – E-Mail wird nur geloggt.\nAn: ${to}\nBetreff: ${subject}\n${text}`);
        }
        return { versendet: false, grund: 'kein_smtp' };
    }

    try {
        await t.sendMail(baueMailOptionen({ to, subject, text, replyTo, absenderName, anhaenge }, process.env.SMTP_FROM || STANDARD_ABSENDER));
        return { versendet: true, grund: null };
    } catch (error) {
        console.error('[Mailer-Fehler]:', error.message);
        return { versendet: false, grund: 'fehler' };
    }
}
