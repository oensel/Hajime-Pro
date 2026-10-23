import express from 'express';
import { erzeugeApiRatenbegrenzung } from '../middleware/apiRatenbegrenzung.js';
import {
    listeNutzer, setzeSuperAdmin, listeVereine, setzeVereinBundesland, listeVereinTurniere, aendereNutzer, loescheNutzer, setzeInitialPasswort,
    weiseMitgliedschaftZuRoute, entferneMitgliedschaftRoute,setzeGesperrt, bestaetigeKonto, sendeBestaetigungsMailRoute, sendePasswortMail, loescheUnbestaetigte,
    legeVereinAnRoute, fuehreVereineZusammenRoute, loescheVereinRoute, archiviereTurnier, loescheTurnierAlsSuperAdmin
} from '../controllers/nutzerController.js';
import { requireAuth, requireSuperAdmin } from '../middleware/auth.js';

// Super-Admin-Verwaltung (Seite admin-nutzer.html): nur für Super-Admins.
export function getNutzerRoutes(knex) {
    const router = express.Router();
    router.use(erzeugeApiRatenbegrenzung(), requireAuth, requireSuperAdmin(knex));
    router.get('/', (req, res) => listeNutzer(knex, req, res));
    router.post('/:id/super-admin', (req, res) => setzeSuperAdmin(knex, req, res));
    // Benutzer bearbeiten, löschen und Initialpasswort setzen
    router.post('/:id/passwort', (req, res) => setzeInitialPasswort(knex, req, res));
    // Verein mit Rolle zuweisen (neue Mitgliedschaft, offene Anfrage freigeben oder Rolle ändern)
    router.post('/:id/mitgliedschaft', (req, res) => weiseMitgliedschaftZuRoute(knex, req, res));
    router.delete('/:id/mitgliedschaft/:vereinId', (req, res) => entferneMitgliedschaftRoute(knex, req, res));
    // Vereinsübersicht: Vereine mit Bundesland, Benutzer- und Turnieranzahl; Turniere je Verein
    router.get('/vereine', (req, res) => listeVereine(knex, req, res));
    router.post('/vereine', (req, res) => legeVereinAnRoute(knex, req, res));
    router.put('/vereine/:id', (req, res) => setzeVereinBundesland(knex, req, res));
    router.post('/vereine/:id/zusammenfuehren', (req, res) => fuehreVereineZusammenRoute(knex, req, res));
    router.delete('/vereine/:id', (req, res) => loescheVereinRoute(knex, req, res));
    router.get('/vereine/:id/turniere', (req, res) => listeVereinTurniere(knex, req, res));
    // Turniere verwalten: archivieren/wiederherstellen und endgültig löschen
    router.post('/turniere/:id/archivieren', (req, res) => archiviereTurnier(knex, req, res));
    router.delete('/turniere/:id', (req, res) => loescheTurnierAlsSuperAdmin(knex, req, res));
    // Aufräumen vor den Routen mit :id
    router.delete('/unbestaetigte', (req, res) => loescheUnbestaetigte(knex, req, res));
    // Konto sperren, Bestätigung verwalten, Passwort-Reset-Mail
    router.post('/:id/sperren', (req, res) => setzeGesperrt(knex, req, res));
    router.post('/:id/bestaetigen', (req, res) => bestaetigeKonto(knex, req, res));
    router.post('/:id/bestaetigungs-mail', (req, res) => sendeBestaetigungsMailRoute(knex, req, res));
    router.post('/:id/passwort-mail', (req, res) => sendePasswortMail(knex, req, res));
    router.put('/:id', (req, res) => aendereNutzer(knex, req, res));
    router.delete('/:id', (req, res) => loescheNutzer(knex, req, res));
    return router;
}
