import express from 'express';
import {
    createTeilnehmer,
    getTeilnehmerByTurnier,
    deleteTeilnehmer,
    ziehZurueck,
    getTeilnehmerById,
    updateTeilnehmer,
    aendereStatusFelder,
    bestaetigeKampfbereit,
    markiereNichtAngetreten,
    disqualifiziere,
    importTeilnehmer,
    previewTeilnehmerImport,
    downloadImportVorlage
} from '../controllers/teilnehmerController.js';
import { requireAuth } from '../middleware/auth.js';

export function getTeilnehmerRoutes(knex) {
    const router = express.Router();

    router.use(requireAuth);

    // Bulk import
    router.post('/import', (req, res) => importTeilnehmer(knex, req, res));
    router.post('/import-vorschau', (req, res) => previewTeilnehmerImport(knex, req, res));
    router.get('/import-vorlage', (req, res) => downloadImportVorlage(req, res));

    // Specific ID routes
    router.get('/:id', (req, res) => getTeilnehmerById(knex, req, res));
    router.put('/:id', (req, res) => updateTeilnehmer(knex, req, res));
    router.put('/:id/status', (req, res) => aendereStatusFelder(knex, req, res));
    router.post('/:id/kampfbereit', (req, res) => bestaetigeKampfbereit(knex, req, res));
    router.post('/:id/zurueckziehen', (req, res) => ziehZurueck(knex, req, res));
    router.post('/:id/nicht-angetreten', (req, res) => markiereNichtAngetreten(knex, req, res));
    router.post('/:id/disqualifizieren', (req, res) => disqualifiziere(knex, req, res));
    router.delete('/:id', (req, res) => deleteTeilnehmer(knex, req, res));

    // General collection routes
    router.post('/', (req, res) => createTeilnehmer(knex, req, res));
    router.get('/', (req, res) => getTeilnehmerByTurnier(knex, req, res));

    return router;
}
