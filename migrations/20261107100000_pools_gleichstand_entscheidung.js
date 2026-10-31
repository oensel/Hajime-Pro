// Entscheidung der Turnierleitung über einen Gleichstand, den weder Siege, Wertungspunkte noch der direkte
// Vergleich auflösen (siehe src/shared/gleichstand.js): JSON-Text { pool|A|B: [[Kämpfer-Ids in entschiedener
// Reihenfolge], …] }. NULL = keine Entscheidung. Die Spalte läuft wie alle Pool-Spalten über den Sync mit.
export async function up(knex) {
    await knex.schema.alterTable('pools', (table) => {
        table.text('gleichstand_entscheidung').nullable().defaultTo(null);
    });
}

export async function down(knex) {
    await knex.schema.alterTable('pools', (table) => {
        table.dropColumn('gleichstand_entscheidung');
    });
}
