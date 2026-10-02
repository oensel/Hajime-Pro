require('dotenv').config({ quiet: true });
const path = require('path');

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

  // Online-Konfiguration (PostgreSQL für die Cloud)
  online: {
    client: 'pg',
    connection: {
      host: process.env.DB_HOST || '127.0.0.1',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'secret',
      database: process.env.DB_NAME || 'judo_cloud',
      port: process.env.DB_PORT || 5432
    },
    pool: {
      min: 2,
      max: 10
    },
    migrations: {
      directory: './migrations'
    },
    seeds: {
      directory: './seeds'
    }
  }
};
