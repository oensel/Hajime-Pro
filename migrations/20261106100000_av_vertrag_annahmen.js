export const config = { transaction: false };

// Annahme des Vertrags zur Auftragsverarbeitung (Art. 28 DSGVO) durch einen Verein, nur Cloud (src/services/avVertrag.js).
// Je Annahme bleibt der angenommene Text als Nachweis erhalten (`text_html` samt SHA-256), dazu wer ihn wann für den Verein
// angenommen hat. Kein UNIQUE auf (verein_id, fassung): beim Zusammenführen von Vereinen wandern die Zeilen zum Ziel.
export async function up(knex) {
    await knex.schema.createTable('av_vertrag_annahmen', (table) => {
        table.increments('id');
        table.integer('verein_id').notNullable().references('id').inTable('vereine').onDelete('CASCADE');
        table.text('fassung').notNullable();
        table.text('benutzer_id').nullable().references('id').inTable('benutzer').onDelete('SET NULL');
        table.text('name').notNullable(); // Name der annehmenden Person, wie eingegeben
        table.text('funktion').notNullable(); // z. B. „1. Vorsitzende“
        table.text('email').notNullable().defaultTo(''); // E-Mail-Adresse des Kontos zum Zeitpunkt der Annahme
        table.text('verein_name').notNullable(); // Vereinsname zum Zeitpunkt der Annahme
        table.text('text_html').notNullable();
        table.text('text_sha256').notNullable();
        table.timestamp('angenommen_am', { useTz: true }).notNullable().defaultTo(knex.fn.now());
        table.index(['verein_id', 'fassung']);
    });
}

export async function down(knex) {
    await knex.schema.dropTableIfExists('av_vertrag_annahmen');
}
