// Ratenbegrenzung der öffentlichen Auth-Endpunkte (Registrierung, Bestätigungsmail erneut, Login) je Absenderadresse,
// gegen Mail-Bombing und Passwort-Raten. Zählt im Speicher (Festfenster, src/liveCloud/ratenbegrenzung.js); die
// Absenderadresse ermittelt clientIp (hinter einem eigenen Proxy LIVE_PROXY_VERTRAUEN=true setzen).
// Aktiv im Betriebsmodus cloud; AUTH_RATENLIMIT_AKTIV=true|false überschreibt das. Im Hallen-Server und in den
// Test-Suiten (viele Anmeldungen von localhost) ist sie damit standardmäßig aus.
import betriebsmodus from '../config/betriebsmodus.cjs';
import { erzeugeRatenbegrenzung, clientIp } from '../liveCloud/ratenbegrenzung.js';

export const MELDUNG_ZU_VIELE_ANFRAGEN = 'Zu viele Anfragen. Bitte versuche es später erneut.';
const ZEHN_MINUTEN = 10 * 60_000;

export function authRatenlimitAktiv(env = process.env) {
    const wert = String(env.AUTH_RATENLIMIT_AKTIV ?? '').trim().toLowerCase();
    if (wert === 'true') return true;
    if (wert === 'false') return false;
    return betriebsmodus.liesBetriebsmodus(env).istCloud;
}

/**
 * Express-Middleware: höchstens `max` Anfragen je Absender und Fenster, darüber 429.
 * @param {{ max: number, fensterMs?: number, aktiv?: boolean, jetzt?: () => number, env?: object }} optionen
 */
export function erzeugeAuthRatenbegrenzung({ max, fensterMs = ZEHN_MINUTEN, aktiv, jetzt, env = process.env }) {
    if (!(aktiv ?? authRatenlimitAktiv(env))) return (req, res, next) => next();
    const grenze = erzeugeRatenbegrenzung({ fensterMs, max, ...(jetzt ? { jetzt } : {}) });
    return (req, res, next) => {
        if (grenze.erlaube(clientIp(req, env))) return next();
        return res.status(429).json({ success: false, error: MELDUNG_ZU_VIELE_ANFRAGEN });
    };
}
