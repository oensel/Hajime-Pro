// POST /api/turniere/:id/teilen { emails } — Turnier-Link per E-Mail verschicken (nur Cloud, siehe services/turnierTeilen.js).
// Das Turnier hat requireTournamentEditAccess bereits autorisiert (req.tournament): Verwalter des ausrichtenden Vereins
// und Super-Admins. Entwürfe und abgesagte Turniere lassen sich nicht teilen.
import { teileTurnierPerMail } from '../services/turnierTeilen.js';
import { ermittleBasisUrl } from '../utils/basisUrl.js';
import betriebsmodus from '../config/betriebsmodus.cjs';
import { sendeMail } from '../utils/mailer.js';
import { turnierHatEchteKaempfe } from './poolController.js';
import { ermittleEffektivenStatus } from './turnierController.js';

export async function teileTurnierRoute(knex, req, res, { sende = sendeMail } = {}) {
    try {
        if (betriebsmodus.istEinzelbenutzerBetrieb()) {
            return res.status(409).json({ success: false, error: 'Turniere per E-Mail teilen gibt es nur in der Cloud.' });
        }
        const turnier = req.tournament;
        const status = ermittleEffektivenStatus(turnier, { hatEchteKaempfe: await turnierHatEchteKaempfe(knex, turnier.id) });
        if (status === 'entwurf' || status === 'abgesagt') {
            return res.status(400).json({ success: false, error: 'Ein Entwurf oder abgesagtes Turnier lässt sich nicht teilen. Bitte zuerst veröffentlichen.' });
        }
        const roh = (req.body || {}).vereinIds;
        if (roh !== undefined && (!Array.isArray(roh) || !roh.every((v) => Number.isInteger(v) && v > 0 && v <= 2147483647))) {
            return res.status(400).json({ success: false, error: 'vereinIds muss eine Liste von Vereins-IDs sein.' });
        }
        const vereinIds = [...new Set(roh || [])];
        const antwort = await teileTurnierPerMail(knex, {
            turnier, eingabe: (req.body || {}).emails, vereinIds, eingeladenVon: req.user.id, basisUrl: ermittleBasisUrl(req), sende
        });
        res.json({ success: true, ...antwort });
    } catch (error) {
        const status = error.status || error.statusCode;
        if (status) return res.status(status).json({ success: false, error: error.message });
        console.error('[Turnier-Teilen]:', error);
        res.status(500).json({ success: false, error: 'Interner Server-Fehler beim Versenden.' });
    }
}
