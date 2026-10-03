export const config = { transaction: false };

// Schützt vor logisch kaputten Kampfpaarungen (z.B. durch Software-Bugs), unabhängig davon,
// ob der Datensatz online erzeugt oder aus einer Offline-Export-Datei importiert wurde.

export async function up(knex) {
    await knex.raw(`
        ALTER TABLE kaempfe
        ADD CONSTRAINT check_verschiedene_kaempfer CHECK (kaempfer1_id <> kaempfer2_id)
    `);
    await knex.raw(`
        ALTER TABLE kaempfe
        ADD CONSTRAINT check_sieger_ist_teilnehmer CHECK (sieger_id IS NULL OR sieger_id IN (kaempfer1_id, kaempfer2_id))
    `);
}

export async function down(knex) {
    await knex.raw(`ALTER TABLE kaempfe DROP CONSTRAINT check_verschiedene_kaempfer`);
    await knex.raw(`ALTER TABLE kaempfe DROP CONSTRAINT check_sieger_ist_teilnehmer`);
}
