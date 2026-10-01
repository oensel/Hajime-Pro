// Lokales PostgreSQL für die Entwicklung, ohne Installation: nutzt die Binaries aus der
// devDependency embedded-postgres (wie tests/e2e-cluster/pgInstanz.js). Datenverzeichnis
// data/pg-lokal, nur 127.0.0.1, trust-Authentifizierung (DB_PASSWORD wird ignoriert).
//
//   node scripts/lokale-pg.mjs start    legt die Instanz beim ersten Mal an, startet sie und
//                                       erzeugt die Datenbank DB_NAME (Standard: hajime)
//   node scripts/lokale-pg.mjs stopp
//   node scripts/lokale-pg.mjs status
//
// Port und Datenbankname kommen aus der .env (DB_PORT, DB_NAME), damit App und Instanz
// zusammenpassen. Migrationen danach: npx knex migrate:latest --knexfile knexfile.cjs --env online
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import pg from 'pg';

dotenv.config({ quiet: true });

const PLATTFORM = { win32: 'windows-x64', linux: process.arch === 'arm64' ? 'linux-arm64' : 'linux-x64', darwin: process.arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64' }[process.platform];
const binaries = await import(`@embedded-postgres/${PLATTFORM}`);

const DIR = path.resolve('data/pg-lokal');
const PORT = Number(process.env.DB_PORT || 5433);
const DB_NAME = process.env.DB_NAME || 'hajime';

function laeuft() {
    try {
        execFileSync(binaries.pg_ctl, ['-D', DIR, 'status'], { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

async function start() {
    if (!fs.existsSync(path.join(DIR, 'PG_VERSION'))) {
        console.log(`Lege PostgreSQL-Instanz in ${DIR} an …`);
        fs.mkdirSync(path.dirname(DIR), { recursive: true });
        execFileSync(binaries.initdb, ['-D', DIR, '-U', 'postgres', '-A', 'trust', '-E', 'UTF8', '--locale=C'], { stdio: 'ignore' });
        fs.appendFileSync(path.join(DIR, 'postgresql.conf'), "\nlisten_addresses = '127.0.0.1'\n");
    }
    if (laeuft()) {
        console.log(`PostgreSQL läuft bereits (Port ${PORT}).`);
    } else {
        execFileSync(binaries.pg_ctl, ['-D', DIR, '-o', `-p ${PORT}`, '-l', `${DIR}.log`, '-w', '-t', '60', 'start'], { stdio: 'ignore' });
        console.log(`PostgreSQL gestartet (127.0.0.1:${PORT}, Log: ${DIR}.log).`);
    }

    const client = new pg.Client({ host: '127.0.0.1', port: PORT, user: 'postgres', database: 'postgres' });
    await client.connect();
    try {
        const { rowCount } = await client.query('select 1 from pg_database where datname = $1', [DB_NAME]);
        if (rowCount === 0) {
            await client.query(`create database "${DB_NAME.replace(/"/g, '')}"`);
            console.log(`Datenbank "${DB_NAME}" angelegt — jetzt migrieren: npx knex migrate:latest --knexfile knexfile.cjs --env online`);
        }
    } finally {
        await client.end();
    }
}

function stopp() {
    if (!laeuft()) {
        console.log('PostgreSQL läuft nicht.');
        return;
    }
    execFileSync(binaries.pg_ctl, ['-D', DIR, '-m', 'fast', '-w', '-t', '60', 'stop'], { stdio: 'ignore' });
    console.log('PostgreSQL gestoppt.');
}

const befehl = process.argv[2];
if (befehl === 'start') await start();
else if (befehl === 'stopp') stopp();
else if (befehl === 'status') console.log(laeuft() ? `läuft (Port ${PORT})` : 'läuft nicht');
else {
    console.error('Aufruf: node scripts/lokale-pg.mjs start|stopp|status');
    process.exit(1);
}
