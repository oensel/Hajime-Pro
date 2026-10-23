import fs from 'fs';
import path from 'path';
import express from 'express';
import { erzeugeApiRatenbegrenzung } from '../middleware/apiRatenbegrenzung.js';
import { requireAuth, requireSuperAdmin } from '../middleware/auth.js';
import { pruefeCodeFuerAktion } from '../services/zweiFaktor.js';
import { meldeInfo } from '../services/fehlerProtokoll.js';
import { leseSicherungsKonfig, leseStatus, fuehreAutomatischeSicherungAus } from '../services/sicherungsPlaner.js';
import {
    SicherungsFehler, schreibeSicherung, schreibeSicherungsdatei, listeSicherungsdateien, loescheSicherungsdatei,
    pruefeDateiname, stelleWiederHer, sicherungsVerzeichnis, endungFuer
} from '../services/datensicherung.js';
import { leseSicherungsPasswort } from '../services/sicherungsVerschluesselung.js';

export const BESTAETIGUNGSWORT = 'WIEDERHERSTELLEN';

/** Liest den Rest einer Anfrage und verwirft ihn (höchstens 20 Sekunden), damit die Antwort ohne Verbindungsabbruch ankommt. */
function entleere(req) {
    return new Promise((resolve) => {
        const zeitgeber = setTimeout(resolve, 20_000);
        const fertig = () => { clearTimeout(zeitgeber); resolve(); };
        req.once('end', fertig);
        req.once('close', fertig);
        req.once('error', fertig);
        req.resume();
    });
}

// /api/sicherung (nur Cloud, nur Super-Admin im Super-Admin-Modus): Komplettsicherung der Datenbank als Datei und Wiedereinspielen
// (src/services/datensicherung.js). Jede Aktion verlangt im Header X-2FA-Code den aktuellen Code der Authenticator-App (oder einen
// Backup-Code), Wiederherstellen zusätzlich X-Bestaetigung: WIEDERHERSTELLEN. Das Wiederherstellen legt vorher automatisch eine
// Sicherung des aktuellen Stands auf dem Server ab (vor-wiederherstellung-….hajime-sicherung.gz).
export function getSicherungRoutes(knex, { verzeichnis = sicherungsVerzeichnis(), konfig = leseSicherungsKonfig() } = {}) {
    const router = express.Router();
    router.use(erzeugeApiRatenbegrenzung(), requireAuth, requireSuperAdmin(knex));

    const mitCode = (handler) => async (req, res) => {
        try {
            const pruefung = await pruefeCodeFuerAktion(knex, req.user.id, req.get('x-2fa-code'));
            if (!pruefung.ok) return res.status(pruefung.status).json({ success: false, error: pruefung.error });
            await handler(req, res);
        } catch (err) {
            if (res.headersSent) return res.destroy(err);
            res.removeHeader('Content-Disposition');
            if (!(err instanceof SicherungsFehler)) console.error('[Sicherung-Fehler]:', err);
            res.status(err instanceof SicherungsFehler ? err.status : 500).json({
                success: false, error: err instanceof SicherungsFehler ? err.message : 'Fehler bei der Sicherung.'
            });
        }
    };
    const dateiName = (req) => {
        if (!pruefeDateiname(req.params.name)) throw new SicherungsFehler('Ungültiger Dateiname.');
        return req.params.name;
    };
    const sendeDatei = (res, name, groesse) => {
        res.set({ 'Content-Type': name.endsWith('.enc') ? 'application/octet-stream' : 'application/gzip', 'Content-Disposition': `attachment; filename="${name}"`, ...(groesse ? { 'Content-Length': groesse } : {}) });
    };

    router.get('/', async (_req, res) => {
        try {
            let verschluesselung;
            try {
                verschluesselung = { aktiv: !!leseSicherungsPasswort(), fehler: null };
            } catch (err) {
                verschluesselung = { aktiv: true, fehler: err.message }; // Passwort eingestellt, aber unbrauchbar: Sicherungen scheitern
            }
            res.json({
                success: true, verzeichnis, verschluesselung, dateien: await listeSicherungsdateien(verzeichnis),
                // Zeitplan der automatischen Sicherung und Stand des letzten Laufs (siehe src/services/sicherungsPlaner.js)
                automatik: {
                    aktiv: konfig.automatisch, uhrzeit: konfig.uhrzeit, behalte: konfig.behalte,
                    kopieVerzeichnis: konfig.kopieVerzeichnis || null, befehl: !!konfig.nachBefehl, status: await leseStatus(verzeichnis)
                }
            });
        } catch (err) {
            console.error('[Sicherung-Liste-Fehler]:', err);
            res.status(500).json({ success: false, error: 'Die Sicherungen konnten nicht gelesen werden.' });
        }
    });

    router.post('/erstellen', mitCode(async (req, res) => {
        const datei = await schreibeSicherungsdatei(knex, verzeichnis);
        meldeInfo(`Sicherung: ${req.user.email} hat ${datei.name} auf dem Server abgelegt.`);
        res.json({ success: true, datei: { name: datei.name, groesse: datei.groesse } });
    }));

    // Den Lauf der automatischen Sicherung jetzt ausführen (Probe für Kopie-Ziel und Befehl)
    router.post('/automatisch-jetzt', mitCode(async (req, res) => {
        meldeInfo(`Sicherung: ${req.user.email} startet die automatische Sicherung von Hand.`);
        const status = await fuehreAutomatischeSicherungAus(knex, verzeichnis, konfig);
        res.json({ success: true, status });
    }));

    router.post('/herunterladen', mitCode(async (req, res) => {
        const name = `hajime-pro-${new Date().toISOString().slice(0, 10)}${endungFuer(leseSicherungsPasswort())}`;
        sendeDatei(res, name);
        meldeInfo(`Sicherung: ${req.user.email} lädt eine Sicherung herunter.`);
        await schreibeSicherung(knex, res);
    }));

    router.post('/dateien/:name/herunterladen', mitCode(async (req, res) => {
        const name = dateiName(req);
        const pfad = path.join(verzeichnis, name);
        let groesse;
        try {
            groesse = (await fs.promises.stat(pfad)).size;
        } catch {
            throw new SicherungsFehler('Die Sicherung gibt es nicht.', 404);
        }
        sendeDatei(res, name, groesse);
        fs.createReadStream(pfad).pipe(res);
    }));

    router.delete('/dateien/:name', mitCode(async (req, res) => {
        await loescheSicherungsdatei(verzeichnis, dateiName(req));
        meldeInfo(`Sicherung: ${req.user.email} hat ${req.params.name} gelöscht.`);
        res.json({ success: true });
    }));

    // Quelle: eine Datei auf dem Server (?datei=<Name>) oder der hochgeladene Body (application/octet-stream, nicht geparst)
    router.post('/wiederherstellen', mitCode(async (req, res) => {
        try {
            if (req.get('x-bestaetigung') !== BESTAETIGUNGSWORT) {
                throw new SicherungsFehler(`Zur Bestätigung bitte „${BESTAETIGUNGSWORT}“ eingeben.`);
            }
            let quelle;
            if (req.query.datei !== undefined) {
                if (!pruefeDateiname(String(req.query.datei))) throw new SicherungsFehler('Ungültiger Dateiname.');
                const pfad = path.join(verzeichnis, String(req.query.datei));
                if (!fs.existsSync(pfad)) throw new SicherungsFehler('Die Sicherung gibt es nicht.', 404);
                quelle = fs.createReadStream(pfad);
            } else {
                quelle = req;
            }
            let vorher = null;
            meldeInfo(`Sicherung: ${req.user.email} spielt eine Sicherung ein (${req.query.datei || 'Upload'}).`);
            const ergebnis = await stelleWiederHer(knex, quelle, {
                vorher: async () => { vorher = await schreibeSicherungsdatei(knex, verzeichnis, 'vor-wiederherstellung', { ohneSperre: true }); }
            });
            meldeInfo(`Sicherung: Wiederherstellung abgeschlossen: ${ergebnis.tabellen} Tabellen, ${ergebnis.zeilen} Zeilen.`);
            res.json({ success: true, ...ergebnis, vorherSicherung: vorher ? vorher.name : null });
        } catch (err) {
            // Ein nicht zu Ende gelesener Upload würde die Verbindung beim Antworten zurücksetzen: der Browser sähe keinen Fehlertext.
            if (!req.readableEnded) await entleere(req);
            throw err;
        }
    }));

    return router;
}
