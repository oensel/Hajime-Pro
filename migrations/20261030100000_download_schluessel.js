export const config = { transaction: false };

// Downloads über die Cloud (src/services/releaseSchluessel.js, Spec docs/specs/2026-10-24-downloads-ueber-cloud-design.md):
//  - download_schluessel: Geräteschlüssel eines Hallen-Servers für Updates; nur der SHA-256, gebunden an das Konto, das ihn ausgelöst hat
//  - download_einloesecodes: Einmalcodes im Dateinamen des Installers, die ein frisch installierter Server gegen einen Geräteschlüssel tauscht
export async function up(knex) {
    await knex.schema.createTable('download_schluessel', (table) => {
        table.increments('id');
        table.text('benutzer_id').notNullable().references('id').inTable('benutzer').onDelete('CASCADE');
        table.text('bezeichnung').notNullable().defaultTo('');
        table.text('schluessel_hash').notNullable().unique();
        table.timestamp('erstellt_am', { useTz: true }).notNullable().defaultTo(knex.fn.now());
        table.timestamp('zuletzt_benutzt_am', { useTz: true }).nullable();
        table.timestamp('widerrufen_am', { useTz: true }).nullable();
        table.index(['benutzer_id']);
    });
    await knex.schema.createTable('download_einloesecodes', (table) => {
        table.increments('id');
        table.text('benutzer_id').notNullable().references('id').inTable('benutzer').onDelete('CASCADE');
        table.text('code_hash').notNullable().unique();
        table.timestamp('erstellt_am', { useTz: true }).notNullable().defaultTo(knex.fn.now());
        table.timestamp('laeuft_ab_am', { useTz: true }).notNullable();
        table.timestamp('benutzt_am', { useTz: true }).nullable();
    });
}

export async function down(knex) {
    await knex.schema.dropTableIfExists('download_einloesecodes');
    await knex.schema.dropTableIfExists('download_schluessel');
}
