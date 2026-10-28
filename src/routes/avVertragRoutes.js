import express from 'express';
import { erzeugeApiRatenbegrenzung } from '../middleware/apiRatenbegrenzung.js';
import { requireAuth } from '../middleware/auth.js';
import { ladeRechtliches } from '../services/rechtliches.js';
import { seite } from '../services/rechtstexte.js';
import { rendereAvVertragText, ladeAvVertragStatus, nimmAvVertragAn } from '../services/avVertrag.js';

// Vertrag zur Auftragsverarbeitung (nur Cloud, src/services/avVertrag.js).
// /av-vertrag.html (öffentlich): die allgemeine Fassung zum Lesen vor der Registrierung.
export function getAvVertragSeite() {
    const router = express.Router();
    router.get(['/av-vertrag', '/av-vertrag.html'], (_req, res) => {
        const rechtliches = ladeRechtliches();
        res.set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
        res.send(seite({ titel: 'Vertrag zur Auftragsverarbeitung', aktiv: 'av-vertrag', inhalt: rendereAvVertragText(rechtliches), rechtliches }));
    });
    return router;
}

// GET  /api/av-vertrag           Stand für den aktiven Verein (Text, angenommen?, darf annehmen?)
// POST /api/av-vertrag/annehmen  { name, funktion, bestaetigt: true, fassung } — nur Admins des aktiven Vereins
export function getAvVertragApi(knex) {
    const router = express.Router();
    router.use(erzeugeApiRatenbegrenzung(), requireAuth);
    const antworte = (fn) => async (req, res) => {
        try {
            res.json({ success: true, ...(await fn(req)) });
        } catch (err) {
            if (!err.statusCode) console.error('[AV-Vertrag-Fehler]:', err);
            res.status(err.statusCode || 500).json({ success: false, error: err.statusCode ? err.message : 'Interner Fehler beim Vertrag zur Auftragsverarbeitung.', code: err.code || undefined });
        }
    };
    router.get('/', antworte((req) => ladeAvVertragStatus(knex, req.user.id, { rechtliches: ladeRechtliches() })));
    router.post('/annehmen', antworte((req) => nimmAvVertragAn(knex, req.user.id, req.body, { rechtliches: ladeRechtliches() })));
    return router;
}
