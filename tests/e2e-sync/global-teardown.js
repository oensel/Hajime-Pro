// Stoppt das eingebettete PostgreSQL des Test-Hallen-Servers (unter Windows beendet Playwright den Server hart,
// ohne dass er seine Datenbank selbst herunterfährt) und löscht sein Datenverzeichnis.
import { bereinigeTestPostgres } from '../helpers/testPostgres.js';
import { SYNC_TEST_PG_VERZEICHNIS } from './test-env.js';

export default async function globalTeardown() {
    await bereinigeTestPostgres(SYNC_TEST_PG_VERZEICHNIS);
}
