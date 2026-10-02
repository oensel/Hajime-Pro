import test from 'node:test';
import assert from 'node:assert/strict';
import betriebsmodus from '../../src/config/betriebsmodus.cjs';

const { liesBetriebsmodus, istEinzelbenutzerBetrieb } = betriebsmodus;

// --- Altvariablen (ohne BETRIEBSMODUS): bisheriges Verhalten bleibt erhalten ---

test('legacy: ohne Variablen = cloud mit PostgreSQL und Vereinsrechten', () => {
    const m = liesBetriebsmodus({});
    assert.equal(m.modus, 'cloud');
    assert.equal(m.quelle, 'legacy');
    assert.equal(m.mehrbenutzer, true);
    assert.equal(m.einzelbenutzer, false);
    assert.equal(m.dbTyp, 'pg');
    assert.equal(m.knexUmgebung, 'online');
    assert.equal(m.syncRolle, null);
    assert.deepEqual(m.fehler, []);
});

test('legacy: IS_OFFLINE=true = server mit SQLite, DB_CLIENT=pg = PostgreSQL', () => {
    const sqlite = liesBetriebsmodus({ IS_OFFLINE: 'true' });
    assert.equal(sqlite.modus, 'server');
    assert.equal(sqlite.dbTyp, 'sqlite');
    assert.equal(sqlite.knexUmgebung, 'offline');
    assert.equal(sqlite.einzelbenutzer, true);
    const pg = liesBetriebsmodus({ IS_OFFLINE: 'true', DB_CLIENT: 'pg' });
    assert.equal(pg.dbTyp, 'pg');
    assert.equal(pg.knexUmgebung, 'online');
});

test('legacy: die Sync-Rolle kommt allein aus SYNC_ROLLE (Hallenbetrieb ohne Sync bleibt möglich)', () => {
    assert.equal(liesBetriebsmodus({ IS_OFFLINE: 'true' }).syncRolle, null);
    assert.equal(liesBetriebsmodus({ IS_OFFLINE: 'true', SYNC_ROLLE: 'server' }).syncRolle, 'server');
    assert.equal(liesBetriebsmodus({ SYNC_ROLLE: 'Server' }).syncRolle, null);
});

test('legacy: SYNC_ROLLE=client = client, ohne Datenbank und ohne mDNS-Ankündigung', () => {
    const m = liesBetriebsmodus({ SYNC_ROLLE: 'client', IS_OFFLINE: 'true' });
    assert.equal(m.modus, 'client');
    assert.equal(m.syncRolle, 'client');
    assert.equal(m.dbTyp, null);
    assert.equal(m.knexUmgebung, null);
    assert.equal(m.mdns, false);
});

test('legacy: SYNC_ROLLE=server ohne IS_OFFLINE bleibt lauffähig, warnt aber', () => {
    const m = liesBetriebsmodus({ SYNC_ROLLE: 'server' });
    assert.equal(m.modus, 'cloud');
    assert.equal(m.syncRolle, 'server');
    assert.deepEqual(m.fehler, []);
    assert.equal(m.warnungen.length, 1);
});

test('legacy: Cluster-Widersprüche sind nur Warnungen, keine Abbrüche', () => {
    const m = liesBetriebsmodus({ IS_OFFLINE: 'true', SYNC_ROLLE: 'server', CLUSTER_KNOTEN: 'server1' });
    assert.deepEqual(m.fehler, []);
    assert.ok(m.warnungen.some(w => /PostgreSQL/.test(w)));
});

// --- Expliziter BETRIEBSMODUS ---

test('cloud: PostgreSQL, Vereinsrechte, keine Dokument-DB', () => {
    const m = liesBetriebsmodus({ BETRIEBSMODUS: 'cloud' });
    assert.equal(m.quelle, 'BETRIEBSMODUS');
    assert.equal(m.istCloud, true);
    assert.equal(m.mehrbenutzer, true);
    assert.equal(m.dbTyp, 'pg');
    assert.equal(m.syncRolle, null);
    assert.equal(m.mdns, false);
    assert.deepEqual(m.fehler, []);
});

test('server: PostgreSQL und Dokument-DB, auf allen Schnittstellen (mDNS, Port 80)', () => {
    const m = liesBetriebsmodus({ BETRIEBSMODUS: 'server' });
    assert.equal(m.istServer, true);
    assert.equal(m.einzelbenutzer, true);
    assert.equal(m.dbTyp, 'pg');
    assert.equal(m.knexUmgebung, 'online');
    assert.equal(m.syncRolle, 'server');
    assert.equal(m.listenHost, undefined);
    assert.equal(m.mdns, true);
    assert.equal(m.port80, true);
    assert.deepEqual(m.fehler, []);
});

test('server: LISTEN_HOST beschränkt die Bindeadresse (z.B. nur localhost), mehr gibt es nicht einzustellen', () => {
    const lokal = liesBetriebsmodus({ BETRIEBSMODUS: 'server', LISTEN_HOST: '127.0.0.1' });
    assert.equal(lokal.listenHost, '127.0.0.1');
    assert.deepEqual(lokal.fehler, []);
    assert.equal(liesBetriebsmodus({ BETRIEBSMODUS: 'server', LISTEN_HOST: '192.168.1.5' }).listenHost, '192.168.1.5');
    assert.equal(liesBetriebsmodus({ BETRIEBSMODUS: 'server' }).listenHost, undefined);
});

test('mDNS und Port 80 lassen sich einzeln abschalten', () => {
    const m = liesBetriebsmodus({ BETRIEBSMODUS: 'server', MDNS_AKTIV: 'false', PORT80_WEITERLEITUNG: 'false' });
    assert.equal(m.mdns, false);
    assert.equal(m.port80, false);
});

test('server ohne DB_HOST startet sein eigenes PostgreSQL, mit DB_HOST nutzt er ein vorhandenes', () => {
    assert.equal(liesBetriebsmodus({ BETRIEBSMODUS: 'server' }).dbEingebettet, true);
    assert.equal(liesBetriebsmodus({ BETRIEBSMODUS: 'server', DB_HOST: '' }).dbEingebettet, true);
    assert.equal(liesBetriebsmodus({ BETRIEBSMODUS: 'server', DB_HOST: '127.0.0.1' }).dbEingebettet, false);
    assert.equal(liesBetriebsmodus({ BETRIEBSMODUS: 'server', DB_HOST: 'db.intern' }).dbEingebettet, false);
    // nicht bei SQLite, nicht in cloud/client
    assert.equal(liesBetriebsmodus({ BETRIEBSMODUS: 'server', DB_CLIENT: 'sqlite' }).dbEingebettet, false);
    assert.equal(liesBetriebsmodus({ BETRIEBSMODUS: 'cloud' }).dbEingebettet, false);
    assert.equal(liesBetriebsmodus({ BETRIEBSMODUS: 'client' }).dbEingebettet, false);
});

test('legacy: ohne BETRIEBSMODUS wird nie ein eingebettetes PostgreSQL gestartet (DB_HOST-Standard 127.0.0.1 bleibt)', () => {
    assert.equal(liesBetriebsmodus({ IS_OFFLINE: 'true', DB_CLIENT: 'pg' }).dbEingebettet, false);
    assert.equal(liesBetriebsmodus({ IS_OFFLINE: 'true' }).dbEingebettet, false);
});

test('Cluster mit eingebettetem PostgreSQL ist ein Fehler (DB_HOST fehlt)', () => {
    assert.ok(liesBetriebsmodus({ BETRIEBSMODUS: 'server', CLUSTER_KNOTEN: 'server1' }).fehler.some(f => /DB_HOST/.test(f)));
    assert.deepEqual(liesBetriebsmodus({ BETRIEBSMODUS: 'server', DB_HOST: '127.0.0.1', CLUSTER_KNOTEN: 'server1' }).fehler, []);
});

test('server mit DB_CLIENT=sqlite bleibt als Altpfad möglich', () => {
    const m = liesBetriebsmodus({ BETRIEBSMODUS: 'server', DB_CLIENT: 'sqlite' });
    assert.equal(m.dbTyp, 'sqlite');
    assert.equal(m.knexUmgebung, 'offline');
    assert.deepEqual(m.fehler, []);
});

test('client: lokale Dokument-DB, keine relationale Datenbank, nur lokal', () => {
    const m = liesBetriebsmodus({ BETRIEBSMODUS: 'client' });
    assert.equal(m.istClient, true);
    assert.equal(m.syncRolle, 'client');
    assert.equal(m.dbTyp, null);
    assert.deepEqual(m.fehler, []);
});

test('Cluster: nur im Modus server, mit PostgreSQL, nicht nur auf localhost gebunden', () => {
    const gut = liesBetriebsmodus({ BETRIEBSMODUS: 'server', DB_HOST: '127.0.0.1', CLUSTER_KNOTEN: 'server2' });
    assert.equal(gut.cluster, true);
    assert.deepEqual(gut.fehler, []);
    assert.ok(liesBetriebsmodus({ BETRIEBSMODUS: 'server', DB_CLIENT: 'sqlite', CLUSTER_KNOTEN: 'server1' }).fehler.some(f => /PostgreSQL/.test(f)));
    assert.ok(liesBetriebsmodus({ BETRIEBSMODUS: 'server', LISTEN_HOST: '127.0.0.1', CLUSTER_KNOTEN: 'server1' }).fehler.some(f => /LISTEN_HOST/.test(f)));
    assert.ok(liesBetriebsmodus({ BETRIEBSMODUS: 'cloud', CLUSTER_KNOTEN: 'server1' }).fehler.some(f => /nur im Modus server/.test(f)));
});

// --- Fehlerfälle ---

test('unbekannter BETRIEBSMODUS und ungültige Werte werden gemeldet', () => {
    assert.ok(liesBetriebsmodus({ BETRIEBSMODUS: 'halle' }).fehler.some(f => /ungültig/.test(f)));
    assert.ok(liesBetriebsmodus({ BETRIEBSMODUS: 'server', DB_CLIENT: 'mysql' }).fehler.some(f => /DB_CLIENT/.test(f)));
    assert.ok(liesBetriebsmodus({ BETRIEBSMODUS: 'server', CLUSTER_KNOTEN: 'server3' }).fehler.some(f => /CLUSTER_KNOTEN/.test(f)));
});

test('expliziter Modus und widersprüchliche Altvariablen sind ein Fehler', () => {
    assert.ok(liesBetriebsmodus({ BETRIEBSMODUS: 'cloud', SYNC_ROLLE: 'server' }).fehler.some(f => /SYNC_ROLLE/.test(f)));
    assert.ok(liesBetriebsmodus({ BETRIEBSMODUS: 'client', SYNC_ROLLE: 'server' }).fehler.some(f => /SYNC_ROLLE/.test(f)));
    assert.ok(liesBetriebsmodus({ BETRIEBSMODUS: 'cloud', DB_CLIENT: 'sqlite' }).fehler.some(f => /sqlite/.test(f)));
    // Übereinstimmende Altvariablen stören nicht
    assert.deepEqual(liesBetriebsmodus({ BETRIEBSMODUS: 'server', SYNC_ROLLE: 'server', IS_OFFLINE: 'true' }).fehler, []);
});

test('istEinzelbenutzerBetrieb liest die Umgebung bei jedem Aufruf neu', () => {
    assert.equal(istEinzelbenutzerBetrieb({ IS_OFFLINE: 'true' }), true);
    assert.equal(istEinzelbenutzerBetrieb({ IS_OFFLINE: 'false' }), false);
    assert.equal(istEinzelbenutzerBetrieb({ BETRIEBSMODUS: 'server' }), true);
    assert.equal(istEinzelbenutzerBetrieb({ BETRIEBSMODUS: 'cloud' }), false);
    const vorher = process.env.IS_OFFLINE;
    const vorherModus = process.env.BETRIEBSMODUS;
    delete process.env.BETRIEBSMODUS;
    try {
        process.env.IS_OFFLINE = 'true';
        assert.equal(istEinzelbenutzerBetrieb(), true);
        process.env.IS_OFFLINE = 'false';
        assert.equal(istEinzelbenutzerBetrieb(), false);
    } finally {
        if (vorher === undefined) delete process.env.IS_OFFLINE; else process.env.IS_OFFLINE = vorher;
        if (vorherModus !== undefined) process.env.BETRIEBSMODUS = vorherModus;
    }
});
