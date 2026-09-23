import { createRepository } from '../baseRepository.js';

const TYPE_PREFIX = 'verein';

// Anders als bei den turnierbezogenen Repositories ist die accounts-Datenbank eine einzige,
// dauerhaft geteilte Datenbank für ALLE Vereine -- findAll() ist hier deshalb bewusst korrekt
// und keine Wiederholung des in den turnierbezogenen Repositories korrigierten Fehlers.
export function createVereineRepository(db) {
    const repo = createRepository({ db, typePrefix: TYPE_PREFIX });

    async function create(data) {
        return repo.create({ ...data, created_at: new Date().toISOString() });
    }

    async function findByName(name) {
        return repo.query({ name });
    }

    async function findAll() {
        const gefunden = await repo.query({});
        return gefunden.sort((a, b) => a.created_at.localeCompare(b.created_at));
    }

    return { ...repo, create, findByName, findAll };
}
