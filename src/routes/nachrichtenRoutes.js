import express from 'express';
import { erzeugeApiRatenbegrenzung } from '../middleware/apiRatenbegrenzung.js';
import { requireAuth } from '../middleware/auth.js';
import { erzeugeNachrichtenController } from '../controllers/nachrichtenController.js';

/** Postfach angemeldeter Konten (/api/nachrichten). Nur Cloud (bzw. NACHRICHTEN_AKTIV=true). */
export function getNachrichtenRoutes(knex, optionen = {}) {
    const router = express.Router();
    const c = erzeugeNachrichtenController(knex, optionen);
    router.use(erzeugeApiRatenbegrenzung(), requireAuth);
    router.get('/ungelesen', c.ungelesen);
    router.get('/empfaenger', c.empfaenger);
    router.get('/empfaenger/admins', c.vereinsAdmins);
    router.get('/', c.liste);
    router.post('/', c.neu);
    router.get('/:id', c.lesen);
    router.post('/:id/antworten', c.antworten);
    return router;
}

/** Kontaktformular ohne Anmeldung (/api/kontakt): 5 Anfragen je 10 Minuten und Absender. */
export function getKontaktRoutes(knex, optionen = {}) {
    const router = express.Router();
    const c = erzeugeNachrichtenController(knex, optionen);
    router.get('/aktiv', (req, res) => res.json({ aktiv: true }));
    router.post('/', erzeugeApiRatenbegrenzung({ max: 5, fensterMs: 10 * 60_000 }), c.kontakt);
    return router;
}
