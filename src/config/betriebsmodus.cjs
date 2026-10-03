// Betriebsmodus von Hajime Pro — die EINE Stelle, die entscheidet, wie dieser Prozess läuft.
//
//   BETRIEBSMODUS=cloud    Internet-Server: PostgreSQL (Supabase oder eigener Server), Vereinsrechte/Login.
//   BETRIEBSMODUS=server   Hallen-Server: PostgreSQL lokal + Dokument-DB (PouchDB/express-pouchdb) lokal,
//                          Einzelbenutzer ohne Login. Läuft auf einem Notebook (Windows/macOS/Linux) oder auf
//                          Linux-Servern, dort optional im Cluster (CLUSTER_KNOTEN).
//   BETRIEBSMODUS=client   Gerät an Matte/Waage: nur lokale Dokument-DB, repliziert zum Server.
//
// Ein Server bietet seine Dienste immer gleich an — ob der Browser auf demselben Rechner läuft oder ein Client
// im LAN zugreift, macht für die Anwendung keinen Unterschied (und ohne Netzwerk läuft er ebenfalls). Wer ihn
// ausnahmsweise nur lokal erreichbar haben will, setzt LISTEN_HOST=127.0.0.1.
//
// Ergänzende Einstellungen:
//   DB_CLIENT=pg                    optional und wirkungslos (es gibt nur PostgreSQL); DB_CLIENT=sqlite ist ein Fehler.
//   DB_HOST / DB_URL                (nur server) Ohne DB_HOST/DB_URL startet der Server sein eigenes, eingebettetes
//                                   PostgreSQL (nichts zu installieren). Mit DB_HOST nutzt er einen vorhandenen
//                                   PostgreSQL-Server (Linux-Server, Cluster).
//   CLUSTER_KNOTEN=server1|server2  (nur server) Cluster-Betrieb zweier Linux-Server, siehe src/cluster/.
//   MDNS_AKTIV / PORT80_WEITERLEITUNG=false   mDNS-Ankündigung bzw. Port-80-Weiterleitung abschalten.
//
// Ohne BETRIEBSMODUS gilt das bisherige Verhalten, abgeleitet aus den alten Variablen:
//   SYNC_ROLLE=client                          -> client
//   IS_OFFLINE=true                            -> server (PostgreSQL über DB_HOST/DB_URL, kein eingebettetes)
//   sonst                                      -> cloud
// So laufen bestehende .env-Dateien und Test-Suiten unverändert weiter.
//
// Als CommonJS geschrieben, damit auch knexfile.cjs/db.js (CommonJS) es nutzen können; ES-Module
// importieren es per Default-Import.

const MODI = ['cloud', 'server', 'client'];
const CLUSTER_KNOTEN = ['server1', 'server2'];

function liesBetriebsmodus(env = process.env) {
    const fehler = [];
    const warnungen = [];

    const explizit = String(env.BETRIEBSMODUS || '').trim();
    let modus;
    let quelle;
    if (explizit) {
        quelle = 'BETRIEBSMODUS';
        if (!MODI.includes(explizit)) {
            fehler.push(`BETRIEBSMODUS="${explizit}" ist ungültig. Erlaubt: ${MODI.join(', ')}.`);
        }
        modus = MODI.includes(explizit) ? explizit : 'server';
    } else {
        quelle = 'legacy';
        if (env.SYNC_ROLLE === 'client') modus = 'client';
        else if (env.IS_OFFLINE === 'true') modus = 'server';
        else modus = 'cloud';
    }
    const streng = quelle === 'BETRIEBSMODUS';
    // Widersprüche melden: bei explizitem Modus ein Fehler, bei den Altvariablen nur eine Warnung.
    const widerspruch = (text) => (streng ? fehler : warnungen).push(text);

    const istCloud = modus === 'cloud';
    const istServer = modus === 'server';
    const istClient = modus === 'client';

    // --- Sync-Rolle (Dokument-DB) ---
    let syncRolle;
    if (streng) {
        syncRolle = istServer ? 'server' : istClient ? 'client' : null;
        const alt = env.SYNC_ROLLE === 'server' || env.SYNC_ROLLE === 'client' ? env.SYNC_ROLLE : null;
        if (alt && alt !== syncRolle) {
            widerspruch(`SYNC_ROLLE=${alt} widerspricht BETRIEBSMODUS=${modus}. SYNC_ROLLE weglassen — der Modus legt die Rolle fest.`);
        }
    } else {
        // Altverhalten: die Rolle kommt allein aus SYNC_ROLLE (IS_OFFLINE ohne SYNC_ROLLE = Hallenbetrieb ohne Sync).
        syncRolle = env.SYNC_ROLLE === 'server' || env.SYNC_ROLLE === 'client' ? env.SYNC_ROLLE : null;
        if (syncRolle === 'server' && istCloud) {
            warnungen.push('SYNC_ROLLE=server ohne IS_OFFLINE=true: wird als Cloud-Betrieb mit Dokument-DB behandelt. Für einen Hallen-Server BETRIEBSMODUS=server setzen.');
        }
    }

    // --- Datenbank ---
    // Immer PostgreSQL (SQLite wurde entfernt). Ein gesetztes DB_CLIENT=sqlite ist ein Konfigurationsfehler, damit
    // eine alte .env nicht stillschweigend gegen eine andere Datenbank läuft.
    let dbTyp = null;
    if (env.DB_CLIENT === 'sqlite') {
        fehler.push('SQLite wird nicht mehr unterstützt. DB_CLIENT=sqlite aus der .env entfernen (Modus server: eingebettetes oder vorhandenes PostgreSQL; ' +
            'ein bestehendes Turnier lässt sich per Turnier-Export/-Import übernehmen).');
    } else if (env.DB_CLIENT && env.DB_CLIENT !== 'pg') {
        fehler.push(`DB_CLIENT="${env.DB_CLIENT}" ist ungültig. Es gibt nur noch PostgreSQL (DB_CLIENT=pg oder weglassen).`);
    }
    if (istCloud || istServer) dbTyp = 'pg';
    // knexfile.cjs kennt die Umgebungen "online" (PostgreSQL) und "online-migration".
    const knexUmgebung = dbTyp === 'pg' ? 'online' : null;
    // Eingebettetes PostgreSQL nur im ausdrücklich gesetzten Modus server: bei den Altvariablen galt ohne DB_HOST
    // immer 127.0.0.1:5432, dort läuft evtl. eine bereits installierte Datenbank — das bleibt unangetastet.
    const externeDb = ['DB_HOST', 'DB_URL', 'DATABASE_URL'].some(name => String(env[name] || '').trim());
    const dbEingebettet = streng && istServer && !externeDb;
    if (!streng && istServer && !externeDb) {
        fehler.push('Der Hallen-Server braucht PostgreSQL: mit DB_HOST/DB_USER/DB_PASSWORD/DB_NAME eine vorhandene Datenbank angeben ' +
            'oder BETRIEBSMODUS=server setzen (dann startet der Server sein eigenes, eingebettetes PostgreSQL).');
    }

    // --- Erreichbarkeit ---
    // Bindeadresse: ohne LISTEN_HOST auf allen Schnittstellen. Das Client-Gerät (desktop/main.js) setzt
    // LISTEN_HOST=127.0.0.1, damit es nicht im Hallen-WLAN erreichbar ist und keine Firewall-Abfrage auslöst.
    const listenHost = env.LISTEN_HOST || undefined;
    // Ankündigung als <MDNS_NAME>.local und Port-80-Weiterleitung braucht nur der Server (Client-Geräte finden ihn darüber).
    const mdns = syncRolle === 'server' && env.MDNS_AKTIV !== 'false';
    const port80 = syncRolle === 'server' && env.PORT80_WEITERLEITUNG !== 'false';

    // --- Cluster ---
    const clusterGesetzt = CLUSTER_KNOTEN.includes(env.CLUSTER_KNOTEN);
    if (env.CLUSTER_KNOTEN && !clusterGesetzt) {
        fehler.push(`CLUSTER_KNOTEN="${env.CLUSTER_KNOTEN}" ist ungültig. Erlaubt: ${CLUSTER_KNOTEN.join(', ')}.`);
    }
    const cluster = clusterGesetzt && istServer;
    if (clusterGesetzt && !istServer) {
        widerspruch(`CLUSTER_KNOTEN=${env.CLUSTER_KNOTEN} gilt nur im Modus server (aktuell: ${modus}).`);
    }
    if (cluster) {
        if (dbEingebettet) widerspruch('Der Cluster braucht je Server eine eigene PostgreSQL-Instanz mit Replikation: DB_HOST setzen (das eingebettete PostgreSQL ist nur für einen einzelnen Server).');
        if (listenHost === '127.0.0.1' || listenHost === 'localhost') widerspruch('Im Cluster müssen sich die beiden Server gegenseitig erreichen: LISTEN_HOST darf nicht auf localhost stehen.');
    }

    return {
        modus,
        quelle,
        istCloud,
        istServer,
        istClient,
        // Cloud: mehrere Vereine mit Login und Vereinsrechten. Server: ein Veranstalter, kein Login
        // (Mock-Benutzer). Client: beantwortet seine Anfragen aus der lokalen Dokument-DB.
        mehrbenutzer: istCloud,
        einzelbenutzer: !istCloud,
        syncRolle,
        dbTyp,
        knexUmgebung,
        dbEingebettet,
        listenHost,
        mdns,
        port80,
        cluster,
        fehler,
        warnungen
    };
}

// Kurzformen für die Stellen, die zur LAUFZEIT prüfen (Controller/Middleware). Sie lesen die Umgebung
// bei jedem Aufruf neu — einzelne Tests schalten process.env zur Laufzeit um.
function istEinzelbenutzerBetrieb(env = process.env) {
    return liesBetriebsmodus(env).einzelbenutzer;
}

module.exports = { MODI, liesBetriebsmodus, istEinzelbenutzerBetrieb };
