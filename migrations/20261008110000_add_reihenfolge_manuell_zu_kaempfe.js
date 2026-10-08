// Markiert Kämpfe, deren Mattenreihenfolge von Hand festgelegt wurde (Drag&Drop, Zurücksetzen).
// Die automatische Matten-Planung (planeKaempfeFuerKampfflaeche) lässt solche Kämpfe an ihrer
// Position stehen und hängt neu freigegebene Kämpfe dahinter an.
export async function up(knex) {
    await knex.schema.alterTable('kaempfe', (table) => {
        table.boolean('reihenfolge_manuell').notNullable().defaultTo(false);
    });
}

export async function down(knex) {
    await knex.schema.alterTable('kaempfe', (table) => {
        table.dropColumn('reihenfolge_manuell');
    });
}
