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
import { getUrkundenRoutes } from './routes/urkundenRoutes.js';
import { ensureSuperAdmin } from './utils/superAdmin.js';
import { waehleKnexUmgebung } from './utils/dbUmgebung.js';
import { liesSyncKonfig } from './sync/konfig.js';
import { starteSyncDienst } from './sync/syncDienst.js';
import { getSyncRoutes } from './routes/syncRoutes.js';
import { starteClientDienst } from './sync/clientDienst.js';
import { liesClusterKonfig, clusterSecretFehler } from './cluster/konfig.js';
import { starteClusterDienst } from './cluster/clusterDienst.js';
import { getClusterRoutes } from './routes/clusterRoutes.js';
import { nurMaster } from './middleware/nurMaster.js';
import { getClientApiRoutes, clientStatischeSeiten } from './sync/clientApi.js';
import { ladeKopplung } from './sync/kopplung.js';
import { getClientVerteilungRoutes } from './routes/clientVerteilungRoutes.js';
import { starteAnkuendigung } from './sync/ankuendigung.js';
import { starteWeiterleitung } from './sync/port80.js';

dotenv.config({ quiet: true });

// Knex-Konfiguration laden
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const knexConfig = require('../knexfile.cjs');

const syncKonfig = liesSyncKonfig();
// Server-Cluster nur für Hallen-Server (SYNC_ROLLE=server) mit CLUSTER_KNOTEN.
const clusterKonfig = syncKonfig.istServer ? liesClusterKonfig() : { aktiv: false };
const clusterFehler = clusterSecretFehler(clusterKonfig, syncKonfig.secret);
if (clusterFehler) {
    // Kein automatisch erzeugtes Geheimnis im Cluster (siehe clusterSecretFehler) — lieber gar nicht
    // starten als still mit 401 zwischen den Servern laufen.
    console.error(clusterFehler);
    process.exit(1);
}
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

    // Kopplung neuer Desktop-Clients: ohne SYNC_SECRET in der .env erzeugt der Hallen-Server das
    // Geheimnis selbst (zero-config). Es muss VOR dem Sync-Dienst feststehen, der es prüft.
    const kopplung = syncKonfig.istServer ? ladeKopplung({ datenverzeichnis: syncKonfig.datenverzeichnis, envSecret: syncKonfig.secret }) : null;
    if (kopplung) {
        syncKonfig.secret = kopplung.secret;
        if (kopplung.secretErzeugt) {
            console.warn('[Kopplung] SYNC_SECRET automatisch erzeugt – Client-Geräte mit .env neu koppeln oder SYNC_SECRET aus kopplung.json übernehmen.');
        }
    }

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

    // Turnier-Import/-Ergebnisupload schicken die Exportdatei base64-kodiert; darin stecken die
    // Ausschreibung und die Urkunden-Vorlagen (je bis 10 MB) bereits als Base64 — daher ein
    // eigenes, höheres Limit nur für diese beiden Routen.
    const jsonImport = express.json({ limit: '200mb' });
    const jsonStandard = express.json({ limit: '15mb' });
    const IMPORT_ROUTE = /^\/api\/turniere\/(import|\d+\/import-ergebnisse)$/;
    app.use((req, res, next) => (IMPORT_ROUTE.test(req.path) ? jsonImport : jsonStandard)(req, res, next));
    app.use(express.static(path.join(__dirname, '../public')));

    if (kopplung) {
        const downloadsVerzeichnis = process.env.CLIENT_DOWNLOADS_VERZEICHNIS || './data/client-downloads';
        const serverVersion = require('../package.json').version;
        // Nur der Ordner der eigenen Version ist abrufbar (download.js/updater.js bauen
        // /downloads/<version>/<datei>) — ältere Stände im Verzeichnis bleiben unerreichbar.
        app.use(`/downloads/${encodeURIComponent(serverVersion)}`, express.static(path.join(path.resolve(downloadsVerzeichnis), serverVersion)));
        app.get('/download', (req, res) => res.sendFile(path.join(__dirname, '../public/download.html')));
        app.use('/api/client', getClientVerteilungRoutes({
            datenverzeichnis: syncKonfig.datenverzeichnis,
            downloadsVerzeichnis,
            version: serverVersion,
            kopplung
        }));
    }

    if (sync && process.env.MDNS_AKTIV !== 'false') {
        starteAnkuendigung({
            name: process.env.MDNS_NAME || 'turnier',
            port: Number(PORT),
            version: require('../package.json').version,
            knoten: clusterKonfig.aktiv ? clusterKonfig.knoten : '',
            modus: () => sync.modus()
        });
    }
    if (sync && process.env.PORT80_WEITERLEITUNG !== 'false' && Number(PORT) !== 80) {
        starteWeiterleitung({ zielPort: Number(PORT) });
    }

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
    app.use('/api/urkunden', requireWriteAuth, getUrkundenRoutes(knex));
    app.use('/api/sync', getSyncRoutes(() => app.get('sync')));
}

app.use('/js/qr', express.static(path.join(__dirname, '../node_modules/jsqr/dist')));
app.use('/js/qrgen', express.static(path.join(__dirname, '../node_modules/qrcode-generator/dist')));
app.use('/js/shared', express.static(path.join(__dirname, 'shared')));
app.use('/js/fabric', express.static(path.join(__dirname, '../node_modules/fabric/dist')));
app.use('/js/pdfjs', express.static(path.join(__dirname, '../node_modules/pdfjs-dist/build')));
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

// LISTEN_HOST (optional): nur an diese Adresse binden. Der Desktop-Client (desktop/main.js) setzt
// 127.0.0.1, damit der Client-Knoten nicht im Hallen-WLAN erreichbar ist (und keine Firewall-
// Abfrage auslöst). Ohne Variable wie bisher auf allen Schnittstellen.
const LISTEN_HOST = process.env.LISTEN_HOST || undefined;
app.listen(PORT, LISTEN_HOST, () => {
    console.log(`🚀 Hajime Pro läuft auf http://${LISTEN_HOST || 'localhost'}:${PORT}`);
});

export { app };
