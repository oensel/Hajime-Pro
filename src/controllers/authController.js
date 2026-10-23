import jwt from 'jsonwebtoken';
import { hashPassword, verifyPassword, brauchtNeuenHash } from '../utils/password.js';
import { ladeBenutzerMitAktivemVerein, ladeVereineFuerBenutzer } from '../utils/vereinHelper.js';
import * as steuerungPasswort from '../utils/steuerungPasswort.js';
import { registriere, bestaetige, sendeBestaetigungNeu, findeKontoPerEmail, normalisiereEmail, MIN_PASSWORT_LAENGE, MAX_EMAIL_LAENGE, MELDUNG_EMAIL_ZU_LANG } from '../services/registrierung.js';
import { ermittleBasisUrl, HINWEIS_FEHLENDE_BASIS_URL } from '../utils/basisUrl.js';
import { hatVereinAdmin } from '../services/vereinsRollen.js';
import { MELDUNG_KONTO_GESPERRT } from '../utils/kontoSperre.js';
import { fordereZuruecksetzungAn, setzePasswortZurueck } from '../services/passwortReset.js';
import { nutzeNotfallSchluessel } from '../services/notfallZugang.js';
import {
    zweiFaktorPflicht, erzeugeZwischenToken, leseZwischenToken, starteEinrichtung, bestaetigeEinrichtung, pruefeZweitenFaktor,
    zweiFaktorStatus, erzeugeNeueBackupCodes, pruefeCodeFuerAktion
} from '../services/zweiFaktor.js';
import betriebsmodus from '../config/betriebsmodus.cjs';
import { protokolliereKonto } from '../services/aktionsProtokoll.js';
import { clientIp } from '../liveCloud/ratenbegrenzung.js';
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
        if (ergebnis.status < 300) {
            protokolliereAnmeldung(knex, req, {
                adresse: email, vereinId: Number.isInteger(Number(vereinId)) ? Number(vereinId) : null,
                aktion: 'konto.registriert', beschreibung: 'Konto registriert (E-Mail-Bestätigung ausstehend)', status: ergebnis.status
            });
        }
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

// Passwort vergessen: schickt (bei bestätigtem, nicht gesperrtem Konto) einen Link zum Zurücksetzen; verrät nie, ob die
// Adresse existiert.
export async function passwortVergessen(knex, req, res) {
    try {
        const basisUrl = ermittleBasisUrl(req);
        if (!basisUrl) {
            console.error(`[Passwort-vergessen] ${HINWEIS_FEHLENDE_BASIS_URL}`);
        } else {
            await fordereZuruecksetzungAn(knex, req.body && req.body.email, basisUrl);
        }
    } catch (error) {
        console.error('[Passwort-vergessen-Fehler]:', error);
    }
    return res.json({
        success: true,
        message: 'Falls zu dieser Adresse ein Konto gehört, haben wir eine E-Mail mit einem Link zum Zurücksetzen des Passworts geschickt.'
    });
}

export async function passwortZuruecksetzen(knex, req, res) {
    try {
        const { token, passwort } = req.body || {};
        const ergebnis = await setzePasswortZurueck(knex, token, passwort);
        if (!ergebnis.ok) return res.status(ergebnis.status).json({ success: false, error: ergebnis.error });
        protokolliereAnmeldung(knex, req, { konto: { id: ergebnis.benutzerId }, aktion: 'passwort.zurueckgesetzt', beschreibung: 'Passwort über den Link aus der Mail neu gesetzt', status: 200 });
        return res.json({ success: true, message: 'Das Passwort wurde geändert. Sie können sich jetzt anmelden.' });
    } catch (error) {
        console.error('[Passwort-zuruecksetzen-Fehler]:', error);
        return res.status(500).json({ success: false, error: 'Interner Server-Fehler beim Zurücksetzen des Passworts.' });
    }
}

// Anmeldeereignisse ins Aktionsprotokoll (nur Cloud bzw. PROTOKOLL_AKTIV=true); ohne Warten und ohne Fehler für den Aufrufer.
function protokolliereAnmeldung(knex, req, daten) {
    if (!(betriebsmodus.liesBetriebsmodus().istCloud || process.env.PROTOKOLL_AKTIV === 'true')) return;
    void protokolliereKonto(knex, { ip: clientIp(req), ...daten });
}

/** POST /api/auth/notfall-zugang { schluessel, email, passwort } — Passwort eines Super-Admins mit dem Notfall-Schlüssel neu setzen (nur Cloud). */
export async function notfallZugang(knex, req, res) {
    if (!betriebsmodus.liesBetriebsmodus().istCloud) return res.status(404).json({ success: false, error: 'Nicht verfügbar.' });
    try {
        const { schluessel, email, passwort } = req.body || {};
        const ergebnis = await nutzeNotfallSchluessel(knex, { schluessel, email, passwort });
        if (!ergebnis.ok) {
            protokolliereAnmeldung(knex, req, { adresse: typeof email === 'string' ? email : null, aktion: 'notfall.fehlgeschlagen', beschreibung: 'Notfall-Zugang abgewiesen (Schlüssel oder Konto ungültig)', status: ergebnis.status });
            return res.status(ergebnis.status).json({ success: false, error: ergebnis.error });
        }
        protokolliereAnmeldung(knex, req, { konto: await findeKontoPerEmail(knex, ergebnis.email), aktion: 'notfall.verwendet', beschreibung: 'Notfall-Schlüssel benutzt: Passwort neu gesetzt, Zwei-Faktor-Anmeldung zurückgesetzt', status: 200 });
        return res.json({ success: true, message: 'Das Passwort wurde geändert und der Notfall-Schlüssel ist verbraucht. Sie können sich jetzt anmelden.' });
    } catch (error) {
        console.error('[Notfall-Zugang-Fehler]:', error);
        return res.status(500).json({ success: false, error: 'Interner Server-Fehler beim Notfall-Zugang.' });
    }
}

// --- Zweiter Faktor (Super-Admins, Cloud): POST /api/auth/2fa/pruefen | einrichtung/start | einrichtung/bestaetigen ---
const MELDUNG_ANMELDUNG_ABGELAUFEN = 'Die Anmeldung ist abgelaufen. Bitte melden Sie sich erneut an.';

async function ladeKontoFuerZweiFaktor(knex, token, zweck, res) {
    const id = leseZwischenToken(token, zweck);
    const konto = id ? await knex('benutzer').where({ id }).first() : null;
    if (!konto || !konto.ist_super_admin) {
        res.status(401).json({ success: false, error: MELDUNG_ANMELDUNG_ABGELAUFEN });
        return null;
    }
    if (konto.gesperrt) {
        res.status(403).json({ success: false, code: 'gesperrt', error: MELDUNG_KONTO_GESPERRT });
        return null;
    }
    return konto;
}

export async function zweiFaktorPruefen(knex, req, res) {
    try {
        const { zwischenToken, code } = req.body || {};
        const konto = await ladeKontoFuerZweiFaktor(knex, zwischenToken, 'pruefen', res);
        if (!konto) return;
        const ergebnis = await pruefeZweitenFaktor(knex, konto.id, code);
        if (!ergebnis.ok) {
            protokolliereAnmeldung(knex, req, { konto, aktion: 'anmeldung.2fa_fehlgeschlagen', beschreibung: 'Zwei-Faktor-Code abgelehnt', status: ergebnis.status });
            return res.status(ergebnis.status).json({ success: false, error: ergebnis.error });
        }
        protokolliereAnmeldung(knex, req, {
            konto, aktion: 'anmeldung.erfolgreich',
            beschreibung: ergebnis.art === 'backup' ? 'Angemeldet mit Zwei-Faktor (Backup-Code)' : 'Angemeldet mit Zwei-Faktor (Authenticator-App)', status: 200
        });
        const antwort = await baueAnmeldeAntwort(knex, konto);
        return res.json({ ...antwort, zweiFaktorArt: ergebnis.art, verbleibendeBackupCodes: ergebnis.verbleibendeBackupCodes });
    } catch (error) {
        console.error('[2FA-Pruefen-Fehler]:', error);
        return res.status(500).json({ success: false, error: 'Interner Server-Fehler bei der Zwei-Faktor-Anmeldung.' });
    }
}

export async function zweiFaktorEinrichtungStart(knex, req, res) {
    try {
        const konto = await ladeKontoFuerZweiFaktor(knex, (req.body || {}).zwischenToken, 'einrichtung', res);
        if (!konto) return;
        const ergebnis = await starteEinrichtung(knex, konto.id);
        if (!ergebnis.ok) return res.status(ergebnis.status).json({ success: false, error: ergebnis.error });
        return res.json({ success: true, geheimnis: ergebnis.geheimnis, otpauthUrl: ergebnis.otpauthUrl });
    } catch (error) {
        console.error('[2FA-Einrichtung-Fehler]:', error);
        return res.status(500).json({ success: false, error: 'Interner Server-Fehler bei der Einrichtung.' });
    }
}

export async function zweiFaktorEinrichtungBestaetigen(knex, req, res) {
    try {
        const { zwischenToken, code } = req.body || {};
        const konto = await ladeKontoFuerZweiFaktor(knex, zwischenToken, 'einrichtung', res);
        if (!konto) return;
        const ergebnis = await bestaetigeEinrichtung(knex, konto.id, code);
        if (!ergebnis.ok) return res.status(ergebnis.status).json({ success: false, error: ergebnis.error });
        const frisch = await knex('benutzer').where({ id: konto.id }).first();
        protokolliereAnmeldung(knex, req, { konto: frisch, aktion: '2fa.eingerichtet', beschreibung: 'Zwei-Faktor-Anmeldung eingerichtet und angemeldet', status: 200 });
        const antwort = await baueAnmeldeAntwort(knex, frisch);
        return res.json({ ...antwort, backupCodes: ergebnis.backupCodes });
    } catch (error) {
        console.error('[2FA-Bestaetigen-Fehler]:', error);
        return res.status(500).json({ success: false, error: 'Interner Server-Fehler bei der Einrichtung.' });
    }
}

/** GET /api/auth/2fa/status — Stand der Zwei-Faktor-Anmeldung des angemeldeten Kontos (Profil). */
export async function zweiFaktorStatusRoute(knex, req, res) {
    try {
        const status = await zweiFaktorStatus(knex, req.user.id);
        if (!status) return res.status(404).json({ success: false, error: 'Benutzer nicht gefunden.' });
        return res.json({ success: true, ...status });
    } catch (error) {
        console.error('[2FA-Status-Fehler]:', error);
        return res.status(500).json({ success: false, error: 'Interner Server-Fehler.' });
    }
}

/** POST /api/auth/2fa/backup-codes — neue Backup-Codes (Header X-2FA-Code: aktueller Code oder ein Backup-Code). */
export async function zweiFaktorBackupCodesRoute(knex, req, res) {
    try {
        const status = await zweiFaktorStatus(knex, req.user.id);
        if (!status || !status.istSuperAdmin || !status.aktiv) {
            return res.status(400).json({ success: false, error: 'Die Zwei-Faktor-Anmeldung ist nicht eingerichtet.' });
        }
        const pruefung = await pruefeCodeFuerAktion(knex, req.user.id, req.get('x-2fa-code'));
        if (!pruefung.ok) return res.status(pruefung.status).json({ success: false, error: pruefung.error });
        return res.json({ success: true, backupCodes: await erzeugeNeueBackupCodes(knex, req.user.id) });
    } catch (error) {
        console.error('[2FA-BackupCodes-Fehler]:', error);
        return res.status(500).json({ success: false, error: 'Interner Server-Fehler.' });
    }
}

/** Antwort einer erfolgreichen Anmeldung (Token + Benutzer mit Vereinen); gemeinsam für Login und Einladung. */
export async function baueAnmeldeAntwort(knex, user) {
    // Ein Super-Admin startet nach jeder Anmeldung im Super-Admin-Modus (Wechsel in einen Verein über die Kopfleiste).
    if (user.ist_super_admin) {
        await knex('benutzer').where({ id: user.id }).update({ super_admin_modus: true });
    }
    const token = jwt.sign(
        { id: user.id, email: user.email },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN }
    );

    const aktuellerBenutzer = await ladeBenutzerMitAktivemVerein(knex, user.id);
    const vereine = await ladeVereineFuerBenutzer(knex, user.id);

    return {
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
            super_admin_aktiv: !!aktuellerBenutzer.super_admin_aktiv,
            muss_passwort_aendern: !!user.muss_passwort_aendern,
            vereine
        }
    };
}

/**
 * Schließt eine Anmeldung nach geprüftem Passwort ab. Super-Admins brauchen in der Cloud den zweiten Faktor: statt der
 * Sitzung kommt dann ein kurzlebiges Zwischen-Token ({ zweiFaktor: 'pruefen' | 'einrichtung', zwischenToken }).
 */
export async function anmeldungAbschliessen(knex, user) {
    if (user.ist_super_admin && zweiFaktorPflicht()) {
        const zweck = user.totp_aktiv_am ? 'pruefen' : 'einrichtung';
        return { success: true, zweiFaktor: zweck, zwischenToken: erzeugeZwischenToken(user.id, zweck) };
    }
    return baueAnmeldeAntwort(knex, user);
}

export async function login(knex, req, res) {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ success: false, error: 'Email und Passwort sind erforderlich.' });
        }
        if (normalisiereEmail(email).length > MAX_EMAIL_LAENGE) {
            return res.status(400).json({ success: false, error: MELDUNG_EMAIL_ZU_LANG });
        }

        const user = await findeKontoPerEmail(knex, email);
        if (!user || !user.password_hash || !verifyPassword(password, user.password_hash)) {
            protokolliereAnmeldung(knex, req, { konto: user || null, adresse: email, aktion: 'anmeldung.fehlgeschlagen', beschreibung: 'Anmeldung fehlgeschlagen (Passwort falsch oder Konto unbekannt)', status: 401 });
            return res.status(401).json({ success: false, error: 'Ungültige Anmeldedaten.' });
        }
        // Ältere, schwächere Passwort-Prüfwerte beim erfolgreichen Login erneuern (src/utils/password.js); ein Fehler dabei stört die Anmeldung nicht
        if (brauchtNeuenHash(user.password_hash)) {
            knex('benutzer').where({ id: user.id }).update({ password_hash: hashPassword(password) })
                .catch((err) => console.error('[Login] Passwort-Prüfwert nicht erneuert:', err.message));
        }
        // Erst nach dem Passwort prüfen, damit der Zustand eines Kontos nur mit gültigen Zugangsdaten sichtbar wird.
        if (user.gesperrt) {
            protokolliereAnmeldung(knex, req, { konto: user, aktion: 'anmeldung.gesperrt', beschreibung: 'Anmeldung eines gesperrten Kontos abgewiesen', status: 403 });
            return res.status(403).json({ success: false, code: 'gesperrt', error: MELDUNG_KONTO_GESPERRT });
        }
        if (!user.email_bestaetigt_am) {
            return res.status(403).json({
                success: false,
                code: 'email_unbestaetigt',
                error: 'Bitte bestätigen Sie zuerst Ihre E-Mail-Adresse über den Link in der Bestätigungsmail.'
            });
        }

        const antwort = await anmeldungAbschliessen(knex, user);
        if (antwort.token) protokolliereAnmeldung(knex, req, { konto: user, aktion: 'anmeldung.erfolgreich', beschreibung: 'Angemeldet', status: 200 });
        return res.json(antwort);

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
                muss_passwort_aendern: !!user.muss_passwort_aendern,
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
                super_admin_aktiv: !!user.super_admin_aktiv,
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
        if (email.length > MAX_EMAIL_LAENGE) {
            return res.status(400).json({ success: false, error: MELDUNG_EMAIL_ZU_LANG });
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
            updateData.muss_passwort_aendern = false;
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
                muss_passwort_aendern: newPassword ? false : !!user.muss_passwort_aendern,
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
