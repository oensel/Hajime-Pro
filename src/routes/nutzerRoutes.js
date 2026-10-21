import express from 'express';
import { erzeugeApiRatenbegrenzung } from '../middleware/apiRatenbegrenzung.js';
import { listeNutzer, setzeSuperAdmin, listeVereine, setzeVereinBundesland, listeVereinTurniere, aendereNutzer, loescheNutzer, setzeInitialPasswort } from '../controllers/nutzerController.js';
import { requireAuth, requireSuperAdmin } from '../middleware/auth.js';

// Super-Admin-Verwaltung (Seite admin-nutzer.html): nur für Super-Admins.
export function getNutzerRoutes(knex) {
    const router = express.Router();
    router.use(erzeugeApiRatenbegrenzung(), requireAuth, requireSuperAdmin(knex));
    router.get('/', (req, res) => listeNutzer(knex, req, res));
    router.post('/:id/super-admin', (req, res) => setzeSuperAdmin(knex, req, res));
    // Benutzer bearbeiten, löschen und Initialpasswort setzen
    router.post('/:id/passwort', (req, res) => setzeInitialPasswort(knex, req, res));
    // Vereinsübersicht: Vereine mit Bundesland, Benutzer- und Turnieranzahl; Turniere je Verein
    router.get('/vereine', (req, res) => listeVereine(knex, req, res));
    router.put('/vereine/:id', (req, res) => setzeVereinBundesland(knex, req, res));
    router.get('/vereine/:id/turniere', (req, res) => listeVereinTurniere(knex, req, res));
    router.put('/:id', (req, res) => aendereNutzer(knex, req, res));
    router.delete('/:id', (req, res) => loescheNutzer(knex, req, res));
    return router;
}
