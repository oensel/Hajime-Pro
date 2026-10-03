import {
    DOPPEL_KO_8_TOPOLOGIE,
    DOPPEL_KO_16_TOPOLOGIE,
    GRUPPEN_UEBERKREUZ_TOPOLOGIE,
    verknuepfeQuellenFuerPool
} from '../src/shared/bracketTopologie.js';

export const config = { transaction: false };

export async function up(knex) {
    // 1. Schema: explizite Kampf-zu-Kampf-Quellreferenzen + Gruppenzugehörigkeit
    await knex.schema.alterTable('kaempfe', (table) => {
        table.integer('kaempfer1_quelle_kampf_id').unsigned().nullable()
            .references('id').inTable('kaempfe').onDelete('SET NULL');
        table.string('kaempfer1_quelle_typ').nullable(); // 'sieger' | 'verlierer'
        table.integer('kaempfer2_quelle_kampf_id').unsigned().nullable()
            .references('id').inTable('kaempfe').onDelete('SET NULL');
        table.string('kaempfer2_quelle_typ').nullable();
        table.string('gruppe').nullable(); // 'A' | 'B' — nur Gruppen-Überkreuz-Vorrunde
    });

    // 2. Backfill: bestehende Pools rückwirkend verknüpfen (rein additiv, betrifft nur die
    // neuen, bisher ungenutzten Spalten — keine bestehenden Ergebnisse/Zuordnungen ändern sich).
    const pools = await knex('pools').select('id', 'modus');

    for (const pool of pools) {
        if (pool.modus === 'Doppel-KO-8') {
            await verknuepfeQuellenFuerPool(knex, pool.id, DOPPEL_KO_8_TOPOLOGIE);
        } else if (pool.modus === 'Doppel-KO-16') {
            await verknuepfeQuellenFuerPool(knex, pool.id, DOPPEL_KO_16_TOPOLOGIE);
        } else if (pool.modus === 'Gruppen-Überkreuz') {
            await verknuepfeQuellenFuerPool(knex, pool.id, GRUPPEN_UEBERKREUZ_TOPOLOGIE);

            // gruppe für die Vorrundenkämpfe nachtragen (ersetzt zukünftig die
            // LIKE 'V_A_%'-Stringsuche in _berechneTeilRangliste)
            await knex('kaempfe').where({ pool_id: pool.id })
                .andWhere('reihenfolge_nummer', 'like', 'V_A_%')
                .update({ gruppe: 'A' });
            await knex('kaempfe').where({ pool_id: pool.id })
                .andWhere('reihenfolge_nummer', 'like', 'V_B_%')
                .update({ gruppe: 'B' });
        }
    }
}

export async function down(knex) {
    await knex.schema.alterTable('kaempfe', (table) => {
        table.dropColumn('kaempfer1_quelle_kampf_id');
        table.dropColumn('kaempfer1_quelle_typ');
        table.dropColumn('kaempfer2_quelle_kampf_id');
        table.dropColumn('kaempfer2_quelle_typ');
        table.dropColumn('gruppe');
    });
}
