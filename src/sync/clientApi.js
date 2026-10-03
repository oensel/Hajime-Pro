// Client-API (nur SYNC_ROLLE=client): beantwortet die Lese-Endpunkte, die Waage (teilnehmer.html),
// Scoreboard (steuerung.html), Mattenleitung (kampf.html) und menu.js brauchen, aus den lokalen
// Dokumenten — in derselben Form wie der Server. Die Antworten selbst berechnet
// src/shared/clientAntworten.js (identisch in der Android-App); hier hängt nur der Express-Router
// davor. Schreibvorgänge laufen über public/js/datenzugriff.js direkt in die lokale Dokument-DB.
import express from 'express';
import path from 'path';
import { createHash } from 'crypto';
import { beantworteClientAnfrage } from '../shared/clientAntworten.js';

// Seiten, die ein Client ausliefert (Spec Abschnitt 4) — alle anderen .html-Seiten zeigen einen
// Hinweis statt der Verwaltungsoberfläche.
const ERLAUBTE_SEITEN = new Set([
    'client.html', 'steuerung.html', 'kampf.html', 'teilnehmer.html', 'anzeige.html', 'overlay.html', 'login.html'
]);

export function clientStatischeSeiten() {
    return (req, res, next) => {
        const datei = path.basename(req.path);
        if (!datei.endsWith('.html') || ERLAUBTE_SEITEN.has(datei)) return next();
        res.status(404).type('html').send(`<!DOCTYPE html><html lang="de"><head><meta charset="utf-8">
<title>Nur am Server</title></head><body style="font-family:sans-serif;padding:32px">
<h2>Diese Seite gibt es nur am Hallen-Server</h2>
<p>Dieses Gerät läuft als Client (Waage / Scoreboard / Mattenleitung). Die Turnierverwaltung ist
am Hallen-Server erreichbar.</p><p><a href="/client.html">Zur Startseite dieses Geräts</a></p>
</body></html>`);
    };
}

export function getClientApiRoutes(holeClient) {
    const router = express.Router();

    router.use(async (req, res) => {
        const client = holeClient();
        // Ohne lokale Turnier-DB (erster Start ohne Serververbindung) gibt es nichts zu lesen.
        if (!client || !client.zustand.db) {
            return res.status(503).json({ error: 'Noch keine Turnierdaten — bitte einmal mit dem Hallen-Server verbinden.' });
        }
        try {
            const antwort = await beantworteClientAnfrage(
                { methode: req.method, pfad: req.path, query: req.query, body: req.body, kopfzeilen: req.headers },
                { db: client.zustand.db, sha256Hex: async (text) => createHash('sha256').update(text).digest('hex') }
            );
            res.status(antwort.status).json(antwort.body);
        } catch (err) {
            console.error('[Client-API] Fehler:', err);
            res.status(500).json({ error: 'Interner Fehler' });
        }
    });

    return router;
}
