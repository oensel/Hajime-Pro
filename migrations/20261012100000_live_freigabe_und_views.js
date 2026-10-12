// Teilnehmer-App Phase 1 (docs/specs/2026-10-12-teilnehmer-app-design.md):
//  - turniere.live_freigabe: Opt-in des Veranstalters am Hallen-Server. Ohne Freigabe sendet der Live-Prozess nichts.
//  - Schema "live" mit Views: die einzige Sicht des Live-Prozesses auf die Daten. Er verbindet sich mit der Rolle
//    live_ro, die nur diese Views lesen darf; die Views laufen mit den Rechten des Eigentümers, die Basistabellen
//    bleiben für live_ro gesperrt. Nicht enthalten: Geburtsjahr, Gewicht, Passnummer (nur passnummer_hash),
//    Zahlungs- und Anmeldedaten.
export async function up(knex) {
    await knex.schema.alterTable('turniere', (table) => {
        table.boolean('live_freigabe').notNullable().defaultTo(false);
    });

    await knex.raw('CREATE SCHEMA IF NOT EXISTS live');
    await knex.raw('REVOKE ALL ON SCHEMA live FROM PUBLIC');

    await knex.raw(`CREATE OR REPLACE VIEW live.turniere AS
        SELECT id, urspruengliche_id, bezeichnung, datum, status, live_freigabe
        FROM public.turniere`);
    await knex.raw(`CREATE OR REPLACE VIEW live.kampfflaechen AS
        SELECT id, turnier_id, bezeichnung
        FROM public.kampfflaechen`);
    await knex.raw(`CREATE OR REPLACE VIEW live.pools AS
        SELECT id, turnier_id, kampfflaeche_id, bezeichnung, modus, typ, status, verspaetet,
               altersklasse, geschlecht, gewichtsklasse, matte_reihenfolge
        FROM public.pools`);
    await knex.raw(`CREATE OR REPLACE VIEW live.teilnehmer AS
        SELECT id, turnier_id, pool_id, vorname, nachname, verein, geschlecht, altersklasse, gewichtsklasse, status,
               encode(sha256(convert_to(turnier_id::text || ':' || judopass_id, 'UTF8')), 'hex') AS passnummer_hash
        FROM public.turnier_teilnehmer`);
    await knex.raw(`CREATE OR REPLACE VIEW live.kaempfe AS
        SELECT id, pool_id, status, matten_reihenfolge, reihenfolge_nummer, kaempfer1_id, kaempfer2_id, sieger_id,
               unterbewertung_kaempfer1, unterbewertung_kaempfer2, mannschaftskampf_id
        FROM public.kaempfe`);
}

export async function down(knex) {
    await knex.raw('DROP SCHEMA IF EXISTS live CASCADE');
    await knex.schema.alterTable('turniere', (table) => {
        table.dropColumn('live_freigabe');
    });
}
