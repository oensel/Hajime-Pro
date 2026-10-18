import express from 'express';
import { erzeugeApiRatenbegrenzung } from '../middleware/apiRatenbegrenzung.js';
import { requireAuth } from '../middleware/auth.js';
import {
    ladeMeineRoute, meineErledigtRoute, mitbringlisteAnlegenRoute, mitbringlisteAendernRoute, mitbringlisteLoeschenRoute
} from '../controllers/orgaController.js';

/**
 * Orga-Aufgaben in der Helfer-App (/api/helfer/orga): eigene Aufgaben abhaken, Mitbringliste pflegen.
 * Jede Route prüft selbst (Eigentümer bzw. Mitgliedschaft im Verein des Turniers). Nur dort gemountet, wo auch
 * /api/helfer gemountet ist (Cloud oder HELFER_APP_AKTIV=true).
 * @param {Object} knex
 */
export function getOrgaHelferRoutes(knex) {
    const router = express.Router();
    router.use(erzeugeApiRatenbegrenzung(), requireAuth);

    router.get('/meine', (req, res) => ladeMeineRoute(knex, req, res));
    router.post('/aufgaben/:id/erledigt', (req, res) => meineErledigtRoute(knex, req, res));
    router.post('/mitbringliste', (req, res) => mitbringlisteAnlegenRoute(knex, req, res));
    router.put('/mitbringliste/:id', (req, res) => mitbringlisteAendernRoute(knex, req, res));
    router.delete('/mitbringliste/:id', (req, res) => mitbringlisteLoeschenRoute(knex, req, res));

    return router;
}
