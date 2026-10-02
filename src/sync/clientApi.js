// Client-API (nur SYNC_ROLLE=client): beantwortet die Lese-Endpunkte, die Waage (teilnehmer.html),
// Scoreboard (steuerung.html), Mattenleitung (kampf.html) und menu.js brauchen, aus den lokalen
// Dokumenten — in derselben Form wie der Server. Schreibvorgänge laufen nicht hierüber, sondern
// über public/js/datenzugriff.js direkt in die lokale Dokument-DB (/db); alle übrigen
// Verwaltungsfunktionen gibt es nur am Hallen-Server.
import express from 'express';
import path from 'path';
import { createHash } from 'crypto';
import { baueMattenAnsicht } from '../shared/mattenAnsicht.js';

const NUR_AM_SERVER = 'Nur am Hallen-Server verfügbar.';

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

async function dokumenteNachTyp(db) {
    const res = await db.allDocs({ include_docs: true });
    const nachTyp = {};
    for (const row of res.rows) {
        const doc = row.doc;
        if (!doc || !doc.dokumenttyp) continue;
        (nachTyp[doc.dokumenttyp] = nachTyp[doc.dokumenttyp] || []).push(doc);
    }
    return nachTyp;
}

function parseListe(wert) {
    if (typeof wert !== 'string') return wert || [];
    try {
        return JSON.parse(wert);
    } catch (e) {
        return wert ? wert.split(',') : [];
    }
}

// Entfernt Sync-Metadaten, damit die Antworten wie die des Servers aussehen.
function alsZeile(doc) {
    const { _id, _rev, _conflicts, dokumenttyp, sql_id, bearbeitet_von, geschrieben_von_knoten, letzte_ablehnung, ...zeile } = doc;
    return zeile;
}

export function getClientApiRoutes(holeClient) {
    const router = express.Router();

    // Ohne lokale Turnier-DB (erster Start ohne Serververbindung) gibt es nichts zu lesen.
    router.use(async (req, res, next) => {
        const client = holeClient();
        if (!client || !client.zustand.db) {
            return res.status(503).json({ error: 'Noch keine Turnierdaten — bitte einmal mit dem Hallen-Server verbinden.' });
        }
        req.lokaleDb = client.zustand.db;
        next();
    });

    router.get('/auth/mode', async (req, res) => {
        const konfig = await req.lokaleDb.get('konfig:steuerung').catch(() => null);
        res.json({ passwordRequired: !!(konfig && konfig.steuerung_passwort_sha256) });
    });

    // Steuerungs-Passwort offline prüfen: Vergleich gegen den replizierten SHA-256-Hash.
    router.post('/auth/verify', async (req, res) => {
        const konfig = await req.lokaleDb.get('konfig:steuerung').catch(() => null);
        const eingabe = req.headers['x-steuerung-password'] || (req.body && req.body.password) || '';
        const hash = createHash('sha256').update(String(eingabe)).digest('hex');
        if (konfig && konfig.steuerung_passwort_sha256 && hash === konfig.steuerung_passwort_sha256) {
            return res.json({ success: true });
        }
        return res.status(401).json({ success: false, error: 'Ungültiges Passwort.' });
    });

    // Wie der Offline-Mock-Benutzer des Hallen-Servers (requireAuth bei IS_OFFLINE=true).
    router.get('/auth/me', (req, res) => {
        res.json({
            success: true,
            user: {
                id: 'offline_user', email: 'offline@hajime.os', vorname: 'Offline', nachname: 'User',
                verein_id: null, verein_name: 'Offline Club', verein_freigegeben: true,
                verein_wartet_auf_super_admin: false, verein_mitglieder_anzahl: 1, ist_super_admin: false, vereine: []
            }
        });
    });

    function turnierAntwort(doc, teilnehmerAnzahl) {
        const turnier = alsZeile(doc);
        turnier.altersklassen = parseListe(turnier.altersklassen);
        turnier.mannschafts_altersklassen = parseListe(turnier.mannschafts_altersklassen);
        turnier.teilnehmer_anzahl = teilnehmerAnzahl;
        return turnier;
    }

    router.get('/turniere', async (req, res) => {
        const docs = await dokumenteNachTyp(req.lokaleDb);
        res.json((docs.turnier || []).map(t => turnierAntwort(t, (docs.teilnehmer || []).length)));
    });

    router.get('/turniere/:id', async (req, res) => {
        const docs = await dokumenteNachTyp(req.lokaleDb);
        const turnier = (docs.turnier || []).find(t => String(t.id) === String(req.params.id));
        if (!turnier) return res.status(404).json({ error: 'Turnier nicht gefunden.' });
        res.json(turnierAntwort(turnier, (docs.teilnehmer || []).filter(t => t.sql_id != null).length));
    });

    router.get('/kampfflaechen', async (req, res) => {
        const docs = await dokumenteNachTyp(req.lokaleDb);
        res.json((docs.kampfflaeche || [])
            .filter(k => String(k.turnier_id) === String(req.query.turnierId))
            .sort((a, b) => a.id - b.id)
            .map(alsZeile));
    });

    router.get('/kaempfe', async (req, res) => {
        if (!req.query.kampfflaecheId) return res.status(400).json({ success: false, error: NUR_AM_SERVER });
        const docs = await dokumenteNachTyp(req.lokaleDb);
        res.json(baueMattenAnsicht({
            kaempfe: docs.kampf || [], pools: docs.pool || [], teilnehmer: docs.teilnehmer || [],
            mannschaftskaempfe: docs.mannschaftskampf || [], mannschaften: docs.mannschaft || []
        }, req.query.kampfflaecheId, Date.now()).map(alsZeile));
    });

    router.get('/teilnehmer', async (req, res) => {
        const docs = await dokumenteNachTyp(req.lokaleDb);
        const liste = (docs.teilnehmer || [])
            .filter(t => String(t.turnier_id) === String(req.query.turnierId) && t.id != null && !t.dublette_von)
            .map(alsZeile)
            .sort((a, b) => String(a.nachname).localeCompare(String(b.nachname), 'de'));
        res.json(liste);
    });

    router.get('/teilnehmer/:id', async (req, res) => {
        const docs = await dokumenteNachTyp(req.lokaleDb);
        const t = (docs.teilnehmer || []).find(d => String(d.id) === String(req.params.id));
        if (!t) return res.status(404).json({ success: false, error: 'Teilnehmer nicht gefunden.' });
        res.json(alsZeile(t));
    });

    // Mannschaftszuordnung an der Waage gibt es nur am Server (Spec Abschnitt 4).
    router.get('/mannschaften', (req, res) => res.json([]));

    // Teilnehmerliste gesperrt, sobald echte Kämpfe laufen (gleiche Regel wie poolController).
    router.get('/pools/vorhanden', async (req, res) => {
        const docs = await dokumenteNachTyp(req.lokaleDb);
        const poolIds = new Set((docs.pool || []).filter(p => String(p.turnier_id) === String(req.query.turnierId)).map(p => p.id));
        const gesperrt = (docs.kampf || []).some(k => poolIds.has(k.pool_id) && ['gestartet', 'beendet'].includes(k.status));
        res.json({ gesperrt });
    });

    router.get('/{*pfad}', (req, res) => res.status(404).json({ success: false, error: NUR_AM_SERVER }));
    router.all('/{*pfad}', (req, res) => res.status(403).json({ success: false, error: NUR_AM_SERVER }));

    return router;
}
