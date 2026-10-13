// Teilnehmer-App Phase 2b: die Views liefern zusätzlich die Farbe von Kämpfer 2 (Turnier und Pool), damit das Dashboard der
// App Blau/Rot wie die Halle zeigt. Neue Spalten stehen am Ende (CREATE OR REPLACE VIEW verlangt die alte Reihenfolge).
export async function up(knex) {
    await knex.raw(`CREATE OR REPLACE VIEW live.turniere AS
        SELECT id, urspruengliche_id, bezeichnung, datum, status, live_freigabe, farbe_kaempfer2
        FROM public.turniere`);
    await knex.raw(`CREATE OR REPLACE VIEW live.pools AS
        SELECT id, turnier_id, kampfflaeche_id, bezeichnung, modus, typ, status, verspaetet,
               altersklasse, geschlecht, gewichtsklasse, matte_reihenfolge, farbe_kaempfer2
        FROM public.pools`);
}

export async function down(knex) {
    await knex.raw(`DROP VIEW IF EXISTS live.pools`);
    await knex.raw(`CREATE VIEW live.pools AS
        SELECT id, turnier_id, kampfflaeche_id, bezeichnung, modus, typ, status, verspaetet,
               altersklasse, geschlecht, gewichtsklasse, matte_reihenfolge
        FROM public.pools`);
    await knex.raw(`DROP VIEW IF EXISTS live.turniere`);
    await knex.raw(`CREATE VIEW live.turniere AS
        SELECT id, urspruengliche_id, bezeichnung, datum, status, live_freigabe
        FROM public.turniere`);
}
