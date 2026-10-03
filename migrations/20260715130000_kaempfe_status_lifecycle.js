export const config = { transaction: false };

// Erweitert kaempfe.status von 3 auf 6 Werte: angelegt | bereit | vorbereiten | gestartet |
// beendet | freilos. 'wartet' spaltet sich in 'angelegt' (mind. ein Kämpfer-Slot noch
// unbekannt/Platzhalter) und 'bereit' (beide Kämpfer stehen fest) auf; 'laufend' wird zu
// 'gestartet'; 'beendet' spaltet 'freilos' ab (automatische Bye-Auflösung, bisher 'beendet' +
// leere Kämpfer-Felder). 'vorbereiten' ist ab jetzt ein gültiger Wert ohne eigenen Schreib-
// Trigger in dieser Runde (Trigger-Logik folgt separat im Scoreboard).
export async function up(knex) {
    // Reihenfolge wichtig: erst die eindeutigen Fälle, dann die verbleibenden.
    await knex('kaempfe').where({ status: 'laufend' }).update({ status: 'gestartet' });

    await knex('kaempfe')
        .where({ status: 'beendet' })
        .andWhere(function () {
            this.whereNull('kaempfer1_id').orWhereNull('kaempfer2_id');
        })
        .update({ status: 'freilos' });

    await knex('kaempfe')
        .where({ status: 'wartet' })
        .whereNotNull('kaempfer1_id')
        .whereNotNull('kaempfer2_id')
        .update({ status: 'bereit' });

    await knex('kaempfe')
        .where({ status: 'wartet' })
        .andWhere(function () {
            this.whereNull('kaempfer1_id').orWhereNull('kaempfer2_id');
        })
        .update({ status: 'angelegt' });

    await knex.schema.alterTable('kaempfe', (table) => {
        table.string('status').notNullable().defaultTo('angelegt').alter();
    });
}

export async function down(knex) {
    await knex.schema.alterTable('kaempfe', (table) => {
        table.string('status').notNullable().defaultTo('wartet').alter();
    });

    await knex('kaempfe').where({ status: 'gestartet' }).update({ status: 'laufend' });
    await knex('kaempfe').where({ status: 'freilos' }).update({ status: 'beendet' });
    await knex('kaempfe')
        .whereIn('status', ['angelegt', 'bereit', 'vorbereiten'])
        .update({ status: 'wartet' });
}
