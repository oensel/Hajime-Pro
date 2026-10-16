// Minimal-Attrappe der Cloud für die E2E-Suite (Turnier aus der Cloud holen): Erreichbarkeit, Login,
// Turnierliste und Export. Zugangsdaten: FAKE_CLOUD_EMAIL / FAKE_CLOUD_PASSWORT. Port: FAKE_CLOUD_PORT.
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

function exportFuer(t) {
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
            const t = turniere.find(x => x.id === Number(m[1]));
            if (!t) return senden(res, 404, { success: false, error: 'Turnier nicht gefunden.' });
            if (t.status_effektiv === 'veroeffentlicht') {
                return senden(res, 403, { success: false, error: 'Das Turnier kann erst exportiert werden, wenn die Anmeldefrist abgelaufen ist.' });
            }
            return senden(res, 200, exportFuer(t));
        }
        return senden(res, 404, { success: false, error: 'Nicht gefunden.' });
    });
}).listen(PORT, '127.0.0.1', () => console.log(`Fake-Cloud auf Port ${PORT}`));
