export const config = { transaction: false };

// Führt einen Lebenszyklus-Status für Kampfflächen (Matten) ein: frei | pools_vorhanden |
// in_austragung | pausiert | gesperrt. Anders als bei Pool/Kampf/Turnier werden HIER alle 5
// Zustände explizit gespeichert und bei jedem relevanten Ereignis geschrieben (siehe
// synchronisiereMattenStatus in poolController.js) statt zur Laufzeit abgeleitet — bewusste
// Entscheidung, da pausiert/gesperrt reine manuelle Override-Zustände ohne Herleitung aus
// anderen Tabellen sind. Additive Spalte, kein SQLite-PRAGMA-Rebuild nötig.
export async function up(knex) {
    await knex.schema.alterTable('kampfflaechen', (table) => {
        table.string('status').notNullable().defaultTo('frei');
    });

    // Backfill aus der aktuellen Pool-Zuordnung (pausiert/gesperrt sind rein manuelle Zustände
    // ohne historisches Signal und bleiben beim Default 'frei', bis jemand sie aktiv setzt).
    const kampfflaechen = await knex('kampfflaechen').select('id');
    for (const kf of kampfflaechen) {
        const zugeordnetePools = await knex('pools').where({ kampfflaeche_id: kf.id }).select('id', 'status');
        let status = 'frei';
        if (zugeordnetePools.length > 0) {
            status = zugeordnetePools.some(p => p.status === 'gestartet') ? 'in_austragung' : 'pools_vorhanden';
        }
        await knex('kampfflaechen').where({ id: kf.id }).update({ status });
    }
}

export async function down(knex) {
    await knex.schema.alterTable('kampfflaechen', (table) => {
        table.dropColumn('status');
    });
}
