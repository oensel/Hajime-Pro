import express from 'express';
import { register, emailBestaetigen, emailBestaetigungErneut, login, getMe, updateProfile, getAuthMode, verifyPasswordEndpoint, aendereSteuerungPasswort, passwortVergessen, passwortZuruecksetzen, notfallZugang, zweiFaktorPruefen, zweiFaktorEinrichtungStart, zweiFaktorEinrichtungBestaetigen, zweiFaktorStatusRoute, zweiFaktorBackupCodesRoute } from '../controllers/authController.js';
import { requireAuth, requireSteuerungPasswort } from '../middleware/auth.js';
import { erzeugeAuthRatenbegrenzung } from '../middleware/authRatenbegrenzung.js';
import { erzeugeApiRatenbegrenzung } from '../middleware/apiRatenbegrenzung.js';

export function getAuthRoutes(knex) {
    const router = express.Router();
    // je 10 Minuten: je Absender, Bestätigungsmail zusätzlich je Adresse, Login zusätzlich je Adresse+Absender und je Adresse (nur in der Cloud bzw. mit AUTH_RATENLIMIT_AKTIV=true)
    const grenzeRegistrierung = erzeugeAuthRatenbegrenzung({ max: 10 });
    const grenzeErneut = erzeugeAuthRatenbegrenzung({ max: 10 });
    const grenzeErneutAdresse = erzeugeAuthRatenbegrenzung({ max: 3, schluessel: 'email', endpunkt: 'email-bestaetigung-erneut' });
    const grenzeVergessen = erzeugeAuthRatenbegrenzung({ max: 10, endpunkt: 'passwort-vergessen' });
    const grenzeVergessenAdresse = erzeugeAuthRatenbegrenzung({ max: 3, schluessel: 'email', endpunkt: 'passwort-vergessen' });
    const grenzeZuruecksetzen = erzeugeAuthRatenbegrenzung({ max: 10, endpunkt: 'passwort-zuruecksetzen' });
    // Notfall-Schlüssel: sehr streng (5 Versuche je 10 Minuten und Absender); der Schlüssel ist ohnehin nicht zu erraten
    const grenzeNotfall = erzeugeAuthRatenbegrenzung({ max: 5, endpunkt: 'notfall-zugang' });
    // zweiter Faktor: 10 Eingaben je 10 Minuten und Absender, dazu 5 Fehlversuche je Konto (src/services/zweiFaktor.js)
    const grenzeZweiFaktor = erzeugeAuthRatenbegrenzung({ max: 10, endpunkt: '2fa' });
    const grenzeLogin = erzeugeAuthRatenbegrenzung({ max: 30 });
    const grenzeLoginAdresse = erzeugeAuthRatenbegrenzung({ max: 10, schluessel: 'email+ip', endpunkt: 'login' });
    // weiches Konto-Limit gegen verteiltes Passwort-Raten (höchstens 360 Versuche je Stunde und Konto)
    const grenzeLoginKonto = erzeugeAuthRatenbegrenzung({ max: 60, schluessel: 'email', endpunkt: 'login-konto' });

    const grenzeAngemeldet = erzeugeApiRatenbegrenzung();

    router.post('/register', grenzeRegistrierung, (req, res) => register(knex, req, res));
    router.post('/email-bestaetigen', (req, res) => emailBestaetigen(knex, req, res));
    router.post('/email-bestaetigung-erneut', grenzeErneut, grenzeErneutAdresse, (req, res) => emailBestaetigungErneut(knex, req, res));
    router.post('/passwort-vergessen', grenzeVergessen, grenzeVergessenAdresse, (req, res) => passwortVergessen(knex, req, res));
    router.post('/passwort-zuruecksetzen', grenzeZuruecksetzen, (req, res) => passwortZuruecksetzen(knex, req, res));
    router.post('/notfall-zugang', grenzeNotfall, (req, res) => notfallZugang(knex, req, res));
    router.post('/2fa/pruefen', grenzeZweiFaktor, (req, res) => zweiFaktorPruefen(knex, req, res));
    router.post('/2fa/einrichtung/start', grenzeZweiFaktor, (req, res) => zweiFaktorEinrichtungStart(knex, req, res));
    router.post('/2fa/einrichtung/bestaetigen', grenzeZweiFaktor, (req, res) => zweiFaktorEinrichtungBestaetigen(knex, req, res));
    router.get('/2fa/status', grenzeAngemeldet, requireAuth, (req, res) => zweiFaktorStatusRoute(knex, req, res));
    router.post('/2fa/backup-codes', grenzeZweiFaktor, requireAuth, (req, res) => zweiFaktorBackupCodesRoute(knex, req, res));
    router.post('/login', grenzeAngemeldet, grenzeLogin, grenzeLoginAdresse, grenzeLoginKonto, (req, res) => login(knex, req, res));
    router.get('/me', grenzeAngemeldet, requireAuth, (req, res) => getMe(knex, req, res));
    router.put('/profile', grenzeAngemeldet, requireAuth, (req, res) => updateProfile(knex, req, res));
    router.get('/mode', (req, res) => getAuthMode(knex, req, res));
    router.post('/verify', (req, res) => verifyPasswordEndpoint(knex, req, res));
    router.post('/steuerung-passwort', grenzeAngemeldet, requireSteuerungPasswort, (req, res) => aendereSteuerungPasswort(knex, req, res));

    return router;
}
