// Wählt die knex-Umgebung aus knexfile.cjs. IS_OFFLINE=true heißt "Hallenbetrieb" — welche
// relationale DB dort läuft, steuert DB_CLIENT: 'pg' (Pflicht im Server-Cluster, nutzt dieselben
// DB_HOST/DB_USER/...-Variablen wie die Cloud-Konfiguration) oder SQLite (Standard, Entwicklung
// und einzelne Hallenrechner). Ohne IS_OFFLINE=true immer die Cloud-Konfiguration.
export function waehleKnexUmgebung(env = process.env) {
    if (env.IS_OFFLINE !== 'true') return 'online';
    return env.DB_CLIENT === 'pg' ? 'online' : 'offline';
}
