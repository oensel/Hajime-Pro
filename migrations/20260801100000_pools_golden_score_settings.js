// Golden Score ist bisher nur eine Laufzeit-Einstellung auf steuerung.html (gsLimitInput),
// die das Kampfgericht bei Bedarf manuell setzt. Manche Wettkampfklassen (z.B. sehr junge
// Altersklassen) sollen aber grundsätzlich keinen Golden Score anbieten, sondern bei
// Gleichstand direkt zur Kampfrichter-Entscheidung (Hantei) übergehen — das muss pro Pool
// vorab in pools.html festgelegt werden können, nicht erst am Tisch.
// golden_score_max_sekunden = NULL bedeutet "unbegrenzt" (Golden Score läuft nach den
// aktuellen IJF-Regeln ohne Zeitlimit bis zur ersten Wertung), analog zum bisherigen
// Verhalten von maxGsSeconds <= 0 in scoreboard.js.
export async function up(knex) {
    await knex.schema.alterTable('pools', (table) => {
        table.boolean('golden_score_aktiv').notNullable().defaultTo(true);
        table.integer('golden_score_max_sekunden').nullable().defaultTo(null);
    });
}

export async function down(knex) {
    await knex.schema.alterTable('pools', (table) => {
        table.dropColumn('golden_score_aktiv');
        table.dropColumn('golden_score_max_sekunden');
    });
}
