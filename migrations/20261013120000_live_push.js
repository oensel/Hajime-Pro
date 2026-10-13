// Teilnehmer-App Phase 3: Push-Anmeldungen je Gerät und Turnier, Glockenliste, bereits gesendete Nachrichten.
export async function up(knex) {
    await knex.schema.createTable('live_push_abos', (t) => {
        t.increments('id');
        t.text('turnier_key').notNullable().references('turnier_key').inTable('live_turniere').onDelete('CASCADE');
        t.text('endpoint').notNullable();
        t.text('p256dh').notNullable();
        t.text('auth').notNullable();
        t.timestamp('erstellt_am', { useTz: true }).notNullable().defaultTo(knex.fn.now());
        t.timestamp('aktualisiert_am', { useTz: true }).notNullable().defaultTo(knex.fn.now());
        t.timestamp('laeuft_ab_am', { useTz: true }).notNullable();
        t.unique(['turnier_key', 'endpoint']);
        t.index(['laeuft_ab_am']);
    });
    await knex.schema.createTable('live_push_glocken', (t) => {
        t.integer('abo_id').notNullable().references('id').inTable('live_push_abos').onDelete('CASCADE');
        t.text('art').notNullable();
        t.text('schluessel').notNullable();
        t.primary(['abo_id', 'art', 'schluessel']);
    });
    await knex.schema.createTable('live_push_gesendet', (t) => {
        t.integer('abo_id').notNullable().references('id').inTable('live_push_abos').onDelete('CASCADE');
        t.text('teilnehmer_key').notNullable();
        t.text('art').notNullable();
        t.integer('bezug_id').notNullable();
        t.timestamp('gesendet_am', { useTz: true }).notNullable().defaultTo(knex.fn.now());
        t.primary(['abo_id', 'teilnehmer_key', 'art', 'bezug_id']);
    });
}

export async function down(knex) {
    await knex.schema.dropTableIfExists('live_push_gesendet');
    await knex.schema.dropTableIfExists('live_push_glocken');
    await knex.schema.dropTableIfExists('live_push_abos');
}
