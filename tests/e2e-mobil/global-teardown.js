// Stoppt das eingebettete PostgreSQL des Test-Hallen-Servers und löscht sein Datenverzeichnis.
import { bereinigeTestPostgres } from '../helpers/testPostgres.js';
import { TEST_PG_VERZEICHNIS } from './test-env.js';

export default async function globalTeardown() {
    await bereinigeTestPostgres(TEST_PG_VERZEICHNIS);
}
