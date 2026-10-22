// Super-Admin-Verwaltung (Helferverwaltung, Spec 3.1; Seite „Benutzer“): Liste aller Konten (Super-Admins zuerst) mit ihren Mitgliedschaften und
// Umschalter für die globale Rolle Super-Admin (benutzer.ist_super_admin). Zugriff nur für Super-Admins
// (requireSuperAdmin in nutzerRoutes.js). Es bleibt immer mindestens ein Super-Admin.

import { datumAlsIso } from '../shared/turnierAktivierung.js';
import { hashPassword } from '../utils/password.js';
import {
    MIN_PASSWORT_LAENGE, MAX_EMAIL_LAENGE, MELDUNG_EMAIL_ZU_LANG, normalisiereEmail, sendeBestaetigungAnKonto, bestaetigeKontoManuell
} from '../services/registrierung.js';
import { sendeResetLink } from '../services/passwortReset.js';
import { legeVereinAn, benenneVereinUm, fuehreVereineZusammen, loescheLeerenVerein } from '../services/vereinsVerwaltung.js';
import { ermittleBasisUrl, HINWEIS_FEHLENDE_BASIS_URL } from '../utils/basisUrl.js';
import { vergesseSperrStand } from '../utils/kontoSperre.js';

/** GET /api/nutzer — alle Konten (ohne Passwort-Hash) mit Mitgliedschaften. */
export async function listeNutzer(knex, req, res) {
    try {
        const konten = await knex('benutzer')
            .select('id', 'vorname', 'nachname', 'email', 'ist_super_admin', 'email_bestaetigt_am', 'gesperrt', 'created_at')
            .orderBy([{ column: 'ist_super_admin', order: 'desc' }, { column: 'nachname' }, { column: 'vorname' }, { column: 'email' }]);
        const mitgliedschaften = await knex('benutzer_vereine')
            .join('vereine', 'vereine.id', 'benutzer_vereine.verein_id')
            .select(
                'benutzer_vereine.benutzer_id as benutzer_id', 'vereine.id as verein_id', 'vereine.name as verein_name',
                'benutzer_vereine.rolle as rolle', 'benutzer_vereine.freigegeben as freigegeben'
            )
            .orderBy('vereine.name');

        const jeKonto = new Map();
        for (const m of mitgliedschaften) {
            if (!jeKonto.has(m.benutzer_id)) jeKonto.set(m.benutzer_id, []);
            jeKonto.get(m.benutzer_id).push({
                verein_id: m.verein_id,
                verein_name: m.verein_name,
                rolle: m.freigegeben ? m.rolle : null,
                freigegeben: !!m.freigegeben
            });
        }

        res.json(konten.map(k => ({
            id: k.id,
            vorname: k.vorname,
            nachname: k.nachname,
            email: k.email,
            ist_super_admin: !!k.ist_super_admin,
            email_bestaetigt: !!k.email_bestaetigt_am,
            gesperrt: !!k.gesperrt,
            erstellt_am: k.created_at ? new Date(k.created_at).toISOString() : null,
            mitgliedschaften: jeKonto.get(k.id) || []
        })));
    } catch (error) {
        console.error('[Nutzer-Liste-Fehler]:', error);
        res.status(500).json({ success: false, error: 'Fehler beim Laden der Konten.' });
    }
}

/** POST /api/nutzer/:id/super-admin { wert: boolean } — ernennen oder entziehen. */
export async function setzeSuperAdmin(knex, req, res) {
    try {
        const zielId = req.params.id;
        const wert = req.body ? req.body.wert : undefined;
        if (typeof wert !== 'boolean') {
            return res.status(400).json({ success: false, error: 'wert muss true oder false sein.' });
        }

        const ergebnis = await knex.transaction(async (trx) => {
            // Alle Super-Admin-Zeilen sperren, damit zwei gleichzeitige Entzüge nicht beide den „vorletzten“ sehen.
            const superAdmins = await trx('benutzer').where({ ist_super_admin: true }).forUpdate().select('id');
            const ziel = await trx('benutzer').where({ id: zielId }).first('id', 'ist_super_admin');
            if (!ziel) return { status: 404, error: 'Konto nicht gefunden.' };
            if (!!ziel.ist_super_admin === wert) return { status: 200 };

            if (!wert && superAdmins.length <= 1) {
                return {
                    status: 409,
                    error: 'Der letzte Super-Admin kann nicht entzogen werden. Bitte zuerst einen weiteren Super-Admin ernennen.'
                };
            }
            await trx('benutzer').where({ id: zielId }).update({ ist_super_admin: wert, updated_at: trx.fn.now() });
            return { status: 200 };
        });

        if (ergebnis.status !== 200) {
            return res.status(ergebnis.status).json({ success: false, error: ergebnis.error });
        }
        res.json({ success: true, ist_super_admin: wert });
    } catch (error) {
        console.error('[Nutzer-Super-Admin-Fehler]:', error);
        res.status(500).json({ success: false, error: 'Interner Server-Fehler beim Ändern der Super-Admin-Rolle.' });
    }
}

// --- Vereinsübersicht (Super-Admin): alle Vereine mit Bundesland, Anzahl Benutzer und Turniere ---

export const BUNDESLAENDER = [
    'Baden-Württemberg', 'Bayern', 'Berlin', 'Brandenburg', 'Bremen', 'Hamburg', 'Hessen', 'Mecklenburg-Vorpommern',
    'Niedersachsen', 'Nordrhein-Westfalen', 'Rheinland-Pfalz', 'Saarland', 'Sachsen', 'Sachsen-Anhalt',
    'Schleswig-Holstein', 'Thüringen'
];

/** GET /api/nutzer/vereine — alle Vereine mit Bundesland, benutzer_anzahl (alle Mitgliedschaften, Rolle egal) und turniere_anzahl. */
export async function listeVereine(knex, req, res) {
    try {
        const vereine = await knex('vereine').select('id', 'name', 'bundesland').orderBy('name');
        const benutzer = await knex('benutzer_vereine').groupBy('verein_id').select('verein_id').count('* as anzahl');
        const turniere = await knex('turniere').whereNotNull('verein_id').groupBy('verein_id').select('verein_id').count('* as anzahl');
        const benutzerJe = new Map(benutzer.map(z => [z.verein_id, parseInt(z.anzahl, 10)]));
        const turniereJe = new Map(turniere.map(z => [z.verein_id, parseInt(z.anzahl, 10)]));
        res.json(vereine.map(v => ({
            id: v.id,
            name: v.name,
            bundesland: v.bundesland || null,
            benutzer_anzahl: benutzerJe.get(v.id) || 0,
            turniere_anzahl: turniereJe.get(v.id) || 0
        })));
    } catch (error) {
        console.error('[Vereine-Liste-Fehler]:', error);
        res.status(500).json({ success: false, error: 'Fehler beim Laden der Vereine.' });
    }
}

function leseVereinId(roh) {
    const id = /^\d+$/.test(String(roh)) ? parseInt(roh, 10) : null;
    return id && id <= 2147483647 ? id : null;
}

/**
 * PUT /api/nutzer/vereine/:id { name?, bundesland? } — Verein umbenennen und/oder Bundesland setzen (leer = entfernen).
 * Nur die mitgeschickten Felder ändern sich.
 */
export async function setzeVereinBundesland(knex, req, res) {
    try {
        const vereinId = leseVereinId(req.params.id);
        if (!vereinId) return res.status(404).json({ success: false, error: 'Verein nicht gefunden.' });
        const body = req.body || {};
        const hatName = Object.prototype.hasOwnProperty.call(body, 'name');
        const hatLand = Object.prototype.hasOwnProperty.call(body, 'bundesland') || !hatName; // ohne Name: wie bisher nur das Bundesland
        const roh = body.bundesland;
        const bundesland = typeof roh === 'string' && roh.trim() !== '' ? roh.trim() : null;
        if (roh !== undefined && roh !== null && typeof roh !== 'string') {
            return res.status(400).json({ success: false, error: 'bundesland muss ein Text sein.' });
        }
        if (hatLand && bundesland && !BUNDESLAENDER.includes(bundesland)) {
            return res.status(400).json({ success: false, error: 'Unbekanntes Bundesland.' });
        }
        const vorhanden = await knex('vereine').where({ id: vereinId }).first('id');
        if (!vorhanden) return res.status(404).json({ success: false, error: 'Verein nicht gefunden.' });
        let name;
        if (hatName) {
            const ergebnis = await benenneVereinUm(knex, vereinId, body.name);
            if (!ergebnis.ok) return res.status(ergebnis.status).json({ success: false, error: ergebnis.error });
            name = ergebnis.name;
        }
        if (hatLand) await knex('vereine').where({ id: vereinId }).update({ bundesland, updated_at: knex.fn.now() });
        res.json({ success: true, ...(hatLand ? { bundesland } : {}), ...(hatName ? { name } : {}) });
    } catch (error) {
        console.error('[Verein-Aendern-Fehler]:', error);
        res.status(500).json({ success: false, error: 'Fehler beim Speichern des Vereins.' });
    }
}

/** POST /api/nutzer/vereine { name, bundesland? } — Verein anlegen. */
export async function legeVereinAnRoute(knex, req, res) {
    try {
        const body = req.body || {};
        const roh = body.bundesland;
        const bundesland = typeof roh === 'string' && roh.trim() !== '' ? roh.trim() : null;
        if (roh !== undefined && roh !== null && typeof roh !== 'string') {
            return res.status(400).json({ success: false, error: 'bundesland muss ein Text sein.' });
        }
        if (bundesland && !BUNDESLAENDER.includes(bundesland)) {
            return res.status(400).json({ success: false, error: 'Unbekanntes Bundesland.' });
        }
        const ergebnis = await legeVereinAn(knex, { name: body.name, bundesland });
        if (!ergebnis.ok) return res.status(ergebnis.status).json({ success: false, error: ergebnis.error });
        res.status(201).json({ success: true, verein: ergebnis.verein });
    } catch (error) {
        console.error('[Verein-Anlegen-Fehler]:', error);
        res.status(500).json({ success: false, error: 'Fehler beim Anlegen des Vereins.' });
    }
}

/** POST /api/nutzer/vereine/:id/zusammenfuehren { zielId } — den Verein :id in den Verein zielId überführen (:id verschwindet). */
export async function fuehreVereineZusammenRoute(knex, req, res) {
    try {
        const quelleId = leseVereinId(req.params.id);
        const zielId = leseVereinId(req.body && req.body.zielId);
        if (!quelleId) return res.status(404).json({ success: false, error: 'Verein nicht gefunden.' });
        if (!zielId) return res.status(400).json({ success: false, error: 'Bitte den Zielverein angeben.' });
        const ergebnis = await fuehreVereineZusammen(knex, quelleId, zielId);
        if (!ergebnis.ok) return res.status(ergebnis.status).json({ success: false, error: ergebnis.error });
        res.json({ success: true, mitglieder: ergebnis.mitglieder, turniere: ergebnis.turniere, vorlagen: ergebnis.vorlagen });
    } catch (error) {
        console.error('[Vereine-Zusammenfuehren-Fehler]:', error);
        res.status(500).json({ success: false, error: 'Fehler beim Zusammenführen der Vereine.' });
    }
}

/** DELETE /api/nutzer/vereine/:id — leeren Verein (ohne Turniere und Mitglieder) löschen. */
export async function loescheVereinRoute(knex, req, res) {
    try {
        const vereinId = leseVereinId(req.params.id);
        if (!vereinId) return res.status(404).json({ success: false, error: 'Verein nicht gefunden.' });
        const ergebnis = await loescheLeerenVerein(knex, vereinId);
        if (!ergebnis.ok) return res.status(ergebnis.status).json({ success: false, error: ergebnis.error });
        res.json({ success: true });
    } catch (error) {
        console.error('[Verein-Loeschen-Fehler]:', error);
        res.status(500).json({ success: false, error: 'Fehler beim Löschen des Vereins.' });
    }
}

/** GET /api/nutzer/vereine/:id/turniere — Turniere des Vereins, Wettkampftag absteigend. */
export async function listeVereinTurniere(knex, req, res) {
    try {
        const vereinId = /^\d+$/.test(String(req.params.id)) ? parseInt(req.params.id, 10) : null;
        const verein = vereinId && vereinId <= 2147483647 ? await knex('vereine').where({ id: vereinId }).first('id', 'name') : null;
        if (!verein) return res.status(404).json({ success: false, error: 'Verein nicht gefunden.' });
        const turniere = await knex('turniere')
            .where({ verein_id: verein.id })
            .select('id', 'bezeichnung', 'datum', 'ort', 'bundesland', 'status', 'archiviert', 'aktiv')
            .orderBy([{ column: 'datum', order: 'desc' }, { column: 'id', order: 'desc' }]);
        const ids = turniere.map(t => t.id);
        const teilnehmer = ids.length
            ? await knex('turnier_teilnehmer').whereIn('turnier_id', ids).groupBy('turnier_id').select('turnier_id').count('* as anzahl')
            : [];
        const teilnehmerJe = new Map(teilnehmer.map(z => [z.turnier_id, parseInt(z.anzahl, 10)]));
        res.json({
            verein: { id: verein.id, name: verein.name },
            turniere: turniere.map(t => ({
                id: t.id,
                bezeichnung: t.bezeichnung,
                datum: datumAlsIso(t.datum) || '',
                ort: t.ort,
                bundesland: t.bundesland || null,
                status: t.status,
                archiviert: !!t.archiviert,
                aktiv: !!t.aktiv,
                teilnehmer_anzahl: teilnehmerJe.get(t.id) || 0
            }))
        });
    } catch (error) {
        console.error('[Verein-Turniere-Fehler]:', error);
        res.status(500).json({ success: false, error: 'Fehler beim Laden der Turniere.' });
    }
}

// --- Benutzer bearbeiten, löschen, Initialpasswort setzen (nur Super-Admin) ---

const MAX_NAME_LAENGE = 255;
const EMAIL_MUSTER = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;".]+$/;

function leseKontoId(req) {
    const roh = req.params.id;
    return typeof roh === 'string' && roh.length > 0 && roh.length <= 64 ? roh : null;
}

/** PUT /api/nutzer/:id { vorname, nachname, email } — Stammdaten eines Kontos ändern (E-Mail eindeutig, kleingeschrieben). */
export async function aendereNutzer(knex, req, res) {
    try {
        const zielId = leseKontoId(req);
        const body = req.body || {};
        const vorname = typeof body.vorname === 'string' ? body.vorname.trim() : '';
        const nachname = typeof body.nachname === 'string' ? body.nachname.trim() : '';
        const email = normalisiereEmail(body.email);
        if (!vorname || !nachname || !email) {
            return res.status(400).json({ success: false, error: 'Vorname, Nachname und E-Mail sind erforderlich.' });
        }
        if (vorname.length > MAX_NAME_LAENGE || nachname.length > MAX_NAME_LAENGE) {
            return res.status(400).json({ success: false, error: `Vor- und Nachname dürfen höchstens ${MAX_NAME_LAENGE} Zeichen lang sein.` });
        }
        if (email.length > MAX_EMAIL_LAENGE) return res.status(400).json({ success: false, error: MELDUNG_EMAIL_ZU_LANG });
        if (!EMAIL_MUSTER.test(email)) return res.status(400).json({ success: false, error: 'Bitte eine gültige E-Mail-Adresse angeben.' });

        const ziel = zielId ? await knex('benutzer').where({ id: zielId }).first('id', 'email') : null;
        if (!ziel) return res.status(404).json({ success: false, error: 'Konto nicht gefunden.' });

        if (email !== ziel.email) {
            // Dubletten ohne Beachtung der Schreibweise (Bestandskonten können noch Großbuchstaben enthalten)
            const fremd = await knex('benutzer').whereRaw('lower(trim(email)) = ?', [email]).whereNot({ id: ziel.id }).first('id');
            if (fremd) return res.status(409).json({ success: false, error: 'Diese E-Mail-Adresse wird bereits von einem anderen Konto verwendet.' });
        }
        await knex('benutzer').where({ id: ziel.id }).update({ vorname, nachname, email, updated_at: knex.fn.now() });
        res.json({ success: true, vorname, nachname, email });
    } catch (error) {
        console.error('[Nutzer-Aendern-Fehler]:', error);
        res.status(500).json({ success: false, error: 'Fehler beim Ändern des Kontos.' });
    }
}

/** DELETE /api/nutzer/:id — Konto samt Mitgliedschaften löschen; nicht das eigene, nicht den letzten Super-Admin. */
export async function loescheNutzer(knex, req, res) {
    try {
        const zielId = leseKontoId(req);
        if (zielId && String(zielId) === String(req.user.id)) {
            return res.status(409).json({ success: false, error: 'Das eigene Konto kann nicht gelöscht werden.' });
        }
        const ergebnis = await knex.transaction(async (trx) => {
            // Super-Admin-Zeilen sperren, damit nicht zwei gleichzeitige Löschungen den letzten entfernen
            const superAdmins = await trx('benutzer').where({ ist_super_admin: true }).forUpdate().select('id');
            const ziel = zielId ? await trx('benutzer').where({ id: zielId }).first('id', 'ist_super_admin') : null;
            if (!ziel) return { status: 404, error: 'Konto nicht gefunden.' };
            if (ziel.ist_super_admin && superAdmins.length <= 1) {
                return { status: 409, error: 'Der letzte Super-Admin kann nicht gelöscht werden.' };
            }
            await trx('benutzer').where({ id: ziel.id }).del(); // Mitgliedschaften, Token, Einsätze folgen per ON DELETE CASCADE
            return { status: 200 };
        });
        if (ergebnis.status !== 200) return res.status(ergebnis.status).json({ success: false, error: ergebnis.error });
        res.json({ success: true });
    } catch (error) {
        console.error('[Nutzer-Loeschen-Fehler]:', error);
        res.status(500).json({ success: false, error: 'Fehler beim Löschen des Kontos.' });
    }
}

/**
 * POST /api/nutzer/:id/passwort { passwort, aendernErforderlich? } — Initialpasswort vergeben. Standardmäßig muss die
 * Person es beim nächsten Anmelden ändern (aendernErforderlich: false hebt das auf). Ein noch unbestätigtes Konto gilt
 * damit als freigegeben (E-Mail bestätigt), weil der Super-Admin die Zugangsdaten übergibt.
 */
export async function setzeInitialPasswort(knex, req, res) {
    try {
        const zielId = leseKontoId(req);
        const body = req.body || {};
        const passwort = body.passwort;
        if (typeof passwort !== 'string' || passwort.length < MIN_PASSWORT_LAENGE) {
            return res.status(400).json({ success: false, error: `Das Passwort muss mindestens ${MIN_PASSWORT_LAENGE} Zeichen lang sein.` });
        }
        if (passwort.length > 200) return res.status(400).json({ success: false, error: 'Das Passwort ist zu lang.' });
        const aendern = body.aendernErforderlich === undefined ? true : body.aendernErforderlich === true;
        const ziel = zielId ? await knex('benutzer').where({ id: zielId }).first('id', 'email_bestaetigt_am') : null;
        if (!ziel) return res.status(404).json({ success: false, error: 'Konto nicht gefunden.' });
        await knex('benutzer').where({ id: ziel.id }).update({
            password_hash: hashPassword(passwort),
            muss_passwort_aendern: aendern,
            ...(ziel.email_bestaetigt_am ? {} : { email_bestaetigt_am: knex.fn.now() }),
            updated_at: knex.fn.now()
        });
        res.json({ success: true, aendernErforderlich: aendern });
    } catch (error) {
        console.error('[Nutzer-Passwort-Fehler]:', error);
        res.status(500).json({ success: false, error: 'Fehler beim Setzen des Passworts.' });
    }
}

// --- Konten sperren, Bestätigung verwalten, Passwort-Reset-Mail (nur Super-Admin) ---

const BASIS_URL_FEHLT = 'Die Basis-URL für Links in Mails ist nicht konfiguriert (PUBLIC_BASE_URL).';

/**
 * POST /api/nutzer/:id/sperren { wert: boolean } — Konto sperren (Login und alle Anfragen werden abgelehnt, Daten bleiben)
 * oder wieder freigeben. Nicht das eigene Konto und nicht den letzten nicht gesperrten Super-Admin.
 */
export async function setzeGesperrt(knex, req, res) {
    try {
        const zielId = leseKontoId(req);
        const wert = req.body ? req.body.wert : undefined;
        if (typeof wert !== 'boolean') return res.status(400).json({ success: false, error: 'wert muss true oder false sein.' });
        if (wert && zielId && String(zielId) === String(req.user.id)) {
            return res.status(409).json({ success: false, error: 'Das eigene Konto kann nicht gesperrt werden.' });
        }
        const ergebnis = await knex.transaction(async (trx) => {
            const superAdmins = await trx('benutzer').where({ ist_super_admin: true, gesperrt: false }).forUpdate().select('id');
            const ziel = zielId ? await trx('benutzer').where({ id: zielId }).first('id', 'ist_super_admin') : null;
            if (!ziel) return { status: 404, error: 'Konto nicht gefunden.' };
            if (wert && ziel.ist_super_admin && superAdmins.length <= 1) {
                return { status: 409, error: 'Der letzte nicht gesperrte Super-Admin kann nicht gesperrt werden.' };
            }
            await trx('benutzer').where({ id: ziel.id }).update({
                gesperrt: wert,
                gesperrt_am: wert ? trx.fn.now() : null,
                updated_at: trx.fn.now()
            });
            return { status: 200 };
        });
        if (ergebnis.status !== 200) return res.status(ergebnis.status).json({ success: false, error: ergebnis.error });
        vergesseSperrStand(zielId);
        res.json({ success: true, gesperrt: wert });
    } catch (error) {
        console.error('[Nutzer-Sperren-Fehler]:', error);
        res.status(500).json({ success: false, error: 'Fehler beim Sperren des Kontos.' });
    }
}

/** POST /api/nutzer/:id/bestaetigen — E-Mail-Adresse eines unbestätigten Kontos von Hand bestätigen. */
export async function bestaetigeKonto(knex, req, res) {
    try {
        const zielId = leseKontoId(req);
        const ziel = zielId ? await knex('benutzer').where({ id: zielId }).first('id', 'email_bestaetigt_am') : null;
        if (!ziel) return res.status(404).json({ success: false, error: 'Konto nicht gefunden.' });
        if (ziel.email_bestaetigt_am) return res.status(409).json({ success: false, error: 'Das Konto ist bereits bestätigt.' });
        // Ohne sichere Basis-URL gibt es keinen Freischaltungs-Link; die Anfrage bleibt dann in der Liste offener Anfragen.
        await bestaetigeKontoManuell(knex, ziel.id, ermittleBasisUrl(req));
        res.json({ success: true });
    } catch (error) {
        console.error('[Nutzer-Bestaetigen-Fehler]:', error);
        res.status(500).json({ success: false, error: 'Fehler beim Bestätigen des Kontos.' });
    }
}

/** POST /api/nutzer/:id/bestaetigungs-mail — Bestätigungsmail an ein unbestätigtes Konto (erneut) senden. */
export async function sendeBestaetigungsMailRoute(knex, req, res) {
    try {
        const zielId = leseKontoId(req);
        const ziel = zielId ? await knex('benutzer').where({ id: zielId }).first() : null;
        if (!ziel) return res.status(404).json({ success: false, error: 'Konto nicht gefunden.' });
        if (ziel.email_bestaetigt_am) return res.status(409).json({ success: false, error: 'Das Konto ist bereits bestätigt.' });
        const basisUrl = ermittleBasisUrl(req);
        if (!basisUrl) {
            console.error(`[Bestaetigungsmail] ${HINWEIS_FEHLENDE_BASIS_URL}`);
            return res.status(503).json({ success: false, error: BASIS_URL_FEHLT });
        }
        await sendeBestaetigungAnKonto(knex, ziel, basisUrl);
        res.json({ success: true });
    } catch (error) {
        console.error('[Nutzer-Bestaetigungsmail-Fehler]:', error);
        res.status(500).json({ success: false, error: 'Fehler beim Senden der Bestätigungsmail.' });
    }
}

/** POST /api/nutzer/:id/passwort-mail — dem Konto einen Link zum Zurücksetzen des Passworts schicken. */
export async function sendePasswortMail(knex, req, res) {
    try {
        const zielId = leseKontoId(req);
        const ziel = zielId ? await knex('benutzer').where({ id: zielId }).first() : null;
        if (!ziel) return res.status(404).json({ success: false, error: 'Konto nicht gefunden.' });
        if (ziel.gesperrt) return res.status(409).json({ success: false, error: 'Das Konto ist gesperrt. Zuerst entsperren.' });
        const basisUrl = ermittleBasisUrl(req);
        if (!basisUrl) {
            console.error(`[Passwort-Mail] ${HINWEIS_FEHLENDE_BASIS_URL}`);
            return res.status(503).json({ success: false, error: BASIS_URL_FEHLT });
        }
        try {
            await sendeResetLink(knex, ziel, basisUrl, { abstandPruefen: false, durchAdmin: true });
        } catch (err) {
            return res.status(502).json({ success: false, error: 'Die Mail konnte nicht gesendet werden. Bitte die Mail-Einstellungen (SMTP) prüfen.' });
        }
        res.json({ success: true });
    } catch (error) {
        console.error('[Nutzer-Passwortmail-Fehler]:', error);
        res.status(500).json({ success: false, error: 'Fehler beim Senden der Passwort-Mail.' });
    }
}

/** DELETE /api/nutzer/unbestaetigte { aelterAlsTage } — nie bestätigte Konten löschen, die älter als N Tage sind (Standard 30, mindestens 1). */
export async function loescheUnbestaetigte(knex, req, res) {
    try {
        const roh = req.body && req.body.aelterAlsTage;
        const tage = roh === undefined ? 30 : Number(roh);
        if (!Number.isInteger(tage) || tage < 1 || tage > 3650) {
            return res.status(400).json({ success: false, error: 'aelterAlsTage muss eine ganze Zahl zwischen 1 und 3650 sein.' });
        }
        const geloescht = await knex('benutzer')
            .whereNull('email_bestaetigt_am')
            .where({ ist_super_admin: false })
            .whereRaw("created_at < now() - (? * interval '1 day')", [tage])
            .del();
        res.json({ success: true, geloescht });
    } catch (error) {
        console.error('[Nutzer-Unbestaetigte-Fehler]:', error);
        res.status(500).json({ success: false, error: 'Fehler beim Aufräumen der unbestätigten Konten.' });
    }
}

// --- Turniere verwalten (nur Super-Admin; ein Turnier einem anderen Verein zuordnen gibt es bewusst nicht) ---

function leseTurnierId(req) {
    const roh = req.params.id;
    return /^\d+$/.test(String(roh)) && Number(roh) <= 2147483647 ? parseInt(roh, 10) : null;
}

/**
 * POST /api/nutzer/turniere/:id/archivieren { wert: boolean } — Turnier archivieren (verschwindet aus den Turnierlisten
 * der Vereine, bleibt vollständig gespeichert) oder wiederherstellen. Das aktive Turnier eines Hallen-Servers nicht.
 */
export async function archiviereTurnier(knex, req, res) {
    try {
        const id = leseTurnierId(req);
        const wert = req.body ? req.body.wert : undefined;
        if (typeof wert !== 'boolean') return res.status(400).json({ success: false, error: 'wert muss true oder false sein.' });
        const turnier = id ? await knex('turniere').where({ id }).first('id', 'aktiv') : null;
        if (!turnier) return res.status(404).json({ success: false, error: 'Turnier nicht gefunden.' });
        if (wert && turnier.aktiv) return res.status(409).json({ success: false, error: 'Das aktive Turnier kann nicht archiviert werden.' });
        await knex('turniere').where({ id }).update({ archiviert: wert, updated_at: knex.fn.now() });
        res.json({ success: true, archiviert: wert });
    } catch (error) {
        console.error('[Turnier-Archivieren-Fehler]:', error);
        res.status(500).json({ success: false, error: 'Fehler beim Archivieren des Turniers.' });
    }
}

/**
 * DELETE /api/nutzer/turniere/:id — Turnier endgültig löschen, auch mit Teilnehmern und Kämpfen (alles folgt per
 * ON DELETE CASCADE). Nicht das aktive Turnier eines Hallen-Servers.
 */
export async function loescheTurnierAlsSuperAdmin(knex, req, res) {
    try {
        const id = leseTurnierId(req);
        const turnier = id ? await knex('turniere').where({ id }).first('id', 'aktiv') : null;
        if (!turnier) return res.status(404).json({ success: false, error: 'Turnier nicht gefunden.' });
        if (turnier.aktiv) return res.status(409).json({ success: false, error: 'Das aktive Turnier kann nicht gelöscht werden.' });
        await knex('turniere').where({ id }).del();
        res.json({ success: true });
    } catch (error) {
        console.error('[Turnier-Loeschen-Fehler]:', error);
        res.status(500).json({ success: false, error: 'Fehler beim Löschen des Turniers.' });
    }
}
