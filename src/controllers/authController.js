import jwt from 'jsonwebtoken';
import { hashPassword, verifyPassword } from '../utils/password.js';
import { ladeBenutzerMitAktivemVerein, ladeVereineFuerBenutzer } from '../utils/vereinHelper.js';
import * as steuerungPasswort from '../utils/steuerungPasswort.js';
import { registriere, bestaetige, sendeBestaetigungNeu, findeKontoPerEmail, normalisiereEmail, MIN_PASSWORT_LAENGE } from '../services/registrierung.js';
import { ermittleBasisUrl, HINWEIS_FEHLENDE_BASIS_URL } from '../utils/basisUrl.js';
import { hatVereinAdmin } from '../services/vereinsRollen.js';
import dotenv from 'dotenv';
dotenv.config({ quiet: true });

const JWT_SECRET = process.env.JWT_SECRET || 'hajime_pro_secret_key_123456!';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';

// Registrierung mit E-Mail-Bestätigung (src/services/registrierung.js): das Konto ist erst nach der
// Bestätigung nutzbar, deshalb gibt es hier nie ein Token zurück. Links in Mails nur mit sicherer Basis-URL
// (src/utils/basisUrl.js): in der Cloud ohne PUBLIC_BASE_URL keine Registrierung.
export async function register(knex, req, res) {
    try {
        const basisUrl = ermittleBasisUrl(req);
        if (!basisUrl) {
            console.error(`[Register] ${HINWEIS_FEHLENDE_BASIS_URL}`);
            return res.status(503).json({ success: false, error: 'Die Registrierung ist derzeit nicht verfügbar.' });
        }
        const { email, password, vorname, nachname, vereinId, quelle } = req.body || {};
        const ergebnis = await registriere(knex, {
            email, password, vorname, nachname, vereinId, quelle, basisUrl
        });
        return res.status(ergebnis.status).json(ergebnis.body);
    } catch (error) {
        console.error('[Register-Fehler]:', error);
        return res.status(500).json({ success: false, error: 'Interner Server-Fehler bei der Registrierung.' });
    }
}

// POST /api/auth/email-bestaetigen { token } — bewusst POST (Knopf auf bestaetigen.html), damit
// Mail-Scanner, die Links vorab abrufen, nichts bestätigen.
export async function emailBestaetigen(knex, req, res) {
    try {
        const token = req.body && req.body.token;
        const basisUrl = ermittleBasisUrl(req);
        if (!basisUrl) console.error(`[E-Mail-Bestätigung] ${HINWEIS_FEHLENDE_BASIS_URL} Freischaltungs-Mail ohne Link.`);
        const ergebnis = await bestaetige(knex, typeof token === 'string' ? token : '', basisUrl);
        if (!ergebnis.ok) {
            return res.status(ergebnis.status).json({ success: false, error: ergebnis.error });
        }
        return res.json({
            success: true,
            vereinId: ergebnis.vereinId ?? null,
            message: ergebnis.vereinId
                ? 'Deine Registrierung muss noch freigeschaltet werden.'
                : 'Deine E-Mail-Adresse ist bestätigt. Du kannst dich jetzt anmelden.'
        });
    } catch (error) {
        console.error('[E-Mail-Bestätigung-Fehler]:', error);
        return res.status(500).json({ success: false, error: 'Interner Server-Fehler bei der Bestätigung.' });
    }
}

// POST /api/auth/email-bestaetigung-erneut { email } — antwortet immer gleich, damit sich nicht prüfen lässt,
// ob eine Adresse registriert ist.
export async function emailBestaetigungErneut(knex, req, res) {
    try {
        const basisUrl = ermittleBasisUrl(req);
        if (!basisUrl) {
            console.error(`[E-Mail-Bestätigung-erneut] ${HINWEIS_FEHLENDE_BASIS_URL}`);
        } else {
            await sendeBestaetigungNeu(knex, req.body && req.body.email, basisUrl);
        }
    } catch (error) {
        console.error('[E-Mail-Bestätigung-erneut-Fehler]:', error);
    }
    return res.json({
        success: true,
        message: 'Falls zu dieser Adresse ein unbestätigtes Konto gehört, haben wir eine neue Bestätigungsmail geschickt.'
    });
}

export async function login(knex, req, res) {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ success: false, error: 'Email und Passwort sind erforderlich.' });
        }

        const user = await findeKontoPerEmail(knex, email);
        if (!user || !user.password_hash || !verifyPassword(password, user.password_hash)) {
            return res.status(401).json({ success: false, error: 'Ungültige Anmeldedaten.' });
        }
        // Erst nach dem Passwort prüfen, damit der Zustand eines Kontos nur mit gültigen Zugangsdaten sichtbar wird.
        if (!user.email_bestaetigt_am) {
            return res.status(403).json({
                success: false,
                code: 'email_unbestaetigt',
                error: 'Bitte bestätigen Sie zuerst Ihre E-Mail-Adresse über den Link in der Bestätigungsmail.'
            });
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
                // Rolle im aktiven Verein (login.html leitet reine Helfer direkt zur Helfer-App)
                verein_rolle: aktuellerBenutzer.verein_rolle,
                ist_super_admin: !!user.ist_super_admin,
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

            // Ohne freigegebenen Admin entscheidet der Super-Admin über die Anfrage (Spec 4), auch wenn
            // andere Mitglieder (Benutzer/Helfer) schon freigegeben sind.
            if (!user.verein_freigegeben) {
                vereinWartetAufSuperAdmin = !(await hatVereinAdmin(knex, user.verein_id));
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
                verein_rolle: user.verein_rolle,
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
        const { vorname, nachname, currentPassword, newPassword } = req.body;
        // Wie bei der Registrierung getrimmt und kleingeschrieben. Eine geänderte Adresse wird (noch) nicht erneut
        // bestätigt.
        const email = normalisiereEmail(req.body.email);

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
            // Dubletten ohne Beachtung der Schreibweise (Bestandskonten können noch Großbuchstaben enthalten).
            const existing = await findeKontoPerEmail(knex, email);
            const fremd = existing && existing.id !== userId
                ? existing
                : await knex('benutzer').whereRaw('lower(trim(email)) = ?', [email]).whereNot({ id: userId }).first();
            if (fremd) {
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
            if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORT_LAENGE) {
                return res.status(400).json({ success: false, error: `Das neue Passwort muss mindestens ${MIN_PASSWORT_LAENGE} Zeichen lang sein.` });
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
                verein_rolle: aktuellerBenutzer.verein_rolle,
                vereine
            }
        });
    } catch (error) {
        console.error('[Profil-Update-Fehler]:', error);
        return res.status(500).json({ success: false, error: 'Interner Server-Fehler beim Aktualisieren des Profils.' });
    }
}

export function getAuthMode(knex, req, res) {
    return res.json({ passwordRequired: steuerungPasswort.istGesetzt() });
}

export function verifyPasswordEndpoint(knex, req, res) {
    const clientPassword = req.headers['x-steuerung-password'] || (req.body && req.body.password);

    if (steuerungPasswort.istGesetzt() && steuerungPasswort.pruefe(clientPassword)) {
        // aenderungErforderlich: es gilt noch das vom Installationsskript erzeugte Start-Passwort —
        // das Frontend verlangt dann sofort ein eigenes Passwort (POST /api/auth/steuerung-passwort).
        return res.json({ success: true, aenderungErforderlich: steuerungPasswort.istStartPasswort() });
    }
    return res.status(401).json({ success: false, error: 'Ungültiges Passwort.' });
}

// Setzt ein eigenes Turnierleitungs-Passwort. Das bisherige Passwort steht im Header
// x-steuerung-password (requireSteuerungPasswort in der Route); gilt als Nachweis für die Änderung.
export async function aendereSteuerungPasswort(knex, req, res) {
    const neu = req.body && req.body.neuesPasswort;
    try {
        await steuerungPasswort.aendere(neu);
        return res.json({ success: true });
    } catch (error) {
        if (error.status === 400) return res.status(400).json({ success: false, error: error.message });
        console.error('[Steuerungs-Passwort-Fehler]:', error);
        return res.status(500).json({ success: false, error: 'Das Passwort konnte nicht gespeichert werden.' });
    }
}
