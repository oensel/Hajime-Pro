import { createRepository } from '../baseRepository.js';

const TYPE_PREFIX = 'kampf';

// Wie bei den übrigen Entitäts-Repositories: CouchDB-Dokumente haben keine implizite
// Einfüge-Reihenfolge wie die bisherige SQL-Auto-Increment-ID -- ein expliziter Zeitstempel
// bei der Erstellung ersetzt sie für die Sortierung in findByPool.
//
// Anders als bei kampfflaechen/teilnehmer/pools bleibt hier eine echte Abfragemethode nötig:
// findByPool statt findAll, da eine Turnier-Datenbank mehrere Pools enthält und
// kampfProgression.js sowie praktisch jede bestehende Kämpfe-Abfrage nach pool_id filtern.
export function createKaempfeRepository(db) {
    const repo = createRepository({ db, typePrefix: TYPE_PREFIX });

    async function create(data) {
        return repo.create({ ...data, created_at: new Date().toISOString() });
    }

    async function findByPool(poolId) {
        const gefunden = await repo.query({ pool_id: poolId });
        return gefunden.sort((a, b) => a.created_at.localeCompare(b.created_at));
    }

    return { ...repo, create, findByPool };
}
