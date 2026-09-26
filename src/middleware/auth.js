import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import { hatVereinsZugriffAufTurnier, ladeBenutzerMitAktivemVerein } from '../utils/vereinHelper.js';
dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET || 'hajime_pro_secret_key_123456!';

export async function requireAuth(req, res, next) {
    if (process.env.IS_OFFLINE === 'true') {
        req.user = { id: 'offline_user', email: 'offline@hajime.os' };
        
        const knex = req.app.get('knex');
        if (knex) {
            try {
                const existing = await knex('benutzer').where({ id: 'offline_user' }).first();
                if (!existing) {
                    let offlineVerein = await knex('vereine').where({ name: 'Offline Club' }).first();
                    if (!offlineVerein) {
                        const [inserted] = await knex('vereine').insert({ name: 'Offline Club' }).returning('id');
                        offlineVerein = { id: typeof inserted === 'object' ? inserted.id : inserted };
                    }

                    await knex('benutzer').insert({
                        id: 'offline_user',
                        email: 'offline@hajime.os',
                        vorname: 'Offline',
                        nachname: 'User',
                        aktiver_verein_id: offlineVerein.id
                    });
                    await knex('benutzer_vereine').insert({
                        benutzer_id: 'offline_user',
                        verein_id: offlineVerein.id,
                        freigegeben: 1
                    });
                    console.log('[DB] Offline-Mock-User "offline_user" wurde angelegt.');
                }
            } catch (err) {
                console.error('[DB-Fehler Offline-User]:', err.message);
            }
        }
        return next();
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, error: 'Authentifizierung erforderlich. Token fehlt.' });
    }

    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded; // { id: DokuMeUserId, email }
        next();
    } catch (error) {
        return res.status(401).json({ success: false, error: 'Ungültiges oder abgelaufenes Token.' });
    }
}

/**
 * Resolves the turnierId a request refers to, from path parameters, query params,
 * request body, or by looking up the referenced pool/teilnehmer/kampfflaeche/kampf.
 * Used by requireTournamentEditAccess.
 * @param {Object} knex - Knex instance
 * @param {Object} req - Express request
 * @returns {Promise<string|number|null>}
 */
async function resolveTurnierId(knex, req) {
    // Extract turnierId from path parameters, query params, or request body.
    let turnierId = req.params.turnierId || req.query.turnierId || req.body.turnierId || req.body.turnier_id;

    // Context-based extraction if turnierId is not directly provided:
    if (!turnierId) {
        const baseUrl = req.baseUrl; // e.g. /api/turniere, /api/pools, /api/teilnehmer, /api/kaempfe, /api/kampfflaechen

        if (baseUrl === '/api/turniere' && req.params.id) {
            turnierId = req.params.id;
        } else if (baseUrl === '/api/pools' && req.params.id) {
            const pool = await knex('pools').where({ id: req.params.id }).first();
            if (pool) turnierId = pool.turnier_id;
        } else if (baseUrl === '/api/teilnehmer' && req.params.id) {
            const athlet = await knex('turnier_teilnehmer').where({ id: req.params.id }).first();
            if (athlet) turnierId = athlet.turnier_id;
        } else if (baseUrl === '/api/kampfflaechen' && req.params.id) {
            const kf = await knex('kampfflaechen').where({ id: req.params.id }).first();
            if (kf) turnierId = kf.turnier_id;
        } else if (baseUrl === '/api/kaempfe' && req.params.id) {
            const kampf = await knex('kaempfe').where({ id: req.params.id }).first();
            if (kampf) {
                const pool = await knex('pools').where({ id: kampf.pool_id }).first();
                if (pool) turnierId = pool.turnier_id;
            }
        }
    }

    // Kontext-Parameter aus Query-String ODER Request-Body auflösen (GET-Listenabfragen
    // wie "/api/kaempfe?kampfflaecheId=..." nutzen Query, POST/PUT-Aktionen den Body).
    if (!turnierId) {
        const teilnehmerId = req.query.teilnehmerId || req.body.teilnehmerId;
        const poolId = req.query.poolId || req.query.pool_id || req.body.poolId || req.body.pool_id;
        const kampfflaecheId = req.query.kampflaecheId || req.query.kampfflaecheId || req.query.kampfflaeche_id
            || req.body.kampflaecheId || req.body.kampfflaecheId || req.body.kampfflaeche_id;

        if (teilnehmerId) {
            const athlet = await knex('turnier_teilnehmer').where({ id: teilnehmerId }).first();
            if (athlet) turnierId = athlet.turnier_id;
        } else if (poolId) {
            const pool = await knex('pools').where({ id: poolId }).first();
            if (pool) turnierId = pool.turnier_id;
        } else if (kampfflaecheId) {
            const kf = await knex('kampfflaechen').where({ id: kampfflaecheId }).first();
            if (kf) turnierId = kf.turnier_id;
        }
    }

    return turnierId || null;
}

/**
 * Middleware factory to check that the authenticated user is an approved (freigegeben)
 * member of the club hosting the tournament (turnier.verein_id). This is the single access
 * rule for managing a tournament and its content (editing the tournament itself, pools/
 * Auslosung, Kampfflächen, Kämpfe) — there is no separate "owner"
 * concept; club membership alone governs access.
 * @param {Object} knex - Knex instance
 */
export function requireTournamentEditAccess(knex) {
    return async (req, res, next) => {
        if (process.env.IS_OFFLINE === 'true') {
            return next();
        }

        try {
            const userId = req.user.id;
            const turnierId = await resolveTurnierId(knex, req);

            if (!turnierId) {
                return res.status(400).json({ success: false, error: 'Turnier-ID konnte nicht ermittelt werden.' });
            }

            const turnier = await knex('turniere').where({ id: parseInt(turnierId) }).first();
            if (!turnier) {
                return res.status(404).json({ success: false, error: 'Turnier nicht gefunden.' });
            }

            const user = await ladeBenutzerMitAktivemVerein(knex, userId);

            if (!hatVereinsZugriffAufTurnier(user, turnier)) {
                return res.status(403).json({
                    success: false,
                    error: 'Kein Zugriff auf dieses Turnier. Sie sind kein freigegebenes Mitglied des ausrichtenden Vereins.'
                });
            }

            req.tournament = turnier;
            next();
        } catch (error) {
            console.error('[Tournament-Edit-Access-Check-Fehler]:', error);
            return res.status(500).json({ success: false, error: 'Interner Server-Fehler bei der Berechtigungsprüfung.' });
        }
    };
}

/**
 * Middleware factory to block write operations on the tournament's competition data (pools,
 * Kampfflächen, Kämpfe) once the tournament is 'abgesagt' or
 * 'abgeschlossen'. Deliberately separate from requireTournamentEditAccess: that middleware is
 * also used by turnierRoutes.js's own lifecycle endpoints (absagen/löschen eines abgesagten
 * Turniers etc.), which have their own, more specific status rules and must NOT be blocked here.
 * Reading/exporting stays available in both modes (archival) — only apply to write routes.
 * @param {Object} knex - Knex instance
 */
export function requireTurnierAktiv(knex) {
    return async (req, res, next) => {
        try {
            const turnierId = await resolveTurnierId(knex, req);
            if (!turnierId) {
                return res.status(400).json({ success: false, error: 'Turnier-ID konnte nicht ermittelt werden.' });
            }

            const turnier = await knex('turniere').where({ id: parseInt(turnierId) }).first();
            if (!turnier) {
                return res.status(404).json({ success: false, error: 'Turnier nicht gefunden.' });
            }

            if (turnier.status === 'abgesagt' || turnier.status === 'abgeschlossen') {
                return res.status(403).json({
                    success: false,
                    error: 'Dieses Turnier ist abgesagt oder abgeschlossen — der Wettkampfbetrieb (Pools, Kampfflächen, Kämpfe) kann nicht mehr verändert werden.'
                });
            }

            next();
        } catch (error) {
            console.error('[Turnier-Aktiv-Check-Fehler]:', error);
            return res.status(500).json({ success: false, error: 'Interner Server-Fehler bei der Turnier-Statusprüfung.' });
        }
    };
}

/**
 * Middleware factory to check that the authenticated user's club membership
 * has been approved before allowing write access to tournaments.
 * @param {Object} knex - Knex instance
 */
export function requireVereinFreigabe(knex) {
    return async (req, res, next) => {
        if (process.env.IS_OFFLINE === 'true') {
            return next();
        }

        try {
            const user = await ladeBenutzerMitAktivemVerein(knex, req.user.id);
            if (!user || !user.verein_freigegeben) {
                return res.status(403).json({
                    success: false,
                    error: 'Ihr Vereinsbeitritt wurde noch nicht freigegeben.'
                });
            }
            next();
        } catch (error) {
            console.error('[Verein-Freigabe-Check-Fehler]:', error);
            return res.status(500).json({ success: false, error: 'Interner Server-Fehler bei der Freigabe-Prüfung.' });
        }
    };
}

/**
 * Middleware factory to restrict a route to the Super-Admin (Bootstrapping-Rolle, siehe
 * src/utils/superAdmin.js). Nicht an Vereinsmitgliedschaft gebunden.
 * @param {Object} knex - Knex instance
 */
export function requireSuperAdmin(knex) {
    return async (req, res, next) => {
        try {
            const benutzer = await knex('benutzer').where({ id: req.user.id }).first();
            if (!benutzer || !benutzer.ist_super_admin) {
                return res.status(403).json({ success: false, error: 'Nur der Super-Admin hat Zugriff auf diese Funktion.' });
            }
            next();
        } catch (error) {
            console.error('[Super-Admin-Check-Fehler]:', error);
            return res.status(500).json({ success: false, error: 'Interner Server-Fehler bei der Berechtigungsprüfung.' });
        }
    };
}

export function requireWriteAuth(req, res, next) {
    const password = process.env.STEUERUNG_PASSWORD;
    if (!password) {
        return next();
    }
    
    // Allow read-only operations for all clients (dashboard, public screens)
    if (req.method === 'GET') {
        return next();
    }
    
    // Verify password for write operations (POST, PUT, DELETE)
    const clientPassword = req.headers['x-steuerung-password'];
    if (clientPassword === password) {
        return next();
    }
    
    return res.status(401).json({ success: false, error: 'Passwort erforderlich für Schreibzugriff.' });
}
