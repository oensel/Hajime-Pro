export function up(knex) {
  return knex.schema
    // 1. Tabelle: turniere
    .createTable('turniere', (table) => {
      table.increments('id').primary();
      table.string('bezeichnung').notNullable();
      table.string('ort').notNullable();
      table.date('datum').notNullable();
      table.string('ausrichter').notNullable();
      table.boolean('nutze_gewichtsklassen').defaultTo(true);
      table.integer('anzahl_kampfflaechen').defaultTo(1);
      table.timestamps(true, true); // Erzeugt created_at und updated_at
    })

    // 2. Tabelle: kampfflaechen
    .createTable('kampfflaechen', (table) => {
      table.increments('id').primary();
      table.integer('turnier_id').unsigned().notNullable()
        .references('id').inTable('turniere').onDelete('CASCADE');
      table.string('bezeichnung').notNullable(); // z.B. "Matte 1"
      table.timestamps(true, true);
    })

    // 3. Tabelle: pools (Verschmolzene Einheit aus Wettkampfklasse + Pool)
    .createTable('pools', (table) => {
      table.increments('id').primary();
      table.integer('turnier_id').unsigned().notNullable()
        .references('id').inTable('turniere').onDelete('CASCADE');
      table.integer('kampfflaeche_id').unsigned().nullable()
        .references('id').inTable('kampfflaechen').onDelete('SET NULL'); // Initial NULL vor Zuweisung
      table.string('bezeichnung').notNullable(); // z.B. "U18 Männlich -70kg"
      table.string('modus').defaultTo('Jeder-gegen-Jeden');
      table.string('altersklasse').notNullable();
      table.string('geschlecht').notNullable();
      table.string('gewichtsklasse').notNullable();
      table.integer('kampfzeit_sekunden').defaultTo(240); // Direkt aus JSON "kampfzeit"
      table.timestamps(true, true);
    })

    // 4. Tabelle: turnier_teilnehmer
    // Da Sie die Zuordnung direkt beim Erstellen des Teilnehmers per Code/Trigger steuern wollen,
    // verweist der Teilnehmer direkt auf seinen zugewiesenen Pool (die Wettkampfklasse).
    .createTable('turnier_teilnehmer', (table) => {
      table.increments('id').primary();
      table.integer('turnier_id').unsigned().notNullable()
        .references('id').inTable('turniere').onDelete('CASCADE');
      table.integer('pool_id').unsigned().nullable()
        .references('id').inTable('pools').onDelete('SET NULL'); // Verknüpfung zum Pool
      table.string('judopass_id').notNullable();
      table.string('vorname').notNullable();
      table.string('nachname').notNullable();
      table.date('geburtsdatum').notNullable();
      table.date('lizenz_ablauf').notNullable();
      table.string('geschlecht').notNullable();
      table.string('verein').notNullable();
      table.decimal('gewicht', 5, 2).notNullable();
      table.string('altersklasse').notNullable();
      table.string('gewichtsklasse').notNullable();
      table.timestamps(true, true);
    })

    // 5. Tabelle: kaempfe
    .createTable('kaempfe', (table) => {
      table.increments('id').primary();
      table.integer('pool_id').unsigned().notNullable()
        .references('id').inTable('pools').onDelete('CASCADE');
      
      // Kämpfer-Referenzen zeigen auf die isolierten turnier_teilnehmer IDs
      table.integer('kaempfer1_id').unsigned().notNullable()
        .references('id').inTable('turnier_teilnehmer').onDelete('RESTRICT');
      table.integer('kaempfer2_id').unsigned().notNullable()
        .references('id').inTable('turnier_teilnehmer').onDelete('RESTRICT');
      
      table.integer('sieger_id').unsigned().nullable()
        .references('id').inTable('turnier_teilnehmer').onDelete('SET NULL');
      
      table.integer('kampfzeit_in_sekunden').defaultTo(0);
      table.integer('unterbewertung_kaempfer1').defaultTo(0);
      table.integer('unterbewertung_kaempfer2').defaultTo(0);
      table.timestamps(true, true);
    });
}

export function down(knex) {
  // Löschen in exakt umgekehrter Reihenfolge, um Foreign-Key-Fehler zu vermeiden
  return knex.schema
    .dropTableIfExists('kaempfe')
    .dropTableIfExists('turnier_teilnehmer')
    .dropTableIfExists('pools')
    .dropTableIfExists('kampfflaechen')
    .dropTableIfExists('turniere');
}
