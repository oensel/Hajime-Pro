// Verwaltet die Ingest-Token der Cloud: node scripts/live-token.mjs erzeugen --name "Halle" [--turnier KEY] | liste | sperren ID
// Verbindet sich mit der Datenbank der Cloud (DB_URL bzw. DB_HOST/DB_USER/DB_PASSWORD/DB_NAME aus .env).
import dotenv from 'dotenv';
import knexLib from 'knex';
import dbVerbindung from '../src/config/dbVerbindung.cjs';
import { fuehreTokenBefehlAus } from '../src/liveCloud/token.js';

dotenv.config({ quiet: true });
const knex = knexLib({ client: 'pg', connection: dbVerbindung.baueVerbindung(process.env, { migration: false }), pool: { min: 0, max: 1 } });
try {
    for (const zeile of await fuehreTokenBefehlAus(knex, process.argv.slice(2))) console.log(zeile);
} catch (fehler) {
    console.error(fehler.message);
    process.exitCode = 1;
} finally {
    await knex.destroy();
}
