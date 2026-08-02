export const config = { transaction: false };

// Führt einen Lebenszyklus-Status für Teilnehmer ein: angemeldet | zurueckgezogen | kampfbereit |
// nicht_erschienen | teilgenommen | nicht_angetreten | disqualifiziert. Additive Spalte, kein
// SQLite-PRAGMA-Rebuild nötig. Bestandsdaten bleiben auf dem sicheren Default 'angemeldet' — eine
// rückwirkende Ableitung von 'teilgenommen' aus alten Kämpfen würde in einer Einmal-Migration zu
// unsicheren Annahmen führen und gehört in die Anwendungslogik, nicht in einen Backfill.
export async function up(knex) {
    await knex.schema.alterTable('turnier_teilnehmer', (table) => {
        table.string('status').notNullable().defaultTo('angemeldet');
    });
}

export async function down(knex) {
    await knex.schema.alterTable('turnier_teilnehmer', (table) => {
        table.dropColumn('status');
    });
}
