// Läuft einmalig nach der Vollablauf-Suite (siehe globalTeardown in
// playwright.vollablauf.config.js) — auch wenn einzelne test()-Schritte fehlgeschlagen sind, denn
// Playwright ruft globalTeardown unabhängig vom Testergebnis auf. Räumt die während des Laufs in
// der echten Online-Cloud-DB erzeugten Turniere (inkl. aller Pools/Kampfflächen/Teilnehmer/
// Mannschaften/Kämpfe darunter) wieder auf:
//
//   1. Primär anhand der in run-state.js mitgeschriebenen Turnier-IDs.
//   2. Fallback zusätzlich per Namens-Präfix (MARKER_PREFIX), falls einzelne IDs aus irgendeinem
//      Grund fehlen (z.B. Absturz zwischen DB-Insert und dem Vormerken der ID).
//   3. Abschluss-Verifikation: loggt, ob nach dem Cleanup noch [E2E-VOLLABLAUF...]-Turniere übrig
//      sind.
//
// WICHTIG (siehe Vorfall-Historie in helpers.js): rührt bewusst NIE `benutzer` oder `vereine` an.
// jan/tim/tom@test.de sind echte, dauerhafte Accounts des Nutzers — eine frühere Fassung hat sie
// über einen Muster-basierten Löschfallback versehentlich entfernt. Dieser Test legt für sie
// weder Account noch Verein an (siehe meldeAn() in helpers.js), es gibt hier also auch nichts,
// das zu ihnen gehört, aufzuräumen wäre.
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import dotenv from 'dotenv';
import knexLib from 'knex';
import { liesStatus } from './run-state.js';
import { bereinigeTestPostgres } from '../helpers/testPostgres.js';
import { OFFLINE_PG_VERZEICHNIS } from './test-env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../..');

const require = createRequire(import.meta.url);

async function loescheTurnierKaskade(knex, turnierIds) {
    if (turnierIds.length === 0) return;

    await knex('kaempfe').whereIn('pool_id', knex('pools').select('id').whereIn('turnier_id', turnierIds)).del();
    await knex('mannschaft_mitglieder').whereIn('mannschaft_id', knex('mannschaften').select('id').whereIn('turnier_id', turnierIds)).del();
    await knex('mannschaftskaempfe').whereIn('pool_id', knex('pools').select('id').whereIn('turnier_id', turnierIds)).del();
    await knex('turnier_teilnehmer').whereIn('turnier_id', turnierIds).del();
    await knex('mannschaften').whereIn('turnier_id', turnierIds).del();
    await knex('pools').whereIn('turnier_id', turnierIds).del();
    await knex('kampfflaechen').whereIn('turnier_id', turnierIds).del();
    await knex('turniere').whereIn('id', turnierIds).del();
}

export default async function globalTeardown() {
    dotenv.config({ path: path.resolve(projectRoot, '.env'), quiet: true });
    const knexConfig = require(path.resolve(projectRoot, 'knexfile.cjs'));
    const knex = knexLib(knexConfig.online);

    try {
        const status = liesStatus();
        console.log(`[Vollablauf-Cleanup] Räume Turniere mit Marker "${status.markerPrefix}" auf...`);

        // --- 1. Primär: getrackte IDs ---
        await loescheTurnierKaskade(knex, status.turnierIds || []);

        // --- 2. Fallback: Namens-Präfix ---
        const uebrigeTurniere = await knex('turniere').where('bezeichnung', 'like', `${status.markerPrefix}%`).select('id');
        if (uebrigeTurniere.length > 0) {
            console.warn(`[Vollablauf-Cleanup] ${uebrigeTurniere.length} Turnier(e) nicht über IDs erfasst, räume per Namens-Fallback auf.`);
            await loescheTurnierKaskade(knex, uebrigeTurniere.map(t => t.id));
        }

        // --- 3. Abschluss-Verifikation ---
        const rest = await knex('turniere').where('bezeichnung', 'like', `${status.markerPrefix}%`).count('id as n').first();
        if (Number(rest.n) === 0) {
            console.log('[Vollablauf-Cleanup] Erfolgreich — keine Turnier-Reste mehr in der Online-DB.');
        } else {
            console.error(`[Vollablauf-Cleanup] ACHTUNG: ${rest.n} Turnier(e) konnten NICHT automatisch entfernt werden. Bitte manuell prüfen (Marker: ${status.markerPrefix}).`);
        }
    } finally {
        await knex.destroy();
        // Offline-Server der Suite: eingebettetes Test-PostgreSQL stoppen und löschen.
        await bereinigeTestPostgres(OFFLINE_PG_VERZEICHNIS);
    }
}
