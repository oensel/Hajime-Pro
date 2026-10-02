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
