export const config = { transaction: false };

// Bundesland je Verein (Vereinsübersicht der Super-Admins). Bestand: das Bundesland des zuletzt ausgerichteten Turniers
// des Vereins, sonst leer; neue Turniere füllen ein leeres Bundesland des Vereins nach, Super-Admins können es setzen.
export async function up(knex) {
    await knex.schema.alterTable('vereine', (table) => {
        table.string('bundesland').nullable();
    });
    await knex.raw(`
        UPDATE vereine v SET bundesland = (
            SELECT t.bundesland FROM turniere t
            WHERE t.verein_id = v.id AND t.bundesland IS NOT NULL AND t.bundesland <> ''
            ORDER BY t.datum DESC, t.id DESC LIMIT 1
        )
    `);
}

export async function down(knex) {
    await knex.schema.alterTable('vereine', (table) => {
        table.dropColumn('bundesland');
    });
}
