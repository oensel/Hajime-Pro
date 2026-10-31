// Hat die Turnierleitung das Wettkampfsystem des Pools bewusst gewählt (Auswahlliste in pools.html,
// PUT /api/pools/:id/system)? Nur dann bleibt es bei einer Änderung der Teilnehmerzahl erhalten, solange es die
// neue Zahl abdeckt (waehleWettkampfsystem in poolController.js); sonst gilt die Voreinstellung. Die Spalte läuft
// wie alle Pool-Spalten über den Sync mit.
export async function up(knex) {
    await knex.schema.alterTable('pools', (table) => {
        table.boolean('system_gewaehlt').notNullable().defaultTo(false);
    });
}

export async function down(knex) {
    await knex.schema.alterTable('pools', (table) => {
        table.dropColumn('system_gewaehlt');
    });
}
