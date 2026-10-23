// Testet die Push-Nachrichten der Teilnehmer-App gegen einen laufenden Cloud-Server: schickt ein Test-Turnier als
// Live-Snapshot an /api/live/ingest und lässt den Abstand von „Anna Muster“ schrittweise sinken (Push ab 3 Kämpfen).
// Aufruf: node scripts/live-push-test.mjs <token> [--url http://localhost:3300] [--abstand 8] [--countdown [sekunden]]
//   ohne --countdown: einmal senden (Turnier erscheint in der App, Glocke bei Anna setzen)
//   mit --countdown: alle <sekunden> (Standard 20) einen Kampf weiter bis „als nächstes“
// Token: node --env-file=.env.cloud-lokal scripts/live-token.mjs erzeugen --name Pushtest --turnier PUSHTEST
import zlib from 'node:zlib';

const args = process.argv.slice(2);
const token = args[0];
const wert = (name, standard) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : standard; };
if (!token || token.startsWith('--')) { console.error('Aufruf: node scripts/live-push-test.mjs <token> [--url …] [--abstand 8] [--countdown [sekunden]]'); process.exit(2); }
const url = wert('--url', 'http://localhost:3300');
const startAbstand = Number(wert('--abstand', '8'));
const countdown = args.includes('--countdown');
const takt = Number(wert('--countdown', '20')) * 1000 || 20000;

function paket(abstand) {
    const zustand = abstand > 0 ? 'in_n' : 'als_naechstes';
    const t = (key, vorname, nachname, extra = {}) => ({
        key, vorname, nachname, vereinKey: 'v1', verein: 'JC Muster', altersklasse: 'U15', gewichtsklasse: '-44', geschlecht: 'w',
        poolId: 10, poolBezeichnung: 'U15 w -44', matteId: 1, matteBezeichnung: 'Matte 1', zustand, abstand: abstand > 0 ? abstand : null,
        naechsterKampfId: 5, platz: null, ...extra
    });
    return {
        version: 1, turnierKey: 'PUSHTEST', name: 'Push-Test Hajime Pro', datum: new Date().toISOString().slice(0, 10),
        stand: new Date().toISOString(), sequenz: Date.now(),
        vereine: [{ key: 'v1', name: 'JC Muster' }],
        matten: [{ id: 1, bezeichnung: 'Matte 1' }],
        teilnehmer: [t('a1', 'Anna', 'Muster'), t('a2', 'Mia', 'Mustermann', { zustand: 'laeuft', abstand: null, naechsterKampfId: 4 })],
        pools: [{ id: 10, bezeichnung: 'U15 w -44', modus: 'Jeder-gegen-Jeden', status: 'matte_zugewiesen', matteId: 1, altersklasse: 'U15', geschlecht: 'w', gewichtsklasse: '-44', farbe2: 'blau', reihenfolge: 0 }],
        kaempfe: [
            { id: 4, poolId: 10, nr: '1', status: 'gestartet', reihenfolge: 1, k1: 'a2', k2: 'a1', sieger: null, p1: 0, p2: 0 },
            { id: 5, poolId: 10, nr: '2', status: 'bereit', reihenfolge: 2, k1: 'a1', k2: 'a2', sieger: null, p1: 0, p2: 0 }
        ],
        mannschaften: [], begegnungen: [], warteschlangen: []
    };
}

async function sende(abstand) {
    const antwort = await fetch(`${url}/api/live/ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip', Authorization: `Bearer ${token}` },
        body: zlib.gzipSync(Buffer.from(JSON.stringify(paket(abstand))))
    });
    console.log(`${new Date().toLocaleTimeString('de-DE')} Abstand ${abstand > 0 ? abstand : 'als nächstes'} gesendet: HTTP ${antwort.status}`);
    if (antwort.status !== 204) process.exit(1);
}

if (!countdown) {
    await sende(startAbstand);
} else {
    for (let a = startAbstand; a >= 0; a--) {
        await sende(a);
        if (a > 0) await new Promise((r) => setTimeout(r, takt));
    }
}
