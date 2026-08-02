import express from 'express';
import { register, login, getMe, updateProfile, getAuthMode, verifyPasswordEndpoint } from '../controllers/authController.js';
import { requireAuth } from '../middleware/auth.js';

export function getAuthRoutes(knex) {
    const router = express.Router();

    router.post('/register', (req, res) => register(knex, req, res));
    router.post('/login', (req, res) => login(knex, req, res));
    router.get('/me', requireAuth, (req, res) => getMe(knex, req, res));
    router.put('/profile', requireAuth, (req, res) => updateProfile(knex, req, res));
    router.get('/mode', (req, res) => getAuthMode(knex, req, res));
    router.post('/verify', (req, res) => verifyPasswordEndpoint(knex, req, res));

    return router;
}
