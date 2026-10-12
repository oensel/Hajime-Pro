// Legt die Datenbank-Rolle des Live-Prozesses an (Spec Abschnitt 5.1): nur SELECT auf die Views des Schemas "live",
// Schreiben gesperrt (default_transaction_read_only), Abfragen auf 3 s begrenzt. Idempotent; gedacht für das
// Installationsskript (deploy/linux/install-live.sh) und scripts/live-rolle.mjs, nicht für den laufenden Betrieb.
// Auf einem Cluster genügt der Aufruf am Master: Rollen und ihre Einstellungen replizieren zum Standby.
const ROLLENNAME = /^[a-z_][a-z0-9_]{0,62}$/;

function literal(text) {
    return `'${String(text).replace(/'/g, "''")}'`;
}

function bezeichner(text) {
    return `"${String(text).replace(/"/g, '""')}"`;
}

export async function legeLiveRolleAn(knex, { passwort, rolle = 'live_ro', datenbank }) {
    if (!ROLLENNAME.test(rolle)) throw new Error(`Ungültiger Rollenname: ${rolle}`);
    if (!passwort) throw new Error('Passwort für die Live-Rolle fehlt.');
    if (!datenbank) throw new Error('Name der Datenbank fehlt.');

    await knex.raw(`DO $$
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${literal(rolle)}) THEN
            CREATE ROLE ${rolle} LOGIN PASSWORD ${literal(passwort)};
        ELSE
            ALTER ROLE ${rolle} WITH LOGIN PASSWORD ${literal(passwort)};
        END IF;
    END $$;`);
    await knex.raw(`ALTER ROLE ${rolle} SET default_transaction_read_only = on`);
    await knex.raw(`ALTER ROLE ${rolle} SET statement_timeout = '3s'`);
    await knex.raw(`GRANT CONNECT ON DATABASE ${bezeichner(datenbank)} TO ${rolle}`);
    await knex.raw(`GRANT USAGE ON SCHEMA live TO ${rolle}`);
    await knex.raw(`GRANT SELECT ON ALL TABLES IN SCHEMA live TO ${rolle}`);
}
