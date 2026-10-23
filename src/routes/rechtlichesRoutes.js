import express from 'express';
import { erzeugeApiRatenbegrenzung } from '../middleware/apiRatenbegrenzung.js';
import { requireAuth, requireSuperAdmin } from '../middleware/auth.js';
import { ladeRechtliches, rechtlichesDatei } from '../services/rechtliches.js';
import { rendereImpressum, rendereDatenschutz } from '../services/rechtstexte.js';

// Impressum und Datenschutzerklärung (öffentlich, ohne Anmeldung): /impressum.html und /datenschutz.html (auch ohne .html). Die Seiten werden bei jedem Aufruf
// aus der Datei der Betreiberangaben erzeugt (src/services/rechtliches.js), Änderungen gelten also sofort ohne Neustart.
export function getRechtlichesSeiten() {
    const router = express.Router();
    const senden = (render) => (_req, res) => {
        res.set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
        res.send(render(ladeRechtliches()));
    };
    router.get(['/impressum', '/impressum.html'], senden(rendereImpressum));
    router.get(['/datenschutz', '/datenschutz.html'], senden(rendereDatenschutz));
    return router;
}

// GET /api/rechtliches/aktiv (öffentlich): gibt es die Seiten? (rechtsfuss.js blendet sonst die Links nicht ein)
// GET /api/rechtliches/status (Super-Admin): fehlende Pflichtangaben und Hinweise
export function getRechtlichesApi(knex) {
    const router = express.Router();
    router.get('/aktiv', (_req, res) => res.json({ aktiv: true }));
    router.get('/status', erzeugeApiRatenbegrenzung(), requireAuth, requireSuperAdmin(knex), (_req, res) => {
        const r = ladeRechtliches();
        res.json({ success: true, vollstaendig: r.vollstaendig, fehlend: r.fehlend, hinweise: r.hinweise, datei: rechtlichesDatei() });
    });
    return router;
}
