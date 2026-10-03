// Einstellungen eines Client-Geräts in einer lokalen, NICHT replizierten Datenbank: dauerhafte
// clientId, gewählte Matte und die zuletzt bekannte Turnier-Instanz (damit das Gerät auch ohne
// Server-Verbindung startet). Die Datenbank öffnet die Plattform (Node: LevelDB, Android: IndexedDB).
const KONFIG_ID = '_local/client-konfig';

export async function erzeugeClientKonfig({ db, neueId, geraet }) {
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
    if (!konfig.client_id) konfig = await schreibe({ client_id: neueId() });

    return {
        clientId: konfig.client_id,
        geraet,
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
