// Super-Admin-Verwaltung (Helferverwaltung, Spec 3.1; Seite „Benutzer“): Liste aller Konten (Super-Admins zuerst) mit ihren Mitgliedschaften und
// Umschalter für die globale Rolle Super-Admin (benutzer.ist_super_admin). Zugriff nur für Super-Admins
// (requireSuperAdmin in nutzerRoutes.js). Es bleibt immer mindestens ein Super-Admin.

import { datumAlsIso } from '../shared/turnierAktivierung.js';
import { hashPassword } from '../utils/password.js';
import { MIN_PASSWORT_LAENGE, MAX_EMAIL_LAENGE, MELDUNG_EMAIL_ZU_LANG, normalisiereEmail } from '../services/registrierung.js';

/** GET /api/nutzer — alle Konten (ohne Passwort-Hash) mit Mitgliedschaften. */
export async function listeNutzer(knex, req, res) {
    try {
        const konten = await knex('benutzer')
            .select('id', 'vorname', 'nachname', 'email', 'ist_super_admin', 'email_bestaetigt_am')
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

/** PUT /api/nutzer/vereine/:id { bundesland } — Bundesland eines Vereins setzen (leer = entfernen). */
export async function setzeVereinBundesland(knex, req, res) {
    try {
        const vereinId = /^\d+$/.test(String(req.params.id)) ? parseInt(req.params.id, 10) : null;
        if (!vereinId || vereinId > 2147483647) return res.status(404).json({ success: false, error: 'Verein nicht gefunden.' });
        const roh = req.body ? req.body.bundesland : undefined;
        const bundesland = typeof roh === 'string' && roh.trim() !== '' ? roh.trim() : null;
        if (roh !== undefined && roh !== null && typeof roh !== 'string') {
            return res.status(400).json({ success: false, error: 'bundesland muss ein Text sein.' });
        }
        if (bundesland && !BUNDESLAENDER.includes(bundesland)) {
            return res.status(400).json({ success: false, error: 'Unbekanntes Bundesland.' });
        }
        const geaendert = await knex('vereine').where({ id: vereinId }).update({ bundesland, updated_at: knex.fn.now() });
        if (!geaendert) return res.status(404).json({ success: false, error: 'Verein nicht gefunden.' });
        res.json({ success: true, bundesland });
    } catch (error) {
        console.error('[Verein-Bundesland-Fehler]:', error);
        res.status(500).json({ success: false, error: 'Fehler beim Speichern des Bundeslands.' });
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
            .select('id', 'bezeichnung', 'datum', 'ort', 'bundesland', 'status')
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
