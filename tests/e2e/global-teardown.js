// Läuft einmalig nach der gesamten Testsuite: stoppt das Test-PostgreSQL (tests/helpers/pg-dienst.mjs) und löscht
// sein Datenverzeichnis. Das frische, migrierte Schema liefert pg-dienst.mjs beim Start der Suite.
import { bereinigeTestPostgres } from '../helpers/testPostgres.js';
import { TEST_PG_VERZEICHNIS } from './test-env.js';

export default async function globalTeardown() {
    await bereinigeTestPostgres(TEST_PG_VERZEICHNIS);
}
