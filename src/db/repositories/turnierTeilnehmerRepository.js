import { createRepository } from '../baseRepository.js';

const TYPE_PREFIX = 'teilnehmer';

// Wie bei kampfflaechenRepository.js: CouchDB-Dokumente haben keine implizite
// Einfüge-Reihenfolge wie die bisherige SQL-Auto-Increment-ID -- ein expliziter Zeitstempel
// bei der Erstellung ersetzt sie für die Sortierung in findAll.
export function createTurnierTeilnehmerRepository(db) {
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

    // Pool-Zuordnung erfolgt über turnier_teilnehmer.pool_id -- gebraucht von den
    // Pool-Anlage-Kaskaden (z.B. jederGegenJedenPoolKaskade.js), die nur die Teilnehmer
    // EINES Pools für die Paarungsbildung brauchen, nicht alle Teilnehmer des Turniers.
    async function findByPool(poolId) {
        const gefunden = await repo.query({ pool_id: poolId });
        return gefunden.sort((a, b) => a.created_at.localeCompare(b.created_at));
    }

    return { ...repo, create, findAll, findByPool };
}
