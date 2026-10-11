import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Prüft die Konfigurationserzeugung des Cluster-Installationsskripts (--nur-konfig: ohne Root, ohne Installation).
const SKRIPT = path.resolve('deploy/linux/install-cluster.sh');
const hatBash = spawnSync('bash', ['--version']).status === 0 && process.platform !== 'win32';

function render(knoten, extra = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hajime-cluster-'));
    const geheimnisse = path.join(dir, 'g.env');
    fs.writeFileSync(geheimnisse, ['DB_PASSWORD=dbpw', 'REPL_PASSWORD=replpw', 'SYNC_SECRET=syncsecret', 'JWT_SECRET=jwt',
        'STEUERUNG_PASSWORD=steuer', 'SUPER_ADMIN_INITIAL_PASSWORD=admin', 'VRRP_AUTH=abcd1234'].join('\n') + '\n');
    const eigene = knoten === 'server1' ? '10.0.0.11' : '10.0.0.12';
    const partner = knoten === 'server1' ? '10.0.0.12' : '10.0.0.11';
    const args = ['--nur-konfig', path.join(dir, 'aus'), '--knoten', knoten, '--eigene-ip', eigene, '--partner-ip', partner,
        '--vip', '10.0.0.10', '--geheimnisse', geheimnisse];
    for (const [k, v] of Object.entries(extra)) { const i = args.indexOf(k); if (i >= 0) args[i + 1] = v; else args.push(k, v); }
    const r = spawnSync('bash', [SKRIPT, ...args], { encoding: 'utf8' });
    const lies = (n) => fs.readFileSync(path.join(dir, 'aus', n), 'utf8');
    return { r, lies };
}

test('server1 wird Master-Kandidat mit höherer VRRP-Priorität', { skip: !hatBash }, () => {
    const { r, lies } = render('server1');
    assert.equal(r.status, 0, r.stderr);
    assert.match(lies('env'), /^CLUSTER_KNOTEN=server1$/m);
    assert.match(lies('env'), /^CLUSTER_PARTNER_URL=http:\/\/10\.0\.0\.12:3000$/m);
    assert.match(lies('env'), /^BETRIEBSMODUS=server$/m);
    assert.match(lies('env'), /^DB_HOST=127\.0\.0\.1$/m);
    assert.match(lies('env'), /^SYNC_SECRET=syncsecret$/m);
    assert.match(lies('keepalived.conf'), /priority 150/);
    assert.match(lies('keepalived.conf'), /unicast_src_ip 10\.0\.0\.11/);
    assert.match(lies('keepalived.conf'), /10\.0\.0\.10\/24/);
    assert.match(lies('keepalived.conf'), /auth_pass abcd1234/);
    assert.match(lies('cluster.env'), /^PARTNER_PG_HOST=10\.0\.0\.12$/m);
});

test('server2 bekommt die niedrigere Priorität und zeigt auf server1', { skip: !hatBash }, () => {
    const { r, lies } = render('server2');
    assert.equal(r.status, 0, r.stderr);
    assert.match(lies('env'), /^CLUSTER_KNOTEN=server2$/m);
    assert.match(lies('env'), /^CLUSTER_PARTNER_URL=http:\/\/10\.0\.0\.11:3000$/m);
    assert.match(lies('keepalived.conf'), /priority 100/);
    assert.match(lies('keepalived.conf'), /unicast_src_ip 10\.0\.0\.12/);
});

test('PostgreSQL-Zugriff und VRRP-Freigabe sind auf die beiden Server beschränkt', { skip: !hatBash }, () => {
    const { lies } = render('server1');
    const hba = lies('pg_hba.conf.ausschnitt');
    assert.match(hba, /replication\s+replikator\s+10\.0\.0\.11\/32/);
    assert.match(hba, /replication\s+replikator\s+10\.0\.0\.12\/32/);
    assert.match(hba, />>> hajime-cluster/);
    assert.match(lies('ufw-vrrp.rules'), /-p 112 -s 10\.0\.0\.12 -j ACCEPT/);
});

test('Zeuge wird in die Konfiguration übernommen', { skip: !hatBash }, () => {
    const { lies } = render('server1', { '--zeuge': '10.0.0.1' });
    assert.match(lies('env'), /^CLUSTER_ZEUGE=10\.0\.0\.1$/m);
});

test('ungültige Angaben werden abgelehnt', { skip: !hatBash }, () => {
    assert.notEqual(render('server1', { '--vip': '10.0.0.11' }).r.status, 0); // VIP = Server-IP
    assert.notEqual(render('server1', { '--eigene-ip': 'abc' }).r.status, 0);
    assert.notEqual(render('server3').r.status, 0);
});

// Kopplungscode wie ihn server1 ausgibt: "HJ1:" + Base64 (+ / = als _ . -) von SCHLUESSEL=WERT-Zeilen.
function kopplungscode(zeilen) {
    return 'HJ1:' + Buffer.from(zeilen.join('\n') + '\n').toString('base64').replace(/\+/g, '_').replace(/\//g, '.').replace(/=/g, '-');
}
const CODE_ZEILEN = ['SERVER1_IP=10.0.0.11', 'VIP=10.0.0.10', 'ZEUGE=http://10.0.0.1/x?a=b', 'VRRP_ID=77',
    'DB_PASSWORD=dbpw', 'REPL_PASSWORD=replpw', 'SYNC_SECRET=syncsecret', 'JWT_SECRET=jwt',
    'STEUERUNG_PASSWORD=steuer', 'SUPER_ADMIN_INITIAL_PASSWORD=admin', 'VRRP_AUTH=abcd1234'];

function mitCode(code, extra = []) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hajime-kopplung-'));
    const r = spawnSync('bash', [SKRIPT, '--nur-konfig', path.join(dir, 'aus'), '--eigene-ip', '10.0.0.12', '--kopplungscode', code, ...extra],
        { encoding: 'utf8' });
    return { r, lies: (n) => fs.readFileSync(path.join(dir, 'aus', n), 'utf8') };
}

test('Kopplungscode liefert server2 alle Angaben: Knoten, server1, VIP, Zeuge, VRRP-ID und Geheimnisse', { skip: !hatBash }, () => {
    const { r, lies } = mitCode(kopplungscode(CODE_ZEILEN));
    assert.equal(r.status, 0, r.stderr);
    assert.match(lies('env'), /^CLUSTER_KNOTEN=server2$/m);
    assert.match(lies('env'), /^CLUSTER_PARTNER_URL=http:\/\/10\.0\.0\.11:3000$/m);
    assert.match(lies('env'), /^CLUSTER_VIP=10\.0\.0\.10$/m);
    assert.match(lies('env'), /^CLUSTER_ZEUGE=http:\/\/10\.0\.0\.1\/x\?a=b$/m);
    assert.match(lies('env'), /^SYNC_SECRET=syncsecret$/m);
    assert.match(lies('keepalived.conf'), /virtual_router_id 77/);
    assert.match(lies('keepalived.conf'), /priority 100/);
    assert.match(lies('keepalived.conf'), /auth_pass abcd1234/);
});

test('Kopplungscode: beschädigt, unvollständig oder für server1 wird abgelehnt', { skip: !hatBash }, () => {
    assert.notEqual(mitCode('kein-code').r.status, 0);
    assert.notEqual(mitCode('HJ1:abc').r.status, 0);
    assert.notEqual(mitCode(kopplungscode(CODE_ZEILEN.filter((z) => !z.startsWith('JWT_SECRET')))).r.status, 0);
    assert.notEqual(mitCode(kopplungscode(CODE_ZEILEN), ['--knoten', 'server1']).r.status, 0);
});

test('server1 braucht --partner-ip und --vip, die eigene IP ist im Nur-Konfig-Modus Pflicht', { skip: !hatBash }, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hajime-cluster-'));
    const g = path.join(dir, 'g.env');
    fs.writeFileSync(g, ['DB_PASSWORD=a', 'REPL_PASSWORD=b', 'SYNC_SECRET=c', 'JWT_SECRET=d', 'STEUERUNG_PASSWORD=e',
        'SUPER_ADMIN_INITIAL_PASSWORD=f', 'VRRP_AUTH=g'].join('\n') + '\n');
    const lauf = (...a) => spawnSync('bash', [SKRIPT, '--nur-konfig', path.join(dir, 'aus'), '--geheimnisse', g, ...a], { encoding: 'utf8' });
    assert.notEqual(lauf('--eigene-ip', '10.0.0.11', '--vip', '10.0.0.10').status, 0);           // Partner fehlt
    assert.notEqual(lauf('--eigene-ip', '10.0.0.11', '--partner-ip', '10.0.0.12').status, 0);    // VIP fehlt
    assert.equal(lauf('--eigene-ip', '10.0.0.11', '--partner-ip', '10.0.0.12', '--vip', '10.0.0.10').status, 0); // --knoten entfällt (server1)
});
