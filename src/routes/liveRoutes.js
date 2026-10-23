// Öffentliche Teilnehmer-App-API und Ingest des Live-Prozesses (Spec Abschnitt 6.1). Nur im Modus cloud eingehängt.
// Der Ingest antwortet nur mit Statuscodes; die App-API ist lesend, ratenbegrenzt und liefert nie mehr als die Kachel.
import express from 'express';
import { uebernimmPaket } from '../liveCloud/ingest.js';
import { pruefeToken, sperreAelterTokens } from '../liveCloud/token.js';
import {
    listeTurniere, ladeTurnier, suche, ladePool, ladeVerein, uebersicht, listePools, ladeDashboard,
    sucheMannschaften, listeMannschaftsPools, ladeMannschaft, uebersichtMannschaften
} from '../liveCloud/abfrage.js';
import { erzeugeRatenbegrenzung, clientIp, ratenGrenzeAusEnv } from '../liveCloud/ratenbegrenzung.js';
import { liesPushKonfig } from '../liveCloud/pushKonfig.js';
import { meldeAn, meldeAb, pruefeUndSende } from '../liveCloud/push.js';
import { pruefeZugang, loeseCodeAuf, holeOderErzeuge, erneuere, setzeGesperrt } from '../liveCloud/zugang.js';

const SCHLUESSEL = /^[A-Za-z0-9_-]{1,64}$/;
const POOL_ID = /^\d{1,9}$/;

export function getLiveRoutes(knex, {
    jetzt = () => new Date(),
    env = process.env,
    begrenzung = erzeugeRatenbegrenzung({ max: ratenGrenzeAusEnv(env) }),
    fehlerBegrenzung = erzeugeRatenbegrenzung({ max: 30, beiVollstand: 'sperren' }),
    // Fehlversuche mit einem ungültigen Zugangscode je Absender (in der Halle teilen sich viele Geräte eine Adresse, daher großzügig; der Code hat 128 Bit)
    zugangBegrenzung = erzeugeRatenbegrenzung({ max: 120, beiVollstand: 'sperren' }),
    // Push-Nachrichten (Phase 3): konfig aus LIVE_PUSH_*, sender sendet über web-push (im Test injiziert)
    push = { konfig: liesPushKonfig(env), sender: null }
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
            // Wird ein an ein Turnier gebundenes Token benutzt, verfallen die älteren Tokens dieses Turniers (neu geholt = ersetzt).
            if (token.turnierKey) await sperreAelterTokens(knex, token.turnierKey, token.id);
            const paket = req.body;
            if (token.turnierKey && paket?.turnierKey !== token.turnierKey) return res.status(403).end();
            const ergebnis = await uebernimmPaket(knex, paket, { jetzt });
            // 409: das Paket wurde verworfen, weil die Cloud einen neueren Stand hat. Der Uplink soll das nicht für
            // zugestellt halten (sonst ginge eine Rücknahme still verloren), sondern loggen und mit Backoff erneut senden.
            if (ergebnis === 'veraltet') return res.status(409).end();
            // Push nach dem Übernehmen, ohne den Ingest warten zu lassen oder scheitern zu lassen.
            if (ergebnis === 'uebernommen' && push.konfig.aktiv && push.sender) {
                pruefeUndSende(knex, paket.turnierKey, { sender: push.sender, konfig: push.konfig, jetzt })
                    .catch(f => console.error('[LivePush] Auswertung fehlgeschlagen:', f.message));
            }
            return res.status(204).end();
        } catch (fehler) {
            if (fehler.code === 'UNGUELTIG') return res.status(400).json({ error: fehler.message });
            console.error('[LiveCloud] Ingest fehlgeschlagen:', fehler.message);
            return res.status(500).end();
        }
    });

    // Zugangscode der Teilnehmer-App verwalten: mit dem Ingest-Token des Turniers (Hallen-Server). GET legt den Code beim ersten Aufruf an.
    const mitTurnierToken = (aktion) => async (req, res) => {
        try {
            const auth = /^Bearer (.+)$/.exec(req.get('authorization') || '');
            const token = auth ? await pruefeToken(knex, auth[1], { jetzt }) : null;
            if (!token || !token.turnierKey) {
                return res.status(fehlerBegrenzung.erlaube(clientIp(req, env)) ? 401 : 429).end();
            }
            res.json(await aktion(token.turnierKey, req.body && typeof req.body === 'object' ? req.body : {}));
        } catch (fehler) {
            console.error('[LiveCloud] Zugang fehlgeschlagen:', fehler.message);
            res.status(500).end();
        }
    };
    router.get('/zugang', mitTurnierToken((key) => holeOderErzeuge(knex, key)));
    router.post('/zugang/erneuern', mitTurnierToken((key) => erneuere(knex, key)));
    router.post('/zugang/sperren', mitTurnierToken((key, body) => setzeGesperrt(knex, key, body.gesperrt !== false)));

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

    // Der Code aus dem QR-Code wird gegen das Turnier eingetauscht; ohne gültigen Code erfährt niemand etwas über Turniere.
    // Eine Liste aller Turniere gibt es nicht mehr, die Schlüssel allein reichen nicht (Zugangspflicht unten).
    const ABGEWIESEN = {
        ungueltig: [401, { error: 'Zugang erforderlich', code: 'zugang' }],
        gesperrt: [403, { error: 'Der Zugang wurde gesperrt', code: 'gesperrt' }],
        abgelaufen: [403, { error: 'Der Zugang ist abgelaufen', code: 'abgelaufen' }]
    };
    const weise = (req, res, grund) => {
        // Nur ein ungültiger Code zählt als Rateversuch; abgelaufen und gesperrt setzen einen richtigen Code voraus.
        if (grund === 'ungueltig' && !zugangBegrenzung.erlaube(clientIp(req, env))) return res.status(429).json({ error: 'Zu viele Fehlversuche' });
        const [status, koerper] = ABGEWIESEN[grund] || ABGEWIESEN.ungueltig;
        return res.status(status).json(koerper);
    };
    router.post('/zugang/aufloesen', async (req, res) => {
        try {
            const code = req.body && typeof req.body.code === 'string' ? req.body.code : '';
            const r = await loeseCodeAuf(knex, code, { jetzt });
            if (!r.ok) return weise(req, res, r.grund);
            res.json({ key: r.key, name: r.name, datum: r.datum, serverzeit: jetzt().toISOString() });
        } catch (f) { fehler500(res, f); }
    });

    // Alle Daten eines Turniers nur mit dem Code im Kopf X-Live-Zugang (auch Push-Anmeldung und Übersicht).
    router.use('/turniere/:key', schluesselPruefen, async (req, res, next) => {
        try {
            const r = await pruefeZugang(knex, req.params.key, req.get('x-live-zugang') || '', { jetzt });
            if (!r.ok) return weise(req, res, r.grund);
            next();
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
            const q = String(req.query.q ?? '').slice(0, 100);
            const [treffer, teams] = await Promise.all([suche(knex, req.params.key, q), sucheMannschaften(knex, req.params.key, q)]);
            res.json({ treffer, mannschaften: teams.mannschaften, mitglieder: teams.mitglieder });
        } catch (f) { fehler500(res, f); }
    });

    router.get('/turniere/:key/pools', schluesselPruefen, async (req, res) => {
        try {
            if (!(await ladeTurnier(knex, req.params.key))) return res.status(404).json({ error: 'Turnier nicht gefunden' });
            res.json({ pools: await listePools(knex, req.params.key) });
        } catch (f) { fehler500(res, f); }
    });

    router.get('/turniere/:key/mannschaften', schluesselPruefen, async (req, res) => {
        try {
            if (!(await ladeTurnier(knex, req.params.key))) return res.status(404).json({ error: 'Turnier nicht gefunden' });
            res.json({ pools: await listeMannschaftsPools(knex, req.params.key) });
        } catch (f) { fehler500(res, f); }
    });

    router.get('/turniere/:key/mannschaften/:teamKey', schluesselPruefen, async (req, res) => {
        if (!SCHLUESSEL.test(req.params.teamKey)) return res.status(400).json({ error: 'Ungültiger Mannschaftsschlüssel' });
        try {
            const team = await ladeMannschaft(knex, req.params.key, req.params.teamKey);
            if (!team) return res.status(404).json({ error: 'Mannschaft nicht gefunden' });
            res.json(team);
        } catch (f) { fehler500(res, f); }
    });

    router.get('/turniere/:key/dashboard', schluesselPruefen, async (req, res) => {
        try {
            const dashboard = await ladeDashboard(knex, req.params.key);
            if (!dashboard) return res.status(404).json({ error: 'Turnier nicht gefunden' });
            res.json({ serverzeit: jetzt().toISOString(), ...dashboard });
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

    // Push-Anmeldung (Phase 3): ohne VAPID-Konfiguration 503, die App arbeitet dann ohne Benachrichtigungen weiter.
    const pushAus = (res) => res.status(503).json({ error: 'Push ist nicht eingerichtet' });
    router.get('/push/schluessel', (req, res) => {
        if (!push.konfig.aktiv) return pushAus(res);
        res.json({ schluessel: push.konfig.publicKey });
    });
    router.put('/turniere/:key/push', schluesselPruefen, async (req, res) => {
        if (!push.konfig.aktiv) return pushAus(res);
        try {
            const body = req.body && typeof req.body === 'object' ? req.body : {};
            const ergebnis = await meldeAn(knex, req.params.key, body, { konfig: push.konfig, jetzt });
            if (ergebnis.status === 'unbekannt') return res.status(404).json({ error: 'Turnier nicht gefunden' });
            res.status(204).end();
        } catch (f) {
            if (f.code === 'UNGUELTIG') return res.status(400).json({ error: f.message });
            if (f.code === 'ZU_VIELE') return res.status(429).json({ error: f.message });
            fehler500(res, f);
        }
    });
    router.delete('/turniere/:key/push', schluesselPruefen, async (req, res) => {
        if (!push.konfig.aktiv) return pushAus(res);
        try {
            await meldeAb(knex, req.params.key, req.body && req.body.endpoint);
            res.status(204).end();
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
                teilnehmer: await uebersicht(knex, req.params.key, body),
                mannschaften: await uebersichtMannschaften(knex, req.params.key, body)
            });
        } catch (f) { fehler500(res, f); }
    });

    return router;
}
