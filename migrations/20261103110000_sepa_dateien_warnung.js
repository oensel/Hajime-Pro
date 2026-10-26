// Startgeld-Lastschrift (Stufe 3): Hinweise zu einer erzeugten SEPA-Datei (später als angekündigt eingezogen,
// nicht enthaltene Rechnungen). Nur Rechnungsnummern, Vereine und Daten, nie Kontodaten. Der Download-Header
// trägt nur eine gekürzte Fassung, die vollständige steht hier und in GET /api/abrechnung/:turnierId/sepa.
export async function up(knex) {
    await knex.schema.alterTable('sepa_dateien', (table) => {
        table.text('warnung').nullable();
    });
}

export async function down(knex) {
    await knex.schema.alterTable('sepa_dateien', (table) => {
        table.dropColumn('warnung');
    });
}
