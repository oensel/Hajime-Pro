import express from 'express';
import knexLib from 'knex';
import pg from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { readFileSync } from 'fs'; // Zwingend erforderlich für das JSON-Einlesen!

// Postgres liefert DATE-Spalten sonst als JS-Date-Objekte aus, die bei der JSON-Serialisierung
// auf UTC normalisiert werden. In Zeitzonen vor UTC (z.B. Europe/Berlin) verschiebt das Datum
// beim Rücklesen um einen Tag (z.B. Lizenzablauf, Anmeldeschluss). Rohe Datumsstrings vermeiden das.
pg.types.setTypeParser(1082, (val) => val);

// Route imports
import { getAuthRoutes } from './routes/authRoutes.js';
import { getVereinRoutes } from './routes/vereinRoutes.js';
import { getTurnierRoutes } from './routes/turnierRoutes.js';
import { getTeilnehmerRoutes } from './routes/teilnehmerRoutes.js';
import { getPoolRoutes } from './routes/poolRoutes.js';
import { getKampfflaecheRoutes } from './routes/kampfflaecheRoutes.js';
import { getKampfRoutes } from './routes/kampfRoutes.js';
import { getMannschaftRoutes, getMannschaftskampfRoutes } from './routes/mannschaftRoutes.js';
import { ensureSuperAdmin } from './utils/superAdmin.js';
import { waehleKnexUmgebung } from './utils/dbUmgebung.js';
import { liesSyncKonfig } from './sync/konfig.js';
import { starteSyncDienst } from './sync/syncDienst.js';
import { getSyncRoutes } from './routes/syncRoutes.js';
import { starteClientDienst } from './sync/clientDienst.js';
import { liesClusterKonfig } from './cluster/konfig.js';
import { starteClusterDienst } from './cluster/clusterDienst.js';
import { getClusterRoutes } from './routes/clusterRoutes.js';
import { nurMaster } from './middleware/nurMaster.js';
import { getClientApiRoutes, clientStatischeSeiten } from './sync/clientApi.js';

dotenv.config();

// Knex-Konfiguration laden
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const knexConfig = require('../knexfile.cjs');

const syncKonfig = liesSyncKonfig();
// Server-Cluster nur für Hallen-Server (SYNC_ROLLE=server) mit CLUSTER_KNOTEN.
const clusterKonfig = syncKonfig.istServer ? liesClusterKonfig() : { aktiv: false };
const app = express();
const PORT = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import { requireWriteAuth } from './middleware/auth.js';

if (syncKonfig.istClient) {
    // ---------------------------------------------------------------------------------------
    // Client-Knoten (Notebook/Tablet): KEINE relationale DB. Lokale PouchDB unter /db, eine
    // Client-API beantwortet die Lese-Endpunkte der Seiten aus den lokalen Dokumenten, Schreib-
    // vorgänge laufen über public/js/datenzugriff.js direkt in /db (siehe src/sync/clientApi.js).
    // ---------------------------------------------------------------------------------------
    const client = await starteClientDienst({ konfig: syncKonfig });
    app.set('sync', client);
    app.use('/db', client.middleware); // vor express.json(), siehe Server-Zweig
    app.use(express.json({ limit: '15mb' }));
    app.use(clientStatischeSeiten(path.join(__dirname, '../public')));
    app.use(express.static(path.join(__dirname, '../public')));
    app.use('/api/sync', getSyncRoutes(() => app.get('sync')));
    app.use('/api/cluster', getClusterRoutes(() => null, { secret: syncKonfig.secret }));
} else {
    const environment = waehleKnexUmgebung();
    const knex = knexLib(knexConfig[environment]);

    // Der Super-Admin-Bootstrap betrifft nur den Online-Mehrbenutzerbetrieb (Vereins-Erstfreigabe) —
    // der Hallenbetrieb (IS_OFFLINE=true, auch mit DB_CLIENT=pg) arbeitet mit seinem eigenen
    // isolierten Mock-User, siehe requireAuth.
    if (process.env.IS_OFFLINE !== 'true') {
        ensureSuperAdmin(knex);
    }

    app.set('knex', knex);

    // Sync-Dienst (nur SYNC_ROLLE=server, siehe src/sync/). Das vorhandene Turnier aktiviert er erst
    // beim ersten Request (sync.bereit(), siehe dort).
    const sync = await starteSyncDienst({
        knex,
        konfig: syncKonfig,
        partnerUrl: clusterKonfig.aktiv ? clusterKonfig.partnerUrl : null,
        // Im Cluster startet jeder Server als Secondary; Master wird er erst über keepalived.
        startModus: clusterKonfig.aktiv ? 'secondary' : 'master'
    });
    app.set('sync', sync);
    const cluster = clusterKonfig.aktiv ? starteClusterDienst({ knex, clusterKonfig, syncKonfig, sync }) : null;
    app.set('cluster', cluster);

    // /db (Dokument-DB) MUSS vor express.json() hängen — sonst konsumiert der JSON-Parser die
    // Request-Bodies, die express-pouchdb selbst lesen muss.
    if (sync) {
        // Nur Datenzugriffe lösen die verzögerte Initialisierung aus — NICHT der Abruf statischer
        // Seiten wie "/" (die Erreichbarkeitsprüfung der Test-Suites läuft vor deren DB-Setup).
        const nachInitialisierung = (req, res, next) => sync.bereit().then(() => next(), next);
        app.use('/api', nachInitialisierung);
        app.use('/db', nachInitialisierung);
        app.use('/db', sync.middleware);
    }

    app.use(express.json({ limit: '15mb' }));
    app.use(express.static(path.join(__dirname, '../public')));

    // Nach jedem erfolgreichen schreibenden API-Request den Abgleich SQL -> Dokumente anstoßen
    // (entprellt). So erreichen Änderungen der Turnierleitung die Matten/Waagen, ohne dass jeder
    // Controller einzeln daran denken muss.
    if (sync) {
        app.use('/api', (req, res, next) => {
            if (req.method !== 'GET') {
                res.on('finish', () => {
                    if (res.statusCode < 400) sync.planeAbgleich();
                });
            }
            next();
        });
    }

    app.use('/api/cluster', getClusterRoutes(() => app.get('cluster'), { secret: syncKonfig.secret }));
    if (cluster) app.use('/api', nurMaster(() => app.get('cluster')));

    // Mount routes with Knex instance dependency injection
    app.use('/api/auth', getAuthRoutes(knex));
    app.use('/api/vereine', getVereinRoutes(knex));
    app.use('/api/turniere', requireWriteAuth, getTurnierRoutes(knex));
    app.use('/api/teilnehmer', requireWriteAuth, getTeilnehmerRoutes(knex));
    app.use('/api/pools', requireWriteAuth, getPoolRoutes(knex));
    app.use('/api/kampfflaechen', requireWriteAuth, getKampfflaecheRoutes(knex));
    app.use('/api/kaempfe', requireWriteAuth, getKampfRoutes(knex));
    app.use('/api/mannschaften', requireWriteAuth, getMannschaftRoutes(knex));
    app.use('/api/mannschaftskaempfe', requireWriteAuth, getMannschaftskampfRoutes(knex));
    app.use('/api/sync', getSyncRoutes(() => app.get('sync')));
}

app.use('/js/qr', express.static(path.join(__dirname, '../node_modules/jsqr/dist')));
app.use('/js/qrgen', express.static(path.join(__dirname, '../node_modules/qrcode-generator/dist')));
app.use('/js/shared', express.static(path.join(__dirname, 'shared')));
app.use('/js/pouchdb', express.static(path.join(__dirname, '../node_modules/pouchdb/dist')));
app.use('/css/material', express.static(path.join(__dirname, '../node_modules/material-components-web')));
app.use('/icons/material', express.static(path.join(__dirname, '../node_modules/@material-design-icons/font')));

app.get('/api/djb-klassen', (req, res) => {
    try {
        const daten = JSON.parse(readFileSync(path.join(__dirname, './config/altersklassen.json'), 'utf-8'));
        res.json(daten);
    } catch (e) {
        console.error("Fehler beim Laden von altersklassen.json:", e);
        res.status(500).json({ error: 'Altersklassen-Konfiguration konnte nicht geladen werden.' });
    }
});

app.get('/api/graduierungen', (req, res) => {
    try {
        const daten = JSON.parse(readFileSync(path.join(__dirname, './config/graduierungen.json'), 'utf-8'));
        res.json(daten);
    } catch (e) {
        console.error("Fehler beim Laden von graduierungen.json:", e);
        res.status(500).json({ error: 'Graduierungs-Konfiguration konnte nicht geladen werden.' });
    }
});

app.get('/api/config', (req, res) => {
    res.json({ isOffline: process.env.IS_OFFLINE === 'true' || syncKonfig.istClient, syncRolle: syncKonfig.rolle });
});

if (syncKonfig.istClient) {
    // Alle übrigen /api-Lesezugriffe beantwortet der Client aus seinen lokalen Dokumenten.
    app.use('/api', getClientApiRoutes(() => app.get('sync')));
}

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, syncKonfig.istClient ? '../public/client.html' : '../public/turniere.html'));
});

app.listen(PORT, () => {
    console.log(`🚀 Hajime Pro läuft auf http://localhost:${PORT}`);
});
