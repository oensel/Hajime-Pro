import express from 'express';
import { erzeugeApiRatenbegrenzung } from '../middleware/apiRatenbegrenzung.js';
import {
    listeNutzer, setzeSuperAdmin, listeVereine, setzeVereinBundesland, listeVereinTurniere, aendereNutzer, loescheNutzer, setzeInitialPasswort,
    weiseMitgliedschaftZuRoute, entferneMitgliedschaftRoute,setzeGesperrt, bestaetigeKonto, sendeBestaetigungsMailRoute, sendePasswortMail, loescheUnbestaetigte,
    legeVereinAnRoute, fuehreVereineZusammenRoute, loescheVereinRoute, archiviereTurnier, loescheTurnierAlsSuperAdmin
} from '../controllers/nutzerController.js';
import { requireAuth, requireSuperAdmin, requireNutzerVerwaltung } from '../middleware/auth.js';

// Benutzerverwaltung (Seite admin-nutzer.html): Super-Admins verwalten alle Konten; Admins eines Vereins die Konten ihrer
// Vereine (Anzeigen, Bearbeiten, Passwort, Sperren, Löschen, Zuordnung entfernen), aber nie Super-Admins.
// Alles übrige (Vereine, Turniere, Super-Admin ernennen, Zuweisen, Bestätigen, Aufräumen) bleibt Super-Admins vorbehalten.
export function getNutzerRoutes(knex) {
    const router = express.Router();
    router.use(erzeugeApiRatenbegrenzung(), requireAuth);
    const nurSuper = requireSuperAdmin(knex);
    const verwaltung = requireNutzerVerwaltung(knex);
    router.get('/', verwaltung, (req, res) => listeNutzer(knex, req, res));
    router.post('/:id/super-admin', nurSuper, (req, res) => setzeSuperAdmin(knex, req, res));
    // Benutzer bearbeiten, löschen und Initialpasswort setzen
    router.post('/:id/passwort', verwaltung, (req, res) => setzeInitialPasswort(knex, req, res));
    // Verein mit Rolle zuweisen (neue Mitgliedschaft, offene Anfrage freigeben oder Rolle ändern)
    router.post('/:id/mitgliedschaft', nurSuper, (req, res) => weiseMitgliedschaftZuRoute(knex, req, res));
    router.delete('/:id/mitgliedschaft/:vereinId', verwaltung, (req, res) => entferneMitgliedschaftRoute(knex, req, res));
    // Vereinsübersicht: Vereine mit Bundesland, Benutzer- und Turnieranzahl; Turniere je Verein
    router.get('/vereine', nurSuper, (req, res) => listeVereine(knex, req, res));
    router.post('/vereine', nurSuper, (req, res) => legeVereinAnRoute(knex, req, res));
    router.put('/vereine/:id', nurSuper, (req, res) => setzeVereinBundesland(knex, req, res));
    router.post('/vereine/:id/zusammenfuehren', nurSuper, (req, res) => fuehreVereineZusammenRoute(knex, req, res));
    router.delete('/vereine/:id', nurSuper, (req, res) => loescheVereinRoute(knex, req, res));
    router.get('/vereine/:id/turniere', nurSuper, (req, res) => listeVereinTurniere(knex, req, res));
    // Turniere verwalten: archivieren/wiederherstellen und endgültig löschen
    router.post('/turniere/:id/archivieren', nurSuper, (req, res) => archiviereTurnier(knex, req, res));
    router.delete('/turniere/:id', nurSuper, (req, res) => loescheTurnierAlsSuperAdmin(knex, req, res));
    // Aufräumen vor den Routen mit :id
    router.delete('/unbestaetigte', nurSuper, (req, res) => loescheUnbestaetigte(knex, req, res));
    // Konto sperren, Bestätigung verwalten, Passwort-Reset-Mail
    router.post('/:id/sperren', verwaltung, (req, res) => setzeGesperrt(knex, req, res));
    router.post('/:id/bestaetigen', nurSuper, (req, res) => bestaetigeKonto(knex, req, res));
    router.post('/:id/bestaetigungs-mail', nurSuper, (req, res) => sendeBestaetigungsMailRoute(knex, req, res));
    router.post('/:id/passwort-mail', verwaltung, (req, res) => sendePasswortMail(knex, req, res));
    router.put('/:id', verwaltung, (req, res) => aendereNutzer(knex, req, res));
    router.delete('/:id', verwaltung, (req, res) => loescheNutzer(knex, req, res));
    return router;
}
