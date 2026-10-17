import express from 'express';
import { register, emailBestaetigen, emailBestaetigungErneut, login, getMe, updateProfile, getAuthMode, verifyPasswordEndpoint, aendereSteuerungPasswort } from '../controllers/authController.js';
import { requireAuth, requireSteuerungPasswort } from '../middleware/auth.js';
import { erzeugeAuthRatenbegrenzung } from '../middleware/authRatenbegrenzung.js';

export function getAuthRoutes(knex) {
    const router = express.Router();
    // je Absender bzw. je E-Mail-Adresse und 10 Minuten (nur in der Cloud bzw. mit AUTH_RATENLIMIT_AKTIV=true)
    const grenzeRegistrierung = erzeugeAuthRatenbegrenzung({ max: 10 });
    const grenzeErneut = erzeugeAuthRatenbegrenzung({ max: 10 });
    const grenzeErneutAdresse = erzeugeAuthRatenbegrenzung({ max: 10, schluessel: 'email' });
    const grenzeLogin = erzeugeAuthRatenbegrenzung({ max: 30 });
    const grenzeLoginAdresse = erzeugeAuthRatenbegrenzung({ max: 10, schluessel: 'email' });

    router.post('/register', grenzeRegistrierung, (req, res) => register(knex, req, res));
    router.post('/email-bestaetigen', (req, res) => emailBestaetigen(knex, req, res));
    router.post('/email-bestaetigung-erneut', grenzeErneut, grenzeErneutAdresse, (req, res) => emailBestaetigungErneut(knex, req, res));
    router.post('/login', grenzeLogin, grenzeLoginAdresse, (req, res) => login(knex, req, res));
    router.get('/me', requireAuth, (req, res) => getMe(knex, req, res));
    router.put('/profile', requireAuth, (req, res) => updateProfile(knex, req, res));
    router.get('/mode', (req, res) => getAuthMode(knex, req, res));
    router.post('/verify', (req, res) => verifyPasswordEndpoint(knex, req, res));
    router.post('/steuerung-passwort', requireSteuerungPasswort, (req, res) => aendereSteuerungPasswort(knex, req, res));

    return router;
}
