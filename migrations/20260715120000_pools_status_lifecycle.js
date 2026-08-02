export const config = { transaction: false };

// Führt einen echten Lebenszyklus-Status für Pools ein und behebt zugleich die bisherige
// Zweckentfremdung von pools.modus (wurde bei Poolabschluss auf den String 'beendet'
// überschrieben und über resolveOriginalModus() wieder zurückrekonstruiert). Werte:
// angelegt | teilnehmer_zugewiesen | matte_zugewiesen | gestartet | kaempfe_beendet |
// abgeschlossen. "gelöscht" ist wie beim Turnier kein gespeicherter Wert, sondern echtes
// Zeilen-Löschen. Additive Spalte, kein SQLite-PRAGMA-Rebuild nötig.
export async function up(knex) {
    await knex.schema.alterTable('pools', (table) => {
        table.string('status').notNullable().defaultTo('angelegt');
    });

    // 1. modus === 'beendet' reparieren: echten Systemnamen aus der Teilnehmerzahl
    // zurückrekonstruieren (identische Logik zur bisherigen resolveOriginalModus()) und
    // status auf 'abgeschlossen' setzen.
    const beendetePools = await knex('pools').where({ modus: 'beendet' }).select('id');
    for (const p of beendetePools) {
        const anzahlRow = await knex('turnier_teilnehmer').where({ pool_id: p.id }).count('* as n').first();
        const anzahl = parseInt(anzahlRow.n, 10);
        let echterModus = 'Nicht startbereit';
        if (anzahl >= 2 && anzahl <= 5) echterModus = 'Jeder-gegen-Jeden';
        else if (anzahl === 6) echterModus = 'Gruppen-Überkreuz';
        else if (anzahl <= 8) echterModus = 'Doppel-KO-8';
        else if (anzahl <= 16) echterModus = 'Doppel-KO-16';
        else if (anzahl <= 32) echterModus = 'Doppel-KO-32';
        await knex('pools').where({ id: p.id }).update({ modus: echterModus, status: 'abgeschlossen' });
    }

    // 2. Übrige Pools anhand ihres aktuellen Zustands einordnen.
    const restPools = await knex('pools').whereNot({ modus: 'beendet' }).select('id', 'kampfflaeche_id');
    for (const p of restPools) {
        const teilnehmerAnzahlRow = await knex('turnier_teilnehmer').where({ pool_id: p.id }).count('* as n').first();
        const teilnehmerAnzahl = parseInt(teilnehmerAnzahlRow.n, 10);

        let status = 'angelegt';
        if (teilnehmerAnzahl > 0) status = 'teilnehmer_zugewiesen';
        if (p.kampfflaeche_id != null) {
            status = 'matte_zugewiesen';
            const kaempfeRow = await knex('kaempfe')
                .where({ pool_id: p.id })
                .andWhere(function () {
                    this.where('status', 'laufend').orWhere('status', 'beendet');
                })
                .first();
            if (kaempfeRow) status = 'gestartet';
        }
        await knex('pools').where({ id: p.id }).update({ status });
    }
}

export async function down(knex) {
    await knex.schema.alterTable('pools', (table) => {
        table.dropColumn('status');
    });
}
