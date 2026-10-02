// Wählt die knex-Umgebung aus knexfile.cjs: "online" = PostgreSQL, "offline" = SQLite. Die Entscheidung
// trifft src/config/betriebsmodus.cjs (cloud/server -> PostgreSQL; server mit DB_CLIENT=sqlite bzw. das
// bisherige IS_OFFLINE=true ohne DB_CLIENT=pg -> SQLite). Der Client hat keine relationale Datenbank.
import betriebsmodus from '../config/betriebsmodus.cjs';

export function waehleKnexUmgebung(env = process.env) {
    return betriebsmodus.liesBetriebsmodus(env).knexUmgebung || 'online';
}
