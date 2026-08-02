const knex = require('knex');
const config = require('./knexfile.cjs');

const environment = process.env.IS_OFFLINE === 'true' ? 'offline' : 'online';
const db = knex(config[environment]);

console.log(`[DB] Verbindung hergestellt im Modus: ${environment.toUpperCase()}`);

module.exports = db;
