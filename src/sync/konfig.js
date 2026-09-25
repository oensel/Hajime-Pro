// Liest die Sync-Einstellungen aus der Umgebung. SYNC_ROLLE entscheidet, ob dieser Knoten eine
// Dokument-DB betreibt: 'server' = Hallen-Server (relationale DB + /db + Brücke), 'client' =
// Notebook/Tablet (nur lokale PouchDB, ab Plan B), leer = heutiges Verhalten ohne Sync (Cloud).
export function liesSyncKonfig(env = process.env) {
    const rolle = env.SYNC_ROLLE === 'server' || env.SYNC_ROLLE === 'client' ? env.SYNC_ROLLE : null;
    return {
        rolle,
        istServer: rolle === 'server',
        istClient: rolle === 'client',
        datenverzeichnis: env.SYNC_DATENVERZEICHNIS || './data/dokumente'
    };
}
