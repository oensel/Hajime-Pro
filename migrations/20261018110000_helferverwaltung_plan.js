export const config = { transaction: false };

// Helferverwaltung, Teil 2: Turnierfelder für den Zeitrahmen und die Tabellen des Helferplans
// (Tätigkeiten, Zeit-Slots, Einsätze).
export async function up(knex) {
    await knex.schema.alterTable('turniere', (table) => {
        table.integer('beginn_min').nullable();
        table.integer('ende_min').nullable();
        table.integer('waagen_anzahl').notNullable().defaultTo(1);
    });

    await knex.schema.createTable('helfer_taetigkeiten', (table) => {
        table.increments('id').primary();
        table.integer('turnier_id').unsigned().notNullable()
            .references('id').inTable('turniere').onDelete('CASCADE');
        table.string('art').notNullable(); // 'matte' | 'waage' | 'frei'
        table.integer('kampfflaeche_id').unsigned().nullable()
            .references('id').inTable('kampfflaechen').onDelete('SET NULL');
        table.string('bezeichnung').notNullable();
        table.integer('bedarf').notNullable();
        table.integer('reihenfolge').notNullable().defaultTo(0);
    });

    await knex.schema.createTable('helfer_slots', (table) => {
        table.increments('id').primary();
        table.integer('taetigkeit_id').unsigned().notNullable()
            .references('id').inTable('helfer_taetigkeiten').onDelete('CASCADE');
        table.integer('von_min').notNullable();
        table.integer('bis_min').notNullable();
        table.integer('bedarf').notNullable();
    });

    await knex.schema.createTable('helfer_einsaetze', (table) => {
        table.increments('id').primary();
        table.integer('slot_id').unsigned().notNullable()
            .references('id').inTable('helfer_slots').onDelete('CASCADE');
        table.string('benutzer_id').nullable()
            .references('id').inTable('benutzer').onDelete('CASCADE');
        table.string('name_manuell').nullable();
        table.string('eingetragen_von').nullable();
        table.timestamp('eingetragen_am').notNullable().defaultTo(knex.fn.now());
        table.unique(['slot_id', 'benutzer_id'], { indexName: 'uq_helfer_einsaetze_slot_benutzer' });
    });
}

export async function down(knex) {
    await knex.schema.dropTableIfExists('helfer_einsaetze');
    await knex.schema.dropTableIfExists('helfer_slots');
    await knex.schema.dropTableIfExists('helfer_taetigkeiten');
    await knex.schema.alterTable('turniere', (table) => {
        table.dropColumn('waagen_anzahl');
        table.dropColumn('ende_min');
        table.dropColumn('beginn_min');
    });
}
