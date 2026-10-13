// Teilnehmer-App Phase 2b: Pools und Kämpfe der freigegebenen Turniere (Baum, Kampfliste, Dashboard).
export async function up(knex) {
    await knex.schema.createTable('live_pools', (t) => {
        t.text('turnier_key').notNullable().references('turnier_key').inTable('live_turniere').onDelete('CASCADE');
        t.integer('pool_id').notNullable();
        t.text('bezeichnung').notNullable().defaultTo('');
        t.text('modus').notNullable().defaultTo('');
        t.text('status').notNullable().defaultTo('');
        t.integer('matte_id');
        t.text('altersklasse').notNullable().defaultTo('');
        t.text('geschlecht').notNullable().defaultTo('');
        t.text('gewichtsklasse').notNullable().defaultTo('');
        t.text('farbe2').notNullable().defaultTo('blau');
        t.primary(['turnier_key', 'pool_id']);
    });

    await knex.schema.createTable('live_kaempfe', (t) => {
        t.text('turnier_key').notNullable().references('turnier_key').inTable('live_turniere').onDelete('CASCADE');
        t.integer('kampf_id').notNullable();
        t.integer('pool_id').notNullable();
        t.text('nr').notNullable().defaultTo('');
        t.text('status').notNullable().defaultTo('');
        t.integer('reihenfolge');
        t.text('k1_key');
        t.text('k2_key');
        t.text('sieger_key');
        t.integer('p1').notNullable().defaultTo(0);
        t.integer('p2').notNullable().defaultTo(0);
        t.primary(['turnier_key', 'kampf_id']);
        t.index(['turnier_key', 'pool_id']);
    });
}

export async function down(knex) {
    await knex.schema.dropTableIfExists('live_kaempfe');
    await knex.schema.dropTableIfExists('live_pools');
}
