import express from 'express';
import {
    listVereine, joinVerein, leaveVerein, wechsleAktivenVerein,
    getPendingRequests, approveMember, rejectMember,
    getSuperAdminPendingRequests, superApproveMember, superRejectMember
} from '../controllers/vereinController.js';
import { requireAuth, requireSuperAdmin } from '../middleware/auth.js';

export function getVereinRoutes(knex) {
    const router = express.Router();

    router.use(requireAuth);

    router.get('/', (req, res) => listVereine(knex, req, res));
    router.post('/join', (req, res) => joinVerein(knex, req, res));
    router.post('/leave', (req, res) => leaveVerein(knex, req, res));
    router.post('/aktiv', (req, res) => wechsleAktivenVerein(knex, req, res));
    router.get('/pending', (req, res) => getPendingRequests(knex, req, res));
    router.post('/approve', (req, res) => approveMember(knex, req, res));
    router.post('/reject', (req, res) => rejectMember(knex, req, res));

    router.get('/super/pending', requireSuperAdmin(knex), (req, res) => getSuperAdminPendingRequests(knex, req, res));
    router.post('/super/approve', requireSuperAdmin(knex), (req, res) => superApproveMember(knex, req, res));
    router.post('/super/reject', requireSuperAdmin(knex), (req, res) => superRejectMember(knex, req, res));

    return router;
}
