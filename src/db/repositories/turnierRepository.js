import { stripReservedFields } from '../reservedFields.js';

const TURNIER_DOC_ID = 'turnier:meta';

// Anders als bei den übrigen Entitäten (kampfflaechen, pools, kaempfe, ...) enthält eine
// Turnier-Datenbank per Konstruktion genau EIN Turnier-Dokument -- die Datenbank identifiziert
// das Turnier bereits über ihren eigenen Namen (turnier_<id>). Deshalb kein
// createRepository-Wrapper mit generierten <typ>:<uuid>-IDs, sondern eine feste, bekannte ID.
//
// save() ersetzt das Dokument vollständig statt es zu mergen: turnierController.js's reale
// updateTurnier-Route sendet ohnehin immer den kompletten Formular-Datensatz, ein Merge-
// Verhalten würde hier nur unbeabsichtigt alte Feldwerte überleben lassen.
export function createTurnierRepository(db) {
    async function get() {
        try {
            return await db.get(TURNIER_DOC_ID);
        } catch (error) {
            if (error.statusCode === 404) return null;
            throw error;
        }
    }

    async function save(data) {
        const bestehend = await get();
        const doc = {
            ...stripReservedFields(data),
            _id: TURNIER_DOC_ID,
            // Kein query() in diesem Modul filtert danach -- konsistent mit jedem anderen
            // Dokumenttyp in der Turnier-Datenbank, falls ein künftiges datenbankübergreifendes
            // Katalog-Werkzeug einmal nach `typ` filtern muss.
            typ: 'turnier',
            ...(bestehend ? { _rev: bestehend._rev } : {})
        };
        const result = await db.insert(doc);
        return { ...doc, _rev: result.rev };
    }

    return { get, save };
}
