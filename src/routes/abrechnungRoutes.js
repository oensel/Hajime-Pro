import express from 'express';
import { requireAuth, requireTournamentEditAccess, requireTurnierAdmin } from '../middleware/auth.js';
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

    router.get('/:turnierId', requireTurnierAdmin(knex), c.lade);
    router.post('/:turnierId/zuordnen', requireTurnierAdmin(knex), c.ordneZu);
    router.post('/:turnierId/rechnungsdaten', requireTurnierAdmin(knex), c.erfasseRechnungsdaten);
    router.post('/:turnierId/rueckspielen-freigeben', requireTurnierAdmin(knex), c.gibRueckspielenFrei);

    return router;
}
