// Startgeld-Lastschrift: Zusatztext des Ausrichters für das Lastschriftmandat (unter dem festen Mandatstext).
// Gilt nur für neu erteilte Mandate; bestehende Mandate behalten den bei der Erteilung gespeicherten Wortlaut.
export async function up(knex) {
    await knex.schema.alterTable('vereins_abrechnung', (table) => {
        table.text('mandat_zusatztext').nullable();
    });
}

export async function down(knex) {
    await knex.schema.alterTable('vereins_abrechnung', (table) => {
        table.dropColumn('mandat_zusatztext');
    });
}
