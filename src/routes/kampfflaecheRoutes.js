import express from 'express';
import {
    createKampfflaeche,
    getKampfflaechen,
    getKampfflaeche,
    updateKampfflaeche,
    deleteKampfflaeche,
    pausiereKampfflaeche,
    setzeKampfflaecheFort,
    sperreKampfflaeche,
    entsperreKampfflaeche
} from '../controllers/kampfflaecheController.js';
import { requireAuth, requireTournamentEditAccess, requireTurnierAktiv } from '../middleware/auth.js';

export function getKampfflaecheRoutes(knex) {
    const router = express.Router();

    router.use(requireAuth);

    // requireTurnierAktiv nur auf schreibende Routen — GET bleibt für abgesagte/abgeschlossene
    // Turniere weiterhin lesbar (Ergebnisansicht, Archiv).
    const aktiv = requireTurnierAktiv(knex);

    router.post('/', requireTournamentEditAccess(knex), aktiv, (req, res) => createKampfflaeche(knex, req, res));
    router.get('/', requireTournamentEditAccess(knex), (req, res) => getKampfflaechen(knex, req, res));

    router.get('/:id', requireTournamentEditAccess(knex), (req, res) => getKampfflaeche(knex, req, res));
    router.put('/:id', requireTournamentEditAccess(knex), aktiv, (req, res) => updateKampfflaeche(knex, req, res));
    router.post('/:id/pausieren', requireTournamentEditAccess(knex), aktiv, (req, res) => pausiereKampfflaeche(knex, req, res));
    router.post('/:id/fortsetzen', requireTournamentEditAccess(knex), aktiv, (req, res) => setzeKampfflaecheFort(knex, req, res));
    router.post('/:id/sperren', requireTournamentEditAccess(knex), aktiv, (req, res) => sperreKampfflaeche(knex, req, res));
    router.post('/:id/entsperren', requireTournamentEditAccess(knex), aktiv, (req, res) => entsperreKampfflaeche(knex, req, res));
    router.delete('/:id', requireTournamentEditAccess(knex), aktiv, (req, res) => deleteKampfflaeche(knex, req, res));

    return router;
}
