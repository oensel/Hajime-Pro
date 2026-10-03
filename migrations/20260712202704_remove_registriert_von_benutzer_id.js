export const config = { transaction: false };

// Löst turnier_teilnehmer vollständig von benutzer — wer einen Athleten angelegt hat,
// ist für den Betrieb der Software nicht relevant und wurde ohnehin nirgends angezeigt.
export async function up(knex) {
    await knex.schema.alterTable('turnier_teilnehmer', (table) => {
        table.dropColumn('registriert_von_benutzer_id');
    });
}

export async function down(knex) {
    await knex.schema.alterTable('turnier_teilnehmer', (table) => {
        table.string('registriert_von_benutzer_id').nullable()
            .references('id').inTable('benutzer').onDelete('SET NULL');
    });
}
