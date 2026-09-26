// pg_ctl startet PostgreSQL losgelöst vom Leitstand — beim Beenden der Suite explizit stoppen.
import { KNOTEN } from './test-env.js';
import { stoppe } from './pgInstanz.js';

export default async function globalTeardown() {
    for (const k of Object.values(KNOTEN)) stoppe(k.pgDir, 'immediate');
}
