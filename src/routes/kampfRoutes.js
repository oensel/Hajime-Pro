import express from 'express';
import {
    createKampf,
    getKaempfe,
    getKampf,
    updateKampf,
    deleteKampf,
    updateKampfColor,
    tauscheKaempfeReihenfolge
} from '../controllers/kampfController.js';
import { requireAuth, requireTournamentEditAccess, requireTurnierAktiv } from '../middleware/auth.js';

export function getKampfRoutes(knex) {
    const router = express.Router();

    router.use(requireAuth);

    // requireTurnierAktiv nur auf schreibende Routen — GET bleibt für abgesagte/abgeschlossene
    // Turniere weiterhin lesbar (Ergebnisansicht, Archiv).
    const aktiv = requireTurnierAktiv(knex);

    router.post('/', requireTournamentEditAccess(knex), aktiv, (req, res) => createKampf(knex, req, res));
    router.get('/', requireTournamentEditAccess(knex), (req, res) => getKaempfe(knex, req, res));

    // Vor der generischen "/:id"-Route, damit "reihenfolge-tauschen" nicht als ID interpretiert wird
    router.put('/reihenfolge-tauschen', requireTournamentEditAccess(knex), aktiv, (req, res) => tauscheKaempfeReihenfolge(knex, req, res));

    router.get('/:id', requireTournamentEditAccess(knex), (req, res) => getKampf(knex, req, res));
    router.put('/:id', requireTournamentEditAccess(knex), aktiv, (req, res) => updateKampf(knex, req, res));
    router.put('/:id/color', requireTournamentEditAccess(knex), aktiv, (req, res) => updateKampfColor(knex, req, res));
    router.delete('/:id', requireTournamentEditAccess(knex), aktiv, (req, res) => deleteKampf(knex, req, res));

    return router;
}
