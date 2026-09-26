// Einstellungen dieses Client-Knotens (Notebook/Tablet), gespeichert in der lokalen, NICHT
// replizierten Datenbank "hajime_client": dauerhafte clientId, gewählte Matte und die zuletzt
// bekannte Turnier-Instanz (damit der Client auch ohne Server-Verbindung startet).
import { randomUUID } from 'crypto';
import os from 'os';
import { oeffneMitWiederholung } from './dokumentDb.js';

const KONFIG_ID = '_local/client-konfig';

export async function erzeugeClientKonfig(PouchDB) {
    const db = await oeffneMitWiederholung(PouchDB, 'hajime_client');

    async function lese() {
        try {
            return await db.get(KONFIG_ID);
        } catch (err) {
            if (err.status !== 404) throw err;
            return { _id: KONFIG_ID };
        }
    }

    async function schreibe(aenderung) {
        const aktuell = await lese();
        const neu = { ...aktuell, ...aenderung };
        await db.put(neu);
        return neu;
    }

    let konfig = await lese();
    if (!konfig.client_id) konfig = await schreibe({ client_id: randomUUID() });

    return {
        clientId: konfig.client_id,
        geraet: os.hostname(),
        async matteId() {
            return (await lese()).matte_id ?? null;
        },
        async setzeMatte(matteId) {
            await schreibe({ matte_id: matteId == null ? null : Number(matteId) });
        },
        async letzteInstanz() {
            return (await lese()).instanz_id ?? null;
        },
        async merkeInstanz(instanzId) {
            await schreibe({ instanz_id: instanzId });
        }
    };
}
