// Wählt die knex-Umgebung aus knexfile.cjs: immer "online" (PostgreSQL). Die Entscheidung trifft
// src/config/betriebsmodus.cjs; der Client hat keine relationale Datenbank.
import betriebsmodus from '../config/betriebsmodus.cjs';

export function waehleKnexUmgebung(env = process.env) {
    return betriebsmodus.liesBetriebsmodus(env).knexUmgebung || 'online';
}
