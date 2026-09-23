import { createRepository } from '../baseRepository.js';

const TYPE_PREFIX = 'benutzer';

// findByEmail ist der kritische Login-Zugriffspfad (siehe authController.js: Benutzer wird
// beim Login und bei der Registrierungs-Dublettenprüfung ausschließlich über die E-Mail-Adresse
// gesucht, nie über die ID).
export function createBenutzerRepository(db) {
    const repo = createRepository({ db, typePrefix: TYPE_PREFIX });

    async function create(data) {
        return repo.create({ ...data, created_at: new Date().toISOString() });
    }

    async function findByEmail(email) {
        return repo.query({ email });
    }

    return { ...repo, create, findByEmail };
}
