// Minimal-Attrappe der Cloud für die E2E-Suite (Turnier aus der Cloud holen): Erreichbarkeit, Login,
// Turnierliste und Export (Turnier 13 zusätzlich mit Helferplan, Stand per /test/helferplan-stand), Login mit Zwei-Faktor
// (FAKE_CLOUD_EMAIL_2FA) und Zurückspielen (import-ergebnisse, mitgeschrieben unter /test/rueckspiel). Zugangsdaten: FAKE_CLOUD_EMAIL / FAKE_CLOUD_PASSWORT. Port: FAKE_CLOUD_PORT.
import http from 'node:http';
import zlib from 'node:zlib';

const PORT = Number(process.env.FAKE_CLOUD_PORT || 3190);
const EMAIL = process.env.FAKE_CLOUD_EMAIL || 'cloud@test.de';
const PASSWORT = process.env.FAKE_CLOUD_PASSWORT || 'cloud-geheim';
const TOKEN = 'fake-cloud-token';
// Ingest-Token, das die Attrappe beim Export mit ?liveToken=1 mitgibt und am Ingest akzeptiert.
const LIVE_TOKEN = 'hjl_fake-live-token';
// Konto mit Zwei-Faktor-Anmeldung (Super-Admin): Login liefert ein Zwischen-Token, /api/auth/2fa/pruefen nimmt ZWEI_FAKTOR_CODE an.
const EMAIL_2FA = process.env.FAKE_CLOUD_EMAIL_2FA || 'super@test.de';
const ZWISCHEN_TOKEN = 'fake-zwischen-token';
const ZWEI_FAKTOR_CODE = process.env.FAKE_CLOUD_2FA_CODE || '123456';

const turniere = [
    {
        id: 11, bezeichnung: 'Cloud-Turnier offen', ort: 'Cloudstadt', datum: '2030-05-01', ausrichter: 'JC Cloud',
        anmeldeschluss: '2030-04-20', status: 'veroeffentlicht', status_effektiv: 'veroeffentlicht', teilnehmer_anzahl: 3, verein_id: 1
    },
    {
        id: 12, bezeichnung: 'Cloud-Turnier geschlossen', ort: 'Cloudstadt', datum: '2030-06-01', ausrichter: 'JC Cloud',
        anmeldeschluss: '2030-05-20', status: 'veroeffentlicht', status_effektiv: 'anmeldung_geschlossen', teilnehmer_anzahl: 5, verein_id: 1
    }
];

// Nicht in der Turnierliste, nur per Export holbar (Helferplan aus der Cloud aktualisieren,
// tests/e2e/helferplan-aus-cloud.spec.js); hat Kampfflächen, einen Pool, einen Teilnehmer und einen Helferplan.
const HELFER_TURNIER = {
    id: 13, bezeichnung: 'Cloud-Turnier Helfer', ort: 'Cloudstadt', datum: '2030-07-01', ausrichter: 'JC Cloud',
    anmeldeschluss: '2030-06-20', status: 'veroeffentlicht', status_effektiv: 'anmeldung_geschlossen', verein_id: 1
};

// Stand des Helferplans in der Cloud; umschaltbar über POST /test/helferplan-stand { stand }.
let helferplanStand = 1;
const HELFERPLAENE = {
    1: {
        taetigkeiten: [
            { art: 'matte', bezeichnung: 'Kampfgericht Matte 2', bedarf: 2, reihenfolge: 2, kampfflaeche_ref: 1,
                slots: [{ von_min: 540, bis_min: 660, bedarf: 2, einsaetze: [{ name: 'Anna Alt' }] }] },
            { art: 'frei', bezeichnung: 'Kuchenverkauf', bedarf: 2, reihenfolge: 1, kampfflaeche_ref: null,
                slots: [{ von_min: 600, bis_min: 720, bedarf: 2, einsaetze: [{ name: 'Bernd Alt' }] }] }
        ]
    },
    2: {
        taetigkeiten: [
            { art: 'matte', bezeichnung: 'Kampfgericht Matte 2', bedarf: 2, reihenfolge: 2, kampfflaeche_ref: 1,
                slots: [{ von_min: 540, bis_min: 660, bedarf: 2, einsaetze: [{ name: 'Clara Neu' }] }] },
            { art: 'frei', bezeichnung: 'Parkplatz', bedarf: 1, reihenfolge: 1, kampfflaeche_ref: null,
                slots: [{ von_min: 480, bis_min: 600, bedarf: 1, einsaetze: [{ name: 'Dieter Neu' }] }] }
        ]
    }
};

function exportFuerHelferTurnier(t) {
    return {
        exportiert_am: new Date().toISOString(),
        turnier: {
            id: t.id, bezeichnung: t.bezeichnung, ort: t.ort, datum: t.datum, ausrichter: t.ausrichter,
            nutze_gewichtsklassen: 1, anzahl_kampfflaechen: 2, altersklassen: [], mannschafts_altersklassen: [],
            status: 'veroeffentlicht', anmeldeschluss: t.anmeldeschluss, beginn_min: 540, ende_min: 1020, waagen_anzahl: 1
        },
        kampfflaechen: [{ id: 101, bezeichnung: 'Matte 1' }, { id: 102, bezeichnung: 'Matte 2' }],
        pools: [{ id: 201, bezeichnung: 'U15 m -50', altersklasse: 'U15', geschlecht: 'm', gewichtsklasse: '-50', kampfflaeche_id: 101 }],
        teilnehmer: [{
            id: 301, pool_id: 201, vorname: 'Max', nachname: 'Muster', geburtsjahr: 2012, geschlecht: 'm',
            verein: 'JC Cloud', gewicht: 49, altersklasse: 'U15', gewichtsklasse: '-50'
        }],
        kaempfe: [], mannschaften: [], mannschaft_mitglieder: [],
        helferplan: HELFERPLAENE[helferplanStand]
    };
}

function exportFuer(t) {
    if (t.id === HELFER_TURNIER.id) return exportFuerHelferTurnier(t);
    return {
        exportiert_am: new Date().toISOString(),
        turnier: {
            id: t.id, bezeichnung: t.bezeichnung, ort: t.ort, datum: t.datum, ausrichter: t.ausrichter,
            nutze_gewichtsklassen: 1, anzahl_kampfflaechen: 2, altersklassen: [], mannschafts_altersklassen: [],
            status: 'veroeffentlicht', anmeldeschluss: t.anmeldeschluss
        },
        kampfflaechen: [], pools: [], teilnehmer: [], kaempfe: [], mannschaften: [], mannschaft_mitglieder: [],
        vereine: ['Cloud-Verein Alpha', 'Cloud-Verein Beta']
    };
}

// Teilnehmer-App: Zustand der Attrappe für den Ingest (tests/e2e/teilnehmer-app-schalter.spec.js). 'ingest' steuert die Antwort
// (ok | fehler = 500), 'erreichbar' false lässt die Erreichbarkeitsprüfung scheitern. Empfangene Pakete sind abrufbar.
const live = { ingest: 'ok', erreichbar: true, pakete: [] };

// Zurückgespielte Turniere (POST /api/turniere/:id/import-ergebnisse), abrufbar über GET /test/rueckspiel.
let rueckspiele = [];

function senden(res, status, daten) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(daten));
}

http.createServer((req, res) => {
    const teile = [];
    req.on('data', (c) => { teile.push(c); });
    req.on('end', () => {
        const roh = Buffer.concat(teile);
        const body = roh.toString('utf8');
        const url = new URL(req.url, 'http://x');
        if (url.pathname === '/api/auth/mode') {
            return live.erreichbar ? senden(res, 200, { isOffline: false }) : senden(res, 503, { success: false });
        }
        if (url.pathname === '/test/modus' && req.method === 'POST') {
            let eingabe = {};
            try { eingabe = JSON.parse(body); } catch { /* leer */ }
            if (eingabe.ingest !== undefined) live.ingest = eingabe.ingest;
            if (eingabe.erreichbar !== undefined) live.erreichbar = !!eingabe.erreichbar;
            return senden(res, 200, { success: true, ...live, pakete: undefined });
        }
        if (url.pathname === '/test/ingest' && req.method === 'GET') return senden(res, 200, { pakete: live.pakete });
        if (url.pathname === '/test/ingest' && req.method === 'DELETE') { live.pakete = []; return senden(res, 200, { success: true }); }
        if (url.pathname === '/api/live/ingest' && req.method === 'POST') {
            const bearer = req.headers.authorization || '';
            if (bearer !== `Bearer ${LIVE_TOKEN}`) return senden(res, 401, { success: false });
            if (live.ingest === 'fehler') return senden(res, 500, { success: false });
            let paket = null;
            try {
                paket = JSON.parse((req.headers['content-encoding'] === 'gzip' ? zlib.gunzipSync(roh) : roh).toString('utf8'));
            } catch { /* kein gültiges Paket */ }
            live.pakete.push({ bearer, paket });
            res.writeHead(204);
            return res.end();
        }
        if (url.pathname === '/test/helferplan-stand' && req.method === 'POST') {
            let eingabe = {};
            try { eingabe = JSON.parse(body); } catch { /* leer */ }
            if (!HELFERPLAENE[eingabe.stand]) return senden(res, 400, { success: false, error: 'Unbekannter Stand.' });
            helferplanStand = eingabe.stand;
            return senden(res, 200, { success: true, stand: helferplanStand });
        }
        if (url.pathname === '/test/rueckspiel' && req.method === 'GET') return senden(res, 200, { rueckspiele });
        if (url.pathname === '/test/rueckspiel' && req.method === 'DELETE') { rueckspiele = []; return senden(res, 200, { success: true }); }
        if (url.pathname === '/api/auth/2fa/pruefen' && req.method === 'POST') {
            let eingabe = {};
            try { eingabe = JSON.parse(body); } catch { /* leer */ }
            if (eingabe.zwischenToken !== ZWISCHEN_TOKEN) return senden(res, 401, { success: false, error: 'Anmeldung abgelaufen.' });
            if (eingabe.code !== ZWEI_FAKTOR_CODE) return senden(res, 401, { success: false, error: 'Der Code ist ungültig.' });
            return senden(res, 200, { success: true, token: TOKEN, user: { id: 2, email: EMAIL_2FA, verein_id: 1, verein_freigegeben: true } });
        }
        if (url.pathname === '/api/auth/login' && req.method === 'POST') {
            let eingabe = {};
            try { eingabe = JSON.parse(body); } catch { /* leer */ }
            if (eingabe.email === EMAIL_2FA && eingabe.password === PASSWORT) {
                return senden(res, 200, { success: true, zweiFaktor: 'pruefen', zwischenToken: ZWISCHEN_TOKEN });
            }
            if (eingabe.email === EMAIL && eingabe.password === PASSWORT) {
                return senden(res, 200, { success: true, token: TOKEN, user: { id: 1, email: EMAIL, verein_id: 1, verein_freigegeben: true } });
            }
            return senden(res, 401, { success: false, error: 'Ungültige Anmeldedaten.' });
        }
        if (req.headers.authorization !== `Bearer ${TOKEN}`) {
            return senden(res, 401, { success: false, error: 'Nicht angemeldet.' });
        }
        if (url.pathname === '/api/turniere') return senden(res, 200, turniere);
        const rueck = url.pathname.match(/^\/api\/turniere\/(\d+)\/import-ergebnisse$/);
        if (rueck && req.method === 'POST') {
            let daten = null;
            try { daten = JSON.parse(Buffer.from(JSON.parse(body).contentBase64, 'base64').toString('utf8')); } catch { /* ungültig */ }
            if (!daten || !daten.turnier) return senden(res, 400, { success: false, error: 'Datei konnte nicht gelesen werden.' });
            rueckspiele.push({ turnierId: Number(rueck[1]), zweiFaktorCode: req.headers['x-2fa-code'] || null, daten });
            const laenge = (liste) => (Array.isArray(liste) ? liste.length : 0);
            return senden(res, 200, {
                success: true,
                turnierId: Number(rueck[1]),
                imported: { kampfflaechen: laenge(daten.kampfflaechen), pools: laenge(daten.pools), teilnehmer: laenge(daten.teilnehmer), kaempfe: laenge(daten.kaempfe) },
                neueVereine: 0,
                barzahlungen: laenge(daten.barzahlungen)
            });
        }
        const m = url.pathname.match(/^\/api\/turniere\/(\d+)\/export$/);
        if (m) {
            const t = [...turniere, HELFER_TURNIER].find(x => x.id === Number(m[1]));
            if (!t) return senden(res, 404, { success: false, error: 'Turnier nicht gefunden.' });
            if (t.status_effektiv === 'veroeffentlicht') {
                return senden(res, 403, { success: false, error: 'Das Turnier kann erst exportiert werden, wenn die Anmeldefrist abgelaufen ist.' });
            }
            const daten = exportFuer(t);
            // Wie die echte Cloud: nur auf ausdrückliche Anforderung (?liveToken=1) ein Ingest-Token für die Teilnehmer-App.
            if (url.searchParams.get('liveToken') === '1') daten.live = { token: LIVE_TOKEN };
            return senden(res, 200, daten);
        }
        return senden(res, 404, { success: false, error: 'Nicht gefunden.' });
    });
}).listen(PORT, '127.0.0.1', () => console.log(`Fake-Cloud auf Port ${PORT}`));
