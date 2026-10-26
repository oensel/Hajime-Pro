import express from 'express';
import { requireAuth, requireTournamentEditAccess } from '../middleware/auth.js';
import { erzeugeZahlwegController } from '../controllers/zahlwegController.js';

// Startgeld-Zahlweg: Anmelder (eigener Verein) und Kasse (Ausrichter), siehe zahlwegController.js.
export function getZahlwegRoutes(knex) {
    const router = express.Router();
    const c = erzeugeZahlwegController(knex);

    router.use(requireAuth);

    // Kasse zuerst (spezifischere Pfade); Zugriff nur für den Ausrichter (Rolle ab benutzer), Super-Admin im Modus
    router.get('/:turnierId/kasse', requireTournamentEditAccess(knex), c.kasse);
    router.post('/:turnierId/kasse/bar-kassiert', requireTournamentEditAccess(knex), c.kassiereBar);
    router.post('/:turnierId/vor-ort', requireTournamentEditAccess(knex), c.erfasseVorOrt);

    router.get('/:turnierId', c.lese);
    router.put('/:turnierId', c.speichere);

    return router;
}
