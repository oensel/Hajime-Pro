exports.up = async function(knex) {
    const isSqlite = knex.client.config.client === 'sqlite3';
    if (isSqlite) {
        await knex.raw('PRAGMA foreign_keys = OFF;');
    }

    // 1. Create table vereine
    await knex.schema.createTable('vereine', (table) => {
        table.increments('id').primary();
        table.string('name').unique().notNullable();
        table.timestamps(true, true);
    });

    // 2. Alter table benutzer
    await knex.schema.alterTable('benutzer', (table) => {
        table.string('password_hash').nullable();
        table.integer('verein_id').unsigned().nullable()
            .references('id').inTable('vereine').onDelete('SET NULL');
        table.integer('verein_freigegeben').defaultTo(0);
    });

    // 3. Migrate existing users' clubs to the new table
    const users = await knex('benutzer').select('*');
    for (const u of users) {
        let vereinId = null;
        if (u.verein) {
            let club = await knex('vereine').where({ name: u.verein }).first();
            if (!club) {
                const [inserted] = await knex('vereine').insert({ name: u.verein }).returning('id');
                vereinId = typeof inserted === 'object' ? inserted.id : inserted;
            } else {
                vereinId = club.id;
            }
        }

        await knex('benutzer').where({ id: u.id }).update({
            verein_id: vereinId,
            verein_freigegeben: vereinId ? 1 : 0
        });
    }

    if (isSqlite) {
        await knex.raw('PRAGMA foreign_keys = ON;');
    }
};

exports.down = async function(knex) {
    const isSqlite = knex.client.config.client === 'sqlite3';
    if (isSqlite) {
        await knex.raw('PRAGMA foreign_keys = OFF;');
    }

    await knex.schema.alterTable('benutzer', (table) => {
        table.dropColumn('password_hash');
        table.dropColumn('verein_id');
        table.dropColumn('verein_freigegeben');
    });

    await knex.schema.dropTableIfExists('vereine');

    if (isSqlite) {
        await knex.raw('PRAGMA foreign_keys = ON;');
    }
};
