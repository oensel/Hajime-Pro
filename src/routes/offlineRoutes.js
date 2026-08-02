import express from 'express';
import { exportMatData, importMatResults } from '../controllers/offlineController.js';
import { requireAuth, requireTournamentEditAccess, requireTurnierAktiv } from '../middleware/auth.js';

export function setupOfflineRoutes(knex) {
    const router = express.Router();

    // Ohne requireAuth bleibt req.user undefined und requireTournamentEditAccess stürzt im
    // Online-Modus beim Zugriff auf req.user.id ab (siehe QA-Bericht F1) — dieser Router lief
    // dadurch für JEDEN Nutzer mit 500 statt korrekt zu authentifizieren/autorisieren.
    router.use(requireAuth);

    router.get('/export', requireTournamentEditAccess(knex), (req, res) => exportMatData(knex, req, res));
    // Re-Import ist eine Schreiboperation am laufenden Wettkampfbetrieb -> für abgesagte/
    // abgeschlossene Turniere gesperrt (Export/Lesen bleibt zu Archivzwecken weiterhin offen).
    router.post('/import', requireTournamentEditAccess(knex), requireTurnierAktiv(knex), (req, res) => importMatResults(knex, req, res));

    return router;
}
