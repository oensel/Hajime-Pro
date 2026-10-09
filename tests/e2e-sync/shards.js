// Aufteilung der Sync-Suite auf unabhängige Knotenpaare (Hallen-Server + Client-Gerät), die gleichzeitig laufen.
// Jeder Shard hat eigene Ports, ein eigenes PostgreSQL und eigene Datenverzeichnisse (siehe test-env.js,
// HAJIME_SYNC_SHARD); Specs innerhalb eines Shards laufen wie bisher seriell in Dateinamen-Reihenfolge.
// Jede Spec-Datei MUSS hier genau einmal stehen — scripts/test-e2e-sync.mjs und die Config prüfen das.
export const SYNC_SHARDS = [
    {
        name: 'server',
        specs: [
            'sync-grundlagen', 'sync-abgleich', 'sync-bruecke', 'sync-konflikte', 'sync-datenzugriff',
            'sync-scoreboard', 'sync-waage', 'sync-liste-nachladen'
        ]
    },
    {
        name: 'client',
        specs: [
            'sync-client-grundlagen', 'sync-client-frontend', 'sync-client-mattenwahl',
            'sync-client-offline', 'sync-client-waage', 'sync-client-turnierwechsel'
        ]
    },
    {
        name: 'verbindung',
        specs: ['client-verteilung', 'verbindung-wechseln']
    }
];

export function specsVonShard(index) {
    return SYNC_SHARDS[index].specs.map((s) => `${s}.spec.js`);
}

// Liefert die Namen von Spec-Dateien, die keinem Shard zugeordnet sind bzw. mehrfach vorkommen.
export function pruefeZuordnung(specDateien) {
    const alle = SYNC_SHARDS.flatMap((s) => s.specs.map((n) => `${n}.spec.js`));
    const fehlen = specDateien.filter((d) => !alle.includes(d));
    const doppelt = alle.filter((d, i) => alle.indexOf(d) !== i);
    const unbekannt = alle.filter((d) => !specDateien.includes(d));
    return { fehlen, doppelt, unbekannt };
}
