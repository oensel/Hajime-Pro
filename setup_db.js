import knexLib from 'knex';
import knexConfig from './knexfile.cjs';
import betriebsmodus from './src/config/betriebsmodus.cjs';
import dotenv from 'dotenv';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config({ quiet: true });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const bm = betriebsmodus.liesBetriebsmodus();
if (bm.fehler.length) {
    bm.fehler.forEach(f => console.error(`❌ [Betriebsmodus] ${f}`));
    process.exit(1);
}
if (!bm.knexUmgebung) {
    console.error(`❌ Abgebrochen: Im Modus ${bm.modus} gibt es keine relationale Datenbank, die sich zurücksetzen ließe.`);
    process.exit(1);
}
const environment = bm.knexUmgebung;
const knex = knexLib(knexConfig[environment]);

// Dieses Skript leert die komplette Datenbank (DROP TABLE) und baut sie leer neu auf. Läuft es versehentlich
// gegen die PostgreSQL-Datenbank (z.B. vergessene .env-Umschaltung), würde das ohne jede Rückfrage die Cloud-
// bzw. Hallen-Datenbank treffen — inklusive vereine/benutzer aller Clubs bzw. des laufenden Turniers. Für
// PostgreSQL daher eine explizite, bewusste Bestätigung verlangen.
if (process.env.CONFIRM_ONLINE_RESET !== 'JA_WIRKLICH_LOESCHEN') {
    console.error(
        `❌ Abgebrochen: setup_db.js würde gegen die PostgreSQL-Datenbank laufen (Modus ${bm.modus}) und sie KOMPLETT ` +
        '(inkl. aller Vereine, Benutzer und Turniere) löschen.\n' +
        '   Falls das wirklich beabsichtigt ist, setze zusätzlich CONFIRM_ONLINE_RESET=JA_WIRKLICH_LOESCHEN.\n' +
        '   Für den lokalen Entwicklungsaufbau mit SQLite BETRIEBSMODUS=server und DB_CLIENT=sqlite in der .env setzen.'
    );
    process.exit(1);
}

async function main() {
    try {
        console.log(`🧹 Leere die Datenbank komplett im Modus: ${environment.toUpperCase()}...`);

        // Drop existing tables in correct order
        await knex.schema.dropTableIfExists('kaempfe');
        await knex.schema.dropTableIfExists('turnier_teilnehmer');
        await knex.schema.dropTableIfExists('pools');
        await knex.schema.dropTableIfExists('kampfflaechen');
        await knex.schema.dropTableIfExists('turniere');
        await knex.schema.dropTableIfExists('benutzer');
        await knex.schema.dropTableIfExists('vereine');
        await knex.schema.dropTableIfExists('knex_migrations');
        await knex.schema.dropTableIfExists('knex_migrations_lock');

        console.log('🏗️  Erstelle Tabellenschema neu...');

        // 1. vereine
        await knex.schema.createTable('vereine', (table) => {
            table.increments('id').primary();
            table.string('name').unique().notNullable();
            table.timestamps(true, true);
        });

        // 2. benutzer
        await knex.schema.createTable('benutzer', (table) => {
            table.string('id').primary();
            table.string('email').notNullable().unique();
            table.string('vorname').nullable();
            table.string('nachname').nullable();
            table.string('password_hash').nullable();
            table.integer('verein_id').unsigned().nullable()
                .references('id').inTable('vereine').onDelete('SET NULL');
            table.integer('verein_freigegeben').defaultTo(0);
            table.timestamps(true, true);
        });

        // 3. turniere
        await knex.schema.createTable('turniere', (table) => {
            table.increments('id').primary();
            table.string('bezeichnung').notNullable();
            table.string('ort').notNullable();
            table.date('datum').notNullable();
            table.string('ausrichter').notNullable();
            table.boolean('nutze_gewichtsklassen').defaultTo(true);
            table.integer('anzahl_kampfflaechen').defaultTo(1);
            table.integer('verein_id').unsigned().nullable()
                .references('id').inTable('vereine').onDelete('SET NULL');
            table.string('bundesland').nullable();
            table.text('altersklassen').nullable();
            table.string('status').notNullable().defaultTo('entwurf');
            table.date('anmeldeschluss').nullable();
            table.decimal('startgeld', 6, 2).nullable();
            table.string('iban').nullable();
            table.string('kontoinhaber').nullable();
            table.string('verwendungszweck').nullable();
            table.timestamps(true, true);
        });

        // 4. kampfflaechen
        await knex.schema.createTable('kampfflaechen', (table) => {
            table.increments('id').primary();
            table.integer('turnier_id').unsigned().notNullable()
                .references('id').inTable('turniere').onDelete('CASCADE');
            table.string('bezeichnung').notNullable();
            table.string('status').notNullable().defaultTo('frei');
            table.timestamps(true, true);
        });

        // 5. pools
        await knex.schema.createTable('pools', (table) => {
            table.increments('id').primary();
            table.integer('turnier_id').unsigned().notNullable()
                .references('id').inTable('turniere').onDelete('CASCADE');
            table.integer('kampfflaeche_id').unsigned().nullable()
                .references('id').inTable('kampfflaechen').onDelete('SET NULL');
            table.string('bezeichnung').notNullable();
            table.string('modus').defaultTo('Jeder-gegen-Jeden');
            table.string('altersklasse').notNullable();
            table.string('geschlecht').notNullable();
            table.string('gewichtsklasse').notNullable();
            table.integer('kampfzeit_sekunden').defaultTo(240);
            table.integer('matte_reihenfolge').nullable();
            table.string('status').notNullable().defaultTo('angelegt');
            table.boolean('golden_score_aktiv').notNullable().defaultTo(true);
            table.integer('golden_score_max_sekunden').nullable().defaultTo(null);
            table.timestamps(true, true);
            table.index('turnier_id', 'idx_pools_turnier_id');
        });

        // 6. turnier_teilnehmer
        await knex.schema.createTable('turnier_teilnehmer', (table) => {
            table.increments('id').primary();
            table.integer('turnier_id').unsigned().notNullable()
                .references('id').inTable('turniere').onDelete('CASCADE');
            table.integer('pool_id').unsigned().nullable()
                .references('id').inTable('pools').onDelete('SET NULL');
            table.string('judopass_id').notNullable();
            table.string('vorname').notNullable();
            table.string('nachname').notNullable();
            table.integer('geburtsjahr').notNullable();
            table.date('lizenz_ablauf').notNullable();
            table.string('geschlecht').notNullable();
            table.string('verein').nullable();
            table.decimal('gewicht', 5, 2).notNullable();
            table.string('altersklasse').notNullable();
            table.string('gewichtsklasse').notNullable();
            table.boolean('startgeld_bezahlt').defaultTo(false);
            table.string('graduierung').nullable();
            table.string('status').notNullable().defaultTo('angemeldet');
            table.timestamps(true, true);
            table.index('turnier_id', 'idx_turnier_teilnehmer_turnier_id');
        });

        // 7. kaempfe
        await knex.schema.createTable('kaempfe', (table) => {
            table.increments('id').primary();
            table.integer('pool_id').unsigned().notNullable()
                .references('id').inTable('pools').onDelete('CASCADE');
            table.integer('kaempfer1_id').unsigned().nullable()
                .references('id').inTable('turnier_teilnehmer').onDelete('RESTRICT');
            table.integer('kaempfer2_id').unsigned().nullable()
                .references('id').inTable('turnier_teilnehmer').onDelete('RESTRICT');
            table.integer('sieger_id').unsigned().nullable()
                .references('id').inTable('turnier_teilnehmer').onDelete('SET NULL');
            table.integer('kampfzeit_in_sekunden').defaultTo(0);
            table.integer('unterbewertung_kaempfer1').defaultTo(0);
            table.integer('unterbewertung_kaempfer2').defaultTo(0);
            table.string('status').notNullable().defaultTo('angelegt').index();
            table.string('reihenfolge_nummer').nullable().index();
            table.integer('matten_reihenfolge').nullable().index();
            table.integer('kaempfer1_quelle_kampf_id').unsigned().nullable()
                .references('id').inTable('kaempfe').onDelete('SET NULL');
            table.string('kaempfer1_quelle_typ').nullable();
            table.integer('kaempfer2_quelle_kampf_id').unsigned().nullable()
                .references('id').inTable('kaempfe').onDelete('SET NULL');
            table.string('kaempfer2_quelle_typ').nullable();
            table.string('gruppe').nullable();
            table.timestamps(true, true);
            table.index('pool_id', 'idx_kaempfe_pool_id');
            table.check('kaempfer1_id <> kaempfer2_id', [], 'check_verschiedene_kaempfer');
            table.check(
                'sieger_id IS NULL OR sieger_id IN (kaempfer1_id, kaempfer2_id)',
                [],
                'check_sieger_ist_teilnehmer'
            );
        });

        console.log('✅ Tabellenschema erfolgreich erstellt!');

    } catch (e) {
        console.error('❌ Fehler beim Setup:', e);
    } finally {
        await knex.destroy();
    }
}

main();
