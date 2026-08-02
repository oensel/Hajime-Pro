import express from 'express';
import {
    createPool,
    getPool,
    generierePools,
    pruefeTeilnehmerlisteGesperrt,
    getPoolsMitDetails,
    verschiebeTeilnehmer,
    updatePoolStammdaten,
    deletePool,
    schliessePoolAb,
    loescheAllePools,
    aendereWettkampfsystem,
    getKampfflaechenMitPools,
    ordnePoolZuKampfflaeche,
    entferneAlleMattenzuordnungen,
    setzeKampfflaecheReihenfolge,
    verteilePools,
    planeKaempfe,
    getDashboardData,
    getPoolUebersicht
} from '../controllers/poolController.js';
import { requireAuth, requireTournamentEditAccess, requireTurnierAktiv } from '../middleware/auth.js';

export function getPoolRoutes(knex) {
    const router = express.Router();

    // Public dashboard route (read-only for spectators)
    router.get('/dashboard', (req, res) => getDashboardData(knex, req, res));
    router.get('/uebersicht', (req, res) => getPoolUebersicht(knex, req, res));

    router.use(requireAuth);

    // requireTurnierAktiv nur auf schreibende Routen — Lesen (GET) bleibt für abgesagte/
    // abgeschlossene Turniere weiterhin möglich (Ergebnisse ansehen, archivieren).
    const aktiv = requireTurnierAktiv(knex);

    // Batch operations
    router.post('/generieren', requireTournamentEditAccess(knex), aktiv, (req, res) => generierePools(knex, req, res));
    router.post('/loeschen-alle', requireTournamentEditAccess(knex), aktiv, (req, res) => loescheAllePools(knex, req, res));
    router.post('/aufteilen', requireTournamentEditAccess(knex), aktiv, (req, res) => verteilePools(knex, req, res));
    router.post('/kaempfe-anordnen', requireTournamentEditAccess(knex), aktiv, (req, res) => planeKaempfe(knex, req, res));
    router.get('/details', requireTournamentEditAccess(knex), (req, res) => getPoolsMitDetails(knex, req, res));
    router.get('/vorhanden', (req, res) => pruefeTeilnehmerlisteGesperrt(knex, req, res));
    router.post('/verschieben', requireTournamentEditAccess(knex), aktiv, (req, res) => verschiebeTeilnehmer(knex, req, res));

    // Kampfflächen (formerly Matten) pool assignments
    router.get('/kampfflaechen', requireTournamentEditAccess(knex), (req, res) => getKampfflaechenMitPools(knex, req, res));
    router.put('/kampfflaeche-zuordnen', requireTournamentEditAccess(knex), aktiv, (req, res) => ordnePoolZuKampfflaeche(knex, req, res));
    router.put('/kampfflaeche-reihenfolge', requireTournamentEditAccess(knex), aktiv, (req, res) => setzeKampfflaecheReihenfolge(knex, req, res));
    router.post('/kampfflaeche-zuordnungen-loeschen', requireTournamentEditAccess(knex), aktiv, (req, res) => entferneAlleMattenzuordnungen(knex, req, res));

    // Single Pool CRUD
    router.post('/', requireTournamentEditAccess(knex), aktiv, (req, res) => createPool(knex, req, res));
    router.get('/:id', requireTournamentEditAccess(knex), (req, res) => getPool(knex, req, res));
    router.put('/:id', requireTournamentEditAccess(knex), aktiv, (req, res) => updatePoolStammdaten(knex, req, res));
    router.put('/:id/system', requireTournamentEditAccess(knex), aktiv, (req, res) => aendereWettkampfsystem(knex, req, res));
    router.post('/:id/abschliessen', requireTournamentEditAccess(knex), aktiv, (req, res) => schliessePoolAb(knex, req, res));
    router.delete('/:id', requireTournamentEditAccess(knex), aktiv, (req, res) => deletePool(knex, req, res));

    return router;
}
