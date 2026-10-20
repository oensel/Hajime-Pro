export const config = { transaction: false };

// Orga-Planer: Checkliste je Turnier (Aufgaben/Posten/Mitbringliste), Einladungen für Externe
// und der Tag-Versatz der Helferplan-Tätigkeiten (0 = Turniertag, -1 = Vortag).
export async function up(knex) {
    await knex.schema.createTable('orga_aufgaben', (table) => {
        table.increments('id').primary();
        table.integer('turnier_id').unsigned().notNullable()
            .references('id').inTable('turniere').onDelete('CASCADE');
        table.integer('eltern_id').unsigned().nullable()
            .references('id').inTable('orga_aufgaben').onDelete('CASCADE');
        table.string('phase').notNullable(); // grundlage | vorbereitung | meldephase | turniertag | nachbereitung
        table.string('art').notNullable().defaultTo('aufgabe'); // aufgabe | posten | mitbringen
        table.string('titel', 255).notNullable();
        table.text('notiz').nullable();
        table.integer('menge').nullable();
        table.integer('reihenfolge').notNullable().defaultTo(0);
        table.string('frist_anker').nullable(); // turnier | anmeldeschluss
        table.integer('frist_tage').nullable();
        table.date('faellig_am').nullable();
        table.boolean('faellig_manuell').notNullable().defaultTo(false);
        table.string('auto_art').nullable(); // helferplan_gesamt | helferplan_taetigkeit
        table.string('auto_ref').nullable();
        table.string('link').nullable();
        table.string('vorlage_key').nullable();
        table.string('benutzer_id').nullable()
            .references('id').inTable('benutzer').onDelete('SET NULL');
        table.string('name_frei').nullable();
        table.string('email_frei').nullable();
        table.timestamp('erledigt_am').nullable();
        table.string('erledigt_von').nullable();
        table.date('erinnert_fuer').nullable();
        table.string('erstellt_von').nullable();
        table.timestamp('erstellt_am').notNullable().defaultTo(knex.fn.now());
        table.index(['turnier_id'], 'idx_orga_aufgaben_turnier');
        table.index(['eltern_id'], 'idx_orga_aufgaben_eltern');
        table.index(['benutzer_id'], 'idx_orga_aufgaben_benutzer');
        table.index(['email_frei'], 'idx_orga_aufgaben_email_frei');
    });

    await knex.schema.createTable('orga_einladungen', (table) => {
        table.increments('id').primary();
        table.string('token_hash').notNullable().unique(); // SHA-256
        table.string('email').notNullable();
        table.string('name').nullable();
        table.integer('verein_id').unsigned().notNullable()
            .references('id').inTable('vereine').onDelete('CASCADE');
        table.timestamp('laeuft_ab_am').notNullable();
        table.timestamp('benutzt_am').nullable();
        table.timestamp('erstellt_am').notNullable().defaultTo(knex.fn.now());
    });

    await knex.schema.alterTable('helfer_taetigkeiten', (table) => {
        table.smallint('tag_versatz').notNullable().defaultTo(0);
    });
}

export async function down(knex) {
    await knex.schema.alterTable('helfer_taetigkeiten', (table) => {
        table.dropColumn('tag_versatz');
    });
    await knex.schema.dropTableIfExists('orga_einladungen');
    await knex.schema.dropTableIfExists('orga_aufgaben');
}
