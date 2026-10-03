require('dotenv').config({ quiet: true });
const path = require('path');
const { baueVerbindung, poolGroesse } = require('./src/config/dbVerbindung.cjs');

function onlineKonfig(migration) {
  return {
    client: 'pg',
    connection: baueVerbindung(process.env, { migration }),
    pool: { min: 2, max: poolGroesse() },
    migrations: { directory: './migrations' },
    seeds: { directory: './seeds' }
  };
}

module.exports = {
  // Offline-Konfiguration (Miteingebautes SQLite)
  offline: {
    client: 'sqlite3',
    connection: {
      filename: path.resolve(__dirname, process.env.DB_SQLITE_PATH || './data/turnier.sqlite')
    },
    useNullAsDefault: true, // Erforderlich für SQLite
    pool: {
      afterCreate: (conn, cb) => {
        // Erzwingt Foreign Key Constraints in SQLite
        conn.run('PRAGMA foreign_keys = ON;', cb);
      }
    },
    migrations: {
      directory: './migrations'
    },
    seeds: {
      directory: './seeds'
    }
  },

  // Online-Konfiguration (PostgreSQL: Cloud/Supabase, Linux-Server, lokale Entwicklung) — Verbindung siehe
  // src/config/dbVerbindung.cjs (DB_URL oder Einzelvariablen, DB_SSL)
  online: onlineKonfig(false),

  // Wie "online", aber mit DB_URL_MIGRATION (Direct-/Session-Verbindung) für Migrationen, z.B.
  // npx knex migrate:latest --knexfile knexfile.cjs --env online-migration
  'online-migration': onlineKonfig(true)
};
