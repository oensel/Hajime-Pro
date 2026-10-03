export const config = { transaction: false };

// turniere.anmeldeschluss war bisher ein freier String — das erlaubt inkonsistente Formate
// ("2026-07-15" vs "15.07.2026"), was Export/Import zwischen Online- und Offline-Betrieb
// gefährdet. Als echter date-Typ ist das Format immer konsistent. app.js registriert bereits
// einen Postgres-Typparser für date-Spalten (OID 1082), der rohe Strings statt JS-Date-Objekte
// liefert — dieselbe Behandlung wie geburtsdatum/lizenz_ablauf. Die Anwendungslogik verwendet
// anmeldeschluss bereits ausschließlich als "YYYY-MM-DD"-String, daher ist keine Code-Änderung
// nötig, nur die Spalten-Typumstellung.
export async function up(knex) {
    // Leere Strings vor der Typumwandlung zu NULL machen, sonst schlägt ::date fehl.
    await knex.raw(`
        ALTER TABLE turniere
        ALTER COLUMN anmeldeschluss TYPE date
        USING NULLIF(anmeldeschluss, '')::date
    `);
}

export async function down(knex) {
    await knex.raw(`ALTER TABLE turniere ALTER COLUMN anmeldeschluss TYPE varchar(255) USING anmeldeschluss::text`);
}
