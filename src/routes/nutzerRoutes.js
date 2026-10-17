import express from 'express';
import { listeNutzer, setzeSuperAdmin } from '../controllers/nutzerController.js';
import { requireAuth, requireSuperAdmin } from '../middleware/auth.js';

// Super-Admin-Verwaltung (Seite admin-nutzer.html): nur für Super-Admins.
export function getNutzerRoutes(knex) {
    const router = express.Router();
    router.use(requireAuth, requireSuperAdmin(knex));
    router.get('/', (req, res) => listeNutzer(knex, req, res));
    router.post('/:id/super-admin', (req, res) => setzeSuperAdmin(knex, req, res));
    return router;
}
