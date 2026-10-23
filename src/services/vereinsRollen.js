// Vereinsverwaltung mit Rollen (Helferverwaltung, Spec Abschnitte 2–4): Beitrittsanfragen entscheiden,
// Rollen ändern, Mitglieder entfernen/austreten lassen und die Empfänger der Beitrittsanfrage ermitteln.
// Regeln:
//   - Entscheiden, Rollen ändern, andere entfernen: Admin des Vereins (freigegeben) oder Super-Admin.
//   - Jeder Verein behält mindestens einen Admin: der letzte Admin kann weder herabgestuft noch entfernt
//     werden und nicht austreten, solange noch andere Mitgliedschaften bestehen (der Super-Admin darf).
//     Ist er das letzte Mitglied überhaupt, darf er austreten; der Verein wird dann gelöscht (wie bisher).
//   - Wer noch offene Helferdienste im Verein hat, kann nicht entfernt werden bzw. austreten.
// Alle Funktionen liefern { ok: true, ... } oder { ok: false, status, error } statt zu werfen.
import { istGueltigeRolle, rolleReicht } from '../shared/rollen.js';
import { istSuperAdminAktiv } from '../utils/vereinHelper.js';
// Offene Helferdienste (Dienste in noch nicht vergangenen Turnieren des Vereins) prüft der Helferplan-Service.
import { hatOffeneDienste } from './helferPlan.js';

export { hatOffeneDienste };

const fehler = (status, error) => ({ ok: false, status, error });

const EINZIGER_VEREIN_FEHLER = 'Sie können Ihren einzigen Verein nicht verlassen — ein Benutzer muss immer mindestens einem Verein angehören. Treten Sie zuerst einem anderen Verein bei.';

async function istSuperAdmin(knex, benutzerId) {
    if (!benutzerId) return false;
    const benutzer = await knex('benutzer').where({ id: benutzerId }).first();
    return istSuperAdminAktiv(benutzer);
}

async function istVereinsAdmin(knex, benutzerId, vereinId) {
    if (!benutzerId) return false;
    const m = await knex('benutzer_vereine')
        .where({ benutzer_id: benutzerId, verein_id: vereinId, freigegeben: 1 })
        .first();
    return !!(m && rolleReicht(m.rolle, 'admin'));
}

/** Admin des Vereins oder Super-Admin? */
export async function darfVereinVerwalten(knex, benutzerId, vereinId) {
    return (await istVereinsAdmin(knex, benutzerId, vereinId)) || (await istSuperAdmin(knex, benutzerId));
}

/**
 * Ist das Konto der einzige freigegebene Admin des Vereins?
 * @returns {Promise<boolean>}
 */
export async function istLetzterAdmin(knex, vereinId, benutzerId) {
    const admins = await knex('benutzer_vereine')
        .where({ verein_id: vereinId, freigegeben: 1, rolle: 'admin' })
        .select('benutzer_id');
    return admins.length === 1 && admins[0].benutzer_id === benutzerId;
}

/**
 * E-Mail-Adressen derer, die über eine Beitrittsanfrage entscheiden: alle freigegebenen Admins des
 * Vereins; hat der Verein keinen Admin, alle Super-Admins.
 * @returns {Promise<string[]>}
 */
export async function ladeEmpfaengerFuerAnfrage(knex, vereinId) {
    const admins = await knex('benutzer_vereine')
        .join('benutzer', 'benutzer.id', 'benutzer_vereine.benutzer_id')
        .where({ 'benutzer_vereine.verein_id': vereinId, 'benutzer_vereine.freigegeben': 1, 'benutzer_vereine.rolle': 'admin' })
        .select('benutzer.email');
    if (admins.length > 0) return admins.map(a => a.email);

    const superAdmins = await knex('benutzer').where({ ist_super_admin: true }).select('email');
    return superAdmins.map(s => s.email);
}

/** Hat der Verein mindestens einen freigegebenen Admin? */
export async function hatVereinAdmin(knex, vereinId) {
    const admin = await knex('benutzer_vereine')
        .where({ verein_id: vereinId, freigegeben: 1, rolle: 'admin' })
        .first();
    return !!admin;
}

/**
 * Löscht eine Mitgliedschaft samt Aufräumarbeiten: aktiver Verein des Kontos springt auf eine
 * verbleibende Mitgliedschaft (oder null), ein Verein ohne jede Mitgliedschaft wird gelöscht.
 * @returns {Promise<boolean>} ob der Verein gelöscht wurde
 */
async function loescheMitgliedschaft(knex, benutzerId, vereinId, { vereinBehalten = false } = {}) {
    // Vor dem Löschen erfassen: das Löschen eines verwaisten Vereins setzt benutzer.aktiver_verein_id
    // per ON DELETE SET NULL bereits zurück, bevor wir nachschauen könnten.
    const benutzer = await knex('benutzer').where({ id: benutzerId }).first();
    const warAktiverVerein = !!(benutzer && benutzer.aktiver_verein_id === vereinId);

    await knex('benutzer_vereine').where({ benutzer_id: benutzerId, verein_id: vereinId }).del();

    let vereinGeloescht = false;
    const verbleibende = await knex('benutzer_vereine').where({ verein_id: vereinId }).count('* as anzahl').first();
    if (!vereinBehalten && parseInt(verbleibende.anzahl, 10) === 0) {
        await knex('vereine').where({ id: vereinId }).del();
        vereinGeloescht = true;
    }

    if (warAktiverVerein) {
        const naechste = await knex('benutzer_vereine').where({ benutzer_id: benutzerId }).orderBy('id').first();
        await knex('benutzer').where({ id: benutzerId }).update({
            aktiver_verein_id: naechste ? naechste.verein_id : null,
            updated_at: knex.fn.now()
        });
    }
    return vereinGeloescht;
}

/**
 * Entscheidet eine Beitrittsanfrage (freigeben mit Rolle oder ablehnen).
 * perToken: true bedeutet, die Berechtigung ist bereits per Freischaltungs-Token aus der Mail nachgewiesen
 * (Task 5, mit entscheiderId: null); dann bleibt entschieden_von leer. Ohne perToken wird entscheiderId
 * immer geprüft (fehlt er, 403).
 * @param {{ vereinId: number, benutzerId: string, entscheiderId: string|null, perToken?: boolean, entscheidung: 'freigeben'|'ablehnen', rolle?: string }} p
 */
export async function entscheideAnfrage(knex, { vereinId, benutzerId, entscheiderId, perToken = false, entscheidung, rolle }) {
    if (entscheidung !== 'freigeben' && entscheidung !== 'ablehnen') {
        return fehler(400, 'Ungültige Entscheidung.');
    }
    if (perToken !== true && !(await darfVereinVerwalten(knex, entscheiderId, vereinId))) {
        return fehler(403, 'Nur Admins dieses Vereins dürfen Beitrittsanfragen entscheiden.');
    }

    const mitgliedschaft = await knex('benutzer_vereine').where({ benutzer_id: benutzerId, verein_id: vereinId }).first();
    if (!mitgliedschaft) return fehler(404, 'Beitrittsanfrage nicht gefunden.');
    if (mitgliedschaft.freigegeben) return fehler(409, 'Diese Mitgliedschaft ist bereits freigegeben.');

    if (entscheidung === 'ablehnen') {
        await loescheMitgliedschaft(knex, benutzerId, vereinId);
        await entwerteFreischaltLinks(knex, benutzerId, vereinId);
        return { ok: true };
    }

    if (!istGueltigeRolle(rolle)) {
        return fehler(400, 'Bitte eine Rolle wählen (Admin, Benutzer oder Helfer).');
    }
    // Nur eine noch offene Anfrage freigeben (gleichzeitige Entscheidungen: die zweite trifft nichts mehr).
    const geaendert = await knex('benutzer_vereine')
        .where({ id: mitgliedschaft.id, freigegeben: 0 })
        .update({
            freigegeben: 1,
            rolle,
            entschieden_von: perToken === true ? null : entscheiderId,
            entschieden_am: knex.fn.now(),
            updated_at: knex.fn.now()
        });
    if (!geaendert) return fehler(409, 'Diese Mitgliedschaft ist bereits freigegeben.');
    await entwerteFreischaltLinks(knex, benutzerId, vereinId);
    return { ok: true };
}

// Nach einer Entscheidung (per Link oder über die Liste) gelten die übrigen Freischaltungs-Links dieser Anfrage
// nicht mehr; sonst träfe ein alter Link nach Ablehnung und erneuter Anfrage die neue Anfrage.
async function entwerteFreischaltLinks(knex, benutzerId, vereinId) {
    await knex('token_einmal')
        .where({ benutzer_id: benutzerId, verein_id: vereinId, zweck: 'freischaltung' })
        .whereNull('benutzt_am')
        .update({ benutzt_am: knex.fn.now() });
}

/**
 * Ändert die Rolle eines freigegebenen Mitglieds. Der letzte Admin kann nur vom Super-Admin herabgestuft werden.
 */
export async function aendereRolle(knex, { vereinId, benutzerId, neueRolle, durchId }) {
    const durchSuperAdmin = await istSuperAdmin(knex, durchId);
    if (!durchSuperAdmin && !(await istVereinsAdmin(knex, durchId, vereinId))) {
        return fehler(403, 'Nur Admins dieses Vereins dürfen Rollen ändern.');
    }
    if (!istGueltigeRolle(neueRolle)) {
        return fehler(400, 'Ungültige Rolle (erlaubt: Admin, Benutzer, Helfer).');
    }

    return knex.transaction(async (trx) => {
        // Admin-Zeilen des Vereins sperren, damit zwei Admins sich nicht gleichzeitig gegenseitig herabstufen.
        await trx('benutzer_vereine').where({ verein_id: vereinId, rolle: 'admin' }).forUpdate().select('id');
        const mitgliedschaft = await trx('benutzer_vereine').where({ benutzer_id: benutzerId, verein_id: vereinId }).first();
        if (!mitgliedschaft) return fehler(404, 'Mitglied nicht gefunden.');
        if (!mitgliedschaft.freigegeben) return fehler(409, 'Die Mitgliedschaft ist noch nicht freigegeben.');
        if (mitgliedschaft.rolle === neueRolle) return { ok: true };

        if (!durchSuperAdmin && neueRolle !== 'admin' && await istLetzterAdmin(trx, vereinId, benutzerId)) {
            return fehler(409, 'Der letzte Admin des Vereins kann nicht herabgestuft werden. Bitte zuerst einen weiteren Admin bestimmen.');
        }

        await trx('benutzer_vereine').where({ id: mitgliedschaft.id }).update({ rolle: neueRolle, updated_at: trx.fn.now() });
        return { ok: true };
    });
}

/**
 * Super-Admin weist einem Konto einen Verein mit Rolle zu: legt die Mitgliedschaft freigegeben an, gibt eine
 * offene Beitrittsanfrage mit der Rolle frei oder ändert die Rolle einer bestehenden Mitgliedschaft.
 * Hat das Konto noch keinen aktiven Verein, wird dieser Verein sein aktiver.
 * @returns {Promise<{ ok: true, aktion: 'angelegt'|'freigegeben'|'rolle' } | { ok: false, status: number, error: string }>}
 */
export async function weiseMitgliedschaftZu(knex, { benutzerId, vereinId, rolle, durchId }) {
    if (!(await istSuperAdmin(knex, durchId))) {
        return fehler(403, 'Nur Super-Admins dürfen Vereine und Rollen zuweisen.');
    }
    if (!istGueltigeRolle(rolle)) {
        return fehler(400, 'Bitte eine Rolle wählen (Admin, Benutzer oder Helfer).');
    }
    const vid = Number(vereinId);
    if (!Number.isInteger(vid) || vid <= 0) return fehler(400, 'Bitte einen Verein wählen.');

    return knex.transaction(async (trx) => {
        const konto = await trx('benutzer').where({ id: benutzerId }).first('id', 'aktiver_verein_id');
        if (!konto) return fehler(404, 'Konto nicht gefunden.');
        const verein = await trx('vereine').where({ id: vid }).first('id');
        if (!verein) return fehler(404, 'Verein nicht gefunden.');

        // Admin-Zeilen sperren, damit sich Rollenänderungen nicht überholen (wie aendereRolle).
        await trx('benutzer_vereine').where({ verein_id: vid, rolle: 'admin' }).forUpdate().select('id');
        const mitgliedschaft = await trx('benutzer_vereine').where({ benutzer_id: benutzerId, verein_id: vid }).first();
        const entschieden = { freigegeben: 1, rolle, entschieden_von: durchId, entschieden_am: trx.fn.now(), updated_at: trx.fn.now() };
        let aktion;
        if (!mitgliedschaft) {
            await trx('benutzer_vereine').insert({ benutzer_id: benutzerId, verein_id: vid, angefragt_ueber: 'verwaltung', ...entschieden });
            aktion = 'angelegt';
        } else if (!mitgliedschaft.freigegeben) {
            await trx('benutzer_vereine').where({ id: mitgliedschaft.id }).update(entschieden);
            await entwerteFreischaltLinks(trx, benutzerId, vid);
            aktion = 'freigegeben';
        } else {
            await trx('benutzer_vereine').where({ id: mitgliedschaft.id }).update({ rolle, updated_at: trx.fn.now() });
            aktion = 'rolle';
        }
        if (!konto.aktiver_verein_id) {
            await trx('benutzer').where({ id: benutzerId }).update({ aktiver_verein_id: vid, updated_at: trx.fn.now() });
        }
        return { ok: true, aktion };
    });
}

/**
 * Entfernt ein Mitglied aus dem Verein (Admin/Super-Admin) oder lässt es austreten (durchId === benutzerId).
 * @returns {Promise<{ ok: true, vereinGeloescht: boolean } | { ok: false, status: number, error: string }>}
 */
export async function entferneMitglied(knex, { vereinId, benutzerId, durchId, vereinBehalten = false, ueberVerwaltung = false }) {
    const durchSuperAdmin = await istSuperAdmin(knex, durchId);
    const selbst = durchId === benutzerId && !ueberVerwaltung;
    if (!selbst && !durchSuperAdmin && !(await istVereinsAdmin(knex, durchId, vereinId))) {
        return fehler(403, 'Nur Admins dieses Vereins dürfen Mitglieder entfernen.');
    }

    return knex.transaction(async (trx) => {
        await trx('benutzer_vereine').where({ verein_id: vereinId, rolle: 'admin' }).forUpdate().select('id');
        const mitgliedschaft = await trx('benutzer_vereine').where({ benutzer_id: benutzerId, verein_id: vereinId }).first();
        if (!mitgliedschaft) return fehler(404, selbst ? 'Sie sind kein Mitglied dieses Vereins.' : 'Mitglied nicht gefunden.');

        // Invariante (einzige Stelle, auch für leaveVerein): ein Konto gehört immer mindestens einem Verein an.
        if (selbst) {
            const eigene = await trx('benutzer_vereine').where({ benutzer_id: benutzerId }).count('* as anzahl').first();
            if (parseInt(eigene.anzahl, 10) <= 1) {
                return fehler(409, EINZIGER_VEREIN_FEHLER);
            }
        }

        if (!durchSuperAdmin && await istLetzterAdmin(trx, vereinId, benutzerId)) {
            const andere = await trx('benutzer_vereine')
                .where({ verein_id: vereinId })
                .whereNot({ benutzer_id: benutzerId })
                .first();
            if (andere) {
                return fehler(409, selbst
                    ? 'Sie sind der letzte Admin dieses Vereins und können nicht austreten. Bitte zuerst einen weiteren Admin bestimmen.'
                    : 'Der letzte Admin des Vereins kann nicht entfernt werden.');
            }
        }

        if (await hatOffeneDienste(trx, benutzerId, vereinId)) {
            return fehler(409, selbst
                ? 'Sie sind in diesem Verein noch für Helferdienste eingetragen. Bitte zuerst austragen.'
                : 'Das Mitglied ist noch für Helferdienste eingetragen. Bitte zuerst austragen.');
        }

        const vereinGeloescht = await loescheMitgliedschaft(trx, benutzerId, vereinId, { vereinBehalten });
        return { ok: true, vereinGeloescht };
    });
}
