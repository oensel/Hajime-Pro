import express from 'express';
import { requireWriteAuth } from '../middleware/auth.js';

// /api/cluster (Spec Abschnitt 9). Ohne Cluster liefert /status { aktiv: false } — das Frontend
// blendet Cluster-Seite und Secondary-Banner dann aus.
//
// /gesund, /befoerdern und /zurueckstufen ruft keepalived auf dem eigenen Server auf (nur von
// localhost). /uebergabe-ankuendigen ruft der Partner-Server auf (SYNC_SECRET). /uebergeben ist
// die geplante Übergabe aus der Cluster-Seite (Turnierleitung, Steuerungs-Passwort).
const LOCALHOST = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export function getClusterRoutes(holeCluster, { secret }) {
    const router = express.Router();

    const nurLocalhost = (req, res, next) => {
        if (!LOCALHOST.has(req.socket.remoteAddress)) return res.status(403).json({ success: false, error: 'Nur von localhost.' });
        next();
    };
    const nurPartner = (req, res, next) => {
        if (secret && req.headers['x-hajime-sync-secret'] !== secret) return res.status(401).json({ success: false, error: 'SYNC_SECRET fehlt oder ist falsch.' });
        next();
    };
    const mitCluster = (req, res, next) => {
        req.cluster = holeCluster();
        if (!req.cluster) return res.status(404).json({ success: false, error: 'Kein Cluster konfiguriert.' });
        next();
    };
    const antworte = (fn) => async (req, res) => {
        try {
            res.json(await fn(req));
        } catch (err) {
            res.status(err.status || 500).json({ success: false, error: err.message });
        }
    };

    router.get('/status', async (req, res) => {
        const cluster = holeCluster();
        if (!cluster) return res.json({ aktiv: false });
        if (req.query.nurEigen) return res.json(await cluster.eigenerStatus());
        res.json(await cluster.status());
    });

    router.get('/gesund', nurLocalhost, mitCluster, async (req, res) => {
        const g = await req.cluster.gesundheit();
        res.status(g.gesund ? 200 : 503).json(g);
    });

    router.post('/befoerdern', nurLocalhost, mitCluster, antworte(req => req.cluster.befoerdern()));
    router.post('/zurueckstufen', nurLocalhost, mitCluster, antworte(req => req.cluster.zurueckstufen()));
    router.post('/uebergabe-ankuendigen', nurPartner, mitCluster, antworte(async (req) => {
        req.cluster.kuendigeUebergabeAn();
        return { success: true };
    }));
    router.post('/uebergeben', requireWriteAuth, mitCluster, antworte(req => req.cluster.uebergeben()));

    return router;
}
