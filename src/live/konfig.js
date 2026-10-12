// Liest die Umgebungsvariablen des Live-Prozesses (Datei /opt/hajime-pro/live.env unter systemd).
// Alles Pflichtige wird beim Start geprüft, damit ein Fehler sofort und mit Klartext sichtbar wird.
const PFLICHT = ['LIVE_DB_PASSWORD', 'LIVE_UPLINK_URL', 'LIVE_UPLINK_TOKEN', 'LIVE_SCHLUESSEL'];

export function liesLiveKonfig(env = process.env) {
    for (const name of PFLICHT) {
        if (!env[name]) throw new Error(`${name} ist nicht gesetzt.`);
    }
    const url = new URL(env.LIVE_UPLINK_URL);
    const lokal = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.protocol !== 'https:' && !lokal) {
        throw new Error('LIVE_UPLINK_URL muss https verwenden.');
    }
    const intervallMs = Number(env.LIVE_INTERVALL_MS || 5000);
    if (!Number.isFinite(intervallMs) || intervallMs < 1000) {
        throw new Error('LIVE_INTERVALL_MS muss mindestens 1000 sein.');
    }
    return {
        db: {
            host: env.LIVE_DB_HOST || '127.0.0.1',
            port: Number(env.LIVE_DB_PORT || 5432),
            user: env.LIVE_DB_USER || 'live_ro',
            password: env.LIVE_DB_PASSWORD,
            database: env.LIVE_DB_NAME || 'hajime'
        },
        uplinkUrl: env.LIVE_UPLINK_URL,
        token: env.LIVE_UPLINK_TOKEN,
        geheimnis: env.LIVE_SCHLUESSEL,
        zustandDatei: env.LIVE_ZUSTAND_DATEI || '/var/lib/hajime-live/gesendet.json',
        intervallMs
    };
}
