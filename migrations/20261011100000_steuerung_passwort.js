// Vom Nutzer geändertes Turnierleitungs-Passwort (Schreibzugriff): eine Zeile (id = 1). Solange sie
// fehlt, gilt das Start-Passwort aus STEUERUNG_PASSWORD (.env) und muss bei der ersten Anmeldung
// geändert werden. Die Tabelle liegt in der relationalen DB, wird im Cluster also auf den Standby
// repliziert. `passwort_sha256` speist das Konfig-Dokument der Client-Geräte (Offline-Prüfung).
export async function up(knex) {
    if (await knex.schema.hasTable('steuerung_passwort')) return;
    await knex.schema.createTable('steuerung_passwort', (table) => {
        table.integer('id').primary();
        table.text('passwort_hash').notNullable();
        table.string('passwort_sha256', 64).notNullable();
        table.timestamp('geaendert_am').notNullable().defaultTo(knex.fn.now());
    });
}

export async function down(knex) {
    await knex.schema.dropTableIfExists('steuerung_passwort');
}
