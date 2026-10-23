export const config = { transaction: false };

// Sichtbarkeit je Turnier ('alle' | 'bundesland' | 'eingeladen') und Standard-Bundesland der Vereine.
// Vereine ohne Bundesland bekommen Nordrhein-Westfalen; neue Vereine werden per Spaltenstandard damit angelegt.
const STANDARD_BUNDESLAND = 'Nordrhein-Westfalen';

export async function up(knex) {
    await knex.schema.alterTable('turniere', (table) => {
        table.string('sichtbarkeit').notNullable().defaultTo('alle');
    });
    await knex('vereine').where((q) => q.whereNull('bundesland').orWhere('bundesland', '')).update({ bundesland: STANDARD_BUNDESLAND });
    await knex.raw(`ALTER TABLE vereine ALTER COLUMN bundesland SET DEFAULT '${STANDARD_BUNDESLAND}'`);
}

export async function down(knex) {
    await knex.raw('ALTER TABLE vereine ALTER COLUMN bundesland DROP DEFAULT');
    await knex.schema.alterTable('turniere', (table) => {
        table.dropColumn('sichtbarkeit');
    });
}
