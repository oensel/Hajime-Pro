import express from 'express';
import { erzeugeAuthRatenbegrenzung } from '../middleware/authRatenbegrenzung.js';
import { pruefeEinladung, loeseEinladungEin } from '../services/orgaEinladung.js';
import { baueAnmeldeAntwort } from '../controllers/authController.js';

/**
 * Einladung für Externe (/api/einladung, öffentlich: der Token im Link trägt die Berechtigung). Ratenbegrenzt je
 * Absender (nur in der Cloud bzw. mit AUTH_RATENLIMIT_AKTIV=true, wie Registrierung und Login).
 *  - GET  /:token  → { success, email, name, vereinName, kontoVorhanden } oder 404
 *  - POST /:token  { password, vorname?, nachname? } → wie Login { success, token, user } (Konto ist danach angemeldet)
 * @param {Object} knex
 */
export function getEinladungRoutes(knex) {
    const router = express.Router();
    const grenzePruefen = erzeugeAuthRatenbegrenzung({ max: 60, endpunkt: 'einladung-pruefen' });
    const grenzeEinloesen = erzeugeAuthRatenbegrenzung({ max: 10, endpunkt: 'einladung-einloesen' });

    router.get('/:token', grenzePruefen, async (req, res) => {
        try {
            const e = await pruefeEinladung(knex, req.params.token);
            if (!e) {
                return res.status(404).json({ success: false, error: 'Der Einladungslink ist ungültig, abgelaufen oder wurde bereits verwendet.' });
            }
            res.json({ success: true, email: e.email, name: e.name, vereinName: e.vereinName, kontoVorhanden: e.kontoVorhanden });
        } catch (error) {
            console.error('[Einladung-Pruefen]:', error);
            res.status(500).json({ success: false, error: 'Interner Server-Fehler.' });
        }
    });

    router.post('/:token', grenzeEinloesen, async (req, res) => {
        try {
            const { password, vorname, nachname } = req.body || {};
            const r = await loeseEinladungEin(knex, req.params.token, { password, vorname, nachname });
            if (!r.ok) return res.status(r.status).json({ success: false, error: r.error });
            const konto = await knex('benutzer').where({ id: r.benutzerId }).first();
            res.json(await baueAnmeldeAntwort(knex, konto));
        } catch (error) {
            console.error('[Einladung-Einloesen]:', error);
            res.status(500).json({ success: false, error: 'Interner Server-Fehler.' });
        }
    });

    return router;
}
