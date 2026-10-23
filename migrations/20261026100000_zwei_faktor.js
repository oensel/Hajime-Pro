export const config = { transaction: false };

// Zwei-Faktor-Anmeldung (TOTP) für Super-Admins, siehe src/services/zweiFaktor.js: das Geheimnis liegt verschlüsselt am
// Konto, aktiv ist es erst mit totp_aktiv_am; totp_letzter_schritt verhindert, dass ein Code zweimal gilt.
// Backup-Codes stehen nur als SHA-256 in totp_backup_codes (je Code einmal benutzbar).
export async function up(knex) {
    await knex.schema.alterTable('benutzer', (table) => {
        table.text('totp_secret').nullable();
        table.timestamp('totp_aktiv_am').nullable();
        table.bigInteger('totp_letzter_schritt').nullable();
    });
    await knex.schema.createTable('totp_backup_codes', (table) => {
        table.increments('id').primary();
        table.string('benutzer_id').notNullable().references('id').inTable('benutzer').onDelete('CASCADE');
        table.string('code_hash', 64).notNullable().unique();
        table.timestamp('benutzt_am').nullable();
        table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
        table.index('benutzer_id');
    });
}

export async function down(knex) {
    await knex.schema.dropTableIfExists('totp_backup_codes');
    await knex.schema.alterTable('benutzer', (table) => {
        table.dropColumn('totp_letzter_schritt');
        table.dropColumn('totp_aktiv_am');
        table.dropColumn('totp_secret');
    });
}
