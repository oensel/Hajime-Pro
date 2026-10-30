// Verteilung des Desktop-Clients (Spec Desktop-Client Abschnitt 5): version.json der zur
// Serverversion passenden Client-Dateien, Kopplung neuer Geräte per Code, Kopplungscode für die
// Turnierleitung (matten.html). Nur Hallen-Server (SYNC_ROLLE=server).
import express from 'express';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { requireSteuerungPasswort } from '../middleware/auth.js';
import { erzeugeApiRatenbegrenzung } from '../middleware/apiRatenbegrenzung.js';
import * as steuerungPasswort from '../utils/steuerungPasswort.js';
import { erneuereCode, erzeugeSperre, normalisiereCode } from '../sync/kopplung.js';
import { lokaleIpv4Adressen, ordneServerAdressen } from '../sync/ankuendigung.js';

export function getClientVerteilungRoutes({ datenverzeichnis, downloadsVerzeichnis, version, kopplung, vip = '', clientDateienStatus = () => null, nachPasswortAenderung = () => {} }) {
    const router = express.Router();
    const sperre = erzeugeSperre();

    router.get('/version', (req, res) => {
        const datei = path.join(path.resolve(downloadsVerzeichnis), version, 'version.json');
        if (!existsSync(datei)) {
            // status: Stand der automatischen Bereitstellung (src/sync/clientDateien.js) — die Download-Seite
            // zeigt ihn an, statt nur "keine Dateien".
            return res.status(404).json({ success: false, error: `Für Version ${version} liegen am Server keine Client-Dateien vor.`, status: clientDateienStatus() });
        }
        res.type('application/json').send(readFileSync(datei, 'utf8'));
    });

    router.post('/koppeln', (req, res) => {
        const ip = req.socket.remoteAddress || '';
        const pruefung = sperre.pruefe(ip);
        if (pruefung.gesperrt) {
            return res.status(429).json({ error: 'Zu viele Fehlversuche.', restSekunden: Math.ceil(pruefung.restMs / 1000) });
        }
        if (normalisiereCode(req.body && req.body.code) !== kopplung.code) {
            sperre.fehlversuch(ip);
            return res.status(401).json({ error: 'Code falsch' });
        }
        sperre.erfolg(ip);
        console.log(`[Kopplung] Gerät ${String(req.body.clientId || '?')} (${ip}) gekoppelt.`);
        res.json({ secret: kopplung.secret });
    });

    // LAN-Adressen des Servers (IP statt turnier.local): Android löst .local-Namen in Apps nicht
    // zuverlässig auf, der QR-Code für die Android-App enthält deshalb eine IP-Adresse.
    // Die Adressen werden bei jedem Aufruf neu ermittelt (VIP-Wechsel, neue DHCP-Adresse); die erste ist
    // die beste (VIP, sonst die Adresse, unter der die Seite geöffnet wurde).
    const serverUrls = (req) => {
        const port = req.socket.localPort;
        const adressen = ordneServerAdressen(lokaleIpv4Adressen(), { angefragt: req.socket.localAddress, vip });
        return adressen.map(ip => `http://${ip}${port === 80 ? '' : `:${port}`}`);
    };

    router.get('/kopplungscode', requireSteuerungPasswort, (req, res) => res.json({ code: kopplung.code, urls: serverUrls(req) }));

    router.post('/kopplungscode/erneuern', requireSteuerungPasswort, (req, res) => {
        kopplung.code = erneuereCode({ datenverzeichnis });
        res.json({ code: kopplung.code, urls: serverUrls(req) });
    });

    // Schreibpasswort jederzeit neu vergeben, ohne das bisherige zu kennen (Client-Konfig, nur Hallen-Server).
    // Bewusst ohne Passwortprüfung: wer den Hallen-Server im Netz erreicht, darf es setzen (Zugriffsschutz = das WLAN der Halle).
    // Der Cluster-Standby leitet an den Master weiter (nurMaster), die Änderung wird über die Tabelle repliziert.
    router.post('/steuerung-passwort', erzeugeApiRatenbegrenzung(), async (req, res) => {
        try {
            await steuerungPasswort.aendere(req.body && req.body.neuesPasswort, { gleichErlaubt: true });
            nachPasswortAenderung();
            console.log(`[Steuerungs-Passwort] Neu gesetzt von ${req.socket.remoteAddress || '?'} (Client-Konfig).`);
            res.json({ success: true });
        } catch (error) {
            if (error.status === 400) return res.status(400).json({ success: false, error: error.message });
            console.error('[Steuerungs-Passwort-Fehler]:', error);
            res.status(500).json({ success: false, error: 'Das Passwort konnte nicht gespeichert werden.' });
        }
    });

    return router;
}
