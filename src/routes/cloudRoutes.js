import express from 'express';
import { erzeugeApiRatenbegrenzung } from '../middleware/apiRatenbegrenzung.js';
import { importiereTurnierDaten, baueTurnierExport } from '../controllers/turnierController.js';
import { FachFehler } from '../utils/fachFehler.js';
import { ersetzeHelferplan } from '../services/helferTransfer.js';
import betriebsmodus from '../config/betriebsmodus.cjs';
import { liesGeraeteSchluessel, speichereGeraeteSchluessel } from '../utils/releaseQuelle.js';

// Turniere des eigenen Vereins aus der Cloud auf den Hallen-Server holen (Turnierauswahl) und nach dem Wettkampftag
// zurückspielen (Startgeld-Abrechnung, Spec docs/superpowers/specs/2026-10-24-startgeld-abrechnung-design.md).
// Nur im Einzelbenutzerbetrieb (Hallen-Server); in der Cloud selbst gibt es die Funktion nicht.
export function getCloudRoutes(knex, { cloud, holeCluster = () => null, datenDir = '' }) {
    const router = express.Router();
    router.use(erzeugeApiRatenbegrenzung());

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
            // Zwei-Faktor-Bedarf (Super-Admin): die Oberfläche fragt dann den Code ab und wiederholt
            if (e.code === 'zwei_faktor') return res.status(status).json({ success: false, zweiFaktor: true, code: e.code, error: e.message });
            // Turnier am selben Tag vorhanden: die Oberfläche fragt, ob es ersetzt werden soll
            if (e.code === 'termin_konflikt') return res.status(status).json({ success: false, terminKonflikt: e.daten, code: e.code, error: e.message });
            return res.status(status).json({ success: false, error: e.message });
        }
        console.error(`[Cloud-${kontext}-Fehler]:`, e.message);
        return res.status(500).json({ success: false, error: e.message });
    }

    // Nebenprodukt der Anmeldung: hat dieser Server noch keinen Geräteschlüssel, holt er sich einen, damit sich Programm und
    // Client-Dateien danach ohne Zutun aus der Cloud aktualisieren. Scheitert das (ältere Cloud, Konto nicht berechtigt), geht alles
    // andere weiter; die Anmeldung gehört der Person, der Schlüssel ist an ihr Konto gebunden und endet mit dessen Freigabe.
    async function richteGeraeteSchluesselEin(token) {
        if (!datenDir || liesGeraeteSchluessel({ datenDir })) return;
        try {
            speichereGeraeteSchluessel(datenDir, await cloud.holeGeraeteSchluessel(token));
        } catch (e) {
            console.warn(`[Cloud] Geräteschlüssel für Updates nicht eingerichtet: ${e.message}`);
        }
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
            const { email, password, code } = req.body || {};
            if (!email || !password) {
                return res.status(400).json({ success: false, error: 'Benutzer und Passwort sind erforderlich.' });
            }
            const { token, user } = await cloud.meldeAn(String(email), String(password), { code: code ? String(code) : null });
            await richteGeraeteSchluesselEin(token);
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
            const { token, ersetzen } = req.body || {};
            if (!token) return res.status(400).json({ success: false, error: 'Cloud-Anmeldung fehlt.' });
            const turnierId = parseInt(req.params.id, 10);
            if (!Number.isInteger(turnierId) || turnierId <= 0) {
                return res.status(400).json({ success: false, error: 'Ungültige Turnier-ID.' });
            }
            const daten = await cloud.ladeExport(String(token), turnierId, { liveToken: true });
            const ergebnis = await importiereTurnierDaten(knex, req.app.get('sync'), daten, { ersetzen: ersetzen === true, terminAbfragen: true });
            return res.status(201).json({ success: true, ...ergebnis });
        } catch (e) {
            return fehler(res, e, 'Holen');
        }
    });

    // Helferplan aus der Cloud aktualisieren (Helferverwaltung, Spec Abschnitt 8): ersetzt NUR den Helferplan
    // des lokalen Turniers, das aus dem Cloud-Turnier :id stammt (urspruengliche_id). Turnier, Teilnehmer und
    // Pools bleiben unberührt; die Einsätze werden komplett durch den Stand der Cloud ersetzt.
    router.post('/turniere/:id/helferplan', async (req, res) => {
        try {
            const { token } = req.body || {};
            if (!token) return res.status(400).json({ success: false, error: 'Cloud-Anmeldung fehlt.' });
            const cloudId = parseInt(req.params.id, 10);
            if (!Number.isInteger(cloudId) || cloudId <= 0) {
                return res.status(400).json({ success: false, error: 'Ungültige Turnier-ID.' });
            }
            const lokal = await knex('turniere').where({ urspruengliche_id: cloudId }).orderBy('id', 'desc').first('id');
            if (!lokal) {
                return res.status(404).json({
                    success: false,
                    error: 'Zu diesem Cloud-Turnier gibt es hier kein Turnier. Bitte das Turnier zuerst aus der Cloud holen.'
                });
            }
            const daten = await cloud.ladeExport(String(token), cloudId);
            if (!daten.helferplan || !Array.isArray(daten.helferplan.taetigkeiten)) {
                return res.status(422).json({ success: false, error: 'Die Cloud liefert für dieses Turnier keinen Helferplan.' });
            }
            const anzahl = await knex.transaction(trx => ersetzeHelferplan(trx, lokal.id, daten.helferplan));
            return res.json({ success: true, turnierId: lokal.id, ...anzahl });
        } catch (e) {
            return fehler(res, e, 'Helferplan');
        }
    });

    // Turnier in die Cloud zurückspielen: Export des lokalen Turniers, das aus dem Cloud-Turnier :cloudId stammt
    // (urspruengliche_id, das jüngste), wie die Datei „Ergebnisse hochladen“ an die Cloud. Die Cloud prüft Rolle
    // (Admin des Ausrichters), Turnier, Vollständigkeit und schützt Zahlungsdaten und Rechnungen.
    router.post('/turniere/:cloudId/zurueckspielen', async (req, res) => {
        try {
            const cluster = holeCluster();
            if (cluster && !cluster.darfSchreiben()) {
                return res.status(409).json({ success: false, error: 'Zurückspielen geht nur am Master-Server.' });
            }
            const { token, code } = req.body || {};
            if (!token) return res.status(400).json({ success: false, error: 'Cloud-Anmeldung fehlt.' });
            const cloudId = parseInt(req.params.cloudId, 10);
            if (!Number.isInteger(cloudId) || cloudId <= 0 || String(cloudId) !== String(req.params.cloudId)) {
                return res.status(400).json({ success: false, error: 'Ungültige Turnier-ID.' });
            }
            const lokal = await knex('turniere').where({ urspruengliche_id: cloudId }).orderBy('id', 'desc').first();
            if (!lokal) {
                return res.status(404).json({ success: false, error: 'Zu diesem Cloud-Turnier gibt es hier kein Turnier.' });
            }
            const daten = await baueTurnierExport(knex, lokal.id, lokal);
            const antwort = await cloud.spieleZurueck(String(token), cloudId, daten, { code: code ? String(code) : null });
            return res.json({ ...antwort, success: true });
        } catch (e) {
            return fehler(res, e, 'Zurückspielen');
        }
    });

    return router;
}
