import express from 'express';
import { erzeugeApiRatenbegrenzung } from '../middleware/apiRatenbegrenzung.js';
import {
    listVereine, joinVerein, leaveVerein, wechsleAktivenVerein,
    getPendingRequests, approveMember, rejectMember, changeRolle, removeMember, getMitglieder,
    getSuperAdminPendingRequests, superApproveMember, superRejectMember
} from '../controllers/vereinController.js';
import { requireAuth, requireSuperAdmin } from '../middleware/auth.js';

export function getVereinRoutes(knex) {
    const router = express.Router();

    // Vereinsliste (nur id und Name) ohne Anmeldung: die Registrierung auf login.html wählt den Verein per
    // Autovervollständigung, bevor es ein Konto gibt (Helferverwaltung, Spec 4).
    router.get('/', (req, res) => listVereine(knex, req, res));

    router.use(erzeugeApiRatenbegrenzung(), requireAuth);
    router.post('/join', (req, res) => joinVerein(knex, req, res));
    router.post('/leave', (req, res) => leaveVerein(knex, req, res));
    router.post('/aktiv', (req, res) => wechsleAktivenVerein(knex, req, res));
    router.get('/pending', (req, res) => getPendingRequests(knex, req, res));
    router.post('/approve', (req, res) => approveMember(knex, req, res));
    router.post('/reject', (req, res) => rejectMember(knex, req, res));
    // Rollenverwaltung (Admin des Vereins oder Super-Admin, geprüft im Service vereinsRollen.js)
    router.post('/rolle', (req, res) => changeRolle(knex, req, res));
    router.post('/entfernen', (req, res) => removeMember(knex, req, res));
    router.get('/mitglieder', (req, res) => getMitglieder(knex, req, res));

    router.get('/super/pending', requireSuperAdmin(knex), (req, res) => getSuperAdminPendingRequests(knex, req, res));
    router.post('/super/approve', requireSuperAdmin(knex), (req, res) => superApproveMember(knex, req, res));
    router.post('/super/reject', requireSuperAdmin(knex), (req, res) => superRejectMember(knex, req, res));

    return router;
}
