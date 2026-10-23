import express from 'express';
import jwt from 'jsonwebtoken';
import { erzeugeApiRatenbegrenzung } from '../middleware/apiRatenbegrenzung.js';
import { erzeugeAuthRatenbegrenzung } from '../middleware/authRatenbegrenzung.js';
import { requireAuth, requireSuperAdmin } from '../middleware/auth.js';
import { listeFehler } from '../services/fehlerProtokoll.js';

const text = (wert, max) => (typeof wert === 'string' ? wert.slice(0, max) : '');

/**
 * POST /api/fehler/browser (auch ohne Anmeldung, damit Fehler der Anmeldeseite ankommen): meldet einen Fehler aus dem Browser.
 * Streng begrenzt (20 je 10 Minuten und Absender), Felder werden gekürzt; ein gültiges Token ordnet die Meldung der E-Mail des Kontos zu.
 */
export function getFehlerMeldeRoutes(erfasse) {
    const router = express.Router();
    const grenze = erzeugeAuthRatenbegrenzung({ max: 20, endpunkt: 'fehler-browser' });
    router.post('/browser', grenze, (req, res) => {
        const body = req.body || {};
        const meldung = text(body.meldung, 500).trim();
        if (!meldung) return res.status(400).json({ success: false, error: 'Meldung fehlt.' });
        let benutzer = null;
        const auth = req.headers.authorization;
        if (auth && auth.startsWith('Bearer ')) {
            try { benutzer = jwt.verify(auth.slice(7), process.env.JWT_SECRET || 'hajime_pro_secret_key_123456!').email || null; } catch { /* anonym */ }
        }
        const stack = text(body.stack, 4000);
        const seite = text(body.url, 300);
        erfasse('error', 'browser', [`${meldung}${stack ? `\n${stack}` : ''}`], { pfad: seite, benutzer });
        res.status(204).end();
    });
    return router;
}

// /api/konsole (nur Super-Admin im Super-Admin-Modus): GET liefert die Einträge (Filter ebene, quelle, suche; nach = nur neuere als diese ID für
// die Live-Ansicht, vor = ältere; gruppiert=1 fasst gleiche Meldungen zusammen), DELETE leert das Fehlerprotokoll.
export function getKonsoleRoutes(knex) {
    const router = express.Router();
    router.use(erzeugeApiRatenbegrenzung(), requireAuth, requireSuperAdmin(knex));
    router.get('/', async (req, res) => {
        try {
            const q = req.query;
            res.json({
                success: true,
                ...(await listeFehler(knex, {
                    ebene: q.ebene, quelle: q.quelle, suche: typeof q.suche === 'string' ? q.suche : '', nach: q.nach, vor: q.vor,
                    limit: q.limit, gruppiert: q.gruppiert === '1'
                }))
            });
        } catch (err) {
            console.error('[Konsole-Fehler]:', err);
            res.status(500).json({ success: false, error: 'Die Konsole konnte nicht geladen werden.' });
        }
    });
    router.delete('/', async (_req, res) => {
        try {
            res.json({ success: true, geloescht: await knex('fehlerprotokoll').del() });
        } catch (err) {
            console.error('[Konsole-Leeren-Fehler]:', err);
            res.status(500).json({ success: false, error: 'Die Konsole konnte nicht geleert werden.' });
        }
    });
    return router;
}
