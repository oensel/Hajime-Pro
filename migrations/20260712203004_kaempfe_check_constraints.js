export const config = { transaction: false };

// Schützt vor logisch kaputten Kampfpaarungen (z.B. durch Software-Bugs), unabhängig davon,
// ob der Datensatz online erzeugt oder aus einer Offline-Export-Datei importiert wurde.
// SQLite unterstützt kein "ALTER TABLE ... ADD CONSTRAINT" für CHECKs auf bestehenden
// Tabellen, daher wird die Tabelle dort neu aufgebaut (Standard-SQLite-Vorgehen).

const SQLITE_INDEXES = [
    { name: 'kaempfe_status_index', column: 'status' },
    { name: 'kaempfe_reihenfolge_nummer_index', column: 'reihenfolge_nummer' },
    { name: 'kaempfe_matten_reihenfolge_index', column: 'matten_reihenfolge' }
];

export async function up(knex) {
    const isSqlite = knex.client.config.client === 'sqlite3';

    if (isSqlite) {
        await knex.raw('PRAGMA foreign_keys = OFF;');
        await knex.raw(`
            CREATE TABLE kaempfe_neu (
                id integer not null primary key autoincrement,
                pool_id integer not null,
                kaempfer1_id integer null,
                kaempfer2_id integer null,
                sieger_id integer null,
                kampfzeit_in_sekunden integer default '0',
                unterbewertung_kaempfer1 integer default '0',
                unterbewertung_kaempfer2 integer default '0',
                status varchar(255) not null default 'wartet',
                reihenfolge_nummer varchar(255) null,
                matten_reihenfolge integer null,
                created_at datetime not null default CURRENT_TIMESTAMP,
                updated_at datetime not null default CURRENT_TIMESTAMP,
                foreign key(pool_id) references pools(id) on delete CASCADE,
                foreign key(kaempfer1_id) references turnier_teilnehmer(id) on delete RESTRICT,
                foreign key(kaempfer2_id) references turnier_teilnehmer(id) on delete RESTRICT,
                foreign key(sieger_id) references turnier_teilnehmer(id) on delete SET NULL,
                CONSTRAINT check_verschiedene_kaempfer CHECK (kaempfer1_id <> kaempfer2_id),
                CONSTRAINT check_sieger_ist_teilnehmer CHECK (sieger_id IS NULL OR sieger_id IN (kaempfer1_id, kaempfer2_id))
            );
        `);
        await knex.raw(`
            INSERT INTO kaempfe_neu (id, pool_id, kaempfer1_id, kaempfer2_id, sieger_id,
                kampfzeit_in_sekunden, unterbewertung_kaempfer1, unterbewertung_kaempfer2,
                status, reihenfolge_nummer, matten_reihenfolge, created_at, updated_at)
            SELECT id, pool_id, kaempfer1_id, kaempfer2_id, sieger_id,
                kampfzeit_in_sekunden, unterbewertung_kaempfer1, unterbewertung_kaempfer2,
                status, reihenfolge_nummer, matten_reihenfolge, created_at, updated_at
            FROM kaempfe;
        `);
        await knex.raw('DROP TABLE kaempfe;');
        await knex.raw('ALTER TABLE kaempfe_neu RENAME TO kaempfe;');

        for (const idx of SQLITE_INDEXES) {
            await knex.raw(`CREATE INDEX \`${idx.name}\` on \`kaempfe\` (\`${idx.column}\`)`);
        }
        await knex.raw('PRAGMA foreign_keys = ON;');
    } else {
        await knex.raw(`
            ALTER TABLE kaempfe
            ADD CONSTRAINT check_verschiedene_kaempfer CHECK (kaempfer1_id <> kaempfer2_id)
        `);
        await knex.raw(`
            ALTER TABLE kaempfe
            ADD CONSTRAINT check_sieger_ist_teilnehmer CHECK (sieger_id IS NULL OR sieger_id IN (kaempfer1_id, kaempfer2_id))
        `);
    }
}

export async function down(knex) {
    const isSqlite = knex.client.config.client === 'sqlite3';

    if (isSqlite) {
        await knex.raw('PRAGMA foreign_keys = OFF;');
        await knex.raw(`
            CREATE TABLE kaempfe_neu (
                id integer not null primary key autoincrement,
                pool_id integer not null,
                kaempfer1_id integer null,
                kaempfer2_id integer null,
                sieger_id integer null,
                kampfzeit_in_sekunden integer default '0',
                unterbewertung_kaempfer1 integer default '0',
                unterbewertung_kaempfer2 integer default '0',
                status varchar(255) not null default 'wartet',
                reihenfolge_nummer varchar(255) null,
                matten_reihenfolge integer null,
                created_at datetime not null default CURRENT_TIMESTAMP,
                updated_at datetime not null default CURRENT_TIMESTAMP,
                foreign key(pool_id) references pools(id) on delete CASCADE,
                foreign key(kaempfer1_id) references turnier_teilnehmer(id) on delete RESTRICT,
                foreign key(kaempfer2_id) references turnier_teilnehmer(id) on delete RESTRICT,
                foreign key(sieger_id) references turnier_teilnehmer(id) on delete SET NULL
            );
        `);
        await knex.raw(`
            INSERT INTO kaempfe_neu (id, pool_id, kaempfer1_id, kaempfer2_id, sieger_id,
                kampfzeit_in_sekunden, unterbewertung_kaempfer1, unterbewertung_kaempfer2,
                status, reihenfolge_nummer, matten_reihenfolge, created_at, updated_at)
            SELECT id, pool_id, kaempfer1_id, kaempfer2_id, sieger_id,
                kampfzeit_in_sekunden, unterbewertung_kaempfer1, unterbewertung_kaempfer2,
                status, reihenfolge_nummer, matten_reihenfolge, created_at, updated_at
            FROM kaempfe;
        `);
        await knex.raw('DROP TABLE kaempfe;');
        await knex.raw('ALTER TABLE kaempfe_neu RENAME TO kaempfe;');

        for (const idx of SQLITE_INDEXES) {
            await knex.raw(`CREATE INDEX \`${idx.name}\` on \`kaempfe\` (\`${idx.column}\`)`);
        }
        await knex.raw('PRAGMA foreign_keys = ON;');
    } else {
        await knex.raw(`ALTER TABLE kaempfe DROP CONSTRAINT check_verschiedene_kaempfer`);
        await knex.raw(`ALTER TABLE kaempfe DROP CONSTRAINT check_sieger_ist_teilnehmer`);
    }
}
