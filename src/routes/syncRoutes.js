import express from 'express';

// /api/sync/status ist IMMER gemountet (auch ohne Sync, dann rolle: null) — das Frontend
// (datenzugriff.js) entscheidet anhand der Antwort zwischen REST- und Dokument-Backend.
export function getSyncRoutes(holeSync) {
    const router = express.Router();

    router.get('/status', (req, res) => {
        const sync = holeSync();
        if (!sync) return res.json({ rolle: null, instanz_id: null, turnier_id: null, db_name: null });
        return res.json(sync.status());
    });

    // Nur für die automatisierten Tests (NODE_ENV=test): deterministisch warten statt zu schlafen.
    if (process.env.NODE_ENV === 'test') {
        router.post('/test/leerlauf', async (req, res) => {
            const sync = holeSync();
            if (sync) await sync.leerlauf();
            res.json({ success: true });
        });

        // Simuliert einen Server-Neustart der Brücke: Feed wieder ab Sequenz 0 lesen.
        router.post('/test/bruecke-neustart', async (req, res) => {
            const sync = holeSync();
            if (sync) await sync.brueckeNeuStarten();
            res.json({ success: true });
        });
    }

    return router;
}
