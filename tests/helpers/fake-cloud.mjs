// Minimal-Attrappe der Cloud für die E2E-Suite (Turnier aus der Cloud holen): Erreichbarkeit, Login,
// Turnierliste und Export (Turnier 13 zusätzlich mit Helferplan, Stand per /test/helferplan-stand). Zugangsdaten: FAKE_CLOUD_EMAIL / FAKE_CLOUD_PASSWORT. Port: FAKE_CLOUD_PORT.
import http from 'node:http';

const PORT = Number(process.env.FAKE_CLOUD_PORT || 3190);
const EMAIL = process.env.FAKE_CLOUD_EMAIL || 'cloud@test.de';
const PASSWORT = process.env.FAKE_CLOUD_PASSWORT || 'cloud-geheim';
const TOKEN = 'fake-cloud-token';

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
        kampfflaechen: [], pools: [], teilnehmer: [], kaempfe: [], mannschaften: [], mannschaft_mitglieder: []
    };
}

function senden(res, status, daten) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(daten));
}

http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
        const url = new URL(req.url, 'http://x');
        if (url.pathname === '/api/auth/mode') return senden(res, 200, { isOffline: false });
        if (url.pathname === '/test/helferplan-stand' && req.method === 'POST') {
            let eingabe = {};
            try { eingabe = JSON.parse(body); } catch { /* leer */ }
            if (!HELFERPLAENE[eingabe.stand]) return senden(res, 400, { success: false, error: 'Unbekannter Stand.' });
            helferplanStand = eingabe.stand;
            return senden(res, 200, { success: true, stand: helferplanStand });
        }
        if (url.pathname === '/api/auth/login' && req.method === 'POST') {
            let eingabe = {};
            try { eingabe = JSON.parse(body); } catch { /* leer */ }
            if (eingabe.email === EMAIL && eingabe.password === PASSWORT) {
                return senden(res, 200, { success: true, token: TOKEN, user: { id: 1, email: EMAIL, verein_id: 1, verein_freigegeben: true } });
            }
            return senden(res, 401, { success: false, error: 'Ungültige Anmeldedaten.' });
        }
        if (req.headers.authorization !== `Bearer ${TOKEN}`) {
            return senden(res, 401, { success: false, error: 'Nicht angemeldet.' });
        }
        if (url.pathname === '/api/turniere') return senden(res, 200, turniere);
        const m = url.pathname.match(/^\/api\/turniere\/(\d+)\/export$/);
        if (m) {
            const t = [...turniere, HELFER_TURNIER].find(x => x.id === Number(m[1]));
            if (!t) return senden(res, 404, { success: false, error: 'Turnier nicht gefunden.' });
            if (t.status_effektiv === 'veroeffentlicht') {
                return senden(res, 403, { success: false, error: 'Das Turnier kann erst exportiert werden, wenn die Anmeldefrist abgelaufen ist.' });
            }
            return senden(res, 200, exportFuer(t));
        }
        return senden(res, 404, { success: false, error: 'Nicht gefunden.' });
    });
}).listen(PORT, '127.0.0.1', () => console.log(`Fake-Cloud auf Port ${PORT}`));
