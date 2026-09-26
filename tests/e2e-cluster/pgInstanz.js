// Lokale PostgreSQL-Instanzen für die Cluster-Suite. Die Binaries (initdb, pg_ctl, postgres)
// stammen aus dem Plattformpaket von embedded-postgres; pg_basebackup/pg_rewind fehlen dort —
// ein Standby wird deshalb über die Low-Level-Backup-API aufgebaut (pg_backup_start, Kopie des
// Datenverzeichnisses, pg_backup_stop + backup_label). Im echten Betrieb erledigt das
// deploy/linux/hajime-rueckstufen.sh mit pg_rewind bzw. pg_basebackup.
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import pg from 'pg';

const PLATTFORM = { win32: 'windows-x64', linux: process.arch === 'arm64' ? 'linux-arm64' : 'linux-x64', darwin: process.arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64' }[process.platform];
const binaries = await import(`@embedded-postgres/${PLATTFORM}`);

const KONFIG = [
    'wal_level = replica',
    'max_wal_senders = 5',
    'hot_standby = on',
    "listen_addresses = '127.0.0.1'",
    'wal_log_hints = on',
    'wal_keep_size = 256MB',
    // Standby: neuer Zeitstrahl nach der Beförderung des Partners wird automatisch verfolgt.
    "recovery_target_timeline = 'latest'",
    'fsync = off' // nur Test: schneller, Datenverlust bei Absturz des Rechners egal
].join('\n');

export function initialisiere(dir) {
    fs.rmSync(dir, { recursive: true, force: true });
    execFileSync(binaries.initdb, ['-D', dir, '-U', 'postgres', '-A', 'trust', '-E', 'UTF8', '--locale=C'], { stdio: 'ignore' });
    fs.appendFileSync(path.join(dir, 'pg_hba.conf'), '\nhost replication all 127.0.0.1/32 trust\n');
    fs.appendFileSync(path.join(dir, 'postgresql.conf'), `\n${KONFIG}\n`);
}

export function starte(dir, port) {
    execFileSync(binaries.pg_ctl, ['-D', dir, '-o', `-p ${port}`, '-l', `${dir}.log`, '-w', '-t', '60', 'start'], { stdio: 'ignore' });
}

export function laeuft(dir) {
    try {
        execFileSync(binaries.pg_ctl, ['-D', dir, 'status'], { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

export function stoppe(dir, modus = 'fast') {
    if (!fs.existsSync(dir)) return;
    try {
        execFileSync(binaries.pg_ctl, ['-D', dir, '-m', modus, '-w', '-t', '60', 'stop'], { stdio: 'ignore' });
    } catch { /* lief nicht */ }
}

export async function verbinde(port, database = 'postgres') {
    const client = new pg.Client({ host: '127.0.0.1', port, user: 'postgres', database });
    client.on('error', () => {});
    await client.connect();
    return client;
}

// Baut zielDir als Standby der laufenden Instanz quellePort/quelleDir auf (Ziel darf nicht laufen).
export async function baueStandby({ quellePort, quelleDir, zielDir, name }) {
    fs.rmSync(zielDir, { recursive: true, force: true });
    const c = await verbinde(quellePort);
    try {
        await c.query(`select pg_backup_start($1, true)`, [`standby-${name}`]);
        fs.cpSync(quelleDir, zielDir, {
            recursive: true,
            filter: (quelle) => {
                const rel = path.relative(quelleDir, quelle).replace(/\\/g, '/');
                return !(/^postmaster\.(pid|opts)$/.test(rel) || /^pg_wal\/./.test(rel)
                    || /^(standby\.signal|backup_label|tablespace_map)$/.test(rel));
            }
        });
        fs.mkdirSync(path.join(zielDir, 'pg_wal', 'archive_status'), { recursive: true });
        const { rows } = await c.query('select labelfile from pg_backup_stop(true)');
        fs.writeFileSync(path.join(zielDir, 'backup_label'), rows[0].labelfile);
    } finally {
        await c.end();
    }
    fs.writeFileSync(path.join(zielDir, 'standby.signal'), '');
    // postgresql.auto.conf der Quelle kann synchronous_standby_names enthalten -> ersetzen.
    fs.writeFileSync(path.join(zielDir, 'postgresql.auto.conf'),
        `primary_conninfo = 'host=127.0.0.1 port=${quellePort} user=postgres application_name=${name}'\n`);
}
