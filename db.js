const knex = require('knex');
const config = require('./knexfile.cjs');

const environment = require('./src/config/betriebsmodus.cjs').liesBetriebsmodus().knexUmgebung || 'online';
const db = knex(config[environment]);

console.log(`[DB] Verbindung hergestellt im Modus: ${environment.toUpperCase()}`);

module.exports = db;
