import { ensureDatabase } from '../couch.js';

const PRAEFIX = 'turnier_';
const GUELTIGE_TURNIER_ID = /^[a-z0-9_-]+$/;

export function createTurnierDbRegistry(nano) {
    const cache = new Map();

    async function openTurnierDb(turnierId) {
        if (typeof turnierId !== 'string' || !GUELTIGE_TURNIER_ID.test(turnierId)) {
            throw new Error(`Ungültige Turnier-ID: ${turnierId}`);
        }
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

    async function deleteTurnierDb(turnierId) {
        await nano.db.destroy(`${PRAEFIX}${turnierId}`);
        cache.delete(turnierId);
    }

    return { openTurnierDb, listTurnierIds, deleteTurnierDb };
}
