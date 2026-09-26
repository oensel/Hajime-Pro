// PostgreSQL-Seite des Server-Clusters (Spec Abschnitt 9): Rolle der lokalen Instanz, Beförderung
// des Standby, Replikationsstatus und der automatische Wechsel synchron/asynchron.
//
// Synchron heißt: der Master bestätigt einen Commit erst, wenn der Standby ihn hat — fällt der
// Master aus, fehlt dem Secondary kein bestätigter Stand. Ist der Standby länger als
// ASYNCHRON_NACH_MS nicht verbunden, schaltet der Master auf asynchron, damit er weiterarbeiten
// kann ("ohne Absicherung"); streamt der Standby wieder, wird wieder synchron geschaltet.
// Der Name des Standby ist sein CLUSTER_KNOTEN (application_name in primary_conninfo).
export const ASYNCHRON_NACH_MS = 5000;

export function erzeugePgReplikation(knex, { partnerKnoten }) {
    let nichtVerbundenSeit = null;

    async function rolle() {
        const { rows } = await knex.raw('select pg_is_in_recovery() as standby');
        return rows[0].standby ? 'standby' : 'primary';
    }

    async function synchronKonfiguriert() {
        const { rows } = await knex.raw('show synchronous_standby_names');
        return !!(rows[0] && rows[0].synchronous_standby_names);
    }

    async function setzeSynchron(synchron) {
        // ALTER SYSTEM ist nicht transaktional und braucht Superuser-Rechte (siehe deploy/linux/README.md).
        await knex.raw(`alter system set synchronous_standby_names = '${synchron ? partnerKnoten : ''}'`);
        await knex.raw('select pg_reload_conf()');
    }

    async function befoerdere() {
        const { rows } = await knex.raw('select pg_promote(true, 60) as ok');
        if (!rows[0].ok) throw new Error('pg_promote() ist nicht innerhalb von 60 s abgeschlossen.');
        // Die Konfiguration kann vom früheren Master stammen und auf mich selbst als Standby zeigen —
        // bis der Partner wieder streamt, asynchron arbeiten (sonst hingen alle Commits).
        await setzeSynchron(false);
        nichtVerbundenSeit = null;
    }

    // Replikationsstatus aus Sicht des Primary (auf dem Standby: nur die Rolle).
    async function status() {
        const pgRolle = await rolle();
        if (pgRolle === 'standby') {
            const { rows } = await knex.raw(`select status, sender_host, sender_port from pg_stat_wal_receiver`);
            return { rolle: 'standby', empfaengt: !!(rows[0] && rows[0].status === 'streaming') };
        }
        const { rows } = await knex.raw(
            `select application_name, state, sync_state,
                    pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn)::bigint as rueckstand_bytes
               from pg_stat_replication where application_name = ?`, [partnerKnoten]);
        const r = rows[0] || null;
        const synchron = await synchronKonfiguriert();
        return {
            rolle: 'primary',
            standby_verbunden: !!(r && r.state === 'streaming'),
            sync_state: r ? r.sync_state : null,
            rueckstand_bytes: r && r.rueckstand_bytes != null ? Number(r.rueckstand_bytes) : null,
            synchron_konfiguriert: synchron,
            absicherung: synchron && r && r.sync_state === 'sync' ? 'synchron' : 'asynchron'
        };
    }

    // Einmal pro Prüfzyklus auf dem Master aufrufen.
    async function waechterSchritt(jetzt = Date.now()) {
        const s = await status();
        if (s.rolle !== 'primary') return s;
        if (s.standby_verbunden) {
            nichtVerbundenSeit = null;
            if (!s.synchron_konfiguriert) {
                await setzeSynchron(true);
                console.log(`[Cluster] Standby ${partnerKnoten} streamt wieder – Replikation synchron.`);
            }
        } else {
            if (!nichtVerbundenSeit) nichtVerbundenSeit = jetzt;
            if (s.synchron_konfiguriert && jetzt - nichtVerbundenSeit > ASYNCHRON_NACH_MS) {
                await setzeSynchron(false);
                console.warn(`[Cluster] Standby ${partnerKnoten} nicht verbunden – Replikation asynchron (ohne Absicherung).`);
            }
        }
        return s;
    }

    return { rolle, status, befoerdere, setzeSynchron, waechterSchritt };
}
