// Ermöglicht den vollständigen Online→Offline→Online-Rundlauf: der Offline-Turnier-Import
// (importTurnier in turnierController.js) legt bewusst immer ein komplett NEUES Turnier mit
// frischer, lokaler ID an — diese ID hat mit der ID des ursprünglichen Online-Turniers nichts zu
// tun (zwei getrennte Datenbanken). Ohne einen Verweis auf die Quelle kann der spätere
// Online-Reimport (importTurnierErgebnisse, "Ergebnisse hochladen") das hochgeladene Turnier
// keinem bestehenden Online-Turnier mehr zuordnen. urspruengliche_id hält die ID des
// Quell-Turniers zum Zeitpunkt des Offline-Imports fest.
export async function up(knex) {
    await knex.schema.alterTable('turniere', (table) => {
        table.integer('urspruengliche_id').unsigned().nullable();
    });
}

export async function down(knex) {
    await knex.schema.alterTable('turniere', (table) => {
        table.dropColumn('urspruengliche_id');
    });
}
