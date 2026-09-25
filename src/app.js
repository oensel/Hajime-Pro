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
import { setupOfflineRoutes } from './routes/offlineRoutes.js';
import { getMannschaftRoutes, getMannschaftskampfRoutes } from './routes/mannschaftRoutes.js';
import { ensureSuperAdmin } from './utils/superAdmin.js';
import { waehleKnexUmgebung } from './utils/dbUmgebung.js';
import { liesSyncKonfig } from './sync/konfig.js';
import { starteSyncDienst } from './sync/syncDienst.js';
import { getSyncRoutes } from './routes/syncRoutes.js';

dotenv.config();

// Knex-Konfiguration laden
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const knexConfig = require('../knexfile.cjs');

const environment = waehleKnexUmgebung();
const knex = knexLib(knexConfig[environment]);

// Der Super-Admin-Bootstrap betrifft nur den Online-Mehrbenutzerbetrieb (Vereins-Erstfreigabe) —
// der Hallenbetrieb (IS_OFFLINE=true, auch mit DB_CLIENT=pg) arbeitet mit seinem eigenen
// isolierten Mock-User, siehe requireAuth.
if (process.env.IS_OFFLINE !== 'true') {
    ensureSuperAdmin(knex);
}

const app = express();
app.set('knex', knex);

// Sync-Dienst (nur SYNC_ROLLE=server, siehe src/sync/). Das vorhandene Turnier aktiviert er erst
// beim ersten Request (sync.bereit(), siehe dort).
const syncKonfig = liesSyncKonfig();
const sync = await starteSyncDienst({ knex, konfig: syncKonfig });
app.set('sync', sync);
const PORT = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import { requireWriteAuth } from './middleware/auth.js';

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

// Mount routes with Knex instance dependency injection
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

app.use('/api/auth', getAuthRoutes(knex));
app.use('/api/vereine', getVereinRoutes(knex));
app.use('/api/turniere', requireWriteAuth, getTurnierRoutes(knex));
app.use('/api/teilnehmer', requireWriteAuth, getTeilnehmerRoutes(knex));
app.use('/api/pools', requireWriteAuth, getPoolRoutes(knex));
app.use('/api/kampfflaechen', requireWriteAuth, getKampfflaecheRoutes(knex));
app.use('/api/kaempfe', requireWriteAuth, getKampfRoutes(knex));
app.use('/api/mannschaften', requireWriteAuth, getMannschaftRoutes(knex));
app.use('/api/mannschaftskaempfe', requireWriteAuth, getMannschaftskampfRoutes(knex));
app.use('/api/offline', requireWriteAuth, setupOfflineRoutes(knex));
app.use('/api/sync', getSyncRoutes(() => app.get('sync')));

app.use('/js/qr', express.static(path.join(__dirname, '../node_modules/jsqr/dist')));
app.use('/js/qrgen', express.static(path.join(__dirname, '../node_modules/qrcode-generator/dist')));
app.use('/js/shared', express.static(path.join(__dirname, 'shared')));
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
    res.json({ isOffline: process.env.IS_OFFLINE === 'true' });
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/turniere.html'));
});

app.listen(PORT, () => {
    console.log(`🚀 Hajime Pro läuft auf http://localhost:${PORT}`);
});
