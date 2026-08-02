export const config = { transaction: false };

// Führt den vollen Turnier-Lebenszyklus ein (Entwurf/Veröffentlicht/Anmeldung geschlossen/
// In Durchführung/Abgeschlossen/Abgesagt/Gelöscht). Nur 4 Werte werden tatsächlich in
// turniere.status gespeichert — 'anmeldung_geschlossen' und 'in_durchfuehrung' werden bei
// jedem Lesezugriff aus status/datum/anmeldeschluss/echten Kämpfen abgeleitet
// (ermittleEffektivenStatus in turnierController.js/teilnehmerController.js), 'gelöscht' ist
// kein Status, sondern echtes Löschen der Zeile. Bewusst kein DB-CHECK-Constraint (würde bei
// SQLite einen riskanten Tabellen-Rebuild erfordern) — die Validierung erfolgt app-seitig.
export async function up(knex) {
    // Bestehende Turniere: der bisherige einzige aktive Wert 'anmeldung_offen' entspricht dem
    // neuen 'veroeffentlicht' (Anmeldung läuft bereits). Alles andere (z. B. weitere Altwerte)
    // gilt als noch nicht veröffentlicht -> 'entwurf', der sichere Default.
    await knex('turniere')
        .where({ status: 'anmeldung_offen' })
        .update({ status: 'veroeffentlicht' });
    await knex('turniere')
        .whereNotIn('status', ['veroeffentlicht'])
        .update({ status: 'entwurf' });

    const isSqlite = knex.client.config.client === 'sqlite3';
    if (isSqlite) {
        await knex.raw('PRAGMA foreign_keys = OFF;');
    }
    await knex.schema.alterTable('turniere', (table) => {
        table.string('status').notNullable().defaultTo('entwurf').alter();
    });
    if (isSqlite) {
        await knex.raw('PRAGMA foreign_keys = ON;');
    }
}

export async function down(knex) {
    const isSqlite = knex.client.config.client === 'sqlite3';
    if (isSqlite) {
        await knex.raw('PRAGMA foreign_keys = OFF;');
    }
    await knex.schema.alterTable('turniere', (table) => {
        table.string('status').notNullable().defaultTo('anmeldung_offen').alter();
    });
    if (isSqlite) {
        await knex.raw('PRAGMA foreign_keys = ON;');
    }

    await knex('turniere')
        .where({ status: 'veroeffentlicht' })
        .update({ status: 'anmeldung_offen' });
}
