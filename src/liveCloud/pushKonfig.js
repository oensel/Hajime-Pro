// Konfiguration und Eingabeprüfung der Push-Nachrichten (Spec Phase 3). Ohne VAPID-Schlüsselpaar ist Push aus.
export const PUSH_SCHWELLE = 3;
const MAX_ENDPUNKT = 500;
const ERLAUBTE_HOSTS = [
    /^fcm\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)notify\.windows\.com$/,
    /^web\.push\.apple\.com$/, /(^|\.)push\.apple\.com$/
];

export function liesPushKonfig(env = process.env) {
    const publicKey = String(env.LIVE_PUSH_VAPID_PUBLIC || '');
    const privateKey = String(env.LIVE_PUSH_VAPID_PRIVATE || '');
    const betreff = String(env.LIVE_PUSH_BETREFF || '');
    return {
        aktiv: !!(publicKey && privateKey && betreff),
        publicKey, privateKey, betreff,
        tage: Number(env.LIVE_PUSH_AUFBEWAHRUNG_TAGE) || 3,
        maxAbos: Number(env.LIVE_PUSH_MAX_ABOS) || 5000
    };
}

export function istErlaubterEndpunkt(url) {
    if (typeof url !== 'string' || url.length === 0 || url.length > MAX_ENDPUNKT) return false;
    let u;
    try { u = new URL(url); } catch { return false; }
    if (u.protocol !== 'https:' || u.username || u.password) return false;
    return ERLAUBTE_HOSTS.some(muster => muster.test(u.hostname));
}
