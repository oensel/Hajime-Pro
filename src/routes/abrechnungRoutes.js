import express from 'express';
import { requireAuth, requireTournamentEditAccess, requireTurnierAdmin } from '../middleware/auth.js';
import { erzeugeAbrechnungController } from '../controllers/abrechnungController.js';
import { sendeMail } from '../utils/mailer.js';

// Startgeld-Abrechnung: Stammdaten des Ausrichters, Übersicht, Rechnungslauf und Zahlstatus (siehe abrechnungController.js).
// Rechnungen werden nie gelöscht (Belege): es gibt bewusst keine DELETE-Route.
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
    router.post('/:turnierId/rechnungen', requireTurnierAdmin(knex), c.erstelleRechnungen);
    router.post('/:turnierId/rechnungen/:rechnungId/senden', requireTurnierAdmin(knex), c.sendeErneut);
    router.post('/:turnierId/rechnungen/:rechnungId/bezahlt', requireTurnierAdmin(knex), c.setzeBezahlt);
    router.get('/:turnierId/rechnungen/:rechnungId/pdf', requireTurnierAdmin(knex), c.ladePdf);
    router.get('/:turnierId/sepa', requireTurnierAdmin(knex), c.listeSepa);
    router.post('/:turnierId/sepa', requireTurnierAdmin(knex), c.erzeugeSepa);

    return router;
}
