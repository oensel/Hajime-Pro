export const config = { transaction: false };

// Antworten des Fragebogens „Ausstattung“ (Assistent in turnier.html, src/shared/ausstattung.js) je Turnier, damit man sie später
// erneut öffnen und anders beantworten kann. Format: { frageId: 'ja' | 'nein' }; leer = noch nie beantwortet.
export async function up(knex) {
    await knex.schema.alterTable('turniere', (table) => {
        table.jsonb('ausstattung').notNullable().defaultTo('{}');
    });
}

export async function down(knex) {
    await knex.schema.alterTable('turniere', (table) => {
        table.dropColumn('ausstattung');
    });
}
