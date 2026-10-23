import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import { hatVereinsZugriffAufTurnier, ladeBenutzerMitAktivemVerein, istSuperAdminAktiv, ladeVereinIdsMitRolle } from '../utils/vereinHelper.js';
import { rolleReicht } from '../shared/rollen.js';
import * as steuerungPasswort from '../utils/steuerungPasswort.js';
import { istKontoGesperrt, MELDUNG_KONTO_GESPERRT } from '../utils/kontoSperre.js';
import betriebsmodus from '../config/betriebsmodus.cjs';
const { istEinzelbenutzerBetrieb } = betriebsmodus;
dotenv.config({ quiet: true });

const JWT_SECRET = process.env.JWT_SECRET || 'hajime_pro_secret_key_123456!';

export async function requireAuth(req, res, next) {
    if (istEinzelbenutzerBetrieb()) {
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
                        email_bestaetigt_am: knex.fn.now(),
                        aktiver_verein_id: offlineVerein.id
                    });
                    await knex('benutzer_vereine').insert({
                        benutzer_id: 'offline_user',
                        verein_id: offlineVerein.id,
                        freigegeben: 1,
                        rolle: 'admin'
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
    } catch (error) {
        return res.status(401).json({ success: false, error: 'Ungültiges oder abgelaufenes Token.' });
    }
    // Gesperrte Konten (Super-Admin) verlieren den Zugriff sofort, auch mit noch gültigem Token. 401, damit die
    // Oberfläche (menu.js) zur Anmeldung zurückleitet.
    const knex = req.app && req.app.get ? req.app.get('knex') : null;
    if (knex) {
        try {
            if (await istKontoGesperrt(knex, req.user.id)) {
                return res.status(401).json({ success: false, code: 'gesperrt', error: MELDUNG_KONTO_GESPERRT });
            }
        } catch (err) {
            console.error('[Auth] Sperrprüfung fehlgeschlagen:', err.message);
        }
    }
    next();
}

/**
 * Turnier-ID zu einer Tätigkeit, einem Slot oder einem Einsatz des Helferplans (genau eine Angabe).
 * @returns {Promise<number|null>} null, wenn der Datensatz nicht existiert
 */
export async function ermittleHelferplanTurnierId(knex, { taetigkeitId, slotId, einsatzId }) {
    const ganzzahl = (w) => (/^\d+$/.test(String(w)) ? parseInt(w, 10) : null);
    let abfrage;
    if (taetigkeitId != null) {
        const tid = ganzzahl(taetigkeitId);
        if (tid == null) return null;
        abfrage = knex('helfer_taetigkeiten as t').where('t.id', tid);
    } else if (slotId != null) {
        const sid = ganzzahl(slotId);
        if (sid == null) return null;
        abfrage = knex('helfer_slots as s').join('helfer_taetigkeiten as t', 't.id', 's.taetigkeit_id').where('s.id', sid);
    } else if (einsatzId != null) {
        const eid = ganzzahl(einsatzId);
        if (eid == null) return null;
        abfrage = knex('helfer_einsaetze as e')
            .join('helfer_slots as s', 's.id', 'e.slot_id')
            .join('helfer_taetigkeiten as t', 't.id', 's.taetigkeit_id')
            .where('e.id', eid);
    } else {
        return null;
    }
    const zeile = await abfrage.first('t.turnier_id');
    return zeile ? zeile.turnier_id : null;
}

/**
 * Turnier-ID zu einer Orga-Aufgabe (null bei unbekannter oder ungültiger ID).
 * @returns {Promise<number|null>}
 */
export async function ermittleOrgaTurnierId(knex, aufgabeId) {
    if (!/^\d+$/.test(String(aufgabeId)) || Number(aufgabeId) > 2147483647) return null;
    const zeile = await knex('orga_aufgaben').where({ id: parseInt(aufgabeId, 10) }).first('turnier_id');
    return zeile ? zeile.turnier_id : null;
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
    // Helferplan (/api/helfer-plan): Tätigkeits-, Slot- und Einsatz-IDs im Pfad bestimmen das Turnier allein —
    // eine turnierId in Body/Query darf sie nicht überstimmen (sonst autorisiert das Gate ein anderes Turnier
    // als das, zu dem der Datensatz gehört). Unbekannte ID → null (die Routen melden vorher 404).
    if (req.baseUrl === '/api/helfer-plan') {
        const { taetigkeitId, slotId, einsatzId } = req.params || {};
        if (taetigkeitId || slotId || einsatzId) {
            return ermittleHelferplanTurnierId(knex, { taetigkeitId, slotId, einsatzId });
        }
    }

    // Orga-Planer (/api/orga): die Aufgaben-ID im Pfad bestimmt das Turnier allein (Body/Query dürfen es nicht überstimmen).
    if (req.baseUrl === '/api/orga' && req.params && req.params.id) {
        return ermittleOrgaTurnierId(knex, req.params.id);
    }

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
 * Middleware factory to check that the authenticated user may manage the tournament: Super-Admin,
 * or an approved (freigegeben) member of the hosting club (turnier.verein_id) with at least the role
 * 'benutzer' (hatVereinsZugriffAufTurnier). Reine Helfer bekommen 403, auch wenn der Verein ihr
 * aktiver Verein ist. Gilt für das Turnier selbst und seinen Inhalt (Pools/Auslosung, Kampfflächen,
 * Kämpfe) — es gibt keinen separaten "Besitzer".
 * @param {Object} knex - Knex instance
 */
export function requireTournamentEditAccess(knex) {
    return async (req, res, next) => {
        if (istEinzelbenutzerBetrieb()) {
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
                    error: 'Kein Zugriff auf dieses Turnier. Verwalten dürfen nur freigegebene Admins und Benutzer des ausrichtenden Vereins.'
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
 * Middleware factory to check that the authenticated user's club membership in the active club
 * has been approved with at least the role 'benutzer' before allowing write access to tournaments
 * (Turnier anlegen, veröffentlichen, absagen, …). Super-Admin immer erlaubt.
 * @param {Object} knex - Knex instance
 */
export function requireVereinFreigabe(knex) {
    return async (req, res, next) => {
        if (istEinzelbenutzerBetrieb()) {
            return next();
        }

        try {
            const user = await ladeBenutzerMitAktivemVerein(knex, req.user.id);
            if (user && user.super_admin_aktiv) return next();
            if (!user || !user.verein_freigegeben) {
                return res.status(403).json({
                    success: false,
                    error: 'Ihr Vereinsbeitritt wurde noch nicht freigegeben.'
                });
            }
            if (!rolleReicht(user.verein_rolle, 'benutzer')) {
                return res.status(403).json({
                    success: false,
                    error: 'Mit Ihrer Rolle in diesem Verein dürfen Sie das nicht.'
                });
            }
            next();
        } catch (error) {
            console.error('[Verein-Freigabe-Check-Fehler]:', error);
            return res.status(500).json({ success: false, error: 'Interner Server-Fehler bei der Freigabe-Prüfung.' });
        }
    };
}

const ROLLEN_BEZEICHNUNG = { admin: 'Admin', benutzer: 'Benutzer', helfer: 'Helfer' };

/**
 * Middleware factory: verlangt im aktiven Verein mindestens die angegebene Rolle (freigegebene
 * Mitgliedschaft). Super-Admin und Einzelbenutzerbetrieb sind immer erlaubt.
 * Setzt req.vereinRolle (null beim Super-Admin ohne passende Mitgliedschaft und im Einzelbenutzerbetrieb).
 * @param {Object} knex - Knex instance
 * @param {'helfer'|'benutzer'|'admin'} mindestens
 */
export function requireRolle(knex, mindestens) {
    return async (req, res, next) => {
        if (istEinzelbenutzerBetrieb()) {
            req.vereinRolle = null;
            return next();
        }

        try {
            const user = await ladeBenutzerMitAktivemVerein(knex, req.user.id);
            req.vereinRolle = user ? user.verein_rolle : null;
            if (user && (user.super_admin_aktiv || rolleReicht(user.verein_rolle, mindestens))) {
                return next();
            }
            return res.status(403).json({
                success: false,
                error: `Dafür ist im aktiven Verein mindestens die Rolle ${ROLLEN_BEZEICHNUNG[mindestens] || mindestens} nötig.`
            });
        } catch (error) {
            console.error('[Rollen-Check-Fehler]:', error);
            return res.status(500).json({ success: false, error: 'Interner Server-Fehler bei der Berechtigungsprüfung.' });
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
            if (!istSuperAdminAktiv(benutzer)) {
                const imVerein = !!(benutzer && benutzer.ist_super_admin);
                return res.status(403).json({
                    success: false,
                    error: imVerein
                        ? 'Wechseln Sie oben rechts in den Super-Admin-Modus, um diese Funktion zu nutzen.'
                        : 'Nur der Super-Admin hat Zugriff auf diese Funktion.'
                });
            }
            next();
        } catch (error) {
            console.error('[Super-Admin-Check-Fehler]:', error);
            return res.status(500).json({ success: false, error: 'Interner Server-Fehler bei der Berechtigungsprüfung.' });
        }
    };
}

/**
 * Benutzerverwaltung (Seite „Benutzer“/„Mitglieder“): Super-Admins im Super-Admin-Modus (alle Konten) und Admins
 * mindestens eines Vereins (nur die Konten ihrer Vereine). Setzt req.nutzerScope = { superAdmin, vereinIds }.
 */
export function requireNutzerVerwaltung(knex) {
    return async (req, res, next) => {
        try {
            const benutzer = await knex('benutzer').where({ id: req.user.id }).first();
            if (istSuperAdminAktiv(benutzer)) {
                req.nutzerScope = { superAdmin: true, vereinIds: [] };
                return next();
            }
            const vereinIds = await ladeVereinIdsMitRolle(knex, req.user.id, 'admin');
            if (vereinIds.length === 0) {
                return res.status(403).json({ success: false, error: 'Nur Admins eines Vereins und Super-Admins haben Zugriff auf diese Funktion.' });
            }
            req.nutzerScope = { superAdmin: false, vereinIds };
            next();
        } catch (error) {
            console.error('[Nutzerverwaltung-Check-Fehler]:', error);
            return res.status(500).json({ success: false, error: 'Interner Server-Fehler bei der Berechtigungsprüfung.' });
        }
    };
}

export function requireWriteAuth(req, res, next) {
    if (!steuerungPasswort.istGesetzt()) {
        return next();
    }

    // Allow read-only operations for all clients (dashboard, public screens)
    if (req.method === 'GET') {
        return next();
    }

    // Verify password for write operations (POST, PUT, DELETE)
    const clientPassword = req.headers['x-steuerung-password'];
    if (steuerungPasswort.pruefe(clientPassword)) {
        return next();
    }
    
    return res.status(401).json({ success: false, error: 'Passwort erforderlich für Schreibzugriff.' });
}

// Wie requireWriteAuth, aber auch für GET: für Daten, die nur die Turnierleitung sehen darf
// (z.B. den Kopplungscode für neue Client-Geräte). Ohne STEUERUNG_PASSWORD offen wie alle
// Verwaltungsseiten im Hallenbetrieb.
export function requireSteuerungPasswort(req, res, next) {
    if (!steuerungPasswort.istGesetzt() || steuerungPasswort.pruefe(req.headers['x-steuerung-password'])) return next();
    return res.status(401).json({ success: false, error: 'Passwort erforderlich.' });
}
