export const config = { transaction: false };

export async function up(knex) {
    const isSqlite = knex.client.config.client === 'sqlite3';
    if (isSqlite) {
        await knex.raw('PRAGMA foreign_keys = OFF;');
    }

    // 1. Turniere bekommen eine echte Verknüpfung zum ausrichtenden Verein
    await knex.schema.alterTable('turniere', (table) => {
        table.integer('verein_id').unsigned().nullable()
            .references('id').inTable('vereine').onDelete('SET NULL');
    });

    // 2. Bestehende Turniere anhand des Freitexts "ausrichter" mit vereine verknüpfen
    //    (Verein wird angelegt, falls noch keiner mit diesem Namen existiert)
    const turniere = await knex('turniere').whereNull('verein_id');
    for (const t of turniere) {
        if (!t.ausrichter) continue;

        let verein = await knex('vereine').where({ name: t.ausrichter }).first();
        if (!verein) {
            const [inserted] = await knex('vereine').insert({ name: t.ausrichter }).returning('id');
            verein = { id: typeof inserted === 'object' ? inserted.id : inserted };
        }

        await knex('turniere').where({ id: t.id }).update({ verein_id: verein.id });
    }

    // 3. Turniere sind ab jetzt ausschließlich über den ausrichtenden Verein zugänglich,
    //    nicht mehr über einen einzelnen "Besitzer"-Benutzer.
    await knex.schema.alterTable('turniere', (table) => {
        table.dropColumn('benutzer_id');
    });

    if (isSqlite) {
        await knex.raw('PRAGMA foreign_keys = ON;');
    }
}

export async function down(knex) {
    const isSqlite = knex.client.config.client === 'sqlite3';
    if (isSqlite) {
        await knex.raw('PRAGMA foreign_keys = OFF;');
    }

    // Hinweis: die ursprünglichen benutzer_id-Werte können beim Rollback nicht
    // wiederhergestellt werden, die Spalte wird leer neu angelegt.
    await knex.schema.alterTable('turniere', (table) => {
        table.string('benutzer_id').nullable()
            .references('id').inTable('benutzer').onDelete('SET NULL');
    });

    await knex.schema.alterTable('turniere', (table) => {
        table.dropColumn('verein_id');
    });

    if (isSqlite) {
        await knex.raw('PRAGMA foreign_keys = ON;');
    }
}
