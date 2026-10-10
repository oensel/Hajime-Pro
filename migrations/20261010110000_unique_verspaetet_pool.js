// Höchstens ein Sammelpool "Verspätet" je Turnier: schützt vor doppelter Anlage bei parallelem
// POST /api/pools/nachzuegler/sammeln (Teil-Index, PostgreSQL).
export async function up(knex) {
    await knex.raw('CREATE UNIQUE INDEX IF NOT EXISTS pools_verspaetet_eindeutig ON pools (turnier_id) WHERE verspaetet = true');
}

export async function down(knex) {
    await knex.raw('DROP INDEX IF EXISTS pools_verspaetet_eindeutig');
}
