// Urkunden-Vorlagen je Verein (docs/superpowers/specs/2026-09-29-urkunden-generator-design.md):
// Blanko-PDF, Textfelder (JSON, pt, Ursprung oben links) und Voreinstellungen für den Druck.
export async function up(knex) {
    await knex.schema.createTable('urkunden_vorlagen', (table) => {
        table.increments('id').primary();
        table.integer('verein_id').unsigned().notNullable().references('id').inTable('vereine').onDelete('CASCADE');
        table.string('name').notNullable();
        table.binary('pdf').notNullable();
        table.string('pdf_dateiname');
        table.float('seiten_breite_pt').notNullable();
        table.float('seiten_hoehe_pt').notNullable();
        table.text('felder').notNullable().defaultTo('[]');
        table.string('platzbereich').notNullable().defaultTo('3');
        table.string('reihenfolge').notNullable().defaultTo('siegerehrung');
        table.boolean('bei_abschluss_anbieten').notNullable().defaultTo(false);
        table.timestamps(true, true);
        table.unique(['verein_id', 'name']);
    });
}

export async function down(knex) {
    await knex.schema.dropTableIfExists('urkunden_vorlagen');
}
