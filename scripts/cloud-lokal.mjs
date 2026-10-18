// Cloud-Server (BETRIEBSMODUS=cloud) auf diesem Rechner: eigene lokale PostgreSQL (data/pg-cloud-lokal,
// 127.0.0.1:5440), Konfiguration in .env.cloud-lokal (git-ignoriert), App auf Port 3300.
//
//   node scripts/cloud-lokal.mjs einrichten   legt .env.cloud-lokal an (Geheimnisse zufällig, SMTP aus .env.cloud)
//   node scripts/cloud-lokal.mjs start        startet PostgreSQL, migriert und startet den Server (im Vordergrund)
//   node scripts/cloud-lokal.mjs stopp        stoppt die lokale PostgreSQL
//   node scripts/cloud-lokal.mjs status
//
// Die Adresse in PUBLIC_BASE_URL (Links in Mails) ist die LAN-Adresse dieses Rechners; mit
// `einrichten --url http://name:3300` lässt sie sich festlegen. Zugangsdaten stehen nur in der Datei.
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { spawn, spawnSync } from 'child_process';
import { pathToFileURL } from 'url';

const WURZEL = path.resolve(import.meta.dirname, '..');
const ENV_DATEI = path.join(WURZEL, '.env.cloud-lokal');
const PORT = 3300;
const DB_PORT = 5440;
const DB_NAME = 'hajime_cloud';
const PG_VERZEICHNIS = path.join(WURZEL, 'data', 'pg-cloud-lokal');

function leseEnv(datei) {
    const werte = {};
    if (!fs.existsSync(datei)) return werte;
    for (const zeile of fs.readFileSync(datei, 'utf8').split(/\r?\n/)) {
        const m = zeile.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/);
        if (!m) continue;
        let v = m[2].trim();
        if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) v = v.slice(1, -1);
        werte[m[1]] = v;
    }
    return werte;
}

function lanAdresse() {
    for (const eintraege of Object.values(os.networkInterfaces())) {
        for (const e of eintraege || []) {
            if (e.family === 'IPv4' && !e.internal && !e.address.startsWith('169.254.')) return e.address;
        }
    }
    return '127.0.0.1';
}

function einrichten(argumente) {
    if (fs.existsSync(ENV_DATEI)) {
        console.log(`${path.basename(ENV_DATEI)} existiert bereits – nichts geändert.`);
        return;
    }
    const urlIndex = argumente.indexOf('--url');
    const basisUrl = urlIndex >= 0 ? argumente[urlIndex + 1] : `http://${lanAdresse()}:${PORT}`;
    const cloud = leseEnv(path.join(WURZEL, '.env.cloud'));
    const zufall = (n) => crypto.randomBytes(n).toString('base64url');
    const zeilen = [
        '# Lokaler Cloud-Server auf diesem Rechner (scripts/cloud-lokal.mjs). Nicht einchecken.',
        'BETRIEBSMODUS=cloud',
        `PORT=${PORT}`,
        'DB_HOST=127.0.0.1',
        `DB_PORT=${DB_PORT}`,
        'DB_USER=postgres',
        'DB_PASSWORD=lokal',
        `DB_NAME=${DB_NAME}`,
        'DB_SSL=false',
        `PG_LOKAL_VERZEICHNIS=${PG_VERZEICHNIS}`,
        `JWT_SECRET=${zufall(48)}`,
        `PUBLIC_BASE_URL=${basisUrl}`,
        `SUPER_ADMIN_INITIAL_PASSWORD=${zufall(12)}`,
        '# Kein Turnierleitungs-Passwort im Cloud-Betrieb (Rechte laufen über die Anmeldung)',
        'STEUERUNG_PASSWORD=',
    ];
    for (const k of ['SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM']) {
        if (cloud[k] !== undefined) zeilen.push(`${k}='${cloud[k].replace(/'/g, '')}'`);
    }
    if (cloud.SMTP_HOST === undefined) console.warn('Hinweis: kein SMTP in .env.cloud gefunden – ohne Mailversand kommt niemand per Registrierung ins System.');
    fs.writeFileSync(ENV_DATEI, zeilen.join('\n') + '\n', { mode: 0o600 });
    console.log(`${path.basename(ENV_DATEI)} angelegt (Adresse: ${basisUrl}). Das Super-Admin-Passwort steht darin (SUPER_ADMIN_INITIAL_PASSWORD).`);
}

function kindUmgebung() {
    const env = { ...process.env, ...leseEnv(ENV_DATEI) };
    return env;
}

function fuehreAus(skript, argumente, env) {
    const r = spawnSync(process.execPath, [skript, ...argumente], { cwd: WURZEL, env, stdio: 'inherit' });
    if (r.status !== 0) throw new Error(`${path.basename(skript)} ${argumente.join(' ')} endete mit Code ${r.status}`);
}

// Überwachter Start: der Server startet nach einem Update (Exit-Code NEUSTART_EXITCODE aus src/utils/cloudUpdate.js) bzw. auf
// Anforderung von scripts/cloud-update.mjs (Datei data/neustart.anfordern) selbst neu. Ein vorgemerkter Austausch der
// Programmdateien (Windows) läuft dazwischen: PostgreSQL stoppen (sperrt node_modules), tauschen, alles neu starten.
const NEUSTART_EXITCODE = 75;
const NEUSTART_DATEI = path.join(WURZEL, 'data', 'neustart.anfordern');

async function start() {
    if (!fs.existsSync(ENV_DATEI)) einrichten([]);
    const env = { ...kindUmgebung(), HAJIME_UEBERWACHT: '1' };
    fs.rmSync(NEUSTART_DATEI, { force: true });
    let beenden = false;
    let app = null;
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { beenden = true; if (app) app.kill(signal); });
    while (!beenden) {
        const { fuehreVorgemerktenAustauschAus } = await import(pathToFileURL(path.join(WURZEL, 'src/utils/dienstUpdate.js')).href);
        if (fs.existsSync(path.join(WURZEL, '.update', 'austausch.json'))) {
            fuehreAus('scripts/lokale-pg.mjs', ['stopp'], env);
            fuehreVorgemerktenAustauschAus(WURZEL);
        }
        fuehreAus('scripts/lokale-pg.mjs', ['start'], env);
        fuehreAus('node_modules/knex/bin/cli.js', ['migrate:latest', '--knexfile', 'knexfile.cjs', '--env', 'online'], env);
        console.log(`Starte Cloud-Server auf Port ${PORT} (${env.PUBLIC_BASE_URL}) …`);
        app = spawn(process.execPath, ['src/app.js'], { cwd: WURZEL, env, stdio: 'inherit' });
        let angefordert = false;
        const wache = setInterval(() => {
            if (!fs.existsSync(NEUSTART_DATEI)) return;
            fs.rmSync(NEUSTART_DATEI, { force: true });
            angefordert = true;
            app.kill();
        }, 2000);
        const code = await new Promise((resolve) => app.on('exit', (c) => resolve(c)));
        clearInterval(wache);
        app = null;
        if (beenden || (code !== NEUSTART_EXITCODE && !angefordert)) process.exit(code ?? 0);
        console.log('Neustart …');
    }
}

const [befehl = 'start', ...rest] = process.argv.slice(2);
if (befehl === 'einrichten') einrichten(rest);
else if (befehl === 'start') await start();
else if (befehl === 'stopp') fuehreAus('scripts/lokale-pg.mjs', ['stopp'], kindUmgebung());
else if (befehl === 'status') fuehreAus('scripts/lokale-pg.mjs', ['status'], kindUmgebung());
else {
    console.error('Befehl unbekannt. Erlaubt: einrichten, start, stopp, status');
    process.exit(2);
}
