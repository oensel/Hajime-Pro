export const config = { transaction: false };

// Startgeld-Lastschrift (Stufe 3):
//  - vereins_abrechnung.glaeubiger_id: SEPA-Gläubiger-ID des Ausrichters
//  - turniere.vorabankuendigung_tage: Frist zwischen Rechnung (= Vorabankündigung) und Einzug
//  - turnier_zahlwege.mandat_gueltig: Lastschrift sichert das Startgeld erst mit bestätigtem Mandat
//  - lastschrift_mandate: Einmal-Mandate (IBAN und Kontoinhaber nur verschlüsselt, Aufbewahrung -> SET NULL)
//  - token_einmal.bezug: Verweis des Einmal-Tokens (hier: Mandat-ID bei Zweck 'mandat')
//  - sepa_dateien: Kopfdaten erzeugter pain.008-Dateien (kein Inhalt, der enthält Klar-IBANs)
//  - rechnungen: Mandats- und Einzugsangaben
export async function up(knex) {
    await knex.schema.alterTable('vereins_abrechnung', (table) => {
        table.string('glaeubiger_id', 35).nullable();
    });
    await knex.schema.alterTable('turniere', (table) => {
        table.integer('vorabankuendigung_tage').notNullable().defaultTo(5);
    });
    await knex.schema.alterTable('turnier_zahlwege', (table) => {
        table.boolean('mandat_gueltig').notNullable().defaultTo(false);
    });

    await knex.schema.createTable('lastschrift_mandate', (table) => {
        table.increments('id').primary();
        table.integer('turnier_id').unsigned().nullable()
            .references('id').inTable('turniere').onDelete('SET NULL');
        table.string('turnier_bezeichnung');
        table.integer('zahlweg_id').unsigned().nullable()
            .references('id').inTable('turnier_zahlwege').onDelete('SET NULL');
        table.string('verein_name').notNullable();
        table.integer('zahlender_verein_id').unsigned().nullable()
            .references('id').inTable('vereine').onDelete('SET NULL');
        table.string('mandatsreferenz', 35).notNullable().unique();
        table.text('daten_verschluesselt').nullable();
        table.string('iban_maske');
        table.text('mandatstext').notNullable();
        table.string('textversion').notNullable();
        table.string('glaeubiger_id').notNullable();
        table.string('glaeubiger_name').notNullable();
        table.string('status').notNullable();
        table.timestamp('erteilt_am', { useTz: true }).notNullable();
        table.string('erteilt_von').notNullable();
        table.boolean('vertretung_bestaetigt').notNullable();
        table.timestamp('bestaetigt_am', { useTz: true });
        table.string('bestaetigt_von');
        table.timestamp('entschieden_am', { useTz: true });
        table.timestamp('erinnert_am', { useTz: true });
        table.date('letzter_einzug_am');
        table.date('loeschen_ab');
        table.timestamps(true, true);
    });
    // Je Turnier und Verein höchstens ein offenes oder gültiges Mandat.
    await knex.raw(
        "CREATE UNIQUE INDEX lastschrift_mandate_aktiv ON lastschrift_mandate (turnier_id, verein_name) WHERE status IN ('unbestaetigt','gueltig')"
    );

    await knex.schema.alterTable('token_einmal', (table) => {
        table.string('bezug').nullable();
    });

    await knex.schema.createTable('sepa_dateien', (table) => {
        table.increments('id').primary();
        table.integer('turnier_id').unsigned().nullable()
            .references('id').inTable('turniere').onDelete('SET NULL');
        table.string('msg_id', 35).unique();
        table.timestamp('erzeugt_am', { useTz: true }).defaultTo(knex.fn.now());
        table.string('erzeugt_von');
        table.date('faelligkeit');
        table.integer('anzahl');
        table.integer('summe_cent');
    });

    await knex.schema.alterTable('rechnungen', (table) => {
        table.integer('mandat_id').unsigned().nullable()
            .references('id').inTable('lastschrift_mandate').onDelete('SET NULL');
        table.string('mandatsreferenz', 35);
        table.date('mandat_datum');
        table.string('iban_maske_zahler');
        table.date('einzug_am');
        table.integer('sepa_datei_id').unsigned().nullable()
            .references('id').inTable('sepa_dateien').onDelete('SET NULL');
        table.timestamp('zurueckgebucht_am', { useTz: true });
    });
}

export async function down(knex) {
    await knex.schema.alterTable('rechnungen', (table) => {
        table.dropColumn('zurueckgebucht_am');
        table.dropColumn('sepa_datei_id');
        table.dropColumn('einzug_am');
        table.dropColumn('iban_maske_zahler');
        table.dropColumn('mandat_datum');
        table.dropColumn('mandatsreferenz');
        table.dropColumn('mandat_id');
    });
    await knex.schema.dropTableIfExists('sepa_dateien');
    await knex.schema.alterTable('token_einmal', (table) => {
        table.dropColumn('bezug');
    });
    await knex.raw('DROP INDEX IF EXISTS lastschrift_mandate_aktiv');
    await knex.schema.dropTableIfExists('lastschrift_mandate');
    await knex.schema.alterTable('turnier_zahlwege', (table) => {
        table.dropColumn('mandat_gueltig');
    });
    await knex.schema.alterTable('turniere', (table) => {
        table.dropColumn('vorabankuendigung_tage');
    });
    await knex.schema.alterTable('vereins_abrechnung', (table) => {
        table.dropColumn('glaeubiger_id');
    });
}
