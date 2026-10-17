// Ratenbegrenzung der öffentlichen Auth-Endpunkte (Registrierung, Bestätigungsmail erneut, Login), gegen Mail-Bombing
// und Passwort-Raten. Zählt im Speicher (Festfenster, src/liveCloud/ratenbegrenzung.js), wahlweise
//   - je Absender (schluessel 'ip'): Adresse aus clientIp (hinter einem eigenen Proxy LIVE_PROXY_VERTRAUEN=true setzen),
//     IPv6 zusammengefasst je /64 (ratenSchluessel), oder
//   - je normalisierter E-Mail-Adresse aus dem Body (schluessel 'email'), damit verteilte Versuche auf ein Konto
//     ebenfalls gebremst werden; gilt für jede Adresse gleich, ob es ein Konto gibt oder nicht.
// Ist die Tabelle voll, werden neue Schlüssel abgewiesen (beiVollstand 'sperren'), statt laufende Zähler zu verdrängen.
// Aktiv im Betriebsmodus cloud; AUTH_RATENLIMIT_AKTIV=true|false überschreibt das. Im Hallen-Server und in den
// Test-Suiten (viele Anmeldungen von localhost) ist sie damit standardmäßig aus.
import net from 'node:net';
import betriebsmodus from '../config/betriebsmodus.cjs';
import { erzeugeRatenbegrenzung, clientIp } from '../liveCloud/ratenbegrenzung.js';
import { normalisiereEmail } from '../services/registrierung.js';

export const MELDUNG_ZU_VIELE_ANFRAGEN = 'Zu viele Anfragen. Bitte versuche es später erneut.';
const ZEHN_MINUTEN = 10 * 60_000;

export function authRatenlimitAktiv(env = process.env) {
    const wert = String(env.AUTH_RATENLIMIT_AKTIV ?? '').trim().toLowerCase();
    if (wert === 'true') return true;
    if (wert === 'false') return false;
    return betriebsmodus.liesBetriebsmodus(env).istCloud;
}

// IPv6-Adresse als 8 Gruppen (Zahlen), oder null.
function ipv6Gruppen(adresse) {
    let a = adresse.toLowerCase();
    const v4 = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(a);
    if (v4) {
        const b = v4[1].split('.').map(Number);
        a = a.slice(0, -v4[1].length) + `${((b[0] << 8) | b[1]).toString(16)}:${((b[2] << 8) | b[3]).toString(16)}`;
    }
    const [vorn, hinten] = a.includes('::') ? a.split('::') : [a, null];
    const teil = (s) => (s ? s.split(':') : []);
    const links = teil(vorn);
    const rechts = hinten === null ? [] : teil(hinten);
    const fehlend = 8 - links.length - rechts.length;
    if (hinten === null ? fehlend !== 0 : fehlend < 0) return null;
    return [...links, ...Array(fehlend).fill('0'), ...rechts].map((g) => parseInt(g, 16));
}

/**
 * Schlüssel einer Absenderadresse für die Ratenbegrenzung: IPv4 unverändert, IPv4-mapped IPv6 (::ffff:a.b.c.d) wie
 * IPv4, sonstiges IPv6 als /64-Präfix (ein Anschluss bekommt meist ein ganzes /64). Andere Werte unverändert.
 */
export function ratenSchluessel(ip) {
    const roh = String(ip ?? '').trim().replace(/%.*$/, '');
    const art = net.isIP(roh);
    if (art !== 6) return roh;
    const g = ipv6Gruppen(roh);
    if (!g) return roh;
    if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) {
        return [g[6] >> 8, g[6] & 0xff, g[7] >> 8, g[7] & 0xff].join('.');
    }
    return `${g.slice(0, 4).map((x) => x.toString(16)).join(':')}::/64`;
}

/**
 * Express-Middleware: höchstens `max` Anfragen je Schlüssel und Fenster, darüber 429. Für schluessel 'email' muss der
 * Body bereits gelesen sein (express.json vor dem Router); Anfragen ohne Adresse zählen dort nicht.
 * @param {{ max: number, schluessel?: 'ip'|'email', fensterMs?: number, maxEintraege?: number, aktiv?: boolean,
 *           jetzt?: () => number, env?: object }} optionen
 */
export function erzeugeAuthRatenbegrenzung({
    max, schluessel = 'ip', fensterMs = ZEHN_MINUTEN, maxEintraege = 50_000, aktiv, jetzt, env = process.env
}) {
    if (!(aktiv ?? authRatenlimitAktiv(env))) return (req, res, next) => next();
    const grenze = erzeugeRatenbegrenzung({
        fensterMs, max, maxEintraege, beiVollstand: 'sperren', ...(jetzt ? { jetzt } : {})
    });
    const ermittle = schluessel === 'email'
        ? (req) => normalisiereEmail(req.body && req.body.email)
        : (req) => ratenSchluessel(clientIp(req, env));
    return (req, res, next) => {
        const s = ermittle(req);
        if (!s || grenze.erlaube(s)) return next();
        return res.status(429).json({ success: false, error: MELDUNG_ZU_VIELE_ANFRAGEN });
    };
}
