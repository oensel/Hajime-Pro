import express from 'express';
import { erzeugeApiRatenbegrenzung } from '../middleware/apiRatenbegrenzung.js';
import { requireAuth, requireTournamentEditAccess } from '../middleware/auth.js';
import {
    pruefeAufgabeVorhanden, ladeOrgaRoute, legeAufgabeAnRoute, aendereAufgabeRoute, loescheAufgabeRoute,
    setzeErledigtRoute, weiseZuRoute, einladungErneutRoute, vorlageNachladenRoute, ladeMitgliederRoute
} from '../controllers/orgaController.js';

/**
 * Orga-Planer der Orga (/api/orga): Super-Admin sowie Admins/Benutzer des ausrichtenden Vereins
 * (requireTournamentEditAccess), im Einzelbenutzerbetrieb offen (Schreiben hinter requireWriteAuth, in app.js).
 * Bewusst ohne requireTurnierAktiv: Aufgaben der Nachbereitung fallen nach dem Turnier an.
 * @param {Object} knex
 * @param {{ sende?: Function }} [optionen] - Mailversand (Tests)
 */
export function getOrgaRoutes(knex, { sende } = {}) {
    const router = express.Router();
    router.use(erzeugeApiRatenbegrenzung(), requireAuth);
    // turnierId außerhalb des int4-Bereichs: 404 statt Datenbankfehler im Gate
    router.use((req, res, next) => {
        const t = req.query.turnierId ?? req.body?.turnierId ?? req.body?.turnier_id;
        if (t != null && !(/^\d+$/.test(String(t)) && Number(t) <= 2147483647)) {
            return res.status(404).json({ success: false, error: 'Turnier nicht gefunden.' });
        }
        next();
    });

    const gate = requireTournamentEditAccess(knex);
    const mitAufgabe = [pruefeAufgabeVorhanden(knex), gate];

    router.get('/', gate, (req, res) => ladeOrgaRoute(knex, req, res));
    router.get('/mitglieder', gate, (req, res) => ladeMitgliederRoute(knex, req, res));
    router.post('/vorlage-nachladen', gate, (req, res) => vorlageNachladenRoute(knex, req, res));
    router.post('/aufgaben', gate, (req, res) => legeAufgabeAnRoute(knex, req, res));
    router.put('/aufgaben/:id', ...mitAufgabe, (req, res) => aendereAufgabeRoute(knex, req, res));
    router.delete('/aufgaben/:id', ...mitAufgabe, (req, res) => loescheAufgabeRoute(knex, req, res));
    router.post('/aufgaben/:id/erledigt', ...mitAufgabe, (req, res) => setzeErledigtRoute(knex, req, res));
    router.post('/aufgaben/:id/zuweisen', ...mitAufgabe, (req, res) => weiseZuRoute(knex, req, res, { sende }));
    router.post('/aufgaben/:id/einladung-erneut', ...mitAufgabe, (req, res) => einladungErneutRoute(knex, req, res, { sende }));

    return router;
}
