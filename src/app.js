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
import betriebsmodus from './config/betriebsmodus.cjs';
import { starteEingebettetesPostgres, stoppeMitProzess } from './utils/eingebettetesPostgres.js';
import { liesSyncKonfig } from './sync/konfig.js';
import { starteSyncDienst } from './sync/syncDienst.js';
import { getSyncRoutes } from './routes/syncRoutes.js';
import { starteClientDienst } from './sync/clientDienst.js';
import { liesClusterKonfig, clusterSecretFehler } from './cluster/konfig.js';
import { starteClusterDienst } from './cluster/clusterDienst.js';
import { getClusterRoutes } from './routes/clusterRoutes.js';
import { nurMaster } from './middleware/nurMaster.js';
import { appCors } from './middleware/appCors.js';
import { getClientApiRoutes, clientStatischeSeiten } from './sync/clientApi.js';
import { ladeKopplung } from './sync/kopplung.js';
import { getClientVerteilungRoutes } from './routes/clientVerteilungRoutes.js';
import { starteAnkuendigung } from './sync/ankuendigung.js';
import { starteWeiterleitung } from './sync/port80.js';
import { dienstUpdateAktiv, pruefeUndAktualisiereDienst } from './utils/dienstUpdate.js';
import { liesOeffentlichenSchluessel } from './sync/clientDateien.js';

dotenv.config({ quiet: true });

// Knex-Konfiguration laden
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const knexConfig = require('../knexfile.cjs');

// Betriebsmodus einmal auswerten (cloud | server | client, siehe src/config/betriebsmodus.cjs). Widersprüchliche
// Einstellungen verhindern den Start — lieber gar nicht starten als in einem halben Zustand laufen.
const bm = betriebsmodus.liesBetriebsmodus();
bm.warnungen.forEach(w => console.warn(`[Betriebsmodus] Hinweis: ${w}`));
if (bm.fehler.length) {
    bm.fehler.forEach(f => console.error(`[Betriebsmodus] ${f}`));
    console.error('[Betriebsmodus] Server wird nicht gestartet.');
    process.exit(1);
}

// Linux-Dienst (systemd): beim Start auf ein neueres GitHub-Release prüfen und es installieren (src/utils/dienstUpdate.js).
// Nach dem Austausch beendet sich der Prozess, systemd (Restart=always) startet die neue Version.
if (dienstUpdateAktiv()) {
    const installDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const aktuelleVersion = JSON.parse(readFileSync(path.join(installDir, 'package.json'), 'utf8')).version;
    const ergebnis = await pruefeUndAktualisiereDienst({
        installDir, aktuelleVersion,
        schluessel: liesOeffentlichenSchluessel(),
        repo: process.env.CLIENT_RELEASE_REPO || 'oensel/Hajime-Pro',
        token: process.env.CLIENT_RELEASE_TOKEN || process.env.GITHUB_TOKEN || ''
    });
    if (ergebnis === 'neustart') process.exit(0);
}

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

// Express 5 lässt req.body undefined, wenn kein Body geparst wurde (Express 4: {}). Die Controller und
// resolveTurnierId lesen req.body.<feld> direkt, daher hier wieder das gewohnte leere Objekt setzen.
const bodyLeerFallback = (req, res, next) => {
    if (req.body === undefined) req.body = {};
    next();
};

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
    app.use(bodyLeerFallback);
    app.use(clientStatischeSeiten(path.join(__dirname, '../public')));
    app.use(express.static(path.join(__dirname, '../public')));
    app.use('/api/sync', getSyncRoutes(() => app.get('sync')));
    app.use('/api/cluster', getClusterRoutes(() => null, { secret: syncKonfig.secret }));
} else {
    const environment = waehleKnexUmgebung();
    let knexKonfig = knexConfig[environment];

    // Modus server ohne DB_HOST: der Server bringt sein PostgreSQL selbst mit (nichts zu installieren).
    let eingebettet = null;
    if (bm.dbEingebettet) {
        try {
            eingebettet = await starteEingebettetesPostgres({
                datenverzeichnis: process.env.PG_DATENVERZEICHNIS || './data/pg',
                port: Number(process.env.DB_PORT) || 5433,
                dbName: process.env.DB_NAME || 'hajime'
            });
        } catch (e) {
            console.error(`[Datenbank] ${e.message}`);
            process.exit(1);
        }
        stoppeMitProzess(eingebettet);
        knexKonfig = {
            ...knexKonfig,
            connection: { host: eingebettet.host, port: eingebettet.port, user: eingebettet.user, password: eingebettet.password, database: eingebettet.database },
            // Absolut, damit der Start nicht vom Arbeitsverzeichnis abhängt (installierte App).
            migrations: { directory: path.join(__dirname, '../migrations') }
        };
    }
    const knex = knexLib(knexKonfig);
    if (eingebettet) {
        // Die eigene Datenbank hat keinen Installer, der migriert: Schema bei jedem Start auf den neuesten Stand bringen.
        const [, neue] = await knex.migrate.latest();
        console.log(`[Datenbank] Schema aktuell${neue.length ? ` (${neue.length} Migration(en) ausgeführt)` : ''}.`);
    }

    // Cloud-Container: auf Wunsch (DB_AUTO_MIGRATE=true) beim Start migrieren, über DB_URL_MIGRATION (Direct-/
    // Session-Verbindung; der Supabase-Transaction-Pooler verträgt keine Migrationen). Standardmäßig aus, damit
    // eine gemeinsame Cloud-DB nie ungefragt migriert wird.
    if (bm.istCloud && process.env.DB_AUTO_MIGRATE === 'true') {
        const migrationsKnex = knexLib({
            ...knexConfig['online-migration'],
            pool: { min: 0, max: 1 },
            migrations: { directory: path.join(__dirname, '../migrations') }
        });
        try {
            const [, neue] = await migrationsKnex.migrate.latest();
            console.log(`[Datenbank] Schema aktuell${neue.length ? ` (${neue.length} Migration(en) ausgeführt)` : ''}.`);
        } catch (e) {
            console.error(`[Datenbank] Migration fehlgeschlagen: ${e.message}`);
            process.exit(1);
        } finally {
            await migrationsKnex.destroy();
        }
    }

    // Der Super-Admin-Bootstrap betrifft nur den Online-Mehrbenutzerbetrieb (Vereins-Erstfreigabe) —
    // der Hallenbetrieb (BETRIEBSMODUS=server, bisher IS_OFFLINE=true) arbeitet mit seinem eigenen
    // isolierten Mock-User, siehe requireAuth.
    if (bm.mehrbenutzer) {
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
        // Android-App (Herkunft localhost): Replikation, Status, Kopplung und Version freigeben.
        app.use(['/db', '/api/sync/status', '/api/client/koppeln', '/api/client/version'], appCors);
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
    app.use(bodyLeerFallback);
    app.use(express.static(path.join(__dirname, '../public')));

    if (kopplung) {
        const downloadsVerzeichnis = process.env.CLIENT_DOWNLOADS_VERZEICHNIS || './data/client-downloads';
        const serverVersion = require('../package.json').version;
        // Nur der Ordner der eigenen Version ist abrufbar (download.js/updater.js bauen
        // /downloads/<version>/<datei>) — ältere Stände im Verzeichnis bleiben unerreichbar.
        app.use(`/downloads/${encodeURIComponent(serverVersion)}`, express.static(path.join(path.resolve(downloadsVerzeichnis), serverVersion)));
        app.get('/download', (req, res) => res.sendFile(path.join(__dirname, '../public/download.html')));
        // Client-Dateien selbst bereitstellen (mitgeliefert im Server-Paket oder aus dem GitHub-Release),
        // damit nach der Installation keine Handarbeit nötig ist. In den Tests aus (kein Netzzugriff).
        // Erst hier geladen: das Modul braucht desktop/ (Signaturprüfung), das im Cloud-Docker-Image fehlt.
        const { erzeugeClientDateien } = await import('./sync/clientDateien.js');
        const clientDateien = erzeugeClientDateien({
            downloadsVerzeichnis,
            version: serverVersion,
            mitgeliefert: process.env.CLIENT_DATEIEN_MITGELIEFERT || '',
            repo: process.env.CLIENT_RELEASE_REPO || 'oensel/Hajime-Pro',
            token: process.env.CLIENT_RELEASE_TOKEN || process.env.GITHUB_TOKEN || '',
            autoHolen: process.env.CLIENT_AUTO_HOLEN ? process.env.CLIENT_AUTO_HOLEN !== 'false' : process.env.NODE_ENV !== 'test'
        });
        clientDateien.starte();
        app.use('/api/client', getClientVerteilungRoutes({
            datenverzeichnis: syncKonfig.datenverzeichnis,
            downloadsVerzeichnis,
            version: serverVersion,
            kopplung,
            clientDateienStatus: () => clientDateien.status()
        }));
    }

    if (sync && bm.mdns) {
        starteAnkuendigung({
            name: process.env.MDNS_NAME || 'turnier',
            port: Number(PORT),
            version: require('../package.json').version,
            knoten: clusterKonfig.aktiv ? clusterKonfig.knoten : '',
            modus: () => sync.modus()
        });
    }
    if (sync && bm.port80 && Number(PORT) !== 80) {
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
// legacy-Build: der moderne Build setzt sehr neue Browser-Funktionen voraus (z.B. Map.getOrInsertComputed, ab
// Chrome ~145) und scheitert in älteren Browsern beim Rendern, ohne dass der Designer es meldet.
app.use('/js/pdfjs', express.static(path.join(__dirname, '../node_modules/pdfjs-dist/legacy/build')));
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
    res.json({ isOffline: bm.einzelbenutzer, syncRolle: syncKonfig.rolle, betriebsmodus: bm.modus });
});

if (syncKonfig.istClient) {
    // Alle übrigen /api-Lesezugriffe beantwortet der Client aus seinen lokalen Dokumenten.
    app.use('/api', getClientApiRoutes(() => app.get('sync')));
}

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, syncKonfig.istClient ? '../public/client.html' : '../public/turniere.html'));
});

// Bindeadresse (bm.listenHost): der Desktop-Client (desktop/main.js) setzt LISTEN_HOST=127.0.0.1, damit er nicht im
// WLAN erreichbar ist und keine Firewall-Abfrage auslöst. Ein Server bindet sonst auf allen Schnittstellen — ob der
// Browser lokal läuft oder ein Client im LAN zugreift, macht für ihn keinen Unterschied.
app.listen(PORT, bm.listenHost, () => {
    console.log(`🚀 Hajime Pro läuft auf http://${bm.listenHost || 'localhost'}:${PORT} (Modus ${bm.modus})`);
});

export { app };
