// Teilnehmer-App: Mannschaften (Teams) und ihre Begegnungen.
//  - Hallen-Server: zusätzliche Views im Schema "live" (Teams, Kader, Begegnungen) und die Matte des Einzelkampfes
//    (Begegnungen können einzeln einer Matte zugeordnet sein). Neue Spalten stehen am Ende der View.
//  - Cloud: Lesemodell live_mannschaften / live_begegnungen (entsteht in jeder Datenbank, am Hallen-Server leer).
export async function up(knex) {
    await knex.raw(`CREATE OR REPLACE VIEW live.kaempfe AS
        SELECT id, pool_id, status, matten_reihenfolge, reihenfolge_nummer, kaempfer1_id, kaempfer2_id, sieger_id,
               unterbewertung_kaempfer1, unterbewertung_kaempfer2, mannschaftskampf_id, kampfflaeche_id
        FROM public.kaempfe`);
    await knex.raw(`CREATE OR REPLACE VIEW live.mannschaften AS
        SELECT id, turnier_id, pool_id, verein, bezeichnung
        FROM public.mannschaften`);
    await knex.raw(`CREATE OR REPLACE VIEW live.mannschaft_mitglieder AS
        SELECT mannschaft_id, turnier_teilnehmer_id, gewichtsklasse
        FROM public.mannschaft_mitglieder`);
    await knex.raw(`CREATE OR REPLACE VIEW live.mannschaftskaempfe AS
        SELECT id, pool_id, mannschaft1_id, mannschaft2_id, sieger_mannschaft_id, status, reihenfolge_nummer, runde,
               kampfflaeche_id, siegpunkte_mannschaft1, siegpunkte_mannschaft2
        FROM public.mannschaftskaempfe`);
    // Die Rolle des Live-Prozesses bekommt die neuen Views, wenn sie schon existiert (sonst übernimmt das
    // Rollen-Skript sie beim Anlegen: GRANT SELECT ON ALL TABLES IN SCHEMA live).
    await knex.raw(`DO $$
    BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'live_ro') THEN
            GRANT SELECT ON live.kaempfe, live.mannschaften, live.mannschaft_mitglieder, live.mannschaftskaempfe TO live_ro;
        END IF;
    END $$;`);

    await knex.schema.createTable('live_mannschaften', (t) => {
        t.text('turnier_key').notNullable().references('turnier_key').inTable('live_turniere').onDelete('CASCADE');
        t.text('key').notNullable();
        t.text('bezeichnung').notNullable().defaultTo('');
        t.text('verein_key').notNullable().defaultTo('');
        t.text('verein').notNullable().defaultTo('');
        t.text('suche').notNullable().defaultTo('');
        t.integer('pool_id');
        t.text('pool_bezeichnung').notNullable().defaultTo('');
        t.text('modus').notNullable().defaultTo('');
        t.text('pool_status').notNullable().defaultTo('');
        t.text('altersklasse').notNullable().defaultTo('');
        t.text('geschlecht').notNullable().defaultTo('');
        t.integer('matte_id');
        t.text('matte_bezeichnung').notNullable().defaultTo('');
        t.text('zustand').notNullable().defaultTo('wartet');
        t.integer('abstand');
        t.integer('naechste_begegnung_id');
        t.text('gegner').notNullable().defaultTo('');
        t.integer('siege').notNullable().defaultTo(0);
        t.integer('niederlagen').notNullable().defaultTo(0);
        t.jsonb('mitglieder').notNullable().defaultTo('[]');
        t.primary(['turnier_key', 'key']);
        t.index(['turnier_key', 'pool_id']);
    });

    await knex.schema.createTable('live_begegnungen', (t) => {
        t.text('turnier_key').notNullable().references('turnier_key').inTable('live_turniere').onDelete('CASCADE');
        t.integer('begegnung_id').notNullable();
        t.integer('pool_id').notNullable();
        t.text('nr').notNullable().defaultTo('');
        t.integer('runde');
        t.text('status').notNullable().defaultTo('');
        t.integer('matte_id');
        t.text('team1_key');
        t.text('team2_key');
        t.integer('s1').notNullable().defaultTo(0);
        t.integer('s2').notNullable().defaultTo(0);
        t.text('sieger_key');
        t.integer('abstand');
        t.primary(['turnier_key', 'begegnung_id']);
        t.index(['turnier_key', 'pool_id']);
    });
}

export async function down(knex) {
    await knex.schema.dropTableIfExists('live_begegnungen');
    await knex.schema.dropTableIfExists('live_mannschaften');
    await knex.raw('DROP VIEW IF EXISTS live.mannschaftskaempfe');
    await knex.raw('DROP VIEW IF EXISTS live.mannschaft_mitglieder');
    await knex.raw('DROP VIEW IF EXISTS live.mannschaften');
    await knex.raw('DROP VIEW IF EXISTS live.kaempfe');
    await knex.raw(`CREATE VIEW live.kaempfe AS
        SELECT id, pool_id, status, matten_reihenfolge, reihenfolge_nummer, kaempfer1_id, kaempfer2_id, sieger_id,
               unterbewertung_kaempfer1, unterbewertung_kaempfer2, mannschaftskampf_id
        FROM public.kaempfe`);
}
