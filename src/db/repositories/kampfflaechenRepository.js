import { createRepository } from '../baseRepository.js';

const TYPE_PREFIX = 'kampffl';

// Kampfflächen haben in CouchDB keine automatische Einfüge-Reihenfolge wie die bisherige
// SQL-Auto-Increment-ID -- ein expliziter Zeitstempel bei der Erstellung ersetzt sie für die
// Sortierung in findByTurnier.
export function createKampfflaechenRepository(db) {
    const repo = createRepository({ db, typePrefix: TYPE_PREFIX });

    async function create(data) {
        return repo.create({ ...data, created_at: new Date().toISOString() });
    }

    async function findByTurnier(turnierId) {
        const gefunden = await repo.query({ turnier_id: turnierId });
        return gefunden.sort((a, b) => a.created_at.localeCompare(b.created_at));
    }

    return { ...repo, create, findByTurnier };
}
