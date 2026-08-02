export function up(knex) {
  return knex.schema.alterTable('pools', (table) => {
    table.integer('matte_reihenfolge').nullable();
  });
}

export function down(knex) {
  return knex.schema.alterTable('pools', (table) => {
    table.dropColumn('matte_reihenfolge');
  });
}
