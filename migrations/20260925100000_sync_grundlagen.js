// Grundlagen für die Synchronisierung mit der Dokument-DB (CouchDB-Umbau, siehe
// docs/superpowers/specs/2026-09-25-couchdb-umbau-design.md):
//  - turniere.instanz_id: Kennung der Turnier-Instanz auf dem Hallen-Server. Die Dokument-DB heißt
//    turnier_<instanz_id>; bei jedem neu angelegten/eingelesenen Turnier entsteht eine neue
//    Kennung, damit Clients mit altem Stand nie in die neue DB zurückreplizieren.
//  - turnier_teilnehmer.dokument_id: ordnet eine offline an der Waage angelegte Nachmeldung
//    (Dokument teilnehmer:u-<uuid>) ihrer später von der Brücke angelegten SQL-Zeile zu.
//  - sync_angewendet: welche Dokument-Revisionen die Brücke bereits verarbeitet hat.
export async function up(knex) {
    await knex.schema.alterTable('turniere', (table) => {
        table.string('instanz_id', 64).nullable();
    });
    await knex.schema.alterTable('turnier_teilnehmer', (table) => {
        table.string('dokument_id', 128).nullable();
    });
    await knex.schema.createTable('sync_angewendet', (table) => {
        table.string('doc_id', 128).notNullable();
        table.string('rev', 64).notNullable();
        table.timestamp('angewendet_am').defaultTo(knex.fn.now());
        table.primary(['doc_id', 'rev']);
    });
}

export async function down(knex) {
    await knex.schema.dropTableIfExists('sync_angewendet');
    await knex.schema.alterTable('turnier_teilnehmer', (table) => {
        table.dropColumn('dokument_id');
    });
    await knex.schema.alterTable('turniere', (table) => {
        table.dropColumn('instanz_id');
    });
}
