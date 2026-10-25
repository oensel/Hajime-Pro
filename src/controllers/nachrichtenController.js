// Nachrichten (Postfach, Kontakt): siehe services/nachrichten.js.
import {
    ladeKonto, zaehleUngelesene, listeThreads, ladeThread, sendeNachricht, antworte, sendeKontaktOhneKonto,
    ladeEmpfaengerAuswahl, ladeVereinsAdmins
} from '../services/nachrichten.js';
import { ermittleBasisUrl } from '../utils/basisUrl.js';
import { sendeMail } from '../utils/mailer.js';

function antwortFehler(res, error, bezeichnung) {
    const status = error.status || error.statusCode;
    if (status) return res.status(status).json({ success: false, error: error.message });
    console.error(`[Nachrichten] ${bezeichnung}:`, error);
    res.status(500).json({ success: false, error: 'Interner Server-Fehler.' });
}

const ganzeZahl = (v) => (/^\d+$/.test(String(v ?? '')) && Number(v) <= 2147483647 ? Number(v) : null);

export function erzeugeNachrichtenController(knex, { sende = sendeMail } = {}) {
    const basis = (req) => ermittleBasisUrl(req);
    const mitKonto = (name, fn) => async (req, res) => {
        try { res.json({ success: true, ...(await fn(await ladeKonto(knex, req.user.id), req)) }); }
        catch (error) { antwortFehler(res, error, name); }
    };
    return {
        ungelesen: mitKonto('ungelesen', async (konto) => ({ anzahl: await zaehleUngelesene(knex, konto) })),
        liste: mitKonto('liste', async (konto) => ({ threads: await listeThreads(knex, konto) })),
        lesen: mitKonto('lesen', async (konto, req) => {
            const id = ganzeZahl(req.params.id);
            if (!id) return { thread: null };
            return { thread: await ladeThread(knex, konto, id) };
        }),
        neu: mitKonto('neu', async (konto, req) => sendeNachricht(knex, konto, req.body || {}, { basisUrl: basis(req), sende })),
        antworten: mitKonto('antworten', async (konto, req) => {
            const id = ganzeZahl(req.params.id);
            if (!id) return {};
            await antworte(knex, konto, id, (req.body || {}).text, { basisUrl: basis(req), sende });
            return { thread: await ladeThread(knex, konto, id) };
        }),
        empfaenger: mitKonto('empfaenger', async (konto) => ladeEmpfaengerAuswahl(knex, konto)),
        vereinsAdmins: mitKonto('vereinsAdmins', async (konto, req) => ({
            admins: await ladeVereinsAdmins(knex, konto, ganzeZahl(req.query.vereinId) ?? -1)
        })),
        // POST /api/kontakt – ohne Anmeldung (Kontaktformular, Vereinsanfrage)
        kontakt: async (req, res) => {
            try {
                await sendeKontaktOhneKonto(knex, req.body || {}, { basisUrl: basis(req), sende });
                res.json({ success: true });
            } catch (error) { antwortFehler(res, error, 'Kontakt'); }
        }
    };
}
