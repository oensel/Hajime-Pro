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

    // findAll (statt nur findByPool) wird für die Pausenprüfung gebraucht: ein Athlet kann in
    // unterschiedlichen Pools desselben Turniers kämpfen, die Mindestpause gilt aber
    // poolübergreifend.
    async function findAll() {
        const gefunden = await repo.query({});
        return gefunden.sort((a, b) => a.created_at.localeCompare(b.created_at));
    }

    // pausenRegel.js ermittelt das Ende des letzten Kampfes über updated_at -- anders als
    // created_at (einmalig bei der Erstellung) muss dieses Feld bei JEDEM Update aktualisiert
    // werden, nicht nur beim Setzen von status: 'beendet', damit es dem tatsächlichen
    // Bearbeitungszeitpunkt entspricht.
    async function update(id, patch) {
        return repo.update(id, { ...patch, updated_at: new Date().toISOString() });
    }

    return { ...repo, create, update, findByPool, findAll };
}
