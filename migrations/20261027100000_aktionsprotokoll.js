export const config = { transaction: false };

// Aktionsprotokoll (siehe src/services/aktionsProtokoll.js): wer hat wann was getan. Name, E-Mail, Rolle und Vereinsname stehen als
// Momentaufnahme im Eintrag (ohne Fremdschlüssel), damit das Protokoll gelöschte Konten und Vereine überlebt.
export async function up(knex) {
    await knex.schema.createTable('aktionsprotokoll', (table) => {
        table.bigIncrements('id').primary();
        table.timestamp('zeitpunkt').notNullable().defaultTo(knex.fn.now());
        table.string('benutzer_id').nullable();
        table.string('benutzer_name').nullable();
        table.string('benutzer_email').nullable();
        table.string('rolle').nullable(); // super_admin | admin | benutzer | helfer
        table.integer('verein_id').nullable();
        table.string('verein_name').nullable();
        table.integer('turnier_id').nullable();
        table.string('aktion').notNullable(); // maschinenlesbar, z. B. turnier.anlegen
        table.text('beschreibung').notNullable(); // Klartext für die Anzeige
        table.string('methode', 10).nullable();
        table.string('pfad', 300).nullable(); // Route mit :id statt konkreter IDs
        table.integer('status').nullable();
        table.string('ip', 64).nullable(); // nur bei Anmeldeereignissen
        table.jsonb('details').notNullable().defaultTo('{}');
        table.index('zeitpunkt');
        table.index(['verein_id', 'zeitpunkt']);
        table.index(['benutzer_id', 'zeitpunkt']);
    });
}

export async function down(knex) {
    await knex.schema.dropTableIfExists('aktionsprotokoll');
}
