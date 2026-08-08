// Ordnet einen vorhandenen turnier_teilnehmer einer Gewichtsklassen-Position der Mannschaft
// zu. Der Judoka bleibt ein ganz normaler turnier_teilnehmer (Waage/QR-Scan/Judopass laufen
// unverändert über die bestehende Einzelwettkampf-Infrastruktur). Mehrere Mitglieder pro
// Gewichtsklasse sind erlaubt (Ersatzkämpfer) — welcher davon in einer konkreten Begegnung
// tatsächlich kämpft, ergibt sich aus dem jeweiligen kaempfe-Eintrag dieser Begegnung.
export async function up(knex) {
    await knex.schema.createTable('mannschaft_mitglieder', (table) => {
        table.increments('id').primary();
        table.integer('mannschaft_id').unsigned().notNullable()
            .references('id').inTable('mannschaften').onDelete('CASCADE');
        table.integer('turnier_teilnehmer_id').unsigned().notNullable()
            .references('id').inTable('turnier_teilnehmer').onDelete('CASCADE');
        table.string('gewichtsklasse').notNullable();
        table.timestamps(true, true);
        table.index('mannschaft_id', 'idx_mannschaft_mitglieder_mannschaft_id');
    });
}

export async function down(knex) {
    await knex.schema.dropTableIfExists('mannschaft_mitglieder');
}
