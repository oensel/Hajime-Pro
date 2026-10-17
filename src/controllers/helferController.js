// Helfer-App (Spec 4.1, 4.2, 5; Routen /api/helfer): Turniere der eigenen Vereine, offene Dienste,
// Eintragen/Austragen bis Turniertag 08:00 (Europe/Berlin), eigene Dienste und Profil.
// Jede Route mit Turnierbezug prüft hatHelferZugriffAufVerein für den ausrichtenden Verein.
import { FachFehler } from '../utils/fachFehler.js';
import { sendeMail } from '../utils/mailer.js';
import { hashPassword, verifyPassword } from '../utils/password.js';
import { hatHelferZugriffAufVerein, ladeVereineFuerBenutzer, ladeVereinIdsMitRolle } from '../utils/vereinHelper.js';
import { entferneMitglied } from '../services/vereinsRollen.js';
import { darfHelferAendern } from '../shared/helferZeit.js';
import * as plan from '../services/helferPlan.js';
import { sendeFehler } from './helferPlanController.js';
import { joinVerein } from './vereinController.js';

const MIN_PASSWORT_LAENGE = 8;

// In der Helfer-App sichtbar: nur veröffentlichte Turniere (Entwürfe nie).
const SICHTBARER_STATUS = 'veroeffentlicht';

function heuteBerlin(jetzt) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' })
        .format(jetzt);
}

// Turnier laden und Helfer-Zugriff prüfen; nicht sichtbare Turniere (Entwurf) gelten als nicht vorhanden.
async function ladeSichtbaresTurnier(knex, turnierId, benutzerId) {
    const tid = /^\d+$/.test(String(turnierId)) ? parseInt(turnierId, 10) : null;
    const turnier = tid == null ? null : await knex('turniere').where({ id: tid }).first();
    if (!turnier || turnier.status === 'entwurf') throw new FachFehler(404, 'Turnier nicht gefunden.');
    if (!(await hatHelferZugriffAufVerein(knex, benutzerId, turnier.verein_id))) {
        throw new FachFehler(403, 'Kein Zugriff: Du bist kein freigeschaltetes Mitglied des ausrichtenden Vereins.');
    }
    return turnier;
}

async function turnierZuSlot(knex, slotId) {
    const zeile = await knex('helfer_slots as s')
        .join('helfer_taetigkeiten as t', 't.id', 's.taetigkeit_id')
        .where('s.id', slotId).first('t.turnier_id');
    if (!zeile) throw new FachFehler(404, 'Slot nicht gefunden.');
    return zeile.turnier_id;
}

async function turnierZuEinsatz(knex, einsatzId) {
    const zeile = await knex('helfer_einsaetze as e')
        .join('helfer_slots as s', 's.id', 'e.slot_id')
        .join('helfer_taetigkeiten as t', 't.id', 's.taetigkeit_id')
        .where('e.id', einsatzId).first('t.turnier_id');
    if (!zeile) throw new FachFehler(404, 'Eintrag nicht gefunden.');
    return zeile.turnier_id;
}

const alsId = (wert, name) => {
    if (!/^\d+$/.test(String(wert ?? ''))) throw new FachFehler(400, `${name} fehlt oder ist ungültig.`);
    return parseInt(wert, 10);
};

/** GET /turniere — anstehende, veröffentlichte Turniere der Vereine mit freigegebener Mitgliedschaft. */
export async function listeTurniere(knex, req, res, { jetzt = () => new Date() } = {}) {
    try {
        const benutzer = await knex('benutzer').where({ id: req.user.id }).first();
        if (!benutzer) return res.json([]);
        let abfrage = knex('turniere as tu')
            .leftJoin('vereine as v', 'v.id', 'tu.verein_id')
            .where('tu.status', SICHTBARER_STATUS)
            .where('tu.datum', '>=', heuteBerlin(jetzt()));
        // Super-Admin: alle Vereine (wie hatHelferZugriffAufVerein)
        if (!benutzer.ist_super_admin) {
            const vereinIds = await ladeVereinIdsMitRolle(knex, req.user.id, 'helfer');
            if (vereinIds.length === 0) return res.json([]);
            abfrage = abfrage.whereIn('tu.verein_id', vereinIds);
        }
        const turniere = await abfrage
            .orderBy([{ column: 'tu.datum' }, { column: 'tu.id' }])
            .select('tu.id', 'tu.bezeichnung', 'tu.datum', 'tu.ort', 'tu.verein_id', 'v.name as verein_name');

        const ids = turniere.map(t => t.id);
        const slots = ids.length
            ? await knex('helfer_slots as s')
                .join('helfer_taetigkeiten as t', 't.id', 's.taetigkeit_id')
                .leftJoin('helfer_einsaetze as e', 'e.slot_id', 's.id')
                .whereIn('t.turnier_id', ids)
                .groupBy('s.id', 't.turnier_id')
                .select('s.id', 's.bedarf', 't.turnier_id', knex.raw('count(e.id)::int as belegt'))
            : [];

        res.json(turniere.map(t => {
            const eigene = slots.filter(s => s.turnier_id === t.id);
            const offen = eigene.filter(s => s.belegt < s.bedarf);
            return {
                id: t.id,
                bezeichnung: t.bezeichnung,
                datum: plan.datumAlsText(t.datum),
                ort: t.ort,
                verein_id: t.verein_id,
                verein_name: t.verein_name,
                offeneDienste: offen.length,
                freiePlaetze: offen.reduce((summe, s) => summe + (s.bedarf - s.belegt), 0)
            };
        }));
    } catch (error) {
        sendeFehler(res, error, 'Helfer-Turniere');
    }
}

/** GET /turniere/:id/dienste — nicht volle Slots und die eigenen. */
export async function ladeDienste(knex, req, res, { jetzt = () => new Date() } = {}) {
    try {
        const turnier = await ladeSichtbaresTurnier(knex, req.params.id, req.user.id);
        try {
            // Matten/Waagen-Zeilen existieren sonst erst, wenn die Orga den Plan einmal geöffnet hat.
            await plan.synchronisiereStandardTaetigkeiten(knex, turnier.id);
        } catch (err) {
            console.error('[Helfer-Dienste-Synchronisieren]:', err.message);
        }
        const datum = plan.datumAlsText(turnier.datum);
        res.json({
            turnier: { id: turnier.id, bezeichnung: turnier.bezeichnung, datum, ort: turnier.ort, status: turnier.status },
            fristAbgelaufen: !darfHelferAendern(datum, jetzt()),
            dienste: await plan.ladeOffeneSlots(knex, turnier.id, req.user.id)
        });
    } catch (error) {
        sendeFehler(res, error, 'Helfer-Dienste');
    }
}

/** POST /einsaetze — Body { slotId }: sich selbst eintragen. */
export async function traegeSichEin(knex, req, res, { jetzt = () => new Date() } = {}) {
    try {
        const slotId = alsId((req.body || {}).slotId, 'slotId');
        await ladeSichtbaresTurnier(knex, await turnierZuSlot(knex, slotId), req.user.id);
        const { id } = await plan.traegeEin(knex, {
            slotId, benutzerId: req.user.id, durchId: req.user.id, jetzt: jetzt(), alsOrga: false
        });
        res.status(201).json({ success: true, id });
    } catch (error) {
        sendeFehler(res, error, 'Helfer-Eintragen');
    }
}

/** DELETE /einsaetze/:id — sich selbst austragen (bis zur Frist). */
export async function traegeSichAus(knex, req, res, { jetzt = () => new Date() } = {}) {
    try {
        const einsatzId = alsId(req.params.id, 'Eintrag');
        await ladeSichtbaresTurnier(knex, await turnierZuEinsatz(knex, einsatzId), req.user.id);
        await plan.traegeAus(knex, { einsatzId, durchId: req.user.id, jetzt: jetzt(), alsOrga: false });
        res.json({ success: true });
    } catch (error) {
        sendeFehler(res, error, 'Helfer-Austragen');
    }
}

/** GET /meine-dienste — eigene Dienste ab heute (Berlin), mit darfAustragen. */
export async function ladeMeineDiensteRoute(knex, req, res, { jetzt = () => new Date() } = {}) {
    try {
        const jetztWert = jetzt();
        const heute = heuteBerlin(jetztWert);
        const dienste = (await plan.ladeMeineDienste(knex, req.user.id)).filter(d => d.turnier.datum >= heute);
        res.json(dienste.map(d => ({ ...d, darfAustragen: darfHelferAendern(d.turnier.datum, jetztWert) })));
    } catch (error) {
        sendeFehler(res, error, 'Helfer-Meine-Dienste');
    }
}

/** GET /profil — Name, E-Mail und Vereine mit Rolle/Status. */
export async function ladeProfil(knex, req, res) {
    try {
        const benutzer = await knex('benutzer').where({ id: req.user.id }).first('id', 'vorname', 'nachname', 'email');
        if (!benutzer) throw new FachFehler(404, 'Konto nicht gefunden.');
        res.json({ ...benutzer, vereine: await ladeVereineFuerBenutzer(knex, req.user.id) });
    } catch (error) {
        sendeFehler(res, error, 'Helfer-Profil');
    }
}

/** POST /profil/verein — Body { vereinId }: Beitrittsanfrage wie /api/vereine/join, ohne neuen Verein. */
export async function frageVereinAn(knex, req, res, { sende = sendeMail } = {}) {
    const vereinId = (req.body || {}).vereinId;
    if (!/^\d+$/.test(String(vereinId ?? ''))) {
        return res.status(400).json({ success: false, error: 'Bitte einen vorhandenen Verein wählen.' });
    }
    // Nur die Vereins-ID weiterreichen: einen neuen Verein anlegen (newVereinName) gibt es hier nicht.
    req.body = { vereinId: parseInt(vereinId, 10) };
    return joinVerein(knex, req, res, { sende, angefragtUeber: 'helfer-app', aktivSetzen: false });
}

/** DELETE /profil/verein/:vereinId — austreten (gesperrt bei offenen Diensten, letztem Admin, einzigem Verein). */
export async function verlasseVerein(knex, req, res) {
    try {
        const vereinId = alsId(req.params.vereinId, 'Verein');
        const ergebnis = await entferneMitglied(knex, { vereinId, benutzerId: req.user.id, durchId: req.user.id });
        if (!ergebnis.ok) return res.status(ergebnis.status).json({ success: false, error: ergebnis.error });
        res.json({ success: true });
    } catch (error) {
        sendeFehler(res, error, 'Helfer-Verein-Verlassen');
    }
}

/**
 * POST /profil/passwort — Body { aktuellesPasswort, neuesPasswort } (mindestens 8 Zeichen).
 * Falsches aktuelles Passwort → 400 (nicht 401: das Frontend leitet bei 401 auf die Anmeldung um).
 */
export async function aenderePasswort(knex, req, res) {
    try {
        const { aktuellesPasswort, neuesPasswort } = req.body || {};
        const benutzer = await knex('benutzer').where({ id: req.user.id }).first();
        if (!benutzer) throw new FachFehler(404, 'Konto nicht gefunden.');
        if (typeof aktuellesPasswort !== 'string' || !benutzer.password_hash || !verifyPassword(aktuellesPasswort, benutzer.password_hash)) {
            throw new FachFehler(400, 'Das aktuelle Passwort ist nicht korrekt.');
        }
        if (typeof neuesPasswort !== 'string' || neuesPasswort.length < MIN_PASSWORT_LAENGE) {
            throw new FachFehler(400, `Das neue Passwort muss mindestens ${MIN_PASSWORT_LAENGE} Zeichen lang sein.`);
        }
        await knex('benutzer').where({ id: req.user.id }).update({ password_hash: hashPassword(neuesPasswort), updated_at: knex.fn.now() });
        res.json({ success: true });
    } catch (error) {
        sendeFehler(res, error, 'Helfer-Passwort');
    }
}
