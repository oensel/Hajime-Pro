import express from 'express';
import { createTurnier, updateTurnier, getTurnier, getTurniere, deleteTurnier, exportTurnier, importTurnier, importTurnierErgebnisse, veroeffentlicheTurnier, sageTurnierAb, beendeDurchfuehrung } from '../controllers/turnierController.js';
import { requireAuth, requireTournamentEditAccess, requireVereinFreigabe } from '../middleware/auth.js';

export function getTurnierRoutes(knex) {
    const router = express.Router();

    router.use(requireAuth);

    router.get('/', (req, res) => getTurniere(knex, req, res));
    router.post('/', requireVereinFreigabe(knex), (req, res) => createTurnier(knex, req, res));

    // Import vor der generischen "/:id"-Route, damit "import" nicht als ID interpretiert wird
    router.post('/import', (req, res) => importTurnier(knex, req, res));

    // Export vor der generischen "/:id"-Route, damit "export" nicht als ID interpretiert wird
    router.get('/:id/export', (req, res) => exportTurnier(knex, req, res));

    // Ergebnisse eines offline durchgeführten Turniers hochladen (nur online, Vereinsprüfung
    // erfolgt im Controller selbst, da sie strenger ist als requireTournamentEditAccess)
    router.post('/:id/import-ergebnisse', (req, res) => importTurnierErgebnisse(knex, req, res));

    // Lebenszyklus-Übergänge (Zustände 2/5/6 der Spezifikation)
    router.post('/:id/veroeffentlichen', requireTournamentEditAccess(knex), requireVereinFreigabe(knex), (req, res) => veroeffentlicheTurnier(knex, req, res));
    router.post('/:id/absagen', requireTournamentEditAccess(knex), requireVereinFreigabe(knex), (req, res) => sageTurnierAb(knex, req, res));
    router.post('/:id/durchfuehrung-beenden', requireTournamentEditAccess(knex), requireVereinFreigabe(knex), (req, res) => beendeDurchfuehrung(knex, req, res));

    // View specific tournament details (allowed for any authenticated user)
    router.get('/:id', (req, res) => getTurnier(knex, req, res));

    // Bearbeiten und Löschen: einzige Regel ist die Zugehörigkeit zum ausrichtenden Verein
    router.put('/:id', requireTournamentEditAccess(knex), requireVereinFreigabe(knex), (req, res) => updateTurnier(knex, req, res));
    router.delete('/:id', requireTournamentEditAccess(knex), requireVereinFreigabe(knex), (req, res) => deleteTurnier(knex, req, res));

    return router;
}
