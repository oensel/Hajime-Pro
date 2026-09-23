import { createRepository } from '../baseRepository.js';

const TYPE_PREFIX = 'mannschaft';

// Wie bei den übrigen Entitäts-Repositories: expliziter Zeitstempel ersetzt die fehlende
// CouchDB-Einfüge-Reihenfolge. findByPool und findUnassigned bilden die beiden real in
// mannschaftController.js vorkommenden Zugriffsmuster ab (Mannschaften eines Pools bzw. noch
// nicht zugewiesene Mannschaften eines Turniers).
export function createMannschaftenRepository(db) {
    const repo = createRepository({ db, typePrefix: TYPE_PREFIX });

    async function create(data) {
        return repo.create({ ...data, created_at: new Date().toISOString() });
    }

    async function findByPool(poolId) {
        const gefunden = await repo.query({ pool_id: poolId });
        return gefunden.sort((a, b) => a.created_at.localeCompare(b.created_at));
    }

    async function findUnassigned() {
        const gefunden = await repo.query({ pool_id: null });
        return gefunden.sort((a, b) => a.created_at.localeCompare(b.created_at));
    }

    return { ...repo, create, findByPool, findUnassigned };
}
