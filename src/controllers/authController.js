import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { hashPassword, verifyPassword } from '../utils/password.js';
import { ladeBenutzerMitAktivemVerein, ladeVereineFuerBenutzer } from '../utils/vereinHelper.js';
import dotenv from 'dotenv';
dotenv.config({ quiet: true });

const JWT_SECRET = process.env.JWT_SECRET || 'hajime_pro_secret_key_123456!';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';

export async function register(knex, req, res) {
    try {
        const { email, password, vorname, nachname } = req.body;

        if (!email || !password || !vorname || !nachname) {
            return res.status(400).json({ success: false, error: 'E-Mail, Passwort, Vorname und Nachname sind erforderlich.' });
        }

        const existing = await knex('benutzer').where({ email }).first();
        if (existing) {
            return res.status(409).json({ success: false, error: 'Diese E-Mail-Adresse ist bereits registriert.' });
        }

        const id = crypto.randomUUID();
        const password_hash = hashPassword(password);

        await knex('benutzer').insert({
            id,
            email,
            vorname,
            nachname,
            password_hash,
            created_at: knex.fn.now(),
            updated_at: knex.fn.now()
        });

        const token = jwt.sign({ id, email }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

        return res.status(201).json({
            success: true,
            token,
            user: { id, email, vorname, nachname, verein_id: null, verein_freigegeben: false, vereine: [] }
        });
    } catch (error) {
        console.error('[Register-Fehler]:', error);
        return res.status(500).json({ success: false, error: 'Interner Server-Fehler bei der Registrierung.' });
    }
}

export async function login(knex, req, res) {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ success: false, error: 'Email und Passwort sind erforderlich.' });
        }

        const user = await knex('benutzer').where({ email }).first();
        if (!user || !user.password_hash || !verifyPassword(password, user.password_hash)) {
            return res.status(401).json({ success: false, error: 'Ungültige Anmeldedaten.' });
        }

        const token = jwt.sign(
            { id: user.id, email: user.email },
            JWT_SECRET,
            { expiresIn: JWT_EXPIRES_IN }
        );

        const aktuellerBenutzer = await ladeBenutzerMitAktivemVerein(knex, user.id);
        const vereine = await ladeVereineFuerBenutzer(knex, user.id);

        return res.json({
            success: true,
            token,
            user: {
                id: user.id,
                email: user.email,
                vorname: user.vorname,
                nachname: user.nachname,
                verein_id: aktuellerBenutzer.verein_id,
                verein_freigegeben: !!aktuellerBenutzer.verein_freigegeben,
                vereine
            }
        });

    } catch (error) {
        console.error('[Login-Fehler]:', error);
        return res.status(500).json({ success: false, error: 'Interner Server-Fehler beim Login.' });
    }
}

export async function getMe(knex, req, res) {
    try {
        const user = await ladeBenutzerMitAktivemVerein(knex, req.user.id);
        if (!user) {
            return res.status(404).json({ success: false, error: 'Benutzer nicht gefunden.' });
        }

        let vereinName = null;
        let vereinMitgliederAnzahl = 0;
        let vereinWartetAufSuperAdmin = false;
        if (user.verein_id) {
            const verein = await knex('vereine').where({ id: user.verein_id }).first();
            vereinName = verein ? verein.name : null;

            const countRow = await knex('benutzer_vereine').where({ verein_id: user.verein_id }).count('* as anzahl').first();
            vereinMitgliederAnzahl = parseInt(countRow.anzahl, 10);

            if (!user.verein_freigegeben) {
                const approvedMember = await knex('benutzer_vereine')
                    .where({ verein_id: user.verein_id, freigegeben: 1 })
                    .first();
                vereinWartetAufSuperAdmin = !approvedMember;
            }
        }

        const vereine = await ladeVereineFuerBenutzer(knex, user.id);

        return res.json({
            success: true,
            user: {
                id: user.id,
                email: user.email,
                vorname: user.vorname,
                nachname: user.nachname,
                verein_id: user.verein_id,
                verein_name: vereinName,
                verein_freigegeben: !!user.verein_freigegeben,
                verein_wartet_auf_super_admin: vereinWartetAufSuperAdmin,
                verein_mitglieder_anzahl: vereinMitgliederAnzahl,
                ist_super_admin: !!user.ist_super_admin,
                vereine
            }
        });
    } catch (error) {
        console.error('[Me-Fehler]:', error);
        return res.status(500).json({ success: false, error: 'Interner Server-Fehler.' });
    }
}

export async function updateProfile(knex, req, res) {
    try {
        const userId = req.user.id;
        const { vorname, nachname, email, currentPassword, newPassword } = req.body;

        if (!vorname || !nachname || !email) {
            return res.status(400).json({ success: false, error: 'Vorname, Nachname und E-Mail sind erforderlich.' });
        }
        if (!currentPassword) {
            return res.status(400).json({ success: false, error: 'Bitte geben Sie Ihr aktuelles Passwort zur Bestätigung ein.' });
        }

        const user = await knex('benutzer').where({ id: userId }).first();
        if (!user) {
            return res.status(404).json({ success: false, error: 'Benutzer nicht gefunden.' });
        }

        if (!user.password_hash || !verifyPassword(currentPassword, user.password_hash)) {
            return res.status(401).json({ success: false, error: 'Das aktuelle Passwort ist nicht korrekt.' });
        }

        if (email !== user.email) {
            const existing = await knex('benutzer').where({ email }).whereNot({ id: userId }).first();
            if (existing) {
                return res.status(409).json({ success: false, error: 'Diese E-Mail-Adresse wird bereits von einem anderen Konto verwendet.' });
            }
        }

        const updateData = {
            vorname,
            nachname,
            email,
            updated_at: knex.fn.now()
        };

        if (newPassword) {
            if (newPassword.length < 6) {
                return res.status(400).json({ success: false, error: 'Das neue Passwort muss mindestens 6 Zeichen lang sein.' });
            }
            updateData.password_hash = hashPassword(newPassword);
        }

        await knex('benutzer').where({ id: userId }).update(updateData);

        const aktuellerBenutzer = await ladeBenutzerMitAktivemVerein(knex, userId);

        let vereinName = null;
        if (aktuellerBenutzer.verein_id) {
            const verein = await knex('vereine').where({ id: aktuellerBenutzer.verein_id }).first();
            vereinName = verein ? verein.name : null;
        }

        const vereine = await ladeVereineFuerBenutzer(knex, userId);

        const token = jwt.sign({ id: userId, email }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

        return res.json({
            success: true,
            message: 'Profil erfolgreich aktualisiert.',
            token,
            user: {
                id: userId,
                email,
                vorname,
                nachname,
                verein_id: aktuellerBenutzer.verein_id,
                verein_name: vereinName,
                verein_freigegeben: !!aktuellerBenutzer.verein_freigegeben,
                vereine
            }
        });
    } catch (error) {
        console.error('[Profil-Update-Fehler]:', error);
        return res.status(500).json({ success: false, error: 'Interner Server-Fehler beim Aktualisieren des Profils.' });
    }
}

export function getAuthMode(knex, req, res) {
    return res.json({ passwordRequired: !!process.env.STEUERUNG_PASSWORD });
}

export function verifyPasswordEndpoint(knex, req, res) {
    const password = process.env.STEUERUNG_PASSWORD;
    const clientPassword = req.headers['x-steuerung-password'] || req.body.password;

    if (password && clientPassword === password) {
        return res.json({ success: true });
    }
    return res.status(401).json({ success: false, error: 'Ungültiges Passwort.' });
}
