export const config = { transaction: false };

// Teilnehmer-App-Schalter am Hallen-Server: das Token (aus der Cloud beim Holen des Turniers) und das Geheimnis für die
// Pseudonymisierung der Teilnehmer-Schlüssel liegen am Turnier und replizieren im Cluster mit; live_ruecknahme merkt,
// dass das Turnier in der Cloud zurückgenommen werden muss (der sendende Knoten ist nicht zwingend der, der ausschaltet).
export async function up(knex) {
    await knex.schema.alterTable('turniere', (table) => {
        table.text('live_token');
        table.text('live_geheimnis');
        table.boolean('live_ruecknahme').notNullable().defaultTo(false);
    });
}

export async function down(knex) {
    await knex.schema.alterTable('turniere', (table) => {
        table.dropColumn('live_token');
        table.dropColumn('live_geheimnis');
        table.dropColumn('live_ruecknahme');
    });
}
