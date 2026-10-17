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

/**
 * STUB bis Task 7 (Helferplan-Service): hat das Konto im Verein noch offene Helferdienste?
 * Task 7 ersetzt diesen Export durch `export { hatOffeneDienste } from './helferPlan.js';`.
 * @returns {Promise<boolean>}
 */
export async function hatOffeneDienste(_knex, _benutzerId, _vereinId) {
    return false;
}

const fehler = (status, error) => ({ ok: false, status, error });

async function istSuperAdmin(knex, benutzerId) {
    if (!benutzerId) return false;
    const benutzer = await knex('benutzer').where({ id: benutzerId }).first();
    return !!(benutzer && benutzer.ist_super_admin);
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
async function loescheMitgliedschaft(knex, benutzerId, vereinId) {
    // Vor dem Löschen erfassen: das Löschen eines verwaisten Vereins setzt benutzer.aktiver_verein_id
    // per ON DELETE SET NULL bereits zurück, bevor wir nachschauen könnten.
    const benutzer = await knex('benutzer').where({ id: benutzerId }).first();
    const warAktiverVerein = !!(benutzer && benutzer.aktiver_verein_id === vereinId);

    await knex('benutzer_vereine').where({ benutzer_id: benutzerId, verein_id: vereinId }).del();

    let vereinGeloescht = false;
    const verbleibende = await knex('benutzer_vereine').where({ verein_id: vereinId }).count('* as anzahl').first();
    if (parseInt(verbleibende.anzahl, 10) === 0) {
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
 * entscheiderId === null bedeutet: die Berechtigung ist bereits anderweitig nachgewiesen (Freischaltungs-
 * Token aus der Mail, Task 5); dann bleibt entschieden_von leer. Jeder andere Wert wird geprüft.
 * @param {{ vereinId: number, benutzerId: string, entscheiderId: string|null, entscheidung: 'freigeben'|'ablehnen', rolle?: string }} p
 */
export async function entscheideAnfrage(knex, { vereinId, benutzerId, entscheiderId, entscheidung, rolle }) {
    if (entscheidung !== 'freigeben' && entscheidung !== 'ablehnen') {
        return fehler(400, 'Ungültige Entscheidung.');
    }
    if (entscheiderId !== null && !(await darfVereinVerwalten(knex, entscheiderId, vereinId))) {
        return fehler(403, 'Nur Admins dieses Vereins dürfen Beitrittsanfragen entscheiden.');
    }

    const mitgliedschaft = await knex('benutzer_vereine').where({ benutzer_id: benutzerId, verein_id: vereinId }).first();
    if (!mitgliedschaft) return fehler(404, 'Beitrittsanfrage nicht gefunden.');
    if (mitgliedschaft.freigegeben) return fehler(409, 'Diese Mitgliedschaft ist bereits freigegeben.');

    if (entscheidung === 'ablehnen') {
        await loescheMitgliedschaft(knex, benutzerId, vereinId);
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
            entschieden_von: entscheiderId,
            entschieden_am: knex.fn.now(),
            updated_at: knex.fn.now()
        });
    if (!geaendert) return fehler(409, 'Diese Mitgliedschaft ist bereits freigegeben.');
    return { ok: true };
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
 * Entfernt ein Mitglied aus dem Verein (Admin/Super-Admin) oder lässt es austreten (durchId === benutzerId).
 * @returns {Promise<{ ok: true, vereinGeloescht: boolean } | { ok: false, status: number, error: string }>}
 */
export async function entferneMitglied(knex, { vereinId, benutzerId, durchId }) {
    const durchSuperAdmin = await istSuperAdmin(knex, durchId);
    const selbst = durchId === benutzerId;
    if (!selbst && !durchSuperAdmin && !(await istVereinsAdmin(knex, durchId, vereinId))) {
        return fehler(403, 'Nur Admins dieses Vereins dürfen Mitglieder entfernen.');
    }

    return knex.transaction(async (trx) => {
        await trx('benutzer_vereine').where({ verein_id: vereinId, rolle: 'admin' }).forUpdate().select('id');
        const mitgliedschaft = await trx('benutzer_vereine').where({ benutzer_id: benutzerId, verein_id: vereinId }).first();
        if (!mitgliedschaft) return fehler(404, selbst ? 'Sie sind kein Mitglied dieses Vereins.' : 'Mitglied nicht gefunden.');

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

        const vereinGeloescht = await loescheMitgliedschaft(trx, benutzerId, vereinId);
        return { ok: true, vereinGeloescht };
    });
}
