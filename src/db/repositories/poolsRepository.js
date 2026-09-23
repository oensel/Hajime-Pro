import { createRepository } from '../baseRepository.js';

const TYPE_PREFIX = 'pool';

// Wie bei kampfflaechenRepository.js: CouchDB-Dokumente haben keine implizite
// Einfüge-Reihenfolge wie die bisherige SQL-Auto-Increment-ID -- ein expliziter Zeitstempel
// bei der Erstellung ersetzt sie für die Sortierung in findAll.
export function createPoolsRepository(db) {
    const repo = createRepository({ db, typePrefix: TYPE_PREFIX });

    async function create(data) {
        return repo.create({ ...data, created_at: new Date().toISOString() });
    }

    // Jede Turnier-Datenbank enthält per Konstruktion ausschließlich Dokumente dieses einen
    // Turniers (siehe Spec: eine CouchDB-Datenbank pro Turnier) -- ein Filter nach turnier_id
    // ist hier anders als bei der bisherigen gemeinsamen SQL-Tabelle nicht nötig.
    async function findAll() {
        const gefunden = await repo.query({});
        return gefunden.sort((a, b) => a.created_at.localeCompare(b.created_at));
    }

    return { ...repo, create, findAll };
}
