export async function up(knex) {
    const hasStatus = await knex.schema.hasColumn('kaempfe', 'status');
    const hasReihenfolgeNummer = await knex.schema.hasColumn('kaempfe', 'reihenfolge_nummer');
    const hasMattenReihenfolge = await knex.schema.hasColumn('kaempfe', 'matten_reihenfolge');

    await knex.schema.alterTable('kaempfe', (table) => {
        if (!hasStatus) {
            table.string('status').notNullable().defaultTo('wartet').index();
        }

        if (!hasReihenfolgeNummer) {
            table.string('reihenfolge_nummer').nullable().index();
        }

        if (!hasMattenReihenfolge) {
            table.integer('matten_reihenfolge').nullable().index();
        }

        table.integer('kaempfer1_id').unsigned().nullable().alter();
        table.integer('kaempfer2_id').unsigned().nullable().alter();
    });
};

export async function down(knex) {
    const hasStatus = await knex.schema.hasColumn('kaempfe', 'status');
    const hasReihenfolgeNummer = await knex.schema.hasColumn('kaempfe', 'reihenfolge_nummer');
    const hasMattenReihenfolge = await knex.schema.hasColumn('kaempfe', 'matten_reihenfolge');

    await knex.schema.alterTable('kaempfe', (table) => {
        if (hasStatus) {
            table.dropColumn('status');
        }

        if (hasReihenfolgeNummer) {
            table.dropColumn('reihenfolge_nummer');
        }

        if (hasMattenReihenfolge) {
            table.dropColumn('matten_reihenfolge');
        }

        table.integer('kaempfer1_id').unsigned().notNullable().alter();
        table.integer('kaempfer2_id').unsigned().notNullable().alter();
    });
};