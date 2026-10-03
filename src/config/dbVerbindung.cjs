// PostgreSQL-Verbindung für knexfile.cjs (Umgebung "online"). Zwei Schreibweisen:
//   DB_URL (oder DATABASE_URL)         komplette Verbindungs-URL, z.B. der Supabase-Pooler
//   DB_HOST/DB_USER/DB_PASSWORD/DB_NAME/DB_PORT   Einzelvariablen (Linux-Server, Cluster, lokale Entwicklung)
// Ist eine URL gesetzt, gewinnt sie und die Einzelvariablen werden ignoriert.
//
//   DB_SSL=true        TLS mit Zertifikatsprüfung
//   DB_SSL=no-verify   TLS ohne Zertifikatsprüfung (Standard bei gesetzter URL: verschlüsselt, aber
//                      Supabase-Pooler-Zertifikate sind nicht im Node-Vertrauensspeicher)
//   DB_SSL=false       kein TLS (Standard bei Einzelvariablen)
//   DB_URL_MIGRATION   optionale Direct-/Session-Verbindung für Migrationen (der Transaction-Pooler von
//                      Supabase verträgt keine Migrationen); ohne sie gilt DB_URL
//   DB_POOL_MAX        maximale Verbindungen (Standard 10)

function leseUrl(env, migration) {
    const wert = (name) => String(env[name] || '').trim();
    return (migration && wert('DB_URL_MIGRATION')) || wert('DB_URL') || wert('DATABASE_URL') || '';
}

function sslEinstellung(env, mitUrl) {
    const roh = String(env.DB_SSL || '').trim().toLowerCase();
    const modus = roh || (mitUrl ? 'no-verify' : 'false');
    if (['true', '1', 'verify'].includes(modus)) return { rejectUnauthorized: true };
    if (['no-verify', 'require'].includes(modus)) return { rejectUnauthorized: false };
    if (['false', '0', 'off'].includes(modus)) return false;
    throw new Error(`DB_SSL="${env.DB_SSL}" ist ungültig. Erlaubt: true, no-verify, false.`);
}

// pg lässt Werte aus der URL (sslmode=...) über das ssl-Objekt gewinnen — deshalb entfernen wir sie,
// DB_SSL ist die einzige Quelle.
function ohneSslParameter(url) {
    try {
        const u = new URL(url);
        for (const p of ['sslmode', 'ssl', 'sslcert', 'sslkey', 'sslrootcert']) u.searchParams.delete(p);
        return u.toString();
    } catch {
        return url;
    }
}

function baueVerbindung(env = process.env, { migration = false } = {}) {
    const url = leseUrl(env, migration);
    const ssl = sslEinstellung(env, Boolean(url));
    if (url) return { connectionString: ohneSslParameter(url), ssl };
    return {
        host: env.DB_HOST || '127.0.0.1',
        user: env.DB_USER || 'postgres',
        password: env.DB_PASSWORD || 'secret',
        database: env.DB_NAME || 'judo_cloud',
        port: env.DB_PORT || 5432,
        ssl
    };
}

function poolGroesse(env = process.env) {
    const n = Number(env.DB_POOL_MAX);
    return Number.isInteger(n) && n > 0 ? n : 10;
}

module.exports = { baueVerbindung, poolGroesse };
