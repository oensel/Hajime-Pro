import { createId } from './documentId.js';

export function createRepository({ db, typePrefix }) {
    async function create(data) {
        const _id = createId(typePrefix);
        const doc = { ...data, _id, typ: typePrefix };
        const result = await db.insert(doc);
        return { ...doc, _rev: result.rev };
    }

    async function findById(id) {
        try {
            return await db.get(id);
        } catch (error) {
            if (error.statusCode === 404) return null;
            throw error;
        }
    }

    async function update(id, patch) {
        const current = await db.get(id);
        const merged = { ...current, ...patch, _id: current._id, _rev: current._rev, typ: current.typ };
        const result = await db.insert(merged);
        return { ...merged, _rev: result.rev };
    }

    async function remove(id) {
        const current = await db.get(id);
        await db.destroy(id, current._rev);
    }

    // CouchDB/PouchDB können Mango-Queries auch ohne vorher angelegten Index beantworten
    // (Vollscan) -- bei den kleinen Dokumentmengen eines einzelnen Turniers (siehe Spec)
    // ist das ausreichend performant, ein Index-Management ist hier bewusst nicht Teil des
    // Fundaments.
    async function query(selector) {
        // typ steht bewusst NACH dem Selector-Spread, damit der eigene Typ-Scope des
        // Repositories nicht durch ein vom Aufrufer übergebenes `typ`-Feld überschrieben
        // werden kann (Objekt-Spread: der später gesetzte Key gewinnt).
        //
        // limit: CouchDBs eigener Mango-Query-Default ist 25 -- ohne expliziten, großzügigen
        // Wert würde query() Ergebnislisten (z.B. alle Kämpfe eines Pools oder alle
        // Teilnehmer eines Turniers) bei realen Turniergrößen (hunderte bis niedrige
        // Tausende Dokumente, nie annähernd Zehntausende) still abschneiden. Eine Paginierung
        // ist auf dieser Ebene für die absehbaren Datenmengen dieser Anwendung nicht nötig.
        const result = await db.find({ selector: { ...selector, typ: typePrefix }, limit: 10000 });
        return result.docs;
    }

    return { create, findById, update, remove, query };
}
