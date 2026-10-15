// Lokale Demo der Teilnehmer-App „Hajime Pro“: startet ein eigenes PostgreSQL (temporär), spielt ein Demo-Turnier
// (Einzel und Mannschaften) ein und startet den Server mit der App unter http://<IP>:3400/live/.
// Aufruf: node scripts/live-demo.mjs   (Strg+C beendet, die Daten werden gelöscht)
import os from 'node:os';
import { starteTestPostgres } from '../tests/helpers/testPostgres.js';

const PORT = process.env.LIVE_DEMO_PORT || '3400';
const db = await starteTestPostgres({ dbName: 'hajime_live_demo' });
const v = db.verbindung;
Object.assign(process.env, {
    BETRIEBSMODUS: '', SYNC_ROLLE: '', CLUSTER_KNOTEN: '', DB_CLIENT: '', IS_OFFLINE: 'true', LIVE_API_AKTIV: 'true',
    DB_HOST: v.host, DB_PORT: String(v.port), DB_USER: v.user, DB_PASSWORD: v.password || '', DB_NAME: v.database,
    DB_URL: '', DATABASE_URL: '', PORT, STEUERUNG_PASSWORD: '', SMTP_HOST: '', MDNS_AKTIV: 'false', PORT80_WEITERLEITUNG: 'false',
    LISTEN_HOST: '0.0.0.0'
});

const { uebernimmPaket } = await import('../src/liveCloud/ingest.js');
const t = (key, vorname, nachname, extra = {}) => ({
    key, vorname, nachname, vereinKey: 'v1', verein: 'JC Muster', altersklasse: 'U15', gewichtsklasse: '-44', geschlecht: 'w',
    poolId: 10, poolBezeichnung: 'U15 w -44', matteId: 1, matteBezeichnung: 'Matte 1', zustand: 'in_n', abstand: 3,
    naechsterKampfId: 5, platz: null, ...extra
});
const team = (key, bezeichnung, extra = {}) => ({
    key, bezeichnung, verein: 'JC Senden', vereinKey: 'v3', poolId: 7, poolBezeichnung: 'U15 w Team', modus: 'Jeder-gegen-Jeden',
    poolStatus: 'gestartet', altersklasse: 'U15', geschlecht: 'weiblich', matteId: 2, matteBezeichnung: 'Matte 2',
    zustand: 'in_n', abstand: 2, naechsteBegegnungId: 31, gegner: 'Team 2', siege: 1, niederlagen: 0,
    mitglieder: [{ vorname: 'Lena', nachname: 'Adler', gewichtsklasse: '-40' }, { vorname: 'Berta', nachname: 'Busch', gewichtsklasse: '+57' }],
    ...extra
});
await uebernimmPaket(db.knex, {
    version: 1, turnierKey: 'DEMO', name: 'Demo-Turnier Hajime Pro', datum: new Date().toISOString().slice(0, 10),
    stand: new Date().toISOString(), sequenz: Date.now(),
    vereine: [{ key: 'v1', name: 'JC Muster' }, { key: 'v2', name: 'TV Beispiel' }, { key: 'v3', name: 'JC Senden' }],
    matten: [{ id: 1, bezeichnung: 'Matte 1' }, { id: 2, bezeichnung: 'Matte 2' }],
    teilnehmer: [
        t('a1', 'Anna', 'Muster'),
        t('a2', 'Mia', 'Mustermann', { zustand: 'laeuft', abstand: null }),
        t('b1', 'Ben', 'Beispiel', { vereinKey: 'v2', verein: 'TV Beispiel', poolId: 11, poolBezeichnung: 'U15 m -50', geschlecht: 'm', gewichtsklasse: '-50', zustand: 'abgeschlossen', abstand: null, platz: 3 })
    ],
    pools: [
        { id: 10, bezeichnung: 'U15 w -44', modus: 'Doppel-KO-8', status: 'matte_zugewiesen', matteId: 1, altersklasse: 'U15', geschlecht: 'w', gewichtsklasse: '-44', farbe2: 'blau', reihenfolge: 0 },
        { id: 11, bezeichnung: 'U15 m -50', modus: 'Jeder-gegen-Jeden', status: 'matte_zugewiesen', matteId: 1, altersklasse: 'U15', geschlecht: 'm', gewichtsklasse: '-50', farbe2: 'rot', reihenfolge: 1 }
    ],
    kaempfe: [
        { id: 1, poolId: 10, nr: 'H1', status: 'beendet', reihenfolge: 1, k1: 'a1', k2: 'a2', sieger: 'a1', p1: 7, p2: 0 },
        { id: 2, poolId: 10, nr: 'H2', status: 'gestartet', reihenfolge: 2, k1: 'a1', k2: 'a2', sieger: null, p1: 0, p2: 0 },
        { id: 3, poolId: 10, nr: 'H3', status: 'bereit', reihenfolge: 3, k1: 'a2', k2: 'a1', sieger: null, p1: 0, p2: 0 },
        { id: 4, poolId: 11, nr: '1', status: 'bereit', reihenfolge: 4, k1: 'b1', k2: 'a1', sieger: null, p1: 0, p2: 0 }
    ],
    mannschaften: [team('t1', 'Team 1'), team('t2', 'Team 2', { zustand: 'laeuft', abstand: 0, naechsteBegegnungId: 30, gegner: 'Team 1' })],
    begegnungen: [
        { id: 29, poolId: 7, nr: '1', runde: 1, status: 'beendet', matteId: 2, team1: 't1', team2: 't2', s1: 3, s2: 2, sieger: 't1', abstand: null },
        { id: 31, poolId: 7, nr: '2', runde: 2, status: 'bereit', matteId: 2, team1: 't1', team2: 't2', s1: 0, s2: 0, sieger: null, abstand: 2 }
    ],
    warteschlangen: []
});

await import('../src/app.js');
const ips = Object.values(os.networkInterfaces()).flat().filter(i => i.family === 'IPv4' && !i.internal).map(i => i.address);
console.log(`\nHajime Pro (Teilnehmer-App) läuft:\n${ips.map(ip => `  http://${ip}:${PORT}/live/`).join('\n')}\n`);
const ende = async () => { await db.stoppe(); process.exit(0); };
process.on('SIGINT', ende);
process.on('SIGTERM', ende);
