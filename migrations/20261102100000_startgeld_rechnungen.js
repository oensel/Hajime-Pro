export const config = { transaction: false };

// Startgeld-Rechnungen (Stufe 2):
//  - vereins_abrechnung: Stammdaten des Ausrichters (IBAN nur verschlüsselt)
//  - turniere: Zahlungsziel, Rechnungshinweis, Rückspiel-Merker
//  - turnier_barzahlungen: Journal der am Hallen-Server kassierten Barzahlungen (kommt beim Rückspielen)
//  - rechnungen: Momentaufnahme jeder Rechnung/Quittung (Aufbewahrung, daher SET NULL statt CASCADE)
export async function up(knex) {
    await knex.schema.createTable('vereins_abrechnung', (table) => {
        table.integer('verein_id').unsigned().primary()
            .references('id').inTable('vereine').onDelete('CASCADE');
        table.text('anschrift');
        table.string('rechnung_email');
        table.string('absender_name');
        table.string('steuernummer');
        table.string('ust_id');
        table.text('ust_hinweis');
        table.string('rechnungs_praefix', 12);
        table.integer('naechste_rechnungsnummer').notNullable().defaultTo(1);
        table.string('kontoinhaber');
        table.text('iban_verschluesselt');
        table.string('iban_maske');
        table.string('geaendert_von');
        table.timestamps(true, true);
    });

    await knex.schema.alterTable('turniere', (table) => {
        table.integer('zahlungsziel_tage').notNullable().defaultTo(14);
        table.text('rechnung_hinweis');
        table.timestamp('zurueckgespielt_am', { useTz: true }).nullable();
        table.boolean('rueckspielen_freigegeben').notNullable().defaultTo(false);
    });

    await knex.schema.createTable('turnier_barzahlungen', (table) => {
        table.increments('id').primary();
        table.uuid('uid').notNullable().unique();
        table.integer('turnier_id').unsigned().notNullable()
            .references('id').inTable('turniere').onDelete('CASCADE');
        table.string('verein_name').notNullable();
        table.integer('anzahl').notNullable();
        table.integer('betrag_cent').notNullable();
        table.timestamp('kassiert_am', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    });

    await knex.schema.createTable('rechnungen', (table) => {
        table.increments('id').primary();
        table.integer('turnier_id').unsigned().nullable()
            .references('id').inTable('turniere').onDelete('SET NULL');
        table.integer('aussteller_verein_id').unsigned().nullable()
            .references('id').inTable('vereine').onDelete('SET NULL');
        table.string('verein_name').notNullable();
        table.string('zahlweg').notNullable();
        table.string('art').notNullable();
        table.string('nummer').notNullable();
        table.date('rechnungsdatum').notNullable();
        table.date('leistungsdatum');
        table.date('zahlungsziel_datum').nullable();
        table.integer('anzahl').notNullable();
        table.integer('einzelpreis_cent').notNullable();
        table.integer('betrag_cent').notNullable();
        table.integer('bar_erhalten_cent').notNullable().defaultTo(0);
        table.jsonb('positionen').notNullable();
        table.jsonb('empfaenger').notNullable();
        table.jsonb('aussteller').notNullable();
        table.string('turnier_bezeichnung');
        table.string('verwendungszweck', 140);
        table.text('hinweis');
        table.binary('pdf');
        table.string('status').notNullable().defaultTo('offen');
        table.timestamp('versandt_am', { useTz: true });
        table.text('versand_fehler');
        table.timestamp('bezahlt_am', { useTz: true });
        table.string('bezahlt_von');
        table.string('erstellt_von');
        table.timestamps(true, true);
        table.unique(['aussteller_verein_id', 'nummer']);
    });
    await knex.raw(
        "CREATE UNIQUE INDEX rechnungen_turnier_verein_aktiv ON rechnungen (turnier_id, verein_name) WHERE status <> 'zurueckgebucht'"
    );
}

export async function down(knex) {
    await knex.raw('DROP INDEX IF EXISTS rechnungen_turnier_verein_aktiv');
    await knex.schema.dropTableIfExists('rechnungen');
    await knex.schema.dropTableIfExists('turnier_barzahlungen');
    await knex.schema.alterTable('turniere', (table) => {
        table.dropColumn('rueckspielen_freigegeben');
        table.dropColumn('zurueckgespielt_am');
        table.dropColumn('rechnung_hinweis');
        table.dropColumn('zahlungsziel_tage');
    });
    await knex.schema.dropTableIfExists('vereins_abrechnung');
}
