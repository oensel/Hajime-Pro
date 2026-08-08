import express from 'express';
import {
    createMannschaft,
    getMannschaftenByTurnier,
    getMannschaftById,
    updateMannschaft,
    deleteMannschaft,
    fuegeMitgliedHinzu,
    entferneMitglied,
    verschiebeMitglied,
    getMannschaftskaempfeByPool,
    getMannschaftsPoolsByTurnier,
    verteileMannschaftenAutomatisch,
    loescheAlleMannschaftsPools
} from '../controllers/mannschaftController.js';
import { requireAuth } from '../middleware/auth.js';

export function getMannschaftRoutes(knex) {
    const router = express.Router();

    router.use(requireAuth);

    // Vor der generischen "/:id"-Route, damit "pools"/"auto-verteilen"/"pools/alle-loeschen"
    // nicht als Mannschafts-ID interpretiert werden
    router.get('/pools', (req, res) => getMannschaftsPoolsByTurnier(knex, req, res));
    router.post('/pools/alle-loeschen', (req, res) => loescheAlleMannschaftsPools(knex, req, res));
    router.post('/auto-verteilen', (req, res) => verteileMannschaftenAutomatisch(knex, req, res));

    router.get('/:id', (req, res) => getMannschaftById(knex, req, res));
    router.put('/:id', (req, res) => updateMannschaft(knex, req, res));
    router.delete('/:id', (req, res) => deleteMannschaft(knex, req, res));
    router.post('/:id/mitglieder', (req, res) => fuegeMitgliedHinzu(knex, req, res));
    router.put('/:id/mitglieder/:mitgliedId', (req, res) => verschiebeMitglied(knex, req, res));
    router.delete('/:id/mitglieder/:mitgliedId', (req, res) => entferneMitglied(knex, req, res));

    router.post('/', (req, res) => createMannschaft(knex, req, res));
    router.get('/', (req, res) => getMannschaftenByTurnier(knex, req, res));

    return router;
}

export function getMannschaftskampfRoutes(knex) {
    const router = express.Router();
    router.use(requireAuth);
    router.get('/', (req, res) => getMannschaftskaempfeByPool(knex, req, res));
    return router;
}
