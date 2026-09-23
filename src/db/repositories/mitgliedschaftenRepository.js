import { createRepository } from '../baseRepository.js';

const TYPE_PREFIX = 'mitgliedschaft';

// Bildet die heutige benutzer_vereine-Tabelle ab (echtes n:m zwischen Benutzern und Vereinen,
// je Mitgliedschaft mit eigenem freigegeben-Status). Der schmalere Sonderfall "nur unbestätigte
// Mitgliedschaften eines Vereins" bekommt bewusst keine eigene Methode -- query({ verein_id,
// freigegeben: 0 }) über das generische query() deckt das ab.
export function createMitgliedschaftenRepository(db) {
    const repo = createRepository({ db, typePrefix: TYPE_PREFIX });

    async function create(data) {
        return repo.create({ ...data, created_at: new Date().toISOString() });
    }

    async function findByBenutzer(benutzerId) {
        return repo.query({ benutzer_id: benutzerId });
    }

    async function findByVerein(vereinId) {
        return repo.query({ verein_id: vereinId });
    }

    return { ...repo, create, findByBenutzer, findByVerein };
}
