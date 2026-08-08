export const config = { transaction: false };

// Tagesgenaues Geburtsdatum wird nirgends benötigt — Altersklassen basieren ausschließlich auf dem
// Jahrgang (siehe ermittleAltersklasse in teilnehmerController.js, das ohnehin nur die ersten vier
// Zeichen auswertet). Ersetzt die bisherige DATE-Spalte durch eine einfache Jahreszahl. Die
// Jahres-Extraktion läuft in JS statt per Raw-SQL, damit sie auf SQLite (Offline) und Postgres
// (Online) identisch funktioniert.
export async function up(knex) {
    await knex.schema.alterTable('turnier_teilnehmer', (table) => {
        table.integer('geburtsjahr');
    });

    const zeilen = await knex('turnier_teilnehmer').select('id', 'geburtsdatum');
    for (const zeile of zeilen) {
        const jahr = parseInt(String(zeile.geburtsdatum).slice(0, 4), 10);
        await knex('turnier_teilnehmer').where({ id: zeile.id }).update({ geburtsjahr: jahr });
    }

    await knex.schema.alterTable('turnier_teilnehmer', (table) => {
        table.integer('geburtsjahr').notNullable().alter();
        table.dropColumn('geburtsdatum');
    });
}

export async function down(knex) {
    await knex.schema.alterTable('turnier_teilnehmer', (table) => {
        table.date('geburtsdatum');
    });

    const zeilen = await knex('turnier_teilnehmer').select('id', 'geburtsjahr');
    for (const zeile of zeilen) {
        await knex('turnier_teilnehmer').where({ id: zeile.id }).update({ geburtsdatum: `${zeile.geburtsjahr}-01-01` });
    }

    await knex.schema.alterTable('turnier_teilnehmer', (table) => {
        table.date('geburtsdatum').notNullable().alter();
        table.dropColumn('geburtsjahr');
    });
}
