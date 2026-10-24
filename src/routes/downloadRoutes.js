import express from 'express';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { createReadStream } from 'fs';
import { erzeugeApiRatenbegrenzung } from '../middleware/apiRatenbegrenzung.js';
import { requireAuth, requireSuperAdmin } from '../middleware/auth.js';
import { clientIp, erzeugeRatenbegrenzung } from '../liveCloud/ratenbegrenzung.js';
import { ermittleBasisUrl } from '../utils/basisUrl.js';
import { istSuperAdminAktiv, ladeVereinIdsMitRolle } from '../utils/vereinHelper.js';
import { pruefeCodeFuerAktion } from '../services/zweiFaktor.js';
import { meldeInfo } from '../services/fehlerProtokoll.js';
import { dateiGroesse, dateiPfad, liesIndex, listeVersionen, neuesteRelease, releaseVerzeichnis } from '../services/releaseSpeicher.js';
import {
    darfReleasesLaden, erzeugeEinloesecode, erzeugeGeraeteSchluessel, listeGeraeteSchluessel, loeseEinloesecodeAb,
    pruefeGeraeteSchluessel, widerrufeGeraeteSchluessel
} from '../services/releaseSchluessel.js';

export const TICKET_GUELTIG_MS = 60_000;
const MELDUNG_KEIN_ZUGRIFF = 'Installer und Updates dürfen nur freigeschaltete Benutzer, Admins und Super-Admins laden (Mitgliedschaft und Verein müssen freigegeben sein).';

// Dateiname mit dem Einlösecode vor der Endung: Hajime-Pro-Server-1.2.3-win-x64.exe -> Hajime-Pro-Server-1.2.3-win-x64.<Code>.exe
export function dateinameMitCode(name, code) {
    return name.replace(/(\.[^.]+)$/, `.${code}$1`);
}

// Nur die Installer des Hallen-Servers (Windows, Linux-AppImage) tragen einen Einlösecode.
export function bekommtEinloesecode(eintrag) {
    return eintrag.gruppe === 'server' && /\.(exe|AppImage)$/i.test(eintrag.name);
}

/** Ein Ticket ist ein 60 Sekunden gültiger, einmaliger Download-Link, der an Benutzer und Datei gebunden ist (der Browser sendet beim Download keinen Authorization-Header). */
export function erzeugeTicketDienst({ geheimnis = randomBytes(32), jetzt = Date.now } = {}) {
    const benutzt = new Map();
    const signiere = (teil) => createHmac('sha256', geheimnis).update(teil).digest('base64url');
    return {
        stelleAus({ benutzerId, version, datei }) {
            const teil = Buffer.from(JSON.stringify({ b: benutzerId, v: version, d: datei, e: jetzt() + TICKET_GUELTIG_MS, n: randomBytes(9).toString('base64url') })).toString('base64url');
            return `${teil}.${signiere(teil)}`;
        },
        loeseEin(ticket) {
            const [teil, signatur] = String(ticket || '').split('.');
            if (!teil || !signatur) return null;
            const soll = Buffer.from(signiere(teil));
            const ist = Buffer.from(signatur);
            if (soll.length !== ist.length || !timingSafeEqual(soll, ist)) return null;
            let daten;
            try { daten = JSON.parse(Buffer.from(teil, 'base64url').toString('utf8')); } catch { return null; }
            const zeit = jetzt();
            for (const [n, ende] of benutzt) if (ende < zeit) benutzt.delete(n);
            if (!daten || daten.e < zeit || benutzt.has(daten.n)) return null;
            benutzt.set(daten.n, daten.e);
            return { benutzerId: daten.b, version: daten.v, datei: daten.d };
        }
    };
}

/** Liefert eine Datei mit Range-Unterstützung (Wiederaufnahme großer Installer). */
export function sendeDatei(req, res, pfad, { name, anhang = false } = {}) {
    const groesse = dateiGroesse(pfad);
    const kopf = { 'Content-Type': 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-store' };
    if (anhang) kopf['Content-Disposition'] = `attachment; filename="${name.replace(/[^A-Za-z0-9._-]/g, '_')}"`;
    const bereich = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
    let start = 0;
    let ende = groesse - 1;
    if (bereich && (bereich[1] || bereich[2])) {
        if (bereich[1]) {
            start = Number(bereich[1]);
            if (bereich[2]) ende = Math.min(Number(bereich[2]), groesse - 1);
        } else {
            start = Math.max(0, groesse - Number(bereich[2]));
        }
        if (start >= groesse || start > ende) {
            res.status(416).set('Content-Range', `bytes */${groesse}`).end();
            return;
        }
        res.status(206).set({ ...kopf, 'Content-Range': `bytes ${start}-${ende}/${groesse}`, 'Content-Length': ende - start + 1 });
    } else {
        res.status(200).set({ ...kopf, 'Content-Length': groesse });
    }
    if (req.method === 'HEAD') return res.end();
    createReadStream(pfad, { start, end: ende }).on('error', () => res.destroy()).pipe(res);
}

function oeffentlicheDateien(index) {
    return index.dateien.filter(d => d.gruppe !== 'intern').map(d => ({
        name: d.name, groesse: d.groesse, sha256: d.sha256, gruppe: d.gruppe, plattform: d.plattform, bezeichnung: d.bezeichnung,
        mitCode: bekommtEinloesecode(d)
    }));
}

// /api/downloads (nur Cloud): Seite „Downloads“ für freigeschaltete Benutzer, Admins und Super-Admins, Geräteschlüssel für Hallen-Server.
export function getDownloadRoutes(knex, { dir = releaseVerzeichnis(), spiegel = null, tickets = erzeugeTicketDienst() } = {}) {
    const router = express.Router();
    const einloesenLimit = erzeugeRatenbegrenzung({ fensterMs: 10 * 60_000, max: 20, beiVollstand: 'sperren' });
    router.use(erzeugeApiRatenbegrenzung());

    const bereich = async (req) => {
        const konto = await knex('benutzer').where({ id: String(req.user.id) }).first();
        return {
            benutzerId: req.user.id,
            superAdmin: istSuperAdminAktiv(konto),
            adminVereinIds: await ladeVereinIdsMitRolle(knex, req.user.id, 'admin')
        };
    };
    const brauchtZugriff = async (req, res, next) => {
        try {
            if (!(await darfReleasesLaden(knex, req.user.id))) return res.status(403).json({ success: false, error: MELDUNG_KEIN_ZUGRIFF });
            next();
        } catch (err) {
            console.error('[Downloads-Fehler]:', err);
            res.status(500).json({ success: false, error: 'Interner Server-Fehler bei der Berechtigungsprüfung.' });
        }
    };
    const mitCode = (handler) => async (req, res) => {
        const pruefung = await pruefeCodeFuerAktion(knex, req.user.id, req.get('x-2fa-code'));
        if (!pruefung.ok) return res.status(pruefung.status).json({ success: false, error: pruefung.error });
        await handler(req, res);
    };
    const fehler = (res, err, kontext) => {
        if (err && err.status && err.status < 500) return res.status(err.status).json({ success: false, error: err.message });
        console.error(`[Downloads-${kontext}-Fehler]:`, err);
        return res.status(500).json({ success: false, error: 'Interner Server-Fehler.' });
    };

    // Einlösen ohne Anmeldung: der Code ist das Geheimnis (16 Zeichen, einmalig, 14 Tage). Antwort immer gleich bei Fehlern.
    router.post('/einloesen', async (req, res) => {
        try {
            if (!einloesenLimit.erlaube(clientIp(req))) return res.status(429).json({ success: false, error: 'Zu viele Versuche. Bitte später erneut versuchen.' });
            const schluessel = await loeseEinloesecodeAb(knex, req.body && req.body.code, String((req.body && req.body.bezeichnung) || 'Hallen-Server'));
            if (!schluessel) return res.status(403).json({ success: false, error: 'Der Code ist ungültig oder abgelaufen.' });
            return res.json({ success: true, schluessel });
        } catch (err) {
            return fehler(res, err, 'Einlösen');
        }
    });

    // Datei mit Ticket: der Link allein berechtigt (60 s, einmalig); die Berechtigung des Kontos wird trotzdem erneut geprüft.
    router.get('/datei/:ticket', async (req, res) => {
        try {
            const t = tickets.loeseEin(req.params.ticket);
            if (!t) return res.status(403).json({ success: false, error: 'Der Download-Link ist abgelaufen oder wurde schon benutzt. Bitte erneut auf „Downloads“ anfordern.' });
            if (!(await darfReleasesLaden(knex, t.benutzerId))) return res.status(403).json({ success: false, error: MELDUNG_KEIN_ZUGRIFF });
            const ziel = dateiPfad(dir, t.version, t.datei);
            if (!ziel) return res.status(404).json({ success: false, error: 'Die Datei gibt es nicht (mehr).' });
            let name = ziel.eintrag.name;
            if (bekommtEinloesecode(ziel.eintrag)) name = dateinameMitCode(name, await erzeugeEinloesecode(knex, t.benutzerId));
            meldeInfo(`Download: ${ziel.eintrag.name} (Version ${t.version}) für Konto ${t.benutzerId}.`, { quelle: 'server' });
            return sendeDatei(req, res, ziel.pfad, { name, anhang: true });
        } catch (err) {
            if (res.headersSent) return res.destroy(err);
            return fehler(res, err, 'Datei');
        }
    });

    router.use(requireAuth);

    router.get('/', brauchtZugriff, (req, res) => {
        const versionen = listeVersionen(dir);
        const gewaehlt = versionen.includes(String(req.query.version || '')) ? String(req.query.version) : versionen[0];
        const index = gewaehlt ? liesIndex(dir, gewaehlt) : null;
        res.json({
            success: true,
            version: index ? index.version : null,
            veroeffentlicht: index ? index.veroeffentlicht : null,
            versionen,
            dateien: index ? oeffentlicheDateien(index) : [],
            spiegelKonfiguriert: !!(spiegel && spiegel.konfiguriert())
        });
    });

    router.post('/ticket', brauchtZugriff, (req, res) => {
        const version = String((req.body && req.body.version) || (neuesteRelease(dir) || {}).version || '');
        const name = String((req.body && req.body.datei) || '');
        const ziel = dateiPfad(dir, version, name);
        if (!ziel || ziel.eintrag.gruppe === 'intern') return res.status(404).json({ success: false, error: 'Die Datei gibt es nicht.' });
        const ticket = tickets.stelleAus({ benutzerId: req.user.id, version, datei: name });
        res.json({ success: true, url: `/api/downloads/datei/${ticket}`, gueltigSekunden: TICKET_GUELTIG_MS / 1000 });
    });

    // Geräteschlüssel für den Hallen-Server dieses Benutzers (z. B. bei „Turnier aus der Cloud holen“ oder im Installationsbefehl).
    router.post('/geraet', brauchtZugriff, async (req, res) => {
        try {
            const schluessel = await erzeugeGeraeteSchluessel(knex, req.user.id, String((req.body && req.body.bezeichnung) || 'Hallen-Server'));
            res.json({ success: true, schluessel });
        } catch (err) {
            fehler(res, err, 'Schlüssel');
        }
    });

    // Einlösecode für den Linux-Installationsbefehl (statt Dateiname).
    router.post('/einloesecode', brauchtZugriff, async (req, res) => {
        try {
            res.json({ success: true, code: await erzeugeEinloesecode(knex, req.user.id) });
        } catch (err) {
            fehler(res, err, 'Code');
        }
    });

    router.get('/schluessel', async (req, res) => {
        try {
            const zeilen = await listeGeraeteSchluessel(knex, await bereich(req));
            res.json({ success: true, schluessel: zeilen.map(z => ({ ...z, eigener: z.benutzer_id === req.user.id })) });
        } catch (err) {
            fehler(res, err, 'Liste');
        }
    });

    router.delete('/schluessel/:id', async (req, res) => {
        try {
            const ok = await widerrufeGeraeteSchluessel(knex, req.params.id, await bereich(req));
            if (!ok) return res.status(404).json({ success: false, error: 'Den Schlüssel gibt es nicht oder er ist schon widerrufen.' });
            res.json({ success: true });
        } catch (err) {
            fehler(res, err, 'Widerruf');
        }
    });

    // Spiegelung aus dem privaten Repository (Super-Admin, mit 2FA-Code wie bei der Sicherung).
    router.get('/spiegel', requireSuperAdmin(knex), (_req, res) => {
        res.json({ success: true, spiegel: spiegel ? spiegel.status() : { konfiguriert: false }, versionen: listeVersionen(dir) });
    });
    router.post('/spiegel/pruefen', requireSuperAdmin(knex), (req, res) => mitCode(async () => {
        try {
            meldeInfo(`Releases: ${req.user.email} stößt die Spiegelung an.`);
            res.json({ success: true, ergebnis: await spiegel.pruefeJetzt() });
        } catch (err) {
            fehler(res, err, 'Spiegelung');
        }
    })(req, res));

    return router;
}

function bearerToken(req) {
    const kopf = String(req.headers.authorization || '');
    return kopf.startsWith('Bearer ') ? kopf.slice(7).trim() : '';
}

// /api/releases/v1 (nur Cloud): dieselbe Form wie die GitHub-Release-API, damit Selbst-Update, Client-Dateien und Hol-Skript nur
// ihre Basis-Adresse und den Geräteschlüssel wechseln müssen. Zugriff nur mit gültigem Geräteschlüssel.
export function getReleaseFassadeRoutes(knex, { dir = releaseVerzeichnis() } = {}) {
    const router = express.Router();
    router.use(erzeugeApiRatenbegrenzung());
    const fehlversuche = erzeugeRatenbegrenzung({ fensterMs: 10 * 60_000, max: 60, beiVollstand: 'sperren' });

    router.use(async (req, res, next) => {
        try {
            const zugang = await pruefeGeraeteSchluessel(knex, bearerToken(req));
            if (!zugang) {
                if (!fehlversuche.erlaube(clientIp(req))) return res.status(429).json({ message: 'Zu viele Versuche.' });
                return res.status(401).json({ message: 'Geräteschlüssel fehlt oder ist ungültig.' });
            }
            req.zugang = zugang;
            next();
        } catch (err) {
            console.error('[Release-Fassade-Fehler]:', err);
            res.status(500).json({ message: 'Interner Server-Fehler.' });
        }
    });

    const alsRelease = (req, index) => {
        const basis = ermittleBasisUrl(req) || `${req.protocol}://${req.get('host')}`;
        return {
            tag_name: `v${index.version}`,
            name: `Hajime Pro v${index.version}`,
            published_at: index.veroeffentlicht,
            assets: index.dateien.map(d => ({
                name: d.name, size: d.groesse, content_type: 'application/octet-stream',
                url: `${basis}/api/releases/v1/assets/${index.version}/${encodeURIComponent(d.name)}`
            }))
        };
    };

    router.get('/repos/:repo/releases/latest', (req, res) => {
        const index = neuesteRelease(dir);
        if (!index) return res.status(404).json({ message: 'Not Found' });
        res.json(alsRelease(req, index));
    });
    router.get('/repos/:repo/releases/tags/:tag', (req, res) => {
        const index = liesIndex(dir, String(req.params.tag).replace(/^v/, ''));
        if (!index) return res.status(404).json({ message: 'Not Found' });
        res.json(alsRelease(req, index));
    });
    router.get('/assets/:version/:name', (req, res) => {
        const ziel = dateiPfad(dir, req.params.version, req.params.name);
        if (!ziel) return res.status(404).json({ message: 'Not Found' });
        sendeDatei(req, res, ziel.pfad, { name: ziel.eintrag.name });
    });

    return router;
}
