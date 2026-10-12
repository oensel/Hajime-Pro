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
    // passnummer_hash: stabiler Schlüssel je Turnier und Person. Basis ist die Cloud-ID des Turniers (urspruengliche_id),
    // damit ein Re-Import desselben Turniers die Schlüssel nicht ändert. Ohne Passnummer ('' ist erlaubt) dient
    // Name + Geburtsjahr + Verein als Ersatz, sonst bekämen alle diese Teilnehmer denselben Schlüssel.
    // gewicht_rang ersetzt das Gewicht: es entscheidet bei Gleichstand die Platzierung wie in der Siegerliste,
    // ohne das Gewicht selbst preiszugeben. nur_mannschaft: Mannschaftsmitglieder ohne Einzelwettkampf.
    await knex.raw(`CREATE OR REPLACE VIEW live.teilnehmer AS
        SELECT t.id, t.turnier_id, t.pool_id, t.vorname, t.nachname, t.verein, t.geschlecht, t.altersklasse,
               t.gewichtsklasse, t.status,
               encode(sha256(convert_to(
                   COALESCE(tu.urspruengliche_id, tu.id)::text || ':' ||
                   COALESCE(NULLIF(t.judopass_id, ''),
                            'ohne:' || lower(t.vorname) || ':' || lower(t.nachname) || ':' ||
                            COALESCE(t.geburtsjahr::text, '') || ':' || lower(t.verein)),
                   'UTF8')), 'hex') AS passnummer_hash,
               dense_rank() OVER (PARTITION BY t.pool_id ORDER BY t.gewicht) AS gewicht_rang,
               (EXISTS (SELECT 1 FROM public.mannschaft_mitglieder mm WHERE mm.turnier_teilnehmer_id = t.id)
                AND NOT t.auch_einzelwettkampf) AS nur_mannschaft
        FROM public.turnier_teilnehmer t
        JOIN public.turniere tu ON tu.id = t.turnier_id`);
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
