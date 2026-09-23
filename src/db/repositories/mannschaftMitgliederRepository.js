import { createRepository } from '../baseRepository.js';

const TYPE_PREFIX = 'mitglied';

// Wie bei den übrigen Entitäts-Repositories: expliziter Zeitstempel ersetzt die fehlende
// CouchDB-Einfüge-Reihenfolge. findByMannschaft ist der mit Abstand häufigste Zugriffspfad
// (Roster-Positionen einer Mannschaft laden); der seltenere Bulk-Fall über mehrere
// Mannschaften hinweg läuft über das generische query() mit einem Mango-$in-Selector, ohne
// eigene Methode (YAGNI).
export function createMannschaftMitgliederRepository(db) {
    const repo = createRepository({ db, typePrefix: TYPE_PREFIX });

    async function create(data) {
        return repo.create({ ...data, created_at: new Date().toISOString() });
    }

    async function findByMannschaft(mannschaftId) {
        const gefunden = await repo.query({ mannschaft_id: mannschaftId });
        return gefunden.sort((a, b) => a.created_at.localeCompare(b.created_at));
    }

    return { ...repo, create, findByMannschaft };
}
