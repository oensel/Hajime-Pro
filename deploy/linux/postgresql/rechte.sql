-- Einmalig auf dem ersten Master (server1) als postgres ausführen; der Standby übernimmt alles per
-- Replikation. Passwörter ANPASSEN.

-- App-Nutzer: Tabellen der Datenbank hajime + die Cluster-Funktionen, ohne Superuser.
CREATE ROLE hajime LOGIN PASSWORD 'ANPASSEN';
CREATE DATABASE hajime OWNER hajime;
GRANT EXECUTE ON FUNCTION pg_promote(boolean, integer) TO hajime;
GRANT EXECUTE ON FUNCTION pg_reload_conf() TO hajime;
GRANT ALTER SYSTEM ON PARAMETER synchronous_standby_names TO hajime;
GRANT pg_monitor TO hajime;

-- Replikationsnutzer (Streaming + pg_rewind).
CREATE ROLE replikator LOGIN REPLICATION PASSWORD 'ANPASSEN';
GRANT EXECUTE ON FUNCTION pg_catalog.pg_ls_dir(text, boolean, boolean) TO replikator;
GRANT EXECUTE ON FUNCTION pg_catalog.pg_stat_file(text, boolean) TO replikator;
GRANT EXECUTE ON FUNCTION pg_catalog.pg_read_binary_file(text) TO replikator;
GRANT EXECUTE ON FUNCTION pg_catalog.pg_read_binary_file(text, bigint, bigint, boolean) TO replikator;
