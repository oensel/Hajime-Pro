import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const lies = (p) => fs.readFileSync(p, 'utf8');

test('systemd-Unit startet den Live-Prozess ohne Netzwerk-Rechte', () => {
    const unit = lies('deploy/linux/systemd/hajime-live.service');
    assert.match(unit, /ExecStart=\/usr\/bin\/node src\/live\/main\.js/);
    assert.match(unit, /EnvironmentFile=\/opt\/hajime-pro\/live\.env/);
    assert.match(unit, /User=hajime-live/);
    assert.match(unit, /StateDirectory=hajime-live/);
    assert.match(unit, /NoNewPrivileges=true/);
    assert.doesNotMatch(unit, /CAP_NET_BIND_SERVICE/);
});

test('nftables: ausgehend nur Cloud-HTTPS, DNS und NTP; eingehend verworfen', () => {
    const regeln = lies('deploy/linux/live/nftables-live.conf');
    assert.match(regeln, /policy drop/);
    assert.match(regeln, /tcp dport 443/);
    assert.match(regeln, /udp dport 123/);
    assert.match(regeln, /udp dport 53/);
    assert.doesNotMatch(regeln, /tcp dport 22 accept/);
});

test('install-live.sh hat gültige Bash-Syntax', { skip: spawnSync('bash', ['--version']).status !== 0 }, () => {
    const r = spawnSync('bash', ['-n', 'deploy/linux/install-live.sh'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
});

test('Anleitung nennt Tethering, Weiterleitung aus und die Firewall', () => {
    const doku = lies('docs/live-uplink.md');
    for (const text of ['ip_forward', 'nftables', 'USB', 'live.env', 'LIVE_SCHLUESSEL']) {
        assert.match(doku, new RegExp(text));
    }
});

test('install-live.sh: Firewall übersteht den Neustart, DNS ist Pflicht, eigener Benutzer, .env gesperrt', () => {
    const skript = lies('deploy/linux/install-live.sh');
    assert.match(skript, /include "\/etc\/nftables\.d\/\*\.conf"/);
    assert.match(skript, /systemctl enable nftables/);
    assert.match(skript, /--dns-ip/);
    assert.doesNotMatch(skript, /DNS_IP="192\.168/);
    assert.match(skript, /useradd --system[^\n]*hajime-live/);
    assert.match(skript, /chmod 600 "\$BASIS\/\.env"/);
});

test('Live-Prozess liest die .env der App nicht (kein dotenv)', () => {
    assert.doesNotMatch(lies('src/live/main.js'), /imports+dotenv|dotenv.config/);
});

test('Anleitung nennt --dns-ip', () => {
    assert.match(lies('docs/live-uplink.md'), /--dns-ip/);
});
