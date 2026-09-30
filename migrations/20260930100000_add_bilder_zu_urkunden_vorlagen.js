// Bilder der Urkunden-Vorlagen (z. B. Vereinslogos): JSON { <bild_id>: { typ, daten (Base64) } },
// referenziert von Feldern { typ: 'bild', bild_id, x, y, breite, hoehe }.
export async function up(knex) {
    await knex.schema.alterTable('urkunden_vorlagen', (table) => {
        table.text('bilder').notNullable().defaultTo('{}');
    });
}

export async function down(knex) {
    await knex.schema.alterTable('urkunden_vorlagen', (table) => {
        table.dropColumn('bilder');
    });
}
