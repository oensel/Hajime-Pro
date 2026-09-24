import { ensureDatabase } from '../couch.js';

const PRAEFIX = 'turnier_';

export function createTurnierDbRegistry(nano) {
    const cache = new Map();

    async function openTurnierDb(turnierId) {
        if (cache.has(turnierId)) return cache.get(turnierId);
        const db = await ensureDatabase(nano, `${PRAEFIX}${turnierId}`);
        cache.set(turnierId, db);
        return db;
    }

    async function listTurnierIds() {
        const alleDatenbanken = await nano.db.list();
        return alleDatenbanken
            .filter((name) => name.startsWith(PRAEFIX))
            .map((name) => name.slice(PRAEFIX.length));
    }

    return { openTurnierDb, listTurnierIds };
}
