import express from 'express';
import { FachFehler } from '../utils/fachFehler.js';

// Teilnehmer-App am Hallen-Server: Status (Icon/Dialog/Hinweis) und Ein-/Ausschalten. Nur im Einzelbenutzerbetrieb eingehängt;
// im Cluster schreibt nur der Master (nurMaster lehnt den POST am Secondary ab), den Status liefert jeder Knoten.
export function getLiveAppRoutes(dienst) {
    const router = express.Router();

    function antworteFehler(res, fehler) {
        if (fehler instanceof FachFehler) {
            return res.status(fehler.statusCode).json({ success: false, error: fehler.message, grund: fehler.code || null });
        }
        console.error('[Teilnehmer-App-Fehler]:', fehler.message);
        return res.status(500).json({ success: false, error: fehler.message });
    }

    router.get('/status', async (req, res) => {
        try {
            res.set('Cache-Control', 'no-store');
            res.json(await dienst.status({ turnierId: parseInt(req.query.turnierId, 10) }));
        } catch (fehler) {
            antworteFehler(res, fehler);
        }
    });

    router.post('/schalter', async (req, res) => {
        try {
            const { turnierId, aktiv } = req.body || {};
            if (typeof aktiv !== 'boolean') {
                return res.status(400).json({ success: false, error: 'Feld "aktiv" muss true oder false sein.' });
            }
            res.json({ success: true, ...(await dienst.schalte({ turnierId: parseInt(turnierId, 10), aktiv })) });
        } catch (fehler) {
            antworteFehler(res, fehler);
        }
    });

    // Zugangscode für den QR-Code der Teilnehmer-App (liegt in der Cloud): abrufen, erneuern (alter Code sofort ungültig), sperren/freigeben
    router.get('/zugang', async (req, res) => {
        try {
            res.set('Cache-Control', 'no-store');
            res.json({ success: true, ...(await dienst.zugang({ turnierId: parseInt(req.query.turnierId, 10) })) });
        } catch (fehler) {
            antworteFehler(res, fehler);
        }
    });

    router.post('/zugang/erneuern', async (req, res) => {
        try {
            res.json({ success: true, ...(await dienst.erneuereZugang({ turnierId: parseInt((req.body || {}).turnierId, 10) })) });
        } catch (fehler) {
            antworteFehler(res, fehler);
        }
    });

    router.post('/zugang/sperren', async (req, res) => {
        try {
            const { turnierId, gesperrt } = req.body || {};
            if (typeof gesperrt !== 'boolean') return res.status(400).json({ success: false, error: 'Feld "gesperrt" muss true oder false sein.' });
            res.json({ success: true, ...(await dienst.sperreZugang({ turnierId: parseInt(turnierId, 10), gesperrt })) });
        } catch (fehler) {
            antworteFehler(res, fehler);
        }
    });

    return router;
}
