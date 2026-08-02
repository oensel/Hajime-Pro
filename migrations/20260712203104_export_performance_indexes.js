export const config = { transaction: false };

// Fremdschlüssel werden von Postgres/SQLite nicht automatisch indiziert. Ohne diese Indexe
// müsste die DB bei jedem Turnier-Export (Pools, Teilnehmer, Kämpfe eines Turniers) die
// jeweilige Tabelle komplett durchsuchen.
export async function up(knex) {
    await knex.schema.alterTable('kaempfe', (table) => {
        table.index('pool_id', 'idx_kaempfe_pool_id');
    });
    await knex.schema.alterTable('turnier_teilnehmer', (table) => {
        table.index('turnier_id', 'idx_turnier_teilnehmer_turnier_id');
    });
    await knex.schema.alterTable('pools', (table) => {
        table.index('turnier_id', 'idx_pools_turnier_id');
    });
}

export async function down(knex) {
    await knex.schema.alterTable('kaempfe', (table) => {
        table.dropIndex('pool_id', 'idx_kaempfe_pool_id');
    });
    await knex.schema.alterTable('turnier_teilnehmer', (table) => {
        table.dropIndex('turnier_id', 'idx_turnier_teilnehmer_turnier_id');
    });
    await knex.schema.alterTable('pools', (table) => {
        table.dropIndex('turnier_id', 'idx_pools_turnier_id');
    });
}
