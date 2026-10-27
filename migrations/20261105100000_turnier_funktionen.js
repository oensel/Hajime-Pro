export const config = { transaction: false };

// Funktionen je Turnier (Urkunden-Druck, Wettkampfpläne drucken, Wer kämpft wo/Dashboard, Teilnehmer-App, Video, Live-Streaming)
// ein-/ausschaltbar; der Assistent in turnier.html setzt sie. Ein fehlender Schlüssel gilt als „an“ (src/shared/turnierFunktionen.js),
// bestehende Turniere zeigen also weiter alles. Orga-Planer und Helfer-App bleiben in turniere.planungs_tools.
export async function up(knex) {
    await knex.schema.alterTable('turniere', (table) => {
        table.jsonb('funktionen').notNullable().defaultTo('{}');
    });
}

export async function down(knex) {
    await knex.schema.alterTable('turniere', (table) => {
        table.dropColumn('funktionen');
    });
}
