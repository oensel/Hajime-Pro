// Spielt ein Demo-Turnier in die lokale Teilnehmer-App ein: node scripts/live-demo.mjs [http://127.0.0.1:3000]
// Voraussetzung: der Server läuft mit LIVE_API_AKTIV=true (z. B. LIVE_API_AKTIV=true npm start). Legt ein Token an und sendet einen Snapshot wie der Live-Prozess der Halle.
import dotenv from 'dotenv';
import knexLib from 'knex';
import { erzeugeToken } from '../src/liveCloud/token.js';

dotenv.config({ quiet: true });
const basis = process.argv[2] || `http://127.0.0.1:${process.env.PORT || 3000}`;
// Verbindung wie das eingebettete PostgreSQL des Hallen-Servers (Benutzer postgres ohne Passwort, nur localhost);
// mit DB_HOST/DB_USER/DB_PASSWORD/DB_NAME in der Umgebung lässt sich ein anderer Server angeben.
const knex = knexLib({
    client: 'pg',
    connection: {
        host: process.env.DB_HOST || '127.0.0.1',
        port: Number(process.env.DB_PORT || 5433),
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'hajime'
    },
    pool: { min: 0, max: 1 }
});

const t = (key, vorname, nachname, extra = {}) => ({
    key, vorname, nachname, vereinKey: 'jc-senden', verein: 'JC Senden', altersklasse: 'U15', gewichtsklasse: '-44', geschlecht: 'w',
    poolId: 1, poolBezeichnung: 'U15 w -44', matteId: 2, matteBezeichnung: 'Matte 2', zustand: 'in_n', abstand: 3,
    naechsterKampfId: 1, platz: null, ...extra
});
const paket = {
    version: 1, turnierKey: 'demo-2026', name: 'Demo-Turnier Senden', datum: new Date().toISOString().slice(0, 10),
    stand: new Date().toISOString(), sequenz: Date.now(),
    vereine: [{ key: 'jc-senden', name: 'JC Senden' }, { key: 'tv-munster', name: 'TV Münster' }],
    matten: [{ id: 1, bezeichnung: 'Matte 1' }, { id: 2, bezeichnung: 'Matte 2' }],
    teilnehmer: [
        t('d1', 'Anna', 'Muster'),
        t('d2', 'Mia', 'Mustermann', { zustand: 'laeuft', abstand: null }),
        t('d3', 'Lena', 'Lehmann', { zustand: 'als_naechstes', abstand: 0 }),
        t('d4', 'Sophie', 'Schulz', { zustand: 'keine_weiteren', abstand: null }),
        t('d5', 'Emma', 'Ebert', { poolId: null, poolBezeichnung: '', matteId: null, matteBezeichnung: '', zustand: 'nicht_ausgelost', abstand: null }),
        t('d6', 'Ben', 'Berger', { vereinKey: 'tv-munster', verein: 'TV Münster', geschlecht: 'm', gewichtsklasse: '-50', poolId: 2, poolBezeichnung: 'U15 m -50', matteId: 1, matteBezeichnung: 'Matte 1', zustand: 'abgeschlossen', abstand: null, platz: 1 }),
        t('d7', 'Tim', 'Thomas', { vereinKey: 'tv-munster', verein: 'TV Münster', geschlecht: 'm', gewichtsklasse: '-50', poolId: 2, poolBezeichnung: 'U15 m -50', matteId: 1, matteBezeichnung: 'Matte 1', zustand: 'abgeschlossen', abstand: null, platz: 2 }),
        t('d8', 'Jonas', 'Jung', { vereinKey: 'tv-munster', verein: 'TV Münster', geschlecht: 'm', gewichtsklasse: '-50', poolId: 2, poolBezeichnung: 'U15 m -50', matteId: 1, matteBezeichnung: 'Matte 1', zustand: 'nicht_erschienen', abstand: null })
    ],
    pools: [
        { id: 1, bezeichnung: 'U15 w -44', modus: 'Doppel-KO-8', status: 'matte_zugewiesen', matteId: 2, altersklasse: 'U15', geschlecht: 'w', gewichtsklasse: '-44', farbe2: 'blau' },
        { id: 2, bezeichnung: 'U15 m -50', modus: 'Jeder-gegen-Jeden', status: 'abgeschlossen', matteId: 1, altersklasse: 'U15', geschlecht: 'm', gewichtsklasse: '-50', farbe2: 'rot' },
        { id: 3, bezeichnung: 'U11 w -30', modus: 'Jeder-gegen-Jeden', status: 'angelegt', matteId: null, altersklasse: 'U11', geschlecht: 'w', gewichtsklasse: '-30', farbe2: 'blau' }
    ],
    kaempfe: [
        { id: 1, poolId: 1, nr: 'H1', status: 'beendet', reihenfolge: 1, k1: 'd3', k2: 'd4', sieger: 'd3', p1: 7, p2: 0 },
        { id: 2, poolId: 1, nr: 'H2', status: 'gestartet', reihenfolge: 2, k1: 'd1', k2: 'd2', sieger: null, p1: 0, p2: 0 },
        { id: 3, poolId: 1, nr: 'H3', status: 'bereit', reihenfolge: 3, k1: null, k2: null, sieger: null, p1: 0, p2: 0 },
        { id: 4, poolId: 1, nr: 'H4', status: 'bereit', reihenfolge: 4, k1: null, k2: null, sieger: null, p1: 0, p2: 0 },
        { id: 5, poolId: 2, nr: 'R1', status: 'beendet', reihenfolge: null, k1: 'd6', k2: 'd7', sieger: 'd6', p1: 7, p2: 0 },
        { id: 6, poolId: 2, nr: 'R2', status: 'beendet', reihenfolge: null, k1: 'd7', k2: 'd8', sieger: 'd7', p1: 1, p2: 0 }
    ],
    warteschlangen: []
};

try {
    const { token } = await erzeugeToken(knex, { name: 'demo' });
    const antwort = await fetch(`${basis}/api/live/ingest`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(paket)
    });
    if (antwort.status !== 204) throw new Error(`Ingest antwortete mit Status ${antwort.status}`);
    console.log(`Demo-Turnier eingespielt. App: ${basis}/live/`);
} catch (fehler) {
    console.error(fehler.message);
    process.exitCode = 1;
} finally {
    await knex.destroy();
}
