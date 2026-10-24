export const config = { transaction: false };

// Startgeld-Zahlweg (Stufe 1):
//  - turnier_zahlwege: gewählter Zahlweg und Rechnungsdaten je Verein und Turnier (Schlüssel: Vereinsname)
//  - turnier_teilnehmer.startgeld_zahlweg_gesichert: Zahlweg des Vereins sichert das Startgeld
//  - turniere.abrechnungsbasis / angebotene_zahlwege: Einstellungen des Ausrichters
export async function up(knex) {
    await knex.schema.createTable('turnier_zahlwege', (table) => {
        table.increments('id').primary();
        table.integer('turnier_id').unsigned().notNullable()
            .references('id').inTable('turniere').onDelete('CASCADE');
        table.integer('verein_id').unsigned().nullable()
            .references('id').inTable('vereine').onDelete('SET NULL');
        table.string('verein_name').notNullable();
        table.string('zahlweg').notNullable();
        table.text('rechnung_email');
        table.text('rechnung_ansprechperson');
        table.text('rechnung_anschrift');
        table.string('geaendert_von');
        table.timestamps(true, true);
        table.unique(['turnier_id', 'verein_name']);
    });
    await knex.schema.alterTable('turnier_teilnehmer', (table) => {
        table.boolean('startgeld_zahlweg_gesichert').notNullable().defaultTo(false);
    });
    await knex.schema.alterTable('turniere', (table) => {
        table.string('abrechnungsbasis').notNullable().defaultTo('gemeldet');
        table.string('angebotene_zahlwege').notNullable().defaultTo('ueberweisung,bar');
    });
}

export async function down(knex) {
    await knex.schema.alterTable('turniere', (table) => {
        table.dropColumn('angebotene_zahlwege');
        table.dropColumn('abrechnungsbasis');
    });
    await knex.schema.alterTable('turnier_teilnehmer', (table) => {
        table.dropColumn('startgeld_zahlweg_gesichert');
    });
    await knex.schema.dropTableIfExists('turnier_zahlwege');
}
