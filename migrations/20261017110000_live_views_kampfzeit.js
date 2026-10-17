// Zeitprognose in der Teilnehmer-App: der Uplink braucht die gekämpfte Zeit und das Kampfende der beendeten Kämpfe
// sowie die eingestellte Kampfzeit der Pools, um die Dauer je Kampf einer Matte zu schätzen (src/shared/zeitPrognose.js).
// Neue Spalten stehen am Ende (CREATE OR REPLACE VIEW verlangt die alte Reihenfolge).
export async function up(knex) {
    await knex.raw(`CREATE OR REPLACE VIEW live.kaempfe AS
        SELECT id, pool_id, status, matten_reihenfolge, reihenfolge_nummer, kaempfer1_id, kaempfer2_id, sieger_id,
               unterbewertung_kaempfer1, unterbewertung_kaempfer2, mannschaftskampf_id, kampfflaeche_id,
               kampfzeit_in_sekunden, updated_at
        FROM public.kaempfe`);
    await knex.raw(`CREATE OR REPLACE VIEW live.pools AS
        SELECT id, turnier_id, kampfflaeche_id, bezeichnung, modus, typ, status, verspaetet,
               altersklasse, geschlecht, gewichtsklasse, matte_reihenfolge, farbe_kaempfer2, kampfzeit_sekunden
        FROM public.pools`);
}

export async function down(knex) {
    await knex.raw('DROP VIEW IF EXISTS live.kaempfe');
    await knex.raw(`CREATE VIEW live.kaempfe AS
        SELECT id, pool_id, status, matten_reihenfolge, reihenfolge_nummer, kaempfer1_id, kaempfer2_id, sieger_id,
               unterbewertung_kaempfer1, unterbewertung_kaempfer2, mannschaftskampf_id, kampfflaeche_id
        FROM public.kaempfe`);
    await knex.raw('DROP VIEW IF EXISTS live.pools');
    await knex.raw(`CREATE VIEW live.pools AS
        SELECT id, turnier_id, kampfflaeche_id, bezeichnung, modus, typ, status, verspaetet,
               altersklasse, geschlecht, gewichtsklasse, matte_reihenfolge, farbe_kaempfer2
        FROM public.pools`);
    await knex.raw(`DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'live_ro') THEN
            GRANT SELECT ON live.kaempfe, live.pools TO live_ro;
        END IF;
    END $$;`);
}
