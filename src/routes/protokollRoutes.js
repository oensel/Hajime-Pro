import express from 'express';
import { erzeugeApiRatenbegrenzung } from '../middleware/apiRatenbegrenzung.js';
import { requireAuth } from '../middleware/auth.js';
import { istSuperAdminAktiv, ladeVereinIdsMitRolle } from '../utils/vereinHelper.js';
import { listeProtokoll, ROLLEN_ANZEIGE } from '../services/aktionsProtokoll.js';

// GET /api/protokoll (nur Cloud): das Aktionsprotokoll. Super-Admins im Super-Admin-Modus sehen alle Einträge, Admins nur die der Vereine,
// in denen sie Admin sind; alle anderen Rollen haben keinen Zugriff. Filter: seite, von/bis (JJJJ-MM-TT), benutzer, suche, vereinId.
// GET /api/protokoll/vereine liefert die wählbaren Vereine für den Filter.
export function getProtokollRoutes(knex) {
    const router = express.Router();
    router.use(erzeugeApiRatenbegrenzung(), requireAuth);

    async function ermittleScope(req, res) {
        const benutzer = await knex('benutzer').where({ id: req.user.id }).first();
        if (istSuperAdminAktiv(benutzer)) return { superAdmin: true, vereinIds: [] };
        const vereinIds = await ladeVereinIdsMitRolle(knex, req.user.id, 'admin');
        if (vereinIds.length === 0) {
            res.status(403).json({ success: false, error: 'Das Protokoll sehen nur Admins ihres Vereins und Super-Admins.' });
            return null;
        }
        return { superAdmin: false, vereinIds };
    }

    router.get('/vereine', async (req, res) => {
        try {
            const scope = await ermittleScope(req, res);
            if (!scope) return;
            const vereine = await knex('vereine').modify((q) => { if (!scope.superAdmin) q.whereIn('id', scope.vereinIds); })
                .select('id', 'name').orderBy('name');
            res.json({ success: true, superAdmin: scope.superAdmin, vereine });
        } catch (err) {
            console.error('[Protokoll-Vereine-Fehler]:', err);
            res.status(500).json({ success: false, error: 'Die Vereine konnten nicht geladen werden.' });
        }
    });

    router.get('/', async (req, res) => {
        try {
            const scope = await ermittleScope(req, res);
            if (!scope) return;
            const q = req.query;
            const vereinId = /^\d+$/.test(String(q.vereinId ?? '')) ? Number(q.vereinId) : null;
            if (vereinId != null && !scope.superAdmin && !scope.vereinIds.includes(vereinId)) {
                return res.status(403).json({ success: false, error: 'Für diesen Verein haben Sie kein Protokoll.' });
            }
            const ergebnis = await listeProtokoll(knex, scope, {
                seite: q.seite, proSeite: q.proSeite, von: q.von, bis: q.bis,
                benutzer: typeof q.benutzer === 'string' ? q.benutzer : '', suche: typeof q.suche === 'string' ? q.suche : '', vereinId
            });
            res.json({ success: true, rollen: ROLLEN_ANZEIGE, ...ergebnis });
        } catch (err) {
            console.error('[Protokoll-Fehler]:', err);
            res.status(500).json({ success: false, error: 'Das Protokoll konnte nicht geladen werden.' });
        }
    });

    return router;
}
