export const config = { transaction: false };

export async function up(knex) {
    await knex.schema.alterTable('turnier_teilnehmer', (table) => {
        // Markiert Athlet:innen, die über den Import mit Ziel "Mannschaft" angelegt wurden (siehe
        // teilnehmerController.js: importTeilnehmer) — steuert nur die Anzeige ("... Team") in
        // teilnehmer.html, der Judoka bleibt technisch ein ganz normaler turnier_teilnehmer.
        table.boolean('fuer_mannschaft').notNullable().defaultTo(false);
    });
}

export async function down(knex) {
    await knex.schema.alterTable('turnier_teilnehmer', (table) => {
        table.dropColumn('fuer_mannschaft');
    });
}
