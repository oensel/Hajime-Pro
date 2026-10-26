import express from 'express';
import { erzeugeApiRatenbegrenzung } from '../middleware/apiRatenbegrenzung.js';
import { erzeugeMandatController } from '../controllers/mandatController.js';

// Mandatsbestätigung per Mail-Link: bewusst ohne requireAuth/requireWriteAuth, der Einmal-Token trägt die
// Berechtigung (wie /api/freigabe). Eigene, engere Ratenbegrenzung gegen Raten von Links.
export function getMandatRoutes(knex) {
    const router = express.Router();
    const c = erzeugeMandatController(knex);
    router.use(erzeugeApiRatenbegrenzung({ max: 60 }));
    router.get('/:token', c.zeige);
    router.post('/:token', c.entscheide);
    return router;
}
