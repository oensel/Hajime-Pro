// Hallen-Server mit mehreren Turnieren: genau eines ist "aktiv", das ist das Turnier, an dem der
// Sync-Dienst (Dokument-DB), Matten, Waage und Client-Geräte hängen. Die Spalte wird mit dem
// Cluster repliziert, damit nach einem Failover dasselbe Turnier aktiv ist.
// Bestand: das bisher einzige (zuletzt angelegte) Turnier bleibt aktiv, sofern es nicht schon
// abgeschlossen oder abgesagt ist.
export async function up(knex) {
    await knex.schema.alterTable('turniere', (t) => {
        t.boolean('aktiv').notNullable().defaultTo(false);
    });
    await knex.raw('CREATE UNIQUE INDEX turniere_aktiv_eindeutig ON turniere (aktiv) WHERE aktiv = true');
    await knex.raw(`
        UPDATE turniere SET aktiv = true
        WHERE id = (SELECT MAX(id) FROM turniere)
          AND status NOT IN ('abgeschlossen', 'abgesagt')
    `);
}

export async function down(knex) {
    await knex.raw('DROP INDEX IF EXISTS turniere_aktiv_eindeutig');
    await knex.schema.alterTable('turniere', (t) => {
        t.dropColumn('aktiv');
    });
}
