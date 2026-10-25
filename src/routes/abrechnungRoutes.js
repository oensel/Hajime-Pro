import express from 'express';
import { requireAuth, requireTournamentEditAccess } from '../middleware/auth.js';
import { erzeugeAbrechnungController } from '../controllers/abrechnungController.js';
import { sendeMail } from '../utils/mailer.js';

// Startgeld-Abrechnung: Stammdaten des Ausrichters, später Rechnungen (siehe abrechnungController.js).
export function getAbrechnungRoutes(knex, { sende = sendeMail } = {}) {
    const router = express.Router();
    const c = erzeugeAbrechnungController(knex, { sende });

    router.use(requireAuth);

    router.get('/stammdaten-pruefung/:turnierId', requireTournamentEditAccess(knex), c.pruefeStammdaten);
    router.get('/stammdaten/:vereinId', c.leseStammdaten);
    router.put('/stammdaten/:vereinId', c.speichereStammdaten);

    return router;
}
