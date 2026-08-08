export const config = { transaction: false };

// Offizielle Ausschreibung als PDF, direkt in der DB gespeichert (bytea/BLOB) — analog zum
// bereits bestehenden Base64-Transfer-Muster bei Turnier-Import/-Export (siehe
// importTurnier/exportTurnier in turnierController.js), nur binär statt als JSON-Datei.
// ausschreibung_dateiname hält den ursprünglichen Dateinamen für Anzeige/Download vor.
export async function up(knex) {
    await knex.schema.alterTable('turniere', (table) => {
        table.binary('ausschreibung_pdf').nullable();
        table.string('ausschreibung_dateiname').nullable();
    });
}

export async function down(knex) {
    await knex.schema.alterTable('turniere', (table) => {
        table.dropColumn('ausschreibung_pdf');
        table.dropColumn('ausschreibung_dateiname');
    });
}
