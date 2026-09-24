import { ensureDatabase } from '../couch.js';
import { createVereineRepository } from '../repositories/vereineRepository.js';
import { createBenutzerRepository } from '../repositories/benutzerRepository.js';
import { createMitgliedschaftenRepository } from '../repositories/mitgliedschaftenRepository.js';

export const OFFLINE_VEREIN_ID = 'verein:offline_club';
export const OFFLINE_BENUTZER_ID = 'benutzer:offline_user';

// Pendant zur Knex-Logik in requireAuth (src/middleware/auth.js): legt beim ersten
// Aufruf einen Offline-Verein und -Benutzer mit fester ID an, statt generierter UUIDs --
// req.user.id ist heute der Literal-String 'offline_user' und muss über Neustarts hinweg
// stabil bleiben.
export async function ensureOfflineAccountsDb(nano) {
    const db = await ensureDatabase(nano, 'offline_accounts');
    const vereineRepository = createVereineRepository(db);
    const benutzerRepository = createBenutzerRepository(db);
    const mitgliedschaftenRepository = createMitgliedschaftenRepository(db);

    const bestehenderVerein = await vereineRepository.findById(OFFLINE_VEREIN_ID);
    if (!bestehenderVerein) {
        await db.insert({
            _id: OFFLINE_VEREIN_ID,
            typ: 'verein',
            name: 'Offline Club',
            created_at: new Date().toISOString()
        });
    }

    const bestehenderBenutzer = await benutzerRepository.findById(OFFLINE_BENUTZER_ID);
    if (!bestehenderBenutzer) {
        await db.insert({
            _id: OFFLINE_BENUTZER_ID,
            typ: 'benutzer',
            email: 'offline@hajime.os',
            vorname: 'Offline',
            nachname: 'User',
            aktiver_verein_id: OFFLINE_VEREIN_ID,
            created_at: new Date().toISOString()
        });

        const bestehendeMitgliedschaften = await mitgliedschaftenRepository.query({
            benutzer_id: OFFLINE_BENUTZER_ID,
            verein_id: OFFLINE_VEREIN_ID
        });
        if (bestehendeMitgliedschaften.length === 0) {
            await mitgliedschaftenRepository.create({
                benutzer_id: OFFLINE_BENUTZER_ID,
                verein_id: OFFLINE_VEREIN_ID,
                freigegeben: true
            });
        }

        console.log('[DB] Offline-Mock-User "offline_user" (CouchDB) wurde angelegt.');
    }

    return db;
}
