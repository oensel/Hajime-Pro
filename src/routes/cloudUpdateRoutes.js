import express from 'express';
import { erzeugeApiRatenbegrenzung } from '../middleware/apiRatenbegrenzung.js';
import { requireAuth, requireSuperAdmin } from '../middleware/auth.js';

// /api/cloud-update (nur Cloud, nur Super-Admin): Stand und Start des Updates aus dem öffentlichen Release-Repository
// (src/utils/cloudUpdate.js). Der Start kehrt sofort zurück, der Status zeigt den Fortschritt.
export function getCloudUpdateRoutes(knex, cloudUpdate) {
    const router = express.Router();
    router.use(erzeugeApiRatenbegrenzung(), requireAuth, requireSuperAdmin(knex));
    const antworte = (fn) => async (req, res) => {
        try {
            res.json(await fn(req));
        } catch (err) {
            res.status(err.status || 500).json({ success: false, error: err.message });
        }
    };
    router.get('/status', antworte(() => cloudUpdate.status()));
    router.post('/start', antworte(() => cloudUpdate.starte()));
    return router;
}
