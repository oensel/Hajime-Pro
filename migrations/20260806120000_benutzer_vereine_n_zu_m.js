export const config = { transaction: false };

// Löst die 1:1-Beschränkung benutzer.verein_id/verein_freigegeben auf: ein Benutzer kann
// künftig mehreren Vereinen angehören (z.B. Trainer, die für zwei Vereine melden). Jede
// Mitgliedschaft hat ihren eigenen Freigabe-Status (analog zum bisherigen
// verein_freigegeben), zusätzlich merkt sich benutzer.aktiver_verein_id, welcher Verein
// gerade in der App-Oberfläche (Kopfleiste) ausgewählt ist. Anonyme Anmeldungen sind nicht
// vorgesehen — ein Benutzer ist immer mindestens einem Verein zugeordnet.
export async function up(knex) {
    await knex.schema.createTable('benutzer_vereine', (table) => {
        table.increments('id').primary();
        table.string('benutzer_id').notNullable()
            .references('id').inTable('benutzer').onDelete('CASCADE');
        table.integer('verein_id').unsigned().notNullable()
            .references('id').inTable('vereine').onDelete('CASCADE');
        table.integer('freigegeben').defaultTo(0);
        table.timestamps(true, true);
        table.unique(['benutzer_id', 'verein_id'], { indexName: 'uq_benutzer_vereine_kein_doppel' });
    });

    await knex.schema.alterTable('benutzer', (table) => {
        table.integer('aktiver_verein_id').unsigned().nullable()
            .references('id').inTable('vereine').onDelete('SET NULL');
    });

    // Bestehende Einzel-Mitgliedschaft je Benutzer in die neue Tabelle übernehmen.
    const benutzerMitVerein = await knex('benutzer').whereNotNull('verein_id');
    for (const b of benutzerMitVerein) {
        await knex('benutzer_vereine').insert({
            benutzer_id: b.id,
            verein_id: b.verein_id,
            freigegeben: b.verein_freigegeben
        });

        await knex('benutzer').where({ id: b.id }).update({ aktiver_verein_id: b.verein_id });
    }

    await knex.schema.alterTable('benutzer', (table) => {
        table.dropColumn('verein_id');
        table.dropColumn('verein_freigegeben');
    });
}

export async function down(knex) {
    await knex.schema.alterTable('benutzer', (table) => {
        table.integer('verein_id').unsigned().nullable()
            .references('id').inTable('vereine').onDelete('SET NULL');
        table.integer('verein_freigegeben').defaultTo(0);
    });

    const benutzer = await knex('benutzer').whereNotNull('aktiver_verein_id');
    for (const b of benutzer) {
        const mitgliedschaft = await knex('benutzer_vereine')
            .where({ benutzer_id: b.id, verein_id: b.aktiver_verein_id })
            .first();

        await knex('benutzer').where({ id: b.id }).update({
            verein_id: b.aktiver_verein_id,
            verein_freigegeben: mitgliedschaft ? mitgliedschaft.freigegeben : 0
        });
    }

    await knex.schema.alterTable('benutzer', (table) => {
        table.dropColumn('aktiver_verein_id');
    });

    await knex.schema.dropTableIfExists('benutzer_vereine');
}
