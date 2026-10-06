require('dotenv').config({ quiet: true });
const { baueVerbindung, poolGroesse } = require('./src/config/dbVerbindung.cjs');

function onlineKonfig(migration) {
  return {
    client: 'pg',
    connection: baueVerbindung(process.env, { migration }),
    pool: { min: 2, max: poolGroesse() },
    migrations: { directory: './migrations' },
  };
}

module.exports = {
  // Online-Konfiguration (PostgreSQL: Cloud/Supabase, Linux-Server, lokale Entwicklung) — Verbindung siehe
  // src/config/dbVerbindung.cjs (DB_URL oder Einzelvariablen, DB_SSL)
  online: onlineKonfig(false),

  // Wie "online", aber mit DB_URL_MIGRATION (Direct-/Session-Verbindung) für Migrationen, z.B.
  // npx knex migrate:latest --knexfile knexfile.cjs --env online-migration
  'online-migration': onlineKonfig(true)
};
