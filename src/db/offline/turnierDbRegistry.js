import { ensureDatabase } from '../couch.js';

const PRAEFIX = 'turnier_';
const GUELTIGE_TURNIER_ID = /^[a-z0-9_-]+$/;

function istGueltigeTurnierId(turnierId) {
    return typeof turnierId === 'string' && GUELTIGE_TURNIER_ID.test(turnierId);
}

export function createTurnierDbRegistry(nano) {
    const cache = new Map();

    async function openTurnierDb(turnierId) {
        if (!istGueltigeTurnierId(turnierId)) {
            throw new Error(`Ungültige Turnier-ID: ${turnierId}`);
        }
        if (cache.has(turnierId)) return cache.get(turnierId);
        const db = await ensureDatabase(nano, `${PRAEFIX}${turnierId}`);
        cache.set(turnierId, db);
        return db;
    }

    // Öffnet eine Turnier-Datenbank OHNE sie bei Nichtexistenz anzulegen -- für alle
    // Lese-/Änderungspfade außer der Neuanlage (openTurnierDb), damit ein Zugriff auf eine
    // unbekannte oder bereits gelöschte Turnier-ID keine leere Geister-Datenbank erzeugt.
    // nano.db.use() selbst macht keinen HTTP-Aufruf -- ob die Datenbank existiert, zeigt
    // sich erst beim ersten echten Zugriff (z.B. turnierRepository.get(), das ein 404
    // bereits als null behandelt).
    function useTurnierDb(turnierId) {
        if (!istGueltigeTurnierId(turnierId)) {
            throw new Error(`Ungültige Turnier-ID: ${turnierId}`);
        }
        return nano.db.use(`${PRAEFIX}${turnierId}`);
    }

    async function listTurnierIds() {
        const alleDatenbanken = await nano.db.list();
        return alleDatenbanken
            .filter((name) => name.startsWith(PRAEFIX))
            .map((name) => name.slice(PRAEFIX.length));
    }

    async function deleteTurnierDb(turnierId) {
        if (!istGueltigeTurnierId(turnierId)) {
            throw new Error(`Ungültige Turnier-ID: ${turnierId}`);
        }
        await nano.db.destroy(`${PRAEFIX}${turnierId}`);
        cache.delete(turnierId);
    }

    return { openTurnierDb, useTurnierDb, listTurnierIds, deleteTurnierDb };
}
