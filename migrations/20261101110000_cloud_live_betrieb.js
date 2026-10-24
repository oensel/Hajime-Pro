export const config = { transaction: false };

// Cloud-Live-Betrieb (src/cloudLive/): die Cloud führt ein Turnier wie ein Hallen-Server live. Je Turnier eine Zeile mit den
// Zugangsdaten der Geräte (Schlüssel im Pfad /turnierlive/<schluessel>, Geheimnis der Replikation, 6-stelliger Kopplungscode) und der
// Instanz der Dokument-Datenbank. Das Geheimnis liegt lesbar, weil der Kopplungs-QR es wieder anzeigen können muss; beendet_am
// beendet den Live-Betrieb (ein erneuter Start legt eine neue Zeile-Version mit neuer Instanz an).
// turniere.auf_hallen_server_geholt_am merkt, dass das Turnier über die Holen-Aktion auf einen Hallen-Server kopiert wurde
// (Warnung beim Live-Schalten in der Cloud, ein Turnier läuft nie an beiden Orten).
export async function up(knex) {
    await knex.schema.createTable('cloud_live', (table) => {
        table.integer('turnier_id').primary().references('id').inTable('turniere').onDelete('CASCADE');
        table.text('schluessel').notNullable().unique();
        table.text('geheimnis').notNullable();
        table.text('code').notNullable();
        table.text('instanz_id').notNullable();
        table.timestamp('erzeugt_am', { useTz: true }).notNullable().defaultTo(knex.fn.now());
        table.timestamp('gesperrt_am', { useTz: true }).nullable();
        table.timestamp('beendet_am', { useTz: true }).nullable();
        table.integer('fehlversuche').notNullable().defaultTo(0); // falsche Kopplungscodes seit dem letzten richtigen
    });
    await knex.schema.alterTable('turniere', (table) => {
        table.timestamp('auf_hallen_server_geholt_am', { useTz: true }).nullable();
    });
}

export async function down(knex) {
    await knex.schema.alterTable('turniere', (table) => {
        table.dropColumn('auf_hallen_server_geholt_am');
    });
    await knex.schema.dropTableIfExists('cloud_live');
}
