// Leitstand der Cluster-Suite (webServer in playwright.cluster.config.js). Ersetzt die Docker-
// Umgebung der Spec durch Prozesse auf localhost:
//  - zwei PostgreSQL-Instanzen (server1 Primary, server2 Standby), Schema per knex-Migration
//  - zwei Hallen-Server (node src/app.js mit CLUSTER_KNOTEN) und ein Client-Gerät
//  - keepalived-Simulation: fragt /api/cluster/gesund beider Server ab, vergibt die VIP an den
//    gesunden Server höherer Priorität, entzieht sie einem ungesunden/unerreichbaren Halter nach
//    AUSFALL_MS und ruft /befoerdern bzw. /zurueckstufen auf (nopreempt: ein gesunder Halter
//    behält die VIP)
//  - VIP: HTTP-Proxy auf VIP_PORT zum aktuellen Halter (der Client repliziert darüber)
//  - Zeuge: GET /zeuge/:knoten (200, außer der Knoten ist per Steuerung "getrennt")
// Steuerung für die Tests: GET /status, POST /knoten/:k/stoppen|starten, POST /zeuge/:k/trennen|verbinden.
import http from 'http';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import knexLib from 'knex';
import { PROJEKT, BASIS, KNOTEN, LEITSTAND_PORT, VIP_PORT, DB_NAME, serverEnv, clientEnv } from './test-env.js';
import * as pgi from './pgInstanz.js';

const TAKT_MS = 500;
const AUSFALL_MS = 2000;
const LOGS = path.join(BASIS, 'logs');

const zustand = {
    vip: null,
    getrennt: new Set(),
    prozesse: {},          // name -> ChildProcess
    ungesundSeit: {},      // name -> ms
    gesund: {},            // name -> letzte Antwort
    bereit: false,
    ereignisse: []
};

function log(text) {
    const zeile = `${new Date().toISOString().slice(11, 23)} ${text}`;
    zustand.ereignisse.unshift(zeile);
    zustand.ereignisse.splice(200);
    console.log(`[Leitstand] ${zeile}`);
}

// ---------- Prozesse ----------

function starteApp(name, env) {
    const aus = fs.openSync(path.join(LOGS, `${name}.log`), 'a');
    const kind = spawn(process.execPath, ['src/app.js'], { cwd: PROJEKT, env, stdio: ['ignore', aus, aus], windowsHide: true });
    zustand.prozesse[name] = kind;
    kind.on('exit', (code) => {
        if (zustand.prozesse[name] === kind) delete zustand.prozesse[name];
        log(`${name} beendet (Code ${code})`);
    });
    return kind;
}

async function warteHttp(url, ms = 30_000) {
    const ende = Date.now() + ms;
    while (Date.now() < ende) {
        try {
            const r = await fetch(url, { signal: AbortSignal.timeout(1000) });
            if (r.status < 500) return;
        } catch { /* noch nicht da */ }
        await new Promise(r => setTimeout(r, 200));
    }
    throw new Error(`${url} nicht erreichbar`);
}

async function stoppeApp(name) {
    const kind = zustand.prozesse[name];
    if (!kind) return;
    const beendet = new Promise(r => kind.once('exit', r));
    kind.kill();
    await Promise.race([beendet, new Promise(r => setTimeout(r, 5000))]);
}

async function stoppeKnoten(name) {
    if (zustand.vip === name) {
        zustand.vip = null;
        log(`VIP von ${name} entfernt (Knoten gestoppt)`);
    }
    await stoppeApp(name);
    pgi.stoppe(KNOTEN[name].pgDir, 'immediate');
    log(`${name} gestoppt (App + PostgreSQL)`);
}

async function starteKnoten(name) {
    const k = KNOTEN[name];
    if (!pgi.laeuft(k.pgDir)) pgi.starte(k.pgDir, k.pgPort);
    if (!zustand.prozesse[name]) starteApp(name, serverEnv(name));
    await warteHttp(`${k.url}/api/cluster/status`);
    log(`${name} gestartet`);
}

// ---------- Aufbau ----------

async function baueAuf() {
    // pg_ctl startet PostgreSQL losgelöst — Instanzen eines abgebrochenen Laufs erst beenden.
    for (const k of Object.values(KNOTEN)) pgi.stoppe(k.pgDir, 'immediate');
    fs.rmSync(BASIS, { recursive: true, force: true });
    fs.mkdirSync(LOGS, { recursive: true });
    const s1 = KNOTEN.server1;
    const s2 = KNOTEN.server2;
    pgi.initialisiere(s1.pgDir);
    pgi.starte(s1.pgDir, s1.pgPort);
    const c = await pgi.verbinde(s1.pgPort);
    await c.query(`create database ${DB_NAME}`);
    await c.end();
    const knex = knexLib({
        client: 'pg',
        connection: { host: '127.0.0.1', port: s1.pgPort, user: 'postgres', database: DB_NAME },
        migrations: { directory: path.join(PROJEKT, 'migrations') }
    });
    await knex.migrate.latest();
    await knex.destroy();
    await pgi.baueStandby({ quellePort: s1.pgPort, quelleDir: s1.pgDir, zielDir: s2.pgDir, name: 'server2' });
    pgi.starte(s2.pgDir, s2.pgPort);
    log('PostgreSQL: server1 Primary, server2 Standby');

    await starteKnoten('server1');
    await starteKnoten('server2');
    starteApp('client', clientEnv());
}

// ---------- keepalived-Simulation ----------

async function fragGesund(name) {
    if (!zustand.prozesse[name]) return { gesund: false, gruende: ['Prozess läuft nicht'] };
    try {
        const r = await fetch(`${KNOTEN[name].url}/api/cluster/gesund`, { signal: AbortSignal.timeout(1500) });
        return await r.json();
    } catch (err) {
        return { gesund: false, gruende: [`nicht erreichbar: ${err.message}`] };
    }
}

async function rufe(name, aktion) {
    try {
        const r = await fetch(`${KNOTEN[name].url}/api/cluster/${aktion}`, { method: 'POST', signal: AbortSignal.timeout(90_000) });
        const daten = await r.json().catch(() => ({}));
        return { ok: r.ok, daten };
    } catch (err) {
        return { ok: false, daten: { error: err.message } };
    }
}

async function takt() {
    const jetzt = Date.now();
    for (const name of Object.keys(KNOTEN)) {
        const g = await fragGesund(name);
        zustand.gesund[name] = g;
        if (g.gesund) delete zustand.ungesundSeit[name];
        else if (!zustand.ungesundSeit[name]) zustand.ungesundSeit[name] = jetzt;
    }
    const istGesund = (n) => zustand.gesund[n] && zustand.gesund[n].gesund;

    // Halter verliert die VIP, wenn er AUSFALL_MS lang ungesund/unerreichbar ist.
    if (zustand.vip && !istGesund(zustand.vip) && jetzt - zustand.ungesundSeit[zustand.vip] >= AUSFALL_MS) {
        const alt = zustand.vip;
        zustand.vip = null;
        log(`VIP: ${alt} ungesund (${(zustand.gesund[alt].gruende || []).join(', ')}) → zurueckstufen`);
        if (zustand.prozesse[alt]) await rufe(alt, 'zurueckstufen');
    }
    if (!zustand.vip) {
        const kandidaten = Object.values(KNOTEN).filter(k => istGesund(k.name)).sort((a, b) => b.prioritaet - a.prioritaet);
        for (const k of kandidaten) {
            const r = await rufe(k.name, 'befoerdern');
            if (r.ok) {
                zustand.vip = k.name;
                log(`VIP → ${k.name} (Epoche ${r.daten.epoche ?? '?'})`);
                break;
            }
            log(`befoerdern ${k.name} abgelehnt: ${r.daten.error || JSON.stringify(r.daten)}`);
        }
    }
}

function starteKeepalived() {
    let laeuft = false;
    setInterval(async () => {
        if (laeuft) return;
        laeuft = true;
        try { await takt(); } catch (err) { log(`Takt-Fehler: ${err.message}`); }
        laeuft = false;
    }, TAKT_MS);
}

// ---------- VIP-Proxy ----------

function starteVip() {
    http.createServer((req, res) => {
        const ziel = zustand.vip && KNOTEN[zustand.vip];
        if (!ziel) {
            res.writeHead(503, { 'content-type': 'application/json' });
            return res.end(JSON.stringify({ error: 'VIP derzeit keinem Server zugeordnet' }));
        }
        const weiter = http.request({ host: '127.0.0.1', port: ziel.appPort, method: req.method, path: req.url, headers: req.headers }, (antwort) => {
            res.writeHead(antwort.statusCode, antwort.headers);
            antwort.pipe(res);
        });
        weiter.on('error', () => {
            if (!res.headersSent) res.writeHead(502);
            res.end();
        });
        req.pipe(weiter);
    }).listen(VIP_PORT, '127.0.0.1');
}

// ---------- Steuerung ----------

function starteSteuerung() {
    http.createServer(async (req, res) => {
        const antworte = (status, daten) => {
            res.writeHead(status, { 'content-type': 'application/json' });
            res.end(JSON.stringify(daten));
        };
        try {
            const teile = req.url.split('?')[0].split('/').filter(Boolean);
            if (req.method === 'GET' && teile[0] === 'bereit') return antworte(zustand.bereit && zustand.vip ? 200 : 503, { bereit: zustand.bereit, vip: zustand.vip });
            if (req.method === 'GET' && teile[0] === 'zeuge') return antworte(zustand.getrennt.has(teile[1]) ? 503 : 200, { knoten: teile[1] });
            if (req.method === 'GET' && teile[0] === 'status') {
                return antworte(200, {
                    vip: zustand.vip,
                    laufend: Object.keys(zustand.prozesse),
                    getrennt: [...zustand.getrennt],
                    gesund: zustand.gesund,
                    ereignisse: zustand.ereignisse.slice(0, 50)
                });
            }
            if (req.method === 'POST' && teile[0] === 'knoten' && KNOTEN[teile[1]]) {
                if (teile[2] === 'stoppen') await stoppeKnoten(teile[1]);
                else if (teile[2] === 'starten') await starteKnoten(teile[1]);
                else return antworte(404, {});
                return antworte(200, { ok: true });
            }
            if (req.method === 'POST' && teile[0] === 'zeuge' && KNOTEN[teile[1]]) {
                if (teile[2] === 'trennen') zustand.getrennt.add(teile[1]);
                else zustand.getrennt.delete(teile[1]);
                log(`Zeuge ${teile[2]}: ${teile[1]}`);
                return antworte(200, { ok: true });
            }
            antworte(404, { error: 'unbekannt' });
        } catch (err) {
            antworte(500, { error: err.message });
        }
    }).listen(LEITSTAND_PORT, '127.0.0.1');
}

async function beende() {
    for (const name of Object.keys(zustand.prozesse)) await stoppeApp(name);
    for (const k of Object.values(KNOTEN)) pgi.stoppe(k.pgDir, 'immediate');
    process.exit(0);
}
process.on('SIGINT', beende);
process.on('SIGTERM', beende);

starteSteuerung();
starteVip();
await baueAuf();
starteKeepalived();
zustand.bereit = true;
log('Cluster aufgebaut');
