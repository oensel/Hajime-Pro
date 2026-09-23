import { createRepository } from '../baseRepository.js';

const TYPE_PREFIX = 'mannschaftskampf';

// Exakt dasselbe Muster wie kaempfeRepository.js: findByPool statt findAll, begründet durch
// mannschaftsProgression.js, dessen einzige Funktion berechneMannschaftsPatches immer alle
// Begegnungen eines Pools als Array entgegennimmt.
export function createMannschaftskaempfeRepository(db) {
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
