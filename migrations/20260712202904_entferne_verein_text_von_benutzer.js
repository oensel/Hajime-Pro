export const config = { transaction: false };

// Löst den "doppelten Vereinsnamen"-Konflikt: benutzer.verein war ein freier Text neben der
// echten Verknüpfung benutzer.verein_id -> vereine.id. Wenn beide auseinanderliefen, war
// unklar, welcher Name beim Export gilt. verein_id + JOIN auf vereine.name ist ab jetzt die
// einzige Quelle der Wahrheit.
export async function up(knex) {
    const isSqlite = knex.client.config.client === 'sqlite3';
    if (isSqlite) {
        await knex.raw('PRAGMA foreign_keys = OFF;');
    }

    // Sicherheitsnetz: Falls noch Benutzer mit Freitext-Verein aber ohne verein_id existieren
    // (z.B. nach manuellen DB-Änderungen), jetzt noch verknüpfen, bevor die Spalte verschwindet.
    const unverknuepft = await knex('benutzer').whereNull('verein_id').whereNotNull('verein');
    for (const u of unverknuepft) {
        if (!u.verein) continue;

        let verein = await knex('vereine').where({ name: u.verein }).first();
        if (!verein) {
            const [inserted] = await knex('vereine').insert({ name: u.verein }).returning('id');
            verein = { id: typeof inserted === 'object' ? inserted.id : inserted };
        }

        await knex('benutzer').where({ id: u.id }).update({
            verein_id: verein.id,
            verein_freigegeben: 1
        });
    }

    await knex.schema.alterTable('benutzer', (table) => {
        table.dropColumn('verein');
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

    await knex.schema.alterTable('benutzer', (table) => {
        table.string('verein').nullable();
    });

    if (isSqlite) {
        await knex.raw('PRAGMA foreign_keys = ON;');
    }
}
