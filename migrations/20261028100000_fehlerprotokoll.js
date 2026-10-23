export const config = { transaction: false };

// Fehlerprotokoll („Konsole“ für Super-Admins, siehe src/services/fehlerProtokoll.js): console.error/-warn des Servers, abgestürzte Prozesse,
// Express-Fehler und Fehler aus dem Browser. Die Meldungen sind auf Zugangsdaten geprüft (Bearer-/JWT-Muster werden geschwärzt).
export async function up(knex) {
    await knex.schema.createTable('fehlerprotokoll', (table) => {
        table.bigIncrements('id').primary();
        table.timestamp('zeitpunkt').notNullable().defaultTo(knex.fn.now());
        table.string('ebene', 10).notNullable(); // error | warn
        table.string('quelle', 12).notNullable(); // server | prozess | browser
        table.string('meldung', 500).notNullable(); // erste Zeile
        table.text('details').nullable(); // vollständige Meldung samt Stack
        table.string('pfad', 300).nullable(); // Anfrage bzw. Seite
        table.string('benutzer').nullable(); // E-Mail, nur bei Browser-Meldungen angemeldeter Konten
        table.index('zeitpunkt');
        table.index(['ebene', 'zeitpunkt']);
    });
}

export async function down(knex) {
    await knex.schema.dropTableIfExists('fehlerprotokoll');
}
