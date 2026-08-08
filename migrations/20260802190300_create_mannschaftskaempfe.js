// Eine Begegnung (Team A vs. Team B) innerhalb eines Mannschafts-Pools. Bewusst strukturell
// parallel zu kaempfe gehalten (gleiche Status-Werte, gleiches Quelle-Verknüpfungsmuster für
// die Bracket-Kaskade) — siehe src/shared/mannschaftsProgression.js und
// src/shared/bracketTopologie.js::verknuepfeQuellenFuerMannschaftsPool. Die einzelnen
// Gewichtsklassen-Duelle einer Begegnung sind ganz normale kaempfe-Zeilen mit gesetztem
// mannschaftskampf_id (siehe Folgemigration) — nur der Begegnungs-Ausgang selbst (wer hat
// mehr Siege) lebt hier.
export async function up(knex) {
    await knex.schema.createTable('mannschaftskaempfe', (table) => {
        table.increments('id').primary();
        table.integer('pool_id').unsigned().notNullable()
            .references('id').inTable('pools').onDelete('CASCADE');
        table.integer('mannschaft1_id').unsigned().nullable()
            .references('id').inTable('mannschaften').onDelete('RESTRICT');
        table.integer('mannschaft2_id').unsigned().nullable()
            .references('id').inTable('mannschaften').onDelete('RESTRICT');
        table.integer('sieger_mannschaft_id').unsigned().nullable()
            .references('id').inTable('mannschaften').onDelete('SET NULL');
        table.string('status').notNullable().defaultTo('angelegt');
        table.string('reihenfolge_nummer').nullable();
        table.integer('matten_reihenfolge').nullable();
        table.integer('mannschaft1_quelle_kampf_id').unsigned().nullable()
            .references('id').inTable('mannschaftskaempfe').onDelete('SET NULL');
        table.string('mannschaft1_quelle_typ').nullable(); // 'sieger' | 'verlierer'
        table.integer('mannschaft2_quelle_kampf_id').unsigned().nullable()
            .references('id').inTable('mannschaftskaempfe').onDelete('SET NULL');
        table.string('mannschaft2_quelle_typ').nullable();
        table.integer('siegpunkte_mannschaft1').notNullable().defaultTo(0);
        table.integer('siegpunkte_mannschaft2').notNullable().defaultTo(0);
        table.integer('wertungspunkte_mannschaft1').notNullable().defaultTo(0);
        table.integer('wertungspunkte_mannschaft2').notNullable().defaultTo(0);
        table.string('stichkampf_gewichtsklasse').nullable();
        table.timestamps(true, true);
        table.index('pool_id', 'idx_mannschaftskaempfe_pool_id');
        table.index('status', 'idx_mannschaftskaempfe_status');
        table.check('mannschaft1_id <> mannschaft2_id', [], 'check_verschiedene_mannschaften');
        table.check(
            'sieger_mannschaft_id IS NULL OR sieger_mannschaft_id IN (mannschaft1_id, mannschaft2_id)',
            [],
            'check_sieger_ist_mannschaft'
        );
    });
}

export async function down(knex) {
    await knex.schema.dropTableIfExists('mannschaftskaempfe');
}
