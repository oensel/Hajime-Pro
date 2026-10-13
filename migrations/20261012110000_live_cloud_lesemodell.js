// Teilnehmer-App Phase 2 (docs/specs/2026-10-12-teilnehmer-app-design.md, Abschnitt 6.1): Lesemodell der Cloud.
// Eigene Tabellen, getrennt von den operativen. Sie entstehen in jeder Datenbank (auch am Hallen-Server, dort bleiben sie
// leer), damit es nur eine Migrationsreihe gibt.
export async function up(knex) {
    await knex.schema.createTable('live_turniere', (t) => {
        t.text('turnier_key').primary();
        t.text('name').notNullable().defaultTo('');
        t.string('datum', 10); // YYYY-MM-DD; Grabsteine haben keins
        t.timestamp('stand', { useTz: true }).notNullable();
        t.bigInteger('sequenz').notNullable();
        t.timestamp('empfangen_am', { useTz: true }).notNullable().defaultTo(knex.fn.now());
        t.boolean('zurueckgezogen').notNullable().defaultTo(false);
        t.jsonb('vereine').notNullable().defaultTo('[]');
        t.jsonb('matten').notNullable().defaultTo('[]');
    });

    await knex.schema.createTable('live_teilnehmer', (t) => {
        t.text('turnier_key').notNullable().references('turnier_key').inTable('live_turniere').onDelete('CASCADE');
        t.text('key').notNullable();
        t.text('vorname').notNullable().defaultTo('');
        t.text('nachname').notNullable().defaultTo('');
        t.text('suche').notNullable().defaultTo('');
        t.text('verein_key').notNullable().defaultTo('');
        t.text('verein').notNullable().defaultTo('');
        t.text('altersklasse').notNullable().defaultTo('');
        t.text('gewichtsklasse').notNullable().defaultTo('');
        t.text('geschlecht').notNullable().defaultTo('');
        t.integer('pool_id');
        t.text('pool_bezeichnung').notNullable().defaultTo('');
        t.integer('matte_id');
        t.text('matte_bezeichnung').notNullable().defaultTo('');
        t.text('zustand').notNullable();
        t.integer('abstand');
        t.integer('naechster_kampf_id');
        t.integer('platz');
        t.primary(['turnier_key', 'key']);
        t.index(['turnier_key', 'verein_key']);
        t.index(['turnier_key', 'pool_id']);
    });

    await knex.schema.createTable('live_kampf_positionen', (t) => {
        t.text('turnier_key').notNullable().references('turnier_key').inTable('live_turniere').onDelete('CASCADE');
        t.integer('kampf_id').notNullable();
        t.integer('matte_id');
        t.text('status').notNullable().defaultTo('');
        t.integer('position').notNullable();
        t.text('teilnehmer_key_1');
        t.text('teilnehmer_key_2');
        t.primary(['turnier_key', 'kampf_id']);
    });

    await knex.schema.createTable('live_ingest_tokens', (t) => {
        t.increments('id');
        t.text('name').notNullable().defaultTo('');
        t.text('token_hash').notNullable().unique();
        t.text('turnier_key'); // gesetzt = Token gilt nur für dieses Turnier
        t.timestamp('erzeugt_am', { useTz: true }).notNullable().defaultTo(knex.fn.now());
        t.timestamp('gesperrt_am', { useTz: true });
        t.timestamp('zuletzt_genutzt', { useTz: true });
    });
}

export async function down(knex) {
    await knex.schema.dropTableIfExists('live_ingest_tokens');
    await knex.schema.dropTableIfExists('live_kampf_positionen');
    await knex.schema.dropTableIfExists('live_teilnehmer');
    await knex.schema.dropTableIfExists('live_turniere');
}
