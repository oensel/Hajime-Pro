import express from 'express';
import {
    createTurnier, updateTurnier, getTurnier, getTurniere, deleteTurnier,
    veroeffentlicheTurnier, sageTurnierAb, beendeDurchfuehrung, importTurnier, exportTurnier
} from '../../controllers/offline/turnierController.js';
import { requireAuth } from '../../middleware/auth.js';

// Offline-Pendant zu src/routes/turnierRoutes.js -- noch NICHT in app.js eingehängt (siehe
// Plan). requireAuth ist die einzige Middleware: requireTournamentEditAccess und
// requireVereinFreigabe sind im Offline-Betrieb bereits heute reine No-Ops (siehe
// src/middleware/auth.js), eine Online-Mehrbenutzer-Berechtigungsprüfung ergibt für den
// Single-Tenant-Offline-Betrieb keinen Sinn. ausschreibung/import-ergebnisse sind bewusst
// nicht Teil dieser Datei -- eigener Folgeplan.
export function getTurnierRoutesOffline(turnierDbRegistry) {
    const router = express.Router();
    router.use(requireAuth);

    router.get('/', (req, res) => getTurniere(turnierDbRegistry, req, res));
    router.post('/', (req, res) => createTurnier(turnierDbRegistry, req, res));

    // Import vor der generischen "/:id"-Route, damit "import" nicht als ID interpretiert wird
    router.post('/import', (req, res) => importTurnier(turnierDbRegistry, req, res));

    router.post('/:id/veroeffentlichen', (req, res) => veroeffentlicheTurnier(turnierDbRegistry, req, res));
    router.post('/:id/absagen', (req, res) => sageTurnierAb(turnierDbRegistry, req, res));
    router.post('/:id/durchfuehrung-beenden', (req, res) => beendeDurchfuehrung(turnierDbRegistry, req, res));

    // Export vor der generischen "/:id"-Route, damit "export" nicht als ID interpretiert wird
    router.get('/:id/export', (req, res) => exportTurnier(turnierDbRegistry, req, res));

    router.get('/:id', (req, res) => getTurnier(turnierDbRegistry, req, res));
    router.put('/:id', (req, res) => updateTurnier(turnierDbRegistry, req, res));
    router.delete('/:id', (req, res) => deleteTurnier(turnierDbRegistry, req, res));

    return router;
}
