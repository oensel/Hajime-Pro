// Verwaltung des Cloud-Live-Betriebs für Admins (Spec docs/superpowers/specs/2026-10-24-cloud-live-betrieb-design.md):
// Turnier live schalten, Kopplungs-QR/-Code, Geräteübersicht, Code erneuern, Zugang sperren. Nur Admins des ausrichtenden Vereins
// und Super-Admins; Benutzer und Helfer sind für die Geräte (Matte/Waage) da und bedienen diese Seite nicht.
import express from 'express';
import { erzeugeApiRatenbegrenzung } from '../middleware/apiRatenbegrenzung.js';
import { requireAuth, requireTournamentEditAccess, requireRolle } from '../middleware/auth.js';
import { ermittleBasisUrl, HINWEIS_FEHLENDE_BASIS_URL } from '../utils/basisUrl.js';
import { baueCloudKopplungsUrl } from '../shared/kopplungsQr.js';
import { FachFehler } from '../utils/fachFehler.js';
import { ladeZugang, erneuereZugang, setzeGesperrt } from './zugang.js';

async function baueStatus(knex, verwalter, turnierId, req) {
    const turnier = await knex('turniere').where({ id: turnierId }).first('auf_hallen_server_geholt_am');
    const status = {
        success: true,
        live: false,
        geholt: !!turnier.auf_hallen_server_geholt_am,
        geholtAm: turnier.auf_hallen_server_geholt_am ? new Date(turnier.auf_hallen_server_geholt_am).toISOString() : null,
        offeneInstanzen: verwalter.offeneAnzahl(),
        maxInstanzen: verwalter.maxTurniere
    };
    if (!verwalter.instanzFuerTurnier(turnierId)) return status;
    const zugang = await ladeZugang(knex, turnierId);
    if (!zugang || zugang.beendetAm) return status;
    const basis = ermittleBasisUrl(req);
    if (!basis) throw new FachFehler(503, HINWEIS_FEHLENDE_BASIS_URL);
    return {
        ...status,
        live: true,
        code: zugang.code,
        schluessel: zugang.schluessel,
        url: `${basis}/turnierlive/${zugang.schluessel}`,
        qr: baueCloudKopplungsUrl(basis, zugang.schluessel, zugang.code),
        gesperrt: zugang.gesperrt,
        gueltigBis: zugang.gueltigBis ? zugang.gueltigBis.toISOString() : null,
        geraete: await verwalter.listeGeraete(turnierId)
    };
}

function antworte(res, fehler) {
    if (fehler instanceof FachFehler) {
        return res.status(fehler.statusCode).json({ success: false, error: fehler.message, ...(fehler.code ? { code: fehler.code } : {}), ...(fehler.daten || {}) });
    }
    console.error('[Cloud-Live] Fehler:', fehler);
    return res.status(500).json({ success: false, error: 'Interner Fehler im Cloud-Live-Betrieb.' });
}

export function getCloudLiveVerwaltungRoutes(knex, { verwalter }) {
    const router = express.Router();
    router.use(erzeugeApiRatenbegrenzung(), requireAuth);
    const berechtigt = [requireTournamentEditAccess(knex), requireRolle(knex, 'admin')];
    const turnierIdVon = (req) => parseInt(req.params.turnierId, 10);

    router.get('/:turnierId', ...berechtigt, async (req, res) => {
        try { res.json(await baueStatus(knex, verwalter, turnierIdVon(req), req)); } catch (fehler) { antworte(res, fehler); }
    });

    router.post('/:turnierId/starten', ...berechtigt, async (req, res) => {
        try {
            const turnierId = turnierIdVon(req);
            const turnier = await knex('turniere').where({ id: turnierId }).first();
            if (['entwurf', 'abgesagt'].includes(turnier.status)) {
                throw new FachFehler(409, 'Ein Entwurf oder abgesagtes Turnier kann nicht live geschaltet werden.');
            }
            const laeuftSchon = !!verwalter.instanzFuerTurnier(turnierId);
            if (!laeuftSchon && turnier.auf_hallen_server_geholt_am && !(req.body && req.body.bestaetigt === true)) {
                throw new FachFehler(409, 'Dieses Turnier wurde bereits auf einen Hallen-Server geholt. Ein Turnier sollte nur an einem Ort live laufen.', { code: 'bereits_geholt' });
            }
            await verwalter.starte(turnierId);
            res.json(await baueStatus(knex, verwalter, turnierId, req));
        } catch (fehler) { antworte(res, fehler); }
    });

    router.post('/:turnierId/code-erneuern', ...berechtigt, async (req, res) => {
        try {
            const turnierId = turnierIdVon(req);
            if (!verwalter.instanzFuerTurnier(turnierId) || !(await erneuereZugang(knex, turnierId))) {
                throw new FachFehler(409, 'Das Turnier läuft nicht live.');
            }
            res.json(await baueStatus(knex, verwalter, turnierId, req));
        } catch (fehler) { antworte(res, fehler); }
    });

    router.post('/:turnierId/sperren', ...berechtigt, async (req, res) => {
        try {
            const turnierId = turnierIdVon(req);
            if (!verwalter.instanzFuerTurnier(turnierId)) throw new FachFehler(409, 'Das Turnier läuft nicht live.');
            await setzeGesperrt(knex, turnierId, !!(req.body && req.body.wert));
            res.json(await baueStatus(knex, verwalter, turnierId, req));
        } catch (fehler) { antworte(res, fehler); }
    });

    return router;
}
