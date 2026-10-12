// Öffentliche Teilnehmer-App-API und Ingest des Live-Prozesses (Spec Abschnitt 6.1). Nur im Modus cloud eingehängt.
// Der Ingest antwortet nur mit Statuscodes; die App-API ist lesend, ratenbegrenzt und liefert nie mehr als die Kachel.
import express from 'express';
import { uebernimmPaket } from '../liveCloud/ingest.js';
import { pruefeToken } from '../liveCloud/token.js';
import { listeTurniere, ladeTurnier, suche, ladePool, ladeVerein, uebersicht } from '../liveCloud/abfrage.js';
import { erzeugeRatenbegrenzung, clientIp, ratenGrenzeAusEnv } from '../liveCloud/ratenbegrenzung.js';

const SCHLUESSEL = /^[A-Za-z0-9_-]{1,64}$/;
const POOL_ID = /^\d{1,9}$/;

export function getLiveRoutes(knex, {
    jetzt = () => new Date(),
    env = process.env,
    begrenzung = erzeugeRatenbegrenzung({ max: ratenGrenzeAusEnv(env) }),
    fehlerBegrenzung = erzeugeRatenbegrenzung({ max: 30, beiVollstand: 'sperren' })
} = {}) {
    const router = express.Router();
    router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

    router.post('/ingest', async (req, res) => {
        try {
            const auth = /^Bearer (.+)$/.exec(req.get('authorization') || '');
            const token = auth ? await pruefeToken(knex, auth[1], { jetzt }) : null;
            if (!token) {
                return res.status(fehlerBegrenzung.erlaube(clientIp(req, env)) ? 401 : 429).end();
            }
            const paket = req.body;
            if (token.turnierKey && paket?.turnierKey !== token.turnierKey) return res.status(403).end();
            const ergebnis = await uebernimmPaket(knex, paket, { jetzt });
            // 409: das Paket wurde verworfen, weil die Cloud einen neueren Stand hat. Der Uplink soll das nicht für
            // zugestellt halten (sonst ginge eine Rücknahme still verloren), sondern loggen und mit Backoff erneut senden.
            if (ergebnis === 'veraltet') return res.status(409).end();
            return res.status(204).end();
        } catch (fehler) {
            if (fehler.code === 'UNGUELTIG') return res.status(400).json({ error: fehler.message });
            console.error('[LiveCloud] Ingest fehlgeschlagen:', fehler.message);
            return res.status(500).end();
        }
    });

    // Ab hier die öffentliche App-API.
    router.use((req, res, next) => {
        if (!begrenzung.erlaube(clientIp(req, env))) return res.status(429).json({ error: 'Zu viele Anfragen' });
        next();
    });

    const schluesselPruefen = (req, res, next) => {
        if (!SCHLUESSEL.test(req.params.key)) return res.status(400).json({ error: 'Ungültiger Turnierschlüssel' });
        next();
    };
    const fehler500 = (res, fehler) => {
        console.error('[LiveCloud] Abfrage fehlgeschlagen:', fehler.message);
        res.status(500).json({ error: 'Abfrage fehlgeschlagen' });
    };

    router.get('/turniere', async (req, res) => {
        try {
            res.json({ serverzeit: jetzt().toISOString(), turniere: await listeTurniere(knex, { jetzt }) });
        } catch (f) { fehler500(res, f); }
    });

    router.get('/turniere/:key', schluesselPruefen, async (req, res) => {
        try {
            const turnier = await ladeTurnier(knex, req.params.key);
            if (!turnier) return res.status(404).json({ error: 'Turnier nicht gefunden' });
            res.json({ ...turnier, serverzeit: jetzt().toISOString() });
        } catch (f) { fehler500(res, f); }
    });

    router.get('/turniere/:key/suche', schluesselPruefen, async (req, res) => {
        try {
            res.json({ treffer: await suche(knex, req.params.key, String(req.query.q ?? '').slice(0, 100)) });
        } catch (f) { fehler500(res, f); }
    });

    router.get('/turniere/:key/pools/:poolId', schluesselPruefen, async (req, res) => {
        if (!POOL_ID.test(req.params.poolId)) return res.status(400).json({ error: 'Ungültige Pool-ID' });
        try {
            const pool = await ladePool(knex, req.params.key, Number(req.params.poolId));
            if (!pool) return res.status(404).json({ error: 'Pool nicht gefunden' });
            res.json(pool);
        } catch (f) { fehler500(res, f); }
    });

    router.get('/turniere/:key/vereine/:vereinKey', schluesselPruefen, async (req, res) => {
        if (!SCHLUESSEL.test(req.params.vereinKey)) return res.status(400).json({ error: 'Ungültiger Vereinsschlüssel' });
        try {
            res.json({ teilnehmer: await ladeVerein(knex, req.params.key, req.params.vereinKey) });
        } catch (f) { fehler500(res, f); }
    });

    router.post('/turniere/:key/uebersicht', schluesselPruefen, async (req, res) => {
        try {
            const turnier = await ladeTurnier(knex, req.params.key);
            if (!turnier) return res.status(404).json({ error: 'Turnier nicht gefunden' });
            const body = req.body && typeof req.body === 'object' ? req.body : {};
            res.json({
                serverzeit: jetzt().toISOString(), stand: turnier.stand, empfangenAm: turnier.empfangenAm,
                teilnehmer: await uebersicht(knex, req.params.key, body)
            });
        } catch (f) { fehler500(res, f); }
    });

    return router;
}
