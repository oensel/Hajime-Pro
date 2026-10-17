import express from 'express';
import { zeigeFreigabe, entscheideFreigabe } from '../controllers/freigabeController.js';

// Freischaltung per Mail-Link: bewusst ohne requireAuth, der Einmal-Token trägt die Berechtigung.
export function getFreigabeRoutes(knex) {
    const router = express.Router();
    router.get('/:token', (req, res) => zeigeFreigabe(knex, req, res));
    router.post('/:token', (req, res) => entscheideFreigabe(knex, req, res));
    return router;
}
