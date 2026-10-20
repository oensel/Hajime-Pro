import express from 'express';
import { erzeugeApiRatenbegrenzung } from '../middleware/apiRatenbegrenzung.js';
import { requireAuth, requireTournamentEditAccess, requireTurnierAktiv, requireRolle } from '../middleware/auth.js';
import {
    pruefeVorhanden, ladePlanRoute, legeTaetigkeitAnRoute, aendereTaetigkeitRoute, loescheTaetigkeitRoute,
    legeSlotAnRoute, aendereSlotRoute, loescheSlotRoute, traegeEinRoute, traegeAusRoute, ladeMitgliederRoute, ladeAusweiseRoute
} from '../controllers/helferPlanController.js';

/**
 * Helferplan der Orga (Spec Abschnitt 6): Super-Admin sowie Admins/Benutzer des ausrichtenden Vereins
 * (requireTournamentEditAccess), Schreibzugriffe nur bei nicht abgesagtem/abgeschlossenem Turnier.
 * Helfer ein-/austragen (Zuweisen von Diensten) nur für Admins des Vereins bzw. Super-Admin.
 * Das Turnier kommt aus :turnierId bzw. aus der Tätigkeit/dem Slot/dem Einsatz (resolveTurnierId).
 * @param {Object} knex
 * @param {{ jetzt?: () => Date, sende?: Function }} [optionen] - Uhr und Mailversand (Tests)
 */
export function getHelferPlanRoutes(knex, { jetzt = () => new Date(), sende } = {}) {
    const router = express.Router();
    router.use(erzeugeApiRatenbegrenzung(), requireAuth);

    const lesen = [requireTournamentEditAccess(knex)];
    const schreiben = [requireTournamentEditAccess(knex), requireTurnierAktiv(knex)];
    const mitDatensatz = [pruefeVorhanden(knex), ...schreiben];

    router.put('/taetigkeiten/:taetigkeitId', ...mitDatensatz, (req, res) => aendereTaetigkeitRoute(knex, req, res));
    router.delete('/taetigkeiten/:taetigkeitId', ...mitDatensatz, (req, res) => loescheTaetigkeitRoute(knex, req, res));
    router.post('/taetigkeiten/:taetigkeitId/slots', ...mitDatensatz, (req, res) => legeSlotAnRoute(knex, req, res));
    router.put('/slots/:slotId', ...mitDatensatz, (req, res) => aendereSlotRoute(knex, req, res, sende ? { sende } : {}));
    router.delete('/slots/:slotId', ...mitDatensatz, (req, res) => loescheSlotRoute(knex, req, res));
    router.post('/slots/:slotId/einsaetze', ...mitDatensatz, requireRolle(knex, 'admin'), (req, res) => traegeEinRoute(knex, req, res, { jetzt }));
    router.delete('/einsaetze/:einsatzId', ...mitDatensatz, requireRolle(knex, 'admin'), (req, res) => traegeAusRoute(knex, req, res, { jetzt }));

    router.get('/:turnierId', ...lesen, (req, res) => ladePlanRoute(knex, req, res));
    router.get('/:turnierId/mitglieder', ...lesen, (req, res) => ladeMitgliederRoute(knex, req, res));
    router.get('/:turnierId/ausweise', ...lesen, (req, res) => ladeAusweiseRoute(knex, req, res));
    router.post('/:turnierId/taetigkeiten', ...schreiben, (req, res) => legeTaetigkeitAnRoute(knex, req, res));

    return router;
}
