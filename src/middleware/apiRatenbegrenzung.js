// Allgemeine Ratenbegrenzung für angemeldete API-Bereiche (Helfer, Helferplan, Vereine, Nutzerverwaltung, Cloud-Zugriff),
// gegen Missbrauch durch einen einzelnen Absender. Nutzt express-rate-limit (Festfenster, im Speicher) mit großzügiger
// Grenze, damit normale Oberflächen (Zeitstrahl, Listen) nie gebremst werden. Aktiv wie die Auth-Ratenbegrenzung nur im
// Betriebsmodus cloud bzw. mit AUTH_RATENLIMIT_AKTIV=true; im Hallen-Server und in den Tests ist sie aus.
import rateLimit from 'express-rate-limit';
import { authRatenlimitAktiv, ratenSchluessel, MELDUNG_ZU_VIELE_ANFRAGEN } from './authRatenbegrenzung.js';
import { clientIp } from '../liveCloud/ratenbegrenzung.js';

export function erzeugeApiRatenbegrenzung({ max = 600, fensterMs = 60_000, env = process.env } = {}) {
    const aktiv = authRatenlimitAktiv(env);
    return rateLimit({
        windowMs: fensterMs,
        limit: max,
        standardHeaders: true,
        legacyHeaders: false,
        skip: () => !aktiv,
        keyGenerator: (req) => ratenSchluessel(clientIp(req, env)),
        validate: false,
        handler: (req, res) => res.status(429).json({ success: false, error: MELDUNG_ZU_VIELE_ANFRAGEN })
    });
}
