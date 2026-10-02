// Liest die Sync-Einstellungen aus der Umgebung. Der Betriebsmodus (BETRIEBSMODUS, bzw. SYNC_ROLLE bei den
// Altvariablen; siehe src/config/betriebsmodus.cjs) entscheidet, ob dieser Knoten eine
// Dokument-DB betreibt: 'server' = Hallen-Server (relationale DB + /db + Brücke), 'client' =
// Notebook/Tablet (nur lokale PouchDB, repliziert zu SYNC_SERVER_URL), leer = heutiges Verhalten
// ohne Sync (Cloud).
import betriebsmodus from '../config/betriebsmodus.cjs';

export function liesSyncKonfig(env = process.env) {
    const rolle = betriebsmodus.liesBetriebsmodus(env).syncRolle;
    return {
        rolle,
        istServer: rolle === 'server',
        istClient: rolle === 'client',
        datenverzeichnis: env.SYNC_DATENVERZEICHNIS || './data/dokumente',
        // Basis-URL des Hallen-Servers (bzw. der virtuellen IP), ohne /db, z.B. http://192.168.10.10:3000
        serverUrl: (env.SYNC_SERVER_URL || '').replace(/\/+$/, '').replace(/\/db$/, ''),
        // Gemeinsames Geheimnis für die Replikation Client <-> Server (optional).
        secret: env.SYNC_SECRET || ''
    };
}
