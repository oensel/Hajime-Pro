export const config = { transaction: false };

// Planungs-Tools je Turnier (Helfer-Dienste und, später, Vorbereitung) ein-/ausschaltbar.
// DB-Standard: an. Bestandsdaten: in der Cloud (mehrere Vereine, Helfer-App) bleiben alle Turniere an; am
// Hallen-Server (Einzelbenutzerbetrieb) nur Turniere, die schon einen Helferplan haben. Neue Turniere setzen den
// Wert beim Anlegen selbst (Cloud: an, Hallen-Server: aus).
export async function up(knex) {
    await knex.schema.alterTable('turniere', (table) => {
        table.boolean('planungs_tools').notNullable().defaultTo(true);
    });

    const { createRequire } = await import('node:module');
    const { istEinzelbenutzerBetrieb } = createRequire(import.meta.url)('../src/config/betriebsmodus.cjs');
    if (istEinzelbenutzerBetrieb()) {
        await knex('turniere')
            .whereNotIn('id', knex('helfer_taetigkeiten').select('turnier_id'))
            .update({ planungs_tools: false });
    }
}

export async function down(knex) {
    await knex.schema.alterTable('turniere', (table) => {
        table.dropColumn('planungs_tools');
    });
}
