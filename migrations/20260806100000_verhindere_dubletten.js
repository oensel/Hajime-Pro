export const config = { transaction: false };

// Verhindert zwei Arten von Dubletten, die die Anwendung bisher nur (unvollständig)
// applikationsseitig prüfte:
//
// 1. Derselbe Judoka doppelt in einer Mannschaft (mannschaft_mitglieder) — z.B. durch einen
//    Doppelklick auf "Mitglied hinzufügen" (siehe fuegeMitgliedHinzu in mannschaftController.js,
//    das bislang ohne Vorab-Prüfung einfügt). Mehrere ANDERE Judoka auf derselben
//    Gewichtsklassen-Position bleiben weiterhin erlaubt (Ersatzkämpfer, siehe Migrations-
//    Kommentar bei create_mannschaft_mitglieder) — hier geht es nur um denselben Judoka zweimal.
//
// 2. Derselbe Judopass zweimal im selben Turnier (turnier_teilnehmer) — z.B. durch einen erneuten
//    CSV-Import mit fehlender/inkonsistenter Dublettenprüfung oder eine Race Condition zwischen
//    zwei parallelen Anmeldungen. createTeilnehmer/importTeilnehmer prüfen das bereits
//    applikationsseitig (siehe "DUBLETTEN-SCHUTZ"), aber nur als Lese-dann-Schreib-Prüfung ohne
//    DB-Garantie. Nur für tatsächlich vorhandene Judopass-Nummern (leerer String bleibt erlaubt,
//    z.B. Kinder ohne eigenen Pass) — ein partieller Unique-Index statt eines einfachen, da sonst
//    alle Teilnehmer ohne Judopass sich gegenseitig blockieren würden.
export async function up(knex) {
    await knex.schema.alterTable('mannschaft_mitglieder', (table) => {
        table.unique(['mannschaft_id', 'turnier_teilnehmer_id'], { indexName: 'uq_mannschaft_mitglieder_kein_doppel' });
    });

    await knex.schema.alterTable('turnier_teilnehmer', (table) => {
        table.unique(['turnier_id', 'judopass_id'], {
            indexName: 'uq_turnier_teilnehmer_judopass',
            predicate: knex.whereRaw("judopass_id <> ''")
        });
    });
}

export async function down(knex) {
    await knex.schema.alterTable('mannschaft_mitglieder', (table) => {
        table.dropUnique(['mannschaft_id', 'turnier_teilnehmer_id'], 'uq_mannschaft_mitglieder_kein_doppel');
    });

    await knex.schema.alterTable('turnier_teilnehmer', (table) => {
        table.dropUnique(['turnier_id', 'judopass_id'], 'uq_turnier_teilnehmer_judopass');
    });
}
