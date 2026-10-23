// Notfall-Schlüssel für den Super-Admin-Zugang: node scripts/notfall-schluessel.mjs erzeugen | status
// erzeugen: legt einen neuen Schlüssel an (ersetzt den alten) und zeigt ihn EINMAL an: ausdrucken und sicher verwahren.
// Verbindet sich mit der Datenbank der Cloud (DB_URL bzw. DB_HOST/DB_USER/DB_PASSWORD/DB_NAME aus .env).
import dotenv from 'dotenv';
import knexLib from 'knex';
import dbVerbindung from '../src/config/dbVerbindung.cjs';
import { erzeugeNotfallSchluessel, notfallSchluesselStatus } from '../src/services/notfallZugang.js';

dotenv.config({ quiet: true });
const befehl = process.argv[2];
if (befehl !== 'erzeugen' && befehl !== 'status') {
    console.error('Aufruf: node scripts/notfall-schluessel.mjs erzeugen | status');
    process.exit(1);
}
const knex = knexLib({ client: 'pg', connection: dbVerbindung.baueVerbindung(process.env, { migration: false }), pool: { min: 0, max: 1 } });
try {
    if (befehl === 'erzeugen') {
        const schluessel = await erzeugeNotfallSchluessel(knex);
        console.log('Neuer Notfall-Schlüssel (wird nicht gespeichert und nie wieder angezeigt):\n');
        console.log(schluessel);
        console.log('\nEingabe auf /notfall-zugang.html; ein früherer Schlüssel ist damit ungültig.');
    } else {
        const status = await notfallSchluesselStatus(knex);
        console.log(status.vorhanden ? `Ein Notfall-Schlüssel ist hinterlegt (erzeugt ${status.erstellt.toISOString()}).` : 'Es ist kein Notfall-Schlüssel hinterlegt.');
    }
} catch (fehler) {
    console.error(fehler.message);
    process.exitCode = 1;
} finally {
    await knex.destroy();
}
