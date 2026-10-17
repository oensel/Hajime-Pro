import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import betriebsmodus from '../config/betriebsmodus.cjs';
dotenv.config({ quiet: true });

let transporter = null;
let testVersand = null;

/** Nur für Tests: ersetzt den Versand (die Funktion erhält { to, subject, text }); null stellt ihn wieder her. */
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

/**
 * Versendet eine E-Mail über den konfigurierten SMTP-Server. Ist kein SMTP_HOST gesetzt (z.B.
 * lokale Entwicklung), wird die Mail nur geloggt statt versendet — Registrierungs-/Freigabe-
 * Abläufe dürfen niemals an fehlender Mail-Konfiguration scheitern.
 * @param {Object} options
 * @param {string|string[]} options.to
 * @param {string} options.subject
 * @param {string} options.text
 */
export async function sendeMail({ to, subject, text }) {
    if (testVersand) return testVersand({ to, subject, text });
    const t = ladeTransporter();
    if (!t) {
        // In der Cloud nur Empfänger und Betreff: der Text enthält Einmal-Links (Bestätigung, Freischaltung), die
        // im Server-Log nichts zu suchen haben. In Entwicklung/Test bleibt der volle Text, dort braucht man die Links.
        if (betriebsmodus.liesBetriebsmodus().istCloud) {
            console.log(`[Mailer] SMTP nicht konfiguriert – E-Mail nicht versendet (Text wird nicht geloggt).\nAn: ${to}\nBetreff: ${subject}`);
        } else {
            console.log(`[Mailer] SMTP nicht konfiguriert – E-Mail wird nur geloggt.\nAn: ${to}\nBetreff: ${subject}\n${text}`);
        }
        return;
    }

    try {
        await t.sendMail({
            from: process.env.SMTP_FROM || '"Hajime Pro" <no-reply@hajime-pro.local>',
            to,
            subject,
            text
        });
    } catch (error) {
        console.error('[Mailer-Fehler]:', error.message);
    }
}
