export const config = { transaction: false };

// Zugangscode der Teilnehmer-App je Turnier (src/liveCloud/zugang.js): die App-Daten gibt es nur mit dem Code aus dem ausgehängten QR-Code.
// turnier_key ohne Fremdschlüssel: der Code kann schon vor dem ersten Snapshot des Turniers erzeugt werden. Der Code liegt im Klartext, damit der
// Aushang später erneut gedruckt werden kann; er schützt nur lesbare Live-Daten eines Turniers und gilt bis zum Ende des Turniertags.
export async function up(knex) {
    await knex.schema.createTable('live_zugang', (table) => {
        table.text('turnier_key').primary();
        table.text('code').notNullable().unique();
        table.timestamp('erzeugt_am', { useTz: true }).notNullable().defaultTo(knex.fn.now());
        table.timestamp('gesperrt_am', { useTz: true }).nullable();
        table.timestamp('gueltig_bis', { useTz: true }).nullable(); // Ausnahme vom automatischen Ende am Turniertag
    });
}

export async function down(knex) {
    await knex.schema.dropTableIfExists('live_zugang');
}
