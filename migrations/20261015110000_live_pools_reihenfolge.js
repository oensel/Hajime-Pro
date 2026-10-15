// Teilnehmer-App: Reihenfolge der Pools auf ihrer Matte (wie auf der Matten-Seite und im Dashboard der Halle).
export async function up(knex) {
    await knex.schema.alterTable('live_pools', (t) => {
        t.integer('reihenfolge');
    });
}

export async function down(knex) {
    await knex.schema.alterTable('live_pools', (t) => {
        t.dropColumn('reihenfolge');
    });
}
