import express from 'express';
import { listVereine, joinVerein, getPendingRequests, approveMember, rejectMember } from '../controllers/vereinController.js';
import { requireAuth } from '../middleware/auth.js';

export function getVereinRoutes(knex) {
    const router = express.Router();

    router.use(requireAuth);

    router.get('/', (req, res) => listVereine(knex, req, res));
    router.post('/join', (req, res) => joinVerein(knex, req, res));
    router.get('/pending', (req, res) => getPendingRequests(knex, req, res));
    router.post('/approve', (req, res) => approveMember(knex, req, res));
    router.post('/reject', (req, res) => rejectMember(knex, req, res));

    return router;
}
