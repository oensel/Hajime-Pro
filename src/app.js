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
import { initialisiere as initialisiereSteuerungPasswort } from './utils/steuerungPasswort.js';
import { getVereinRoutes } from './routes/vereinRoutes.js';
import { getFreigabeRoutes } from './routes/freigabeRoutes.js';
import { getNutzerRoutes } from './routes/nutzerRoutes.js';
import { getCloudUpdateRoutes } from './routes/cloudUpdateRoutes.js';
import { getSicherungRoutes } from './routes/sicherungRoutes.js';
import { leseSicherungsKonfig, starteSicherungsPlaner } from './services/sicherungsPlaner.js';
import { sicherungsVerzeichnis } from './services/datensicherung.js';
import { getProtokollRoutes } from './routes/protokollRoutes.js';
import { getRechtlichesSeiten, getRechtlichesApi } from './routes/rechtlichesRoutes.js';
import { ladeRechtliches } from './services/rechtliches.js';
import { loescheUnbestaetigteKonten, UNBESTAETIGT_TAGE } from './services/kontenAufraeumen.js';
import { getKonsoleRoutes, getFehlerMeldeRoutes } from './routes/konsoleRoutes.js';
import { installiereFehlerErfassung, meldeInfo, fehlerBehandlung, bereinigeFehler, STANDARD_AUFBEWAHRUNG_TAGE as FEHLER_TAGE } from './services/fehlerProtokoll.js';
import { erzeugeProtokollMiddleware, bereinigeProtokoll, STANDARD_AUFBEWAHRUNG_TAGE } from './services/aktionsProtokoll.js';
import { erzeugeCloudUpdate } from './utils/cloudUpdate.js';
import { getTurnierRoutes } from './routes/turnierRoutes.js';
import { getCloudRoutes } from './routes/cloudRoutes.js';
import { erzeugeCloudZugriff } from './services/cloudZugriff.js';
import { getTeilnehmerRoutes } from './routes/teilnehmerRoutes.js';
import { getPoolRoutes } from './routes/poolRoutes.js';
import { getKampfflaecheRoutes } from './routes/kampfflaecheRoutes.js';
import { getKampfRoutes } from './routes/kampfRoutes.js';
import { getMannschaftRoutes, getMannschaftskampfRoutes } from './routes/mannschaftRoutes.js';
import { getUrkundenRoutes } from './routes/urkundenRoutes.js';
import { getLiveRoutes } from './routes/liveRoutes.js';
import { getLiveAppRoutes } from './routes/liveAppRoutes.js';
import { starteLiveAppDienst } from './liveApp/liveAppDienst.js';
import { getOrgaRoutes } from './routes/orgaRoutes.js';
import { getOrgaHelferRoutes } from './routes/orgaHelferRoutes.js';
import { getEinladungRoutes } from './routes/einladungRoutes.js';
import { getHelferRoutes } from './routes/helferRoutes.js';
import { getHelferPlanRoutes } from './routes/helferPlanRoutes.js';
import { starteAufbewahrung } from './liveCloud/aufbewahrung.js';
import { liesPushKonfig } from './liveCloud/pushKonfig.js';
import { erzeugeSender } from './liveCloud/pushSender.js';
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
import { erzeugeVerwalter as erzeugeCloudLiveVerwalter } from './cloudLive/verwalter.js';
import { getCloudLiveGeraeteRoutes } from './cloudLive/geraeteRoutes.js';
import { getClientVerteilungRoutes } from './routes/clientVerteilungRoutes.js';
import { starteAnkuendigung } from './sync/ankuendigung.js';
import { starteWeiterleitung } from './sync/port80.js';
import { erzeugeAusgabe } from './durchsage/audioAusgabe.js';
import { erzeugeDurchsageDienst, haengeDurchsageAn, haengeWebSocketAn, verbindeAlsProxy } from './durchsage/durchsageDienst.js';
import { erzeugeVideoSpeicher } from './video/videoSpeicher.js';
import { erzeugeVideoDienst, VIDEO_PFAD, VIDEO_LIVE_PFAD } from './video/videoDienst.js';
import { getVideoRoutes } from './routes/videoRoutes.js';
import { dienstUpdateAktiv, pruefeUndAktualisiereDienst } from './utils/dienstUpdate.js';
import { getDownloadRoutes, getReleaseFassadeRoutes } from './routes/downloadRoutes.js';
import { erzeugeReleaseSpiegel, leseSpiegelKonfig } from './services/releaseSpiegelDienst.js';
import { erzeugeLokalenReleaseZugriff, neuesteLokaleVersion, releaseVerzeichnis } from './services/releaseSpeicher.js';
import { ermittleReleaseQuelle } from './utils/releaseQuelle.js';

dotenv.config({ quiet: true });

// Knex-Konfiguration laden
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const knexConfig = require('../knexfile.cjs');

// Betriebsmodus einmal auswerten (cloud | server | client, siehe src/config/betriebsmodus.cjs). Widersprüchliche
// Einstellungen verhindern den Start — lieber gar nicht starten als in einem halben Zustand laufen.
const bm = betriebsmodus.liesBetriebsmodus();
// Fehlerprotokoll („Konsole“, src/services/fehlerProtokoll.js): in der Cloud an; FEHLERPROTOKOLL_AKTIV=true schaltet es außerhalb der Cloud ein (Tests)
const fehlerAktiv = bm.istCloud || process.env.FEHLERPROTOKOLL_AKTIV === 'true';
bm.warnungen.forEach(w => console.warn(`[Betriebsmodus] Hinweis: ${w}`));
if (bm.fehler.length) {
    bm.fehler.forEach(f => console.error(`[Betriebsmodus] ${f}`));
    console.error('[Betriebsmodus] Server wird nicht gestartet.');
    process.exit(1);
}

// Linux-Dienst (systemd): beim Start auf ein neueres GitHub-Release prüfen und es installieren (src/utils/dienstUpdate.js).
// Nach dem Austausch beendet sich der Prozess, systemd (Restart=always) startet die neue Version.
if (dienstUpdateAktiv()) {
    // Erst hier geladen: clientDateien.js braucht desktop/ (Signaturprüfung), das im Cloud-Docker-Image fehlt.
    const { liesOeffentlichenSchluessel } = await import('./sync/clientDateien.js');
    const installDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const aktuelleVersion = JSON.parse(readFileSync(path.join(installDir, 'package.json'), 'utf8')).version;
    // Quelle: die Cloud, sobald dieser Server einen Geräteschlüssel hat (src/utils/releaseQuelle.js), sonst GitHub.
    const quelle = ermittleReleaseQuelle({ datenDir: path.join(installDir, 'data') });
    const ergebnis = await pruefeUndAktualisiereDienst({
        installDir, aktuelleVersion,
        schluessel: liesOeffentlichenSchluessel(),
        repo: quelle.repo, token: quelle.token, apiBasis: quelle.apiBasis
    });
    if (ergebnis === 'neustart') process.exit(0);
}

const appVersion = JSON.parse(readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8')).version;
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
import { startOrgaErinnerung } from './services/orgaErinnerung.js';

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
            if (neue.length) meldeInfo(`Datenbank-Migration angewendet: ${neue.join(', ')}`);
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
    const fehlerErfassung = fehlerAktiv ? installiereFehlerErfassung(knex) : null;

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
    // Teilnehmer-App (Schalter am Hallen-Server): Cloud-Prüfung und Uplink im Server-Prozess; den Cluster bindet er spät.
    const cloudZugriff = erzeugeCloudZugriff();
    const liveApp = bm.einzelbenutzer
        ? starteLiveAppDienst({ knex, cloud: cloudZugriff, holeCluster: () => app.get('cluster') })
        : null;
    app.set('liveApp', liveApp);
    const cluster = clusterKonfig.aktiv ? starteClusterDienst({
        knex, clusterKonfig, syncKonfig, sync, version: appVersion,
        holeLiveAppStatus: () => app.get('liveApp')?.statusFuerPartner() ?? null
    }) : null;
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
    // Cloud-Live (src/cloudLive/): die Cloud führt Turniere wie ein Hallen-Server live. Geräte sprechen /turnierlive/<schluessel>
    // an (Status, Kopplung, /db); wie /db muss das vor express.json() hängen. CLOUD_LIVE_AKTIV=true schaltet es außerhalb der Cloud ein (Tests).
    if (bm.istCloud || process.env.CLOUD_LIVE_AKTIV === 'true') {
        const cloudLive = erzeugeCloudLiveVerwalter({
            knex, konfig: { datenverzeichnis: process.env.CLOUD_LIVE_DATENVERZEICHNIS || './data/cloud-live' }
        });
        app.set('cloudLive', cloudLive);
        app.use('/turnierlive', appCors);
        app.use('/turnierlive/:schluessel', getCloudLiveGeraeteRoutes({ knex, verwalter: cloudLive }));
        // Nach jedem erfolgreichen schreibenden API-Request den Abgleich der Live-Turniere anstoßen (wie am Hallen-Server).
        app.use('/api', (req, res, next) => {
            if (req.method !== 'GET') {
                res.on('finish', () => {
                    if (res.statusCode < 400) cloudLive.planeAbgleich();
                });
            }
            next();
        });
        cloudLive.wiederaufnahme().catch((fehler) => console.error('[Cloud-Live] Wiederaufnahme fehlgeschlagen:', fehler));
    }

    // eigenes, höheres Limit nur für diese beiden Routen.
    const jsonImport = express.json({ limit: '200mb' });
    const jsonStandard = express.json({ limit: '15mb' });
    // Anmeldung/Registrierung/Profil (/api/auth, teils öffentlich) brauchen nur wenige Felder: kleines Limit (413).
    const jsonAuth = express.json({ limit: '10kb' });
    const IMPORT_ROUTE = /^\/api\/turniere\/(import|\d+\/import-ergebnisse)$/;
    const AUTH_ROUTE = /^\/api\/(auth|fehler)(\/|$)/;
    app.use((req, res, next) => (IMPORT_ROUTE.test(req.path) ? jsonImport
        : AUTH_ROUTE.test(req.path) ? jsonAuth : jsonStandard)(req, res, next));
    app.use(bodyLeerFallback);
    // Aktionsprotokoll (src/services/aktionsProtokoll.js): in der Cloud jede schreibende Aktion eines angemeldeten Kontos;
    // PROTOKOLL_AKTIV=true schaltet es außerhalb der Cloud ein (Tests).
    const protokollAktiv = bm.istCloud || process.env.PROTOKOLL_AKTIV === 'true';
    if (protokollAktiv) app.use(erzeugeProtokollMiddleware(knex));
    // Impressum und Datenschutzerklärung (öffentlich, vor dem statischen Ordner); RECHTLICHES_AKTIV=true schaltet sie außerhalb der Cloud ein (Tests)
    const rechtlichesAktiv = bm.istCloud || process.env.RECHTLICHES_AKTIV === 'true';
    if (rechtlichesAktiv) {
        app.use(getRechtlichesSeiten());
        const rechtliches = ladeRechtliches();
        if (!rechtliches.vollstaendig) {
            console.warn(`[Rechtliches] Impressum/Datenschutzerklärung unvollständig, es fehlen: ${rechtliches.fehlend.map((f) => f.pfad).join(', ')} (siehe docs/datenschutz/README.md)`);
        }
    }
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
        // Cloud (Geräteschlüssel vorhanden) oder bisher GitHub; Datenverzeichnis des Servers: dort liegt der Geräteschlüssel.
        const clientDateienQuelle = () => {
            const q = ermittleReleaseQuelle({ datenDir: syncKonfig.datenverzeichnis ? path.dirname(path.resolve(syncKonfig.datenverzeichnis)) : '' });
            return { repo: q.repo, token: q.token, ...(q.apiBasis ? { apiBasis: q.apiBasis } : {}) };
        };
        const clientDateien = erzeugeClientDateien({
            downloadsVerzeichnis,
            version: serverVersion,
            mitgeliefert: process.env.CLIENT_DATEIEN_MITGELIEFERT || '',
            ...clientDateienQuelle(),
            autoHolen: process.env.CLIENT_AUTO_HOLEN ? process.env.CLIENT_AUTO_HOLEN !== 'false' : process.env.NODE_ENV !== 'test'
        });
        clientDateien.starte();
        app.use('/api/client', getClientVerteilungRoutes({
            datenverzeichnis: syncKonfig.datenverzeichnis,
            downloadsVerzeichnis,
            version: serverVersion,
            kopplung,
            vip: clusterKonfig.vip,
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
    // Geändertes Turnierleitungs-Passwort aus der DB laden (lädt bei noch fehlender Migration nach).
    initialisiereSteuerungPasswort(knex);
    app.use('/api/auth', getAuthRoutes(knex));
    app.use('/api/vereine', getVereinRoutes(knex));
    // Freischaltung per Mail-Link (Token trägt die Berechtigung, daher ohne Anmeldung) und Super-Admin-Verwaltung.
    app.use('/api/freigabe', getFreigabeRoutes(knex));
    app.use('/api/nutzer', getNutzerRoutes(knex));
    // Update des Cloud-Servers durch den Super-Admin (src/utils/cloudUpdate.js).
    if (bm.istCloud) {
        const installDir = path.resolve(__dirname, '..');
        // Mit eingerichteter Spiegelung (RELEASE_QUELLE_REPO) aktualisiert sich die Cloud aus ihrer eigenen Ablage, sonst wie bisher aus GitHub.
        let lokal = {};
        if (leseSpiegelKonfig().repo) {
            const zugriff = erzeugeLokalenReleaseZugriff(releaseVerzeichnis());
            const { pruefeUndLade } = await import('../desktop/server/selbstUpdate.js');
            lokal = {
                repo: zugriff.repo, neuesteVersionFn: async () => neuesteLokaleVersion(releaseVerzeichnis()),
                ladeFn: (argumente) => pruefeUndLade({ ...argumente, fetchFn: zugriff.fetchFn, apiBasis: zugriff.apiBasis })
            };
        }
        app.use('/api/cloud-update', getCloudUpdateRoutes(knex, erzeugeCloudUpdate({
            installDir, aktuelleVersion: appVersion,
            repo: process.env.CLIENT_RELEASE_REPO || 'oensel/Hajime-Pro-Releases',
            token: process.env.CLIENT_RELEASE_TOKEN || process.env.GITHUB_TOKEN || '',
            ...lokal
        })));
    }
    // Installer und Updates für freigeschaltete Konten und Hallen-Server (src/routes/downloadRoutes.js); RELEASES_AKTIV=true schaltet es außerhalb der Cloud ein (Tests).
    if (bm.istCloud || process.env.RELEASES_AKTIV === 'true') {
        // Erst hier geladen: clientDateien.js braucht desktop/ (Signaturprüfung); das Cloud-Image enthält davon nur updateLogik.js und den öffentlichen Schlüssel.
        const { liesOeffentlichenSchluessel } = await import('./sync/clientDateien.js');
        const spiegel = erzeugeReleaseSpiegel({ konfig: leseSpiegelKonfig(), schluessel: liesOeffentlichenSchluessel() });
        app.use('/api/downloads', getDownloadRoutes(knex, { dir: releaseVerzeichnis(), spiegel }));
        app.use('/api/releases/v1', getReleaseFassadeRoutes(knex, { dir: releaseVerzeichnis() }));
        if (process.env.NODE_ENV !== 'test') spiegel.starte();
    }
    // Komplettsicherung und Wiedereinspielen durch den Super-Admin (src/services/datensicherung.js); SICHERUNG_AKTIV=true schaltet es außerhalb der Cloud ein (Tests).
    if (bm.istCloud || process.env.SICHERUNG_AKTIV === 'true') {
        const sicherungsKonfig = leseSicherungsKonfig();
        app.use('/api/sicherung', getSicherungRoutes(knex, { verzeichnis: sicherungsVerzeichnis(), konfig: sicherungsKonfig }));
        // Tägliche automatische Sicherung (src/services/sicherungsPlaner.js); SICHERUNG_AUTOMATISCH=false schaltet sie ab
        if (sicherungsKonfig.automatisch && process.env.NODE_ENV !== 'test') starteSicherungsPlaner(knex, sicherungsVerzeichnis(), sicherungsKonfig);
    }
    if (rechtlichesAktiv) app.use('/api/rechtliches', getRechtlichesApi(knex));
    // Ohne Impressumsseiten (Hallen-Server) meldet die Fußzeile „nicht aktiv“, statt einen 404 in der Konsole zu erzeugen.
    else app.get('/api/rechtliches/aktiv', (req, res) => res.json({ aktiv: false }));
    if (bm.istCloud && process.env.NODE_ENV !== 'test') {
        // Konten ohne bestätigte E-Mail-Adresse werden nach 30 Tagen gelöscht (Datenschutzerklärung, Abschnitt 3)
        const bereinigeKonten = () => loescheUnbestaetigteKonten(knex, Number(process.env.UNBESTAETIGT_TAGE) || UNBESTAETIGT_TAGE)
            .then((n) => { if (n > 0) meldeInfo(`Aufräumen: ${n} unbestätigte Konten gelöscht`, { quelle: 'prozess' }); })
            .catch((err) => console.error('[Konten] Aufräumen fehlgeschlagen:', err.message));
        setTimeout(bereinigeKonten, 60_000).unref();
        setInterval(bereinigeKonten, 24 * 60 * 60 * 1000).unref();
    }
    if (fehlerErfassung) {
        app.use('/api/fehler', getFehlerMeldeRoutes(fehlerErfassung.erfasse));
        app.use('/api/konsole', getKonsoleRoutes(knex));
        const bereinigeFehlerprotokoll = () => bereinigeFehler(knex, Number(process.env.FEHLER_AUFBEWAHRUNG_TAGE) || FEHLER_TAGE)
            .then((n) => { if (n > 0) meldeInfo(`Aufräumen: ${n} Konsoleneinträge älter als ${Number(process.env.FEHLER_AUFBEWAHRUNG_TAGE) || FEHLER_TAGE} Tage gelöscht`, { quelle: 'prozess' }); })
            .catch((err) => console.error('[Fehlerprotokoll] Aufräumen fehlgeschlagen:', err.message));
        bereinigeFehlerprotokoll();
        setInterval(bereinigeFehlerprotokoll, 24 * 60 * 60 * 1000).unref();
    }
    if (protokollAktiv) {
        app.use('/api/protokoll', getProtokollRoutes(knex));
        // Aufbewahrung: beim Start und danach täglich ältere Einträge löschen (PROTOKOLL_AUFBEWAHRUNG_TAGE, Standard 365)
        const tage = Number(process.env.PROTOKOLL_AUFBEWAHRUNG_TAGE) || STANDARD_AUFBEWAHRUNG_TAGE;
        const bereinige = () => bereinigeProtokoll(knex, tage)
            .then((n) => { if (n > 0) meldeInfo(`Aufräumen: ${n} Protokolleinträge älter als ${tage} Tage gelöscht`, { quelle: 'prozess' }); })
            .catch((err) => console.error('[Protokoll] Aufräumen fehlgeschlagen:', err.message));
        bereinige();
        setInterval(bereinige, 24 * 60 * 60 * 1000).unref();
    }
    app.use('/api/turniere', requireWriteAuth, getTurnierRoutes(knex));
    app.use('/api/teilnehmer', requireWriteAuth, getTeilnehmerRoutes(knex));
    app.use('/api/pools', requireWriteAuth, getPoolRoutes(knex));
    app.use('/api/kampfflaechen', requireWriteAuth, getKampfflaecheRoutes(knex));
    app.use('/api/kaempfe', requireWriteAuth, getKampfRoutes(knex));
    app.use('/api/mannschaften', requireWriteAuth, getMannschaftRoutes(knex));
    app.use('/api/mannschaftskaempfe', requireWriteAuth, getMannschaftskampfRoutes(knex));
    app.use('/api/urkunden', requireWriteAuth, getUrkundenRoutes(knex));
    // Helferplan der Orga (Spec Helferverwaltung 6): überall, im Hallenbetrieb hinter dem Turnierleitungs-Passwort.
    app.use('/api/helfer-plan', requireWriteAuth, getHelferPlanRoutes(knex));
    // Orga-Planer (Checkliste der Orga): überall, im Hallenbetrieb hinter dem Turnierleitungs-Passwort.
    app.use('/api/orga', requireWriteAuth, getOrgaRoutes(knex));
    // Helfer-App (Spec 5): nur in der Cloud; HELFER_APP_AKTIV=true schaltet sie für Tests im Modus server ein.
    if (bm.istCloud || process.env.HELFER_APP_AKTIV === 'true') {
        app.use('/api/helfer/orga', getOrgaHelferRoutes(knex));
        app.use('/api/helfer', getHelferRoutes(knex));
        app.use('/api/einladung', getEinladungRoutes(knex));
    }
    // Orga-Planer: stündliche Erinnerungsmails; nur mit SMTP, nie in Testläufen (Mail-Rauschen).
    if ((bm.istCloud || process.env.HELFER_APP_AKTIV === 'true') && process.env.SMTP_HOST && process.env.NODE_ENV !== 'test') {
        startOrgaErinnerung(knex);
    }
    app.use('/api/cloud', requireWriteAuth, getCloudRoutes(knex, { cloud: cloudZugriff, holeCluster: () => app.get('cluster'), datenDir: syncKonfig.datenverzeichnis ? path.dirname(path.resolve(syncKonfig.datenverzeichnis)) : '' }));
    if (liveApp) app.use('/api/live-app', requireWriteAuth, getLiveAppRoutes(liveApp));
    app.use('/api/sync', getSyncRoutes(() => app.get('sync')));

    // Teilnehmer-App (Phase 2): Ingest des Live-Prozesses und öffentliche App-API. Nur in der Cloud — ein Hallen-Server
    // darf keinen offenen Ingest anbieten. LIVE_API_AKTIV=true schaltet es für die Test-Suite im Modus server ein.
    if (bm.istCloud || process.env.LIVE_API_AKTIV === 'true') {
        const pushKonfig = liesPushKonfig();
        app.use('/api/live', getLiveRoutes(knex, { push: { konfig: pushKonfig, sender: pushKonfig.aktiv ? erzeugeSender(pushKonfig) : null } }));
        app.use('/live', express.static(path.join(__dirname, '../teilnehmer-app')));
        starteAufbewahrung(knex, { tage: Number(process.env.LIVE_AUFBEWAHRUNG_TAGE) || 7 });
    }
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

// Live-Durchsage (Scoreboard-Mikrofon -> Audioausgang des Hallen-Servers, siehe src/durchsage/). Nicht in der Cloud.
// Hallen-Server: spielt selbst ab (nur der Master); Client-Knoten: reicht Status und WebSocket an den Hallen-Server weiter.
const durchsageDienst = (bm.modus === 'cloud' || syncKonfig.istClient) ? null : erzeugeDurchsageDienst({
    ausgabe: erzeugeAusgabe(),
    darfSenden: () => { const c = app.get('cluster'); return !c || c.darfSchreiben(); }
});
if (bm.modus !== 'cloud') {
    app.get('/api/durchsage/status', async (req, res) => {
        if (durchsageDienst) return res.json(durchsageDienst.status());
        try {
            const r = await fetch(`${syncKonfig.serverUrl}/api/durchsage/status`, {
                headers: syncKonfig.secret ? { 'x-hajime-sync-secret': syncKonfig.secret } : {},
                signal: AbortSignal.timeout(3000)
            });
            if (!r.ok) throw new Error(String(r.status));
            res.json(await r.json());
        } catch {
            res.json({ verfuegbar: false, grund: 'Hallen-Server nicht erreichbar.', besetzt: false });
        }
    });
}

// Videoaufnahme für den Videoschiedsrichter (src/video/): Der Hallen-Server speichert die Clips der Matten (Übertragung live, sonst nachgeliefert) und zeigt sie live;
// Client-Knoten (Steuerung der Matte) reichen Status und WebSocket an ihn weiter. Nicht in der Cloud.
const videoSpeicher = (bm.modus === 'cloud' || syncKonfig.istClient) ? null
    : erzeugeVideoSpeicher({ wurzel: process.env.VIDEO_VERZEICHNIS || './data/video' });
const videoDienst = videoSpeicher && erzeugeVideoDienst({
    speicher: videoSpeicher,
    darfSenden: () => { const c = app.get('cluster'); return !c || c.darfSchreiben(); }
});
if (videoDienst) {
    app.use('/api/video', requireWriteAuth, getVideoRoutes({ speicher: videoSpeicher, dienst: videoDienst }));
} else if (syncKonfig.istClient) {
    const serverKopf = () => (syncKonfig.secret ? { 'x-hajime-sync-secret': syncKonfig.secret } : {});
    app.get('/api/video/status', async (req, res) => {
        try {
            const r = await fetch(`${syncKonfig.serverUrl}/api/video/status`, { headers: serverKopf(), signal: AbortSignal.timeout(3000) });
            if (!r.ok) throw new Error(String(r.status));
            res.json(await r.json());
        } catch {
            res.json({ verfuegbar: false, grund: 'Hallen-Server nicht erreichbar.', speicher: null });
        }
    });
}

if (syncKonfig.istClient) {
    // Alle übrigen /api-Lesezugriffe beantwortet der Client aus seinen lokalen Dokumenten.
    app.use('/api', getClientApiRoutes(() => app.get('sync')));
}

// Vorstellungsseite für Interessenten (öffentlich, ohne Anmeldung)
app.get('/willkommen', (req, res) => res.sendFile(path.join(__dirname, '../public/willkommen.html')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, syncKonfig.istClient ? '../public/client.html' : '../public/turniere.html'));
});

// Fehlerbehandlung am Ende der Routen: 5xx werden protokolliert und als JSON ohne Interna beantwortet
if (fehlerAktiv) app.use(fehlerBehandlung);

// Bindeadresse (bm.listenHost): der Desktop-Client (desktop/main.js) setzt LISTEN_HOST=127.0.0.1, damit er nicht im
// WLAN erreichbar ist und keine Firewall-Abfrage auslöst. Ein Server bindet sonst auf allen Schnittstellen — ob der
// Browser lokal läuft oder ein Client im LAN zugreift, macht für ihn keinen Unterschied.
const httpServer = app.listen(PORT, bm.listenHost, () => {
    console.log(`🚀 Hajime Pro läuft auf http://${bm.listenHost || 'localhost'}:${PORT} (Modus ${bm.modus})`);
    meldeInfo(`Server gestartet: Modus ${bm.modus}, Port ${PORT}, Version ${appVersion}`);
});

if (bm.modus !== 'cloud') {
    haengeDurchsageAn(httpServer, {
        verbinde: durchsageDienst
            ? (ws) => durchsageDienst.verbinde(ws)
            : (ws) => verbindeAlsProxy(ws, { serverUrl: syncKonfig.serverUrl, secret: syncKonfig.secret }),
        // Client-Knoten bindet nur an localhost (Browser derselben Seite); der Hallen-Server prüft SYNC_SECRET.
        secret: () => (durchsageDienst ? syncKonfig.secret : '')
    });
}

if (videoDienst) {
    const secret = () => syncKonfig.secret;
    haengeWebSocketAn(httpServer, { pfad: VIDEO_PFAD, verbinde: (ws) => videoDienst.verbindeSender(ws), secret, maxPayload: 16 * 1024 * 1024 });
    haengeWebSocketAn(httpServer, {
        pfad: VIDEO_LIVE_PFAD,
        verbinde: (ws, req) => videoDienst.verbindeZuschauer(ws, new URL(req.url, 'http://x').searchParams.get('matte') ?? ''),
        secret
    });
} else if (syncKonfig.istClient) {
    // Client-Knoten: die Steuerung überträgt über ihn; Zuschauerseiten (Live, Video-Archiv) öffnet man am Hallen-Server.
    haengeWebSocketAn(httpServer, {
        pfad: VIDEO_PFAD,
        verbinde: (ws) => verbindeAlsProxy(ws, { serverUrl: syncKonfig.serverUrl, secret: syncKonfig.secret, pfad: VIDEO_PFAD }),
        maxPayload: 16 * 1024 * 1024
    });
}

export { app };
