export const config = { transaction: false };

// Super-Admin-Modus: ein Super-Admin arbeitet entweder im Super-Admin-Modus (globale Rechte) oder in einem Verein
// (nur die Rechte seiner Rolle dort). aktiver_verein_id bleibt unberührt und merkt sich den zuletzt gewählten Verein.
export async function up(knex) {
    await knex.schema.alterTable('benutzer', (table) => {
        table.boolean('super_admin_modus').notNullable().defaultTo(false);
    });
    await knex('benutzer').where({ ist_super_admin: true }).update({ super_admin_modus: true });
}

export async function down(knex) {
    await knex.schema.alterTable('benutzer', (table) => {
        table.dropColumn('super_admin_modus');
    });
}
