// Legt die Rolle live_ro an: node scripts/live-rolle.mjs
// Liest die Verbindung des Hallen-Servers aus .env (DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME) und das Passwort der
// neuen Rolle aus LIVE_DB_PASSWORD. Muss mit einem Benutzer laufen, der Rollen anlegen darf (z. B. postgres):
// dafür DB_ADMIN_USER/DB_ADMIN_PASSWORD setzen. Am Master ausführen, der Standby ist schreibgeschützt.
import dotenv from 'dotenv';
import knexLib from 'knex';
import { legeLiveRolleAn } from '../src/live/rolle.js';

dotenv.config({ quiet: true });
const passwort = process.env.LIVE_DB_PASSWORD;
if (!passwort) {
    console.error('LIVE_DB_PASSWORD ist nicht gesetzt.');
    process.exit(1);
}
const datenbank = process.env.DB_NAME || 'hajime';
const knex = knexLib({
    client: 'pg',
    connection: {
        host: process.env.DB_HOST || '127.0.0.1',
        port: Number(process.env.DB_PORT || 5432),
        user: process.env.DB_ADMIN_USER || process.env.DB_USER,
        password: process.env.DB_ADMIN_PASSWORD || process.env.DB_PASSWORD,
        database: datenbank
    }
});
try {
    await legeLiveRolleAn(knex, { passwort, datenbank });
    console.log('Rolle live_ro angelegt/aktualisiert.');
} finally {
    await knex.destroy();
}
