// Pfade, die ein Client-Gerät am Hallen-Server benutzt (/api/sync/status, /api/client/koppeln, /db/…), für ein Turnier, das die
// Cloud live führt. Gemountet unter /turnierlive/:schluessel: Geräte bekommen serverUrl = https://<cloud>/turnierlive/<schluessel>
// und brauchen deshalb keine Änderung in clientKern/replikation. Der Schlüssel bestimmt das Turnier, das Geheimnis (Header
// x-hajime-sync-secret) berechtigt zur Replikation genau dieser einen Dokument-DB.
import express from 'express';
import { erzeugeSperre } from '../sync/kopplung.js';
import { ladeZugangPerSchluessel, pruefeCode, pruefeGeheimnis } from './zugang.js';

// Unterpfade einer Turnier-DB, die eine Replikation braucht. Alles andere mit „_“ (Sicherheit, Verdichten, Löschen, …) bleibt gesperrt.
const ERLAUBTE_DB_PFADE = new Set(['_changes', '_bulk_docs', '_bulk_get', '_revs_diff', '_all_docs', '_local', '_ensure_full_commit', '_find']);
const LESEN = new Set(['GET', 'HEAD']);

function segmente(pfad) {
    return pfad.split('/').filter(Boolean).map((teil) => {
        try { return decodeURIComponent(teil); } catch { return teil; }
    });
}

export function getCloudLiveGeraeteRoutes({ knex, verwalter, schluesselVersuche = 30 }) {
    const router = express.Router({ mergeParams: true });
    const ipSperre = erzeugeSperre();
    // Zusätzlich je Schlüssel: der Code hat nur 10^6 Möglichkeiten, ein Angreifer mit dem Schlüssel soll nicht über viele IPs raten.
    const schluesselSperre = erzeugeSperre({ maxVersuche: schluesselVersuche });

    // Findet die Instanz des Schlüssels; beendet → 410, unbekannt → 404. Liefert null, wenn die Antwort schon gesendet ist.
    async function holeInstanz(req, res) {
        const instanz = verwalter.instanz(req.params.schluessel);
        if (instanz) return instanz;
        const zugang = await ladeZugangPerSchluessel(knex, req.params.schluessel);
        if (zugang && zugang.beendetAm) res.status(410).json({ error: 'beendet', reason: 'Der Live-Betrieb dieses Turniers wurde beendet.' });
        else res.status(404).json({ error: 'not_found' });
        return null;
    }

    router.get('/api/sync/status', async (req, res, next) => {
        try {
            const instanz = await holeInstanz(req, res);
            if (!instanz) return;
            res.json({
                rolle: 'server', instanz_id: instanz.instanzId, turnier_id: instanz.turnierId, db_name: instanz.dbName, modus: 'master'
            });
        } catch (fehler) { next(fehler); }
    });

    router.post('/api/client/koppeln', express.json({ limit: '10kb' }), async (req, res, next) => {
        try {
            const instanz = await holeInstanz(req, res);
            if (!instanz) return;
            const ip = req.ip || req.socket.remoteAddress || '';
            for (const [sperre, schluessel] of [[ipSperre, ip], [schluesselSperre, req.params.schluessel]]) {
                const pruefung = sperre.pruefe(schluessel);
                if (pruefung.gesperrt) {
                    return res.status(429).json({ error: 'Zu viele Fehlversuche.', restSekunden: Math.ceil(pruefung.restMs / 1000) });
                }
            }
            const ergebnis = await pruefeCode(knex, req.params.schluessel, req.body && req.body.code);
            if (!ergebnis.ok) {
                if (ergebnis.grund === 'ungueltig') {
                    ipSperre.fehlversuch(ip);
                    schluesselSperre.fehlversuch(req.params.schluessel);
                    return res.status(401).json({ error: 'Code falsch' });
                }
                return res.status(403).json({ error: ergebnis.grund === 'gesperrt' ? 'Der Zugang ist gesperrt.' : 'Der Zugang ist abgelaufen.', grund: ergebnis.grund });
            }
            ipSperre.erfolg(ip);
            console.log(`[Cloud-Live] Gerät ${String((req.body && req.body.clientId) || '?')} (${ip}) an Turnier ${instanz.turnierId} gekoppelt.`);
            res.json({ secret: ergebnis.geheimnis });
        } catch (fehler) { next(fehler); }
    });

    // Dokument-DB (express-pouchdb): Geheimnis prüfen, dann nur die Replikationspfade der eigenen Turnier-DB durchlassen.
    router.use('/db', async (req, res, next) => {
        try {
            const instanz = await holeInstanz(req, res);
            if (!instanz) return;
            const geheimnis = req.headers['x-hajime-sync-secret'];
            const pruefung = await pruefeGeheimnis(knex, req.params.schluessel, Array.isArray(geheimnis) ? geheimnis[0] : geheimnis);
            if (!pruefung.ok) {
                const status = pruefung.grund === 'ungueltig' ? 401 : 403;
                return res.status(status).json({ error: 'unauthorized', reason: pruefung.grund });
            }
            const teile = segmente(req.path);
            if (teile.length === 0) {
                if (req.method !== 'GET') return res.status(404).json({ error: 'not_found' });
                return verwalter.dokumentMiddleware(req, res, next);
            }
            if (teile[0] !== instanz.dbName) return res.status(404).json({ error: 'not_found', reason: 'Keine Turnier-DB' });
            if (teile.length === 1 && !LESEN.has(req.method)) return res.status(403).json({ error: 'forbidden' });
            if (teile.length > 1 && teile[1].startsWith('_') && !ERLAUBTE_DB_PFADE.has(teile[1])) {
                return res.status(403).json({ error: 'forbidden' });
            }
            return verwalter.dokumentMiddleware(req, res, next);
        } catch (fehler) { next(fehler); }
    });

    return router;
}
