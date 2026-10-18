import express from 'express';
import { erzeugeApiRatenbegrenzung } from '../middleware/apiRatenbegrenzung.js';
import { requireAuth } from '../middleware/auth.js';
import {
    listeTurniere, ladeDienste, traegeSichEin, traegeSichAus, ladeMeineDiensteRoute,
    ladeProfil, frageVereinAn, verlasseVerein, aenderePasswort
} from '../controllers/helferController.js';

/**
 * Helfer-App (Spec 4.1, 4.2, 5): eigene Endpunkte, die selbst die Mitgliedschaft prüfen
 * (hatHelferZugriffAufVerein). Nur in der Cloud gemountet (oder HELFER_APP_AKTIV=true).
 * @param {Object} knex
 * @param {{ jetzt?: () => Date, sende?: Function }} [optionen] - Uhr und Mailversand (Tests)
 */
export function getHelferRoutes(knex, { jetzt = () => new Date(), sende } = {}) {
    const router = express.Router();
    router.use(erzeugeApiRatenbegrenzung(), requireAuth);

    router.get('/turniere', (req, res) => listeTurniere(knex, req, res, { jetzt }));
    router.get('/turniere/:id/dienste', (req, res) => ladeDienste(knex, req, res, { jetzt }));
    router.post('/einsaetze', (req, res) => traegeSichEin(knex, req, res, { jetzt }));
    router.delete('/einsaetze/:id', (req, res) => traegeSichAus(knex, req, res, { jetzt }));
    router.get('/meine-dienste', (req, res) => ladeMeineDiensteRoute(knex, req, res, { jetzt }));
    router.get('/profil', (req, res) => ladeProfil(knex, req, res));
    router.post('/profil/verein', (req, res) => frageVereinAn(knex, req, res, sende ? { sende } : {}));
    router.delete('/profil/verein/:vereinId', (req, res) => verlasseVerein(knex, req, res));
    router.post('/profil/passwort', (req, res) => aenderePasswort(knex, req, res));

    return router;
}
