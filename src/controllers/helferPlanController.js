// Orga-Ansicht des Helferplans (Spec Abschnitt 6, Routen /api/helfer-plan). Das Gate
// requireTournamentEditAccess autorisiert das Turnier (req.tournament); jede Route prüft zusätzlich, dass
// die Tätigkeit/der Slot/der Einsatz zu genau diesem Turnier gehört (die Service-Funktionen nehmen nur IDs).
import { FachFehler } from '../utils/fachFehler.js';
import { sendeMail } from '../utils/mailer.js';
import { ermittleHelferplanTurnierId } from '../middleware/auth.js';
import * as plan from '../services/helferPlan.js';
import { erzeugeAusweisPdf } from '../services/helferAusweis.js';

/** Antwort für Fehler aus Service-Funktionen: FachFehler mit Status, Meldung, code und daten; sonst 500. */
export function sendeFehler(res, error, kontext) {
    if (error instanceof FachFehler) {
        return res.status(error.statusCode).json({
            success: false, error: error.message, code: error.code ?? null, daten: error.daten ?? null
        });
    }
    console.error(`[${kontext}]:`, error);
    return res.status(500).json({ success: false, error: 'Interner Server-Fehler.' });
}

/**
 * Wirft FachFehler 404, wenn die Tätigkeit/der Slot/der Einsatz nicht existiert oder nicht zum Turnier
 * `turnierId` gehört (gleiche Meldung, damit fremde IDs nicht erkennbar sind).
 * @param {{ taetigkeitId?: number|string, slotId?: number|string, einsatzId?: number|string }} ref
 */
export async function stelleSicherDassGehoertZu(knex, turnierId, ref) {
    const tatsaechlich = await ermittleHelferplanTurnierId(knex, ref);
    if (tatsaechlich == null || Number(tatsaechlich) !== Number(turnierId)) {
        const was = ref.taetigkeitId != null ? 'Tätigkeit' : ref.slotId != null ? 'Slot' : 'Eintrag';
        throw new FachFehler(404, `${was} nicht gefunden.`);
    }
}

// Vor dem Gate: unbekannte Tätigkeits-/Slot-/Einsatz-IDs als 404 statt „Turnier-ID konnte nicht ermittelt werden“.
export function pruefeVorhanden(knex) {
    return async (req, res, next) => {
        try {
            const { taetigkeitId, slotId, einsatzId } = req.params;
            if ((await ermittleHelferplanTurnierId(knex, { taetigkeitId, slotId, einsatzId })) == null) {
                const was = taetigkeitId != null ? 'Tätigkeit' : slotId != null ? 'Slot' : 'Eintrag';
                return res.status(404).json({ success: false, error: `${was} nicht gefunden.` });
            }
            next();
        } catch (error) {
            sendeFehler(res, error, 'Helferplan-Vorhanden');
        }
    };
}

// Das vom Gate autorisierte Turnier; im Einzelbenutzerbetrieb (kein Gate) das des Datensatzes bzw. aus dem Pfad.
async function autorisiertesTurnierId(knex, req, ref) {
    if (req.tournament) return req.tournament.id;
    if (ref) return ermittleHelferplanTurnierId(knex, ref);
    return parseInt(req.params.turnierId, 10);
}

async function pruefeZugehoerigkeit(knex, req, ref) {
    const turnierId = await autorisiertesTurnierId(knex, req, ref);
    await stelleSicherDassGehoertZu(knex, turnierId, ref);
    return turnierId;
}

const istBestaetigt = (req) => {
    const body = req.body || {};
    return body.bestaetigt === true || req.query.bestaetigt === '1' || req.query.bestaetigt === 'true';
};

function uhrzeit(min) {
    return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

function datumDeutsch(iso) {
    return iso ? iso.split('-').reverse().join('.') : '';
}

/**
 * Mail an die Konten, deren Dienstzeit sich geändert hat. Fehler beim Versand werden nur geloggt.
 */
async function benachrichtigeUeberZeitaenderung(knex, slotId, benutzerIds, sende) {
    if (!benutzerIds.length) return;
    try {
        const info = await knex('helfer_slots as s')
            .join('helfer_taetigkeiten as t', 't.id', 's.taetigkeit_id')
            .join('turniere as tu', 'tu.id', 't.turnier_id')
            .where('s.id', slotId)
            .first('s.von_min', 's.bis_min', 't.bezeichnung as taetigkeit', 'tu.bezeichnung as turnier', 'tu.datum');
        if (!info) return;
        const konten = await knex('benutzer').whereIn('id', benutzerIds).select('id', 'email', 'vorname');
        for (const konto of konten) {
            if (!konto.email) continue;
            try {
                await sende({
                    to: konto.email,
                    subject: `Hajime Pro: Dein Helferdienst beim Turnier „${info.turnier}“ wurde geändert`,
                    text: `Hallo ${konto.vorname || ''},

Dein Dienst „${info.taetigkeit}“ beim Turnier „${info.turnier}“ am ${datumDeutsch(plan.datumAlsText(info.datum))} ist jetzt von ${uhrzeit(info.von_min)} bis ${uhrzeit(info.bis_min)} Uhr.

Wenn du zu dieser Zeit nicht kannst, melde dich bitte bei der Turnierleitung.`
                });
            } catch (err) {
                console.error('[Helferplan-Mail-Fehler]:', err.message);
            }
        }
    } catch (err) {
        console.error('[Helferplan-Mail-Fehler]:', err.message);
    }
}

/** GET /:turnierId — Plan, vorher Standard-Tätigkeiten (Matten, Waagen) abgleichen (nur aktive, künftige Turniere). */
export async function ladePlanRoute(knex, req, res) {
    try {
        const turnierId = await autorisiertesTurnierId(knex, req);
        try {
            await plan.synchronisiereWennAktiv(knex, turnierId);
        } catch (err) {
            // z. B. Secondary im Cluster (Standby nur lesend): Plan trotzdem anzeigen.
            if (err instanceof FachFehler) throw err;
            console.error('[Helferplan-Synchronisieren]:', err.message);
        }
        res.json(await plan.ladePlan(knex, turnierId));
    } catch (error) {
        sendeFehler(res, error, 'Helferplan-Laden');
    }
}

/** POST /:turnierId/taetigkeiten — Body { bezeichnung, bedarf } */
export async function legeTaetigkeitAnRoute(knex, req, res) {
    try {
        const turnierId = await autorisiertesTurnierId(knex, req);
        const { bezeichnung, bedarf } = req.body || {};
        const ergebnis = await plan.legeTaetigkeitAn(knex, turnierId, { bezeichnung, bedarf });
        res.status(201).json({ success: true, id: ergebnis.id });
    } catch (error) {
        sendeFehler(res, error, 'Helferplan-Taetigkeit-Anlegen');
    }
}

/** PUT /taetigkeiten/:taetigkeitId — Body { bezeichnung?, bedarf?, bestaetigt? } */
export async function aendereTaetigkeitRoute(knex, req, res) {
    try {
        const taetigkeitId = parseInt(req.params.taetigkeitId, 10);
        await pruefeZugehoerigkeit(knex, req, { taetigkeitId });
        const { bezeichnung, bedarf } = req.body || {};
        await plan.aendereTaetigkeit(knex, taetigkeitId, { bezeichnung, bedarf, bestaetigt: istBestaetigt(req) });
        res.json({ success: true });
    } catch (error) {
        sendeFehler(res, error, 'Helferplan-Taetigkeit-Aendern');
    }
}

/** DELETE /taetigkeiten/:taetigkeitId — Bestätigung per Body { bestaetigt: true } oder ?bestaetigt=1 */
export async function loescheTaetigkeitRoute(knex, req, res) {
    try {
        const taetigkeitId = parseInt(req.params.taetigkeitId, 10);
        await pruefeZugehoerigkeit(knex, req, { taetigkeitId });
        await plan.loescheTaetigkeit(knex, taetigkeitId, { bestaetigt: istBestaetigt(req) });
        res.json({ success: true });
    } catch (error) {
        sendeFehler(res, error, 'Helferplan-Taetigkeit-Loeschen');
    }
}

/** POST /taetigkeiten/:taetigkeitId/slots — Body { von_min, bis_min } */
export async function legeSlotAnRoute(knex, req, res) {
    try {
        const taetigkeitId = parseInt(req.params.taetigkeitId, 10);
        await pruefeZugehoerigkeit(knex, req, { taetigkeitId });
        const { von_min, bis_min } = req.body || {};
        const ergebnis = await plan.legeSlotAn(knex, taetigkeitId, { von_min, bis_min });
        res.status(201).json({ success: true, id: ergebnis.id });
    } catch (error) {
        sendeFehler(res, error, 'Helferplan-Slot-Anlegen');
    }
}

/** PUT /slots/:slotId — Body { von_min?, bis_min?, bedarf?, bestaetigt? }; Mail an Betroffene bei neuer Zeit. */
export async function aendereSlotRoute(knex, req, res, { sende = sendeMail } = {}) {
    try {
        const slotId = parseInt(req.params.slotId, 10);
        await pruefeZugehoerigkeit(knex, req, { slotId });
        const { von_min, bis_min, bedarf } = req.body || {};
        const { betroffeneBenutzerIds } = await plan.aendereSlot(knex, slotId, {
            von_min, bis_min, bedarf, bestaetigt: istBestaetigt(req)
        });
        await benachrichtigeUeberZeitaenderung(knex, slotId, betroffeneBenutzerIds, sende);
        res.json({ success: true, benachrichtigt: betroffeneBenutzerIds.length });
    } catch (error) {
        sendeFehler(res, error, 'Helferplan-Slot-Aendern');
    }
}

/** DELETE /slots/:slotId — Bestätigung per Body { bestaetigt: true } oder ?bestaetigt=1 */
export async function loescheSlotRoute(knex, req, res) {
    try {
        const slotId = parseInt(req.params.slotId, 10);
        await pruefeZugehoerigkeit(knex, req, { slotId });
        await plan.loescheSlot(knex, slotId, { bestaetigt: istBestaetigt(req) });
        res.json({ success: true });
    } catch (error) {
        sendeFehler(res, error, 'Helferplan-Slot-Loeschen');
    }
}

/** POST /slots/:slotId/einsaetze — Body { benutzerId } (Konto) oder { name } (ohne Konto); ohne Frist. */
export async function traegeEinRoute(knex, req, res, { jetzt = () => new Date() } = {}) {
    try {
        const slotId = parseInt(req.params.slotId, 10);
        await pruefeZugehoerigkeit(knex, req, { slotId });
        const { benutzerId, name } = req.body || {};
        let ergebnis;
        if (benutzerId) {
            ergebnis = await plan.traegeEin(knex, { slotId, benutzerId: String(benutzerId), durchId: req.user.id, jetzt: jetzt(), alsOrga: true });
        } else if (typeof name === 'string' && name.trim()) {
            ergebnis = await plan.traegeManuellEin(knex, { slotId, name, durchId: req.user.id });
        } else {
            return res.status(400).json({ success: false, error: 'Bitte ein Mitglied oder einen Namen angeben.' });
        }
        res.status(201).json({ success: true, id: ergebnis.id });
    } catch (error) {
        sendeFehler(res, error, 'Helferplan-Eintragen');
    }
}

/** DELETE /einsaetze/:einsatzId — Orga trägt jederzeit aus. */
export async function traegeAusRoute(knex, req, res, { jetzt = () => new Date() } = {}) {
    try {
        const einsatzId = parseInt(req.params.einsatzId, 10);
        await pruefeZugehoerigkeit(knex, req, { einsatzId });
        await plan.traegeAus(knex, { einsatzId, durchId: req.user.id, jetzt: jetzt(), alsOrga: true });
        res.json({ success: true });
    } catch (error) {
        sendeFehler(res, error, 'Helferplan-Austragen');
    }
}

/** GET /:turnierId/mitglieder — freigegebene Mitglieder des ausrichtenden Vereins (zum Zuteilen), ohne E-Mail. */
export async function ladeMitgliederRoute(knex, req, res) {
    try {
        const turnierId = await autorisiertesTurnierId(knex, req);
        const turnier = req.tournament || await knex('turniere').where({ id: turnierId }).first();
        if (!turnier) throw new FachFehler(404, 'Turnier nicht gefunden.');
        const zeilen = await knex('benutzer_vereine as bv')
            .join('benutzer as b', 'b.id', 'bv.benutzer_id')
            .where({ 'bv.verein_id': turnier.verein_id, 'bv.freigegeben': 1 })
            .whereNotNull('bv.rolle')
            .orderBy([{ column: 'b.nachname' }, { column: 'b.vorname' }])
            .select('b.id', 'b.vorname', 'b.nachname', 'bv.rolle');
        res.json(zeilen.map(z => ({
            id: z.id,
            name: [z.vorname, z.nachname].filter(Boolean).join(' ').trim(),
            rolle: z.rolle
        })));
    } catch (error) {
        sendeFehler(res, error, 'Helferplan-Mitglieder');
    }
}

/** GET /:turnierId/ausweise?ids=a,b — druckbare Helferausweise (PDF); ohne ids alle Helfer mit Einsatz. */
export async function ladeAusweiseRoute(knex, req, res) {
    try {
        const turnierId = await autorisiertesTurnierId(knex, req);
        const ids = String(req.query?.ids || '').split(',').map(x => x.trim()).filter(Boolean);
        const bytes = await erzeugeAusweisPdf(knex, turnierId, ids.length ? { benutzerIds: ids } : {});
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'inline; filename="helferausweise.pdf"');
        res.send(Buffer.from(bytes));
    } catch (error) {
        sendeFehler(res, error, 'Helferausweise');
    }
}
