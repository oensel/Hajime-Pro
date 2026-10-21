// Helfer per E-Mail in den Verein einladen (Admins, nur außerhalb des Einzelbenutzerbetriebs): siehe services/helferEinladung.js.
import { darfVereinVerwalten } from '../services/vereinsRollen.js';
import { sendeHelferEinladungen, ladeOffeneEinladungen } from '../services/helferEinladung.js';
import { ermittleBasisUrl } from '../utils/basisUrl.js';
import betriebsmodus from '../config/betriebsmodus.cjs';
import { sendeMail } from '../utils/mailer.js';

function ladeVereinId(req) {
    const v = req.method === 'GET' ? req.query.vereinId : (req.body || {}).vereinId;
    return /^\d+$/.test(String(v ?? '')) && Number(v) <= 2147483647 ? Number(v) : null;
}

async function pruefeZugriff(knex, req, res) {
    if (betriebsmodus.istEinzelbenutzerBetrieb()) {
        res.status(409).json({ success: false, error: 'Einladungen per E-Mail gibt es nur in der Cloud.' });
        return null;
    }
    const vereinId = ladeVereinId(req);
    if (!vereinId) {
        res.status(400).json({ success: false, error: 'vereinId ist erforderlich.' });
        return null;
    }
    if (!(await darfVereinVerwalten(knex, req.user.id, vereinId))) {
        res.status(403).json({ success: false, error: 'Nur Admins dieses Vereins dürfen Helfer einladen.' });
        return null;
    }
    return vereinId;
}

/** POST /api/vereine/einladungen  { vereinId, emails: string | string[] } */
export async function sendeEinladungenRoute(knex, req, res, { sende = sendeMail } = {}) {
    try {
        const vereinId = await pruefeZugriff(knex, req, res);
        if (!vereinId) return;
        const antwort = await sendeHelferEinladungen(knex, {
            vereinId, eingabe: (req.body || {}).emails, basisUrl: ermittleBasisUrl(req), sende
        });
        res.json({ success: true, ...antwort });
    } catch (error) {
        const status = error.status || error.statusCode;
        if (status) return res.status(status).json({ success: false, error: error.message });
        console.error('[Helfer-Einladung]:', error);
        res.status(500).json({ success: false, error: 'Interner Server-Fehler beim Versenden der Einladungen.' });
    }
}

/** GET /api/vereine/einladungen?vereinId= — offene Einladungen */
export async function ladeEinladungenRoute(knex, req, res) {
    try {
        const vereinId = await pruefeZugriff(knex, req, res);
        if (!vereinId) return;
        res.json({ success: true, einladungen: await ladeOffeneEinladungen(knex, vereinId) });
    } catch (error) {
        console.error('[Helfer-Einladung-Liste]:', error);
        res.status(500).json({ success: false, error: 'Interner Server-Fehler beim Laden der Einladungen.' });
    }
}
