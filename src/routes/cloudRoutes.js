import express from 'express';
import { importiereTurnierDaten } from '../controllers/turnierController.js';
import { FachFehler } from '../utils/fachFehler.js';
import betriebsmodus from '../config/betriebsmodus.cjs';

// Turniere des eigenen Vereins aus der Cloud auf den Hallen-Server holen (Turnierauswahl).
// Nur im Einzelbenutzerbetrieb (Hallen-Server); in der Cloud selbst gibt es die Funktion nicht.
export function getCloudRoutes(knex, { cloud, holeCluster = () => null }) {
    const router = express.Router();

    router.use((req, res, next) => {
        if (!betriebsmodus.istEinzelbenutzerBetrieb()) {
            return res.status(403).json({ success: false, error: 'Das Holen aus der Cloud ist nur an einem Hallen-Server verfügbar.' });
        }
        next();
    });

    function fehler(res, e, kontext) {
        if (e instanceof FachFehler) {
            // Ein 401 der Cloud (falsche Zugangsdaten) betrifft nicht die Sitzung an diesem Server:
            // menu.js leitet bei 401 auf die Anmeldeseite um, daher als 422 weiterreichen.
            const status = e.statusCode === 401 ? 422 : e.statusCode;
            return res.status(status).json({ success: false, error: e.message });
        }
        console.error(`[Cloud-${kontext}-Fehler]:`, e.message);
        return res.status(500).json({ success: false, error: e.message });
    }

    // Ist die Cloud konfiguriert und erreichbar (und dieser Server darf schreiben)?
    router.get('/status', async (req, res) => {
        try {
            const cluster = holeCluster();
            if (cluster && !cluster.darfSchreiben()) return res.json({ verfuegbar: false });
            const verfuegbar = cloud.konfiguriert() && await cloud.pruefeErreichbar();
            return res.json({ verfuegbar });
        } catch {
            return res.json({ verfuegbar: false });
        }
    });

    // Anmeldung an der Cloud und Liste der Turniere des Vereins des Benutzers.
    router.post('/turniere', async (req, res) => {
        try {
            const { email, password } = req.body || {};
            if (!email || !password) {
                return res.status(400).json({ success: false, error: 'Benutzer und Passwort sind erforderlich.' });
            }
            const { token, user } = await cloud.meldeAn(String(email), String(password));
            const turniere = await cloud.listeTurniere(token);
            return res.json({
                success: true,
                token,
                verein: user ? { id: user.verein_id ?? null, freigegeben: !!user.verein_freigegeben } : null,
                turniere: turniere.map(t => ({
                    id: t.id,
                    bezeichnung: t.bezeichnung,
                    ort: t.ort,
                    datum: t.datum,
                    ausrichter: t.ausrichter,
                    anmeldeschluss: t.anmeldeschluss || null,
                    status_effektiv: t.status_effektiv || t.status || null,
                    teilnehmer_anzahl: t.teilnehmer_anzahl ?? null,
                    verein_id: t.verein_id ?? null
                }))
            });
        } catch (e) {
            return fehler(res, e, 'Liste');
        }
    });

    // Turnier holen: Export aus der Cloud laden und wie den Datei-Import einspielen.
    router.post('/turniere/:id/holen', async (req, res) => {
        try {
            const { token } = req.body || {};
            if (!token) return res.status(400).json({ success: false, error: 'Cloud-Anmeldung fehlt.' });
            const turnierId = parseInt(req.params.id, 10);
            if (!Number.isInteger(turnierId) || turnierId <= 0) {
                return res.status(400).json({ success: false, error: 'Ungültige Turnier-ID.' });
            }
            const daten = await cloud.ladeExport(String(token), turnierId);
            const ergebnis = await importiereTurnierDaten(knex, req.app.get('sync'), daten);
            return res.status(201).json({ success: true, ...ergebnis });
        } catch (e) {
            return fehler(res, e, 'Holen');
        }
    });

    return router;
}
