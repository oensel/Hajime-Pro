// Sichtbarkeit eines Turniers für andere Vereine: 'alle' (Standard), 'bundesland' (Vereine im Bundesland des
// Turniers, ersatzweise des ausrichtenden Vereins) oder 'eingeladen' (nur Vereine in turnier_einladungen).
// Der ausrichtende Verein (Rolle benutzer aufwärts), Super-Admins und der Einzelbenutzerbetrieb sehen immer alles.
import { hatVereinsZugriffAufTurnier } from '../utils/vereinHelper.js';
import betriebsmodus from '../config/betriebsmodus.cjs';

const { istEinzelbenutzerBetrieb } = betriebsmodus;

export const SICHTBARKEITEN = ['alle', 'bundesland', 'eingeladen'];

export function normalisiereSichtbarkeit(wert, standard = 'alle') {
    return SICHTBARKEITEN.includes(wert) ? wert : standard;
}

/** Vereine des Benutzers (freigegebene Mitgliedschaften) samt Bundesland. */
async function ladeEigeneVereine(knex, benutzerId) {
    return knex('benutzer_vereine as bv')
        .join('vereine as v', 'v.id', 'bv.verein_id')
        .where({ 'bv.benutzer_id': benutzerId, 'bv.freigegeben': 1 })
        .select('v.id', 'v.bundesland');
}

/**
 * Filtert Turniere auf die für den Benutzer sichtbaren. Ändert nichts an der Reihenfolge.
 * @param {object|null} user Ergebnis von ladeBenutzerMitAktivemVerein
 */
export async function filtereSichtbareTurniere(knex, user, turniere) {
    if (istEinzelbenutzerBetrieb() || (user && user.super_admin_aktiv)) return turniere;
    const beschraenkt = turniere.filter((t) => t.sichtbarkeit && t.sichtbarkeit !== 'alle' && !hatVereinsZugriffAufTurnier(user, t));
    if (beschraenkt.length === 0) return turniere;

    const eigene = user ? await ladeEigeneVereine(knex, user.id) : [];
    const eigeneIds = new Set(eigene.map((v) => v.id));
    const eigeneLaender = new Set(eigene.map((v) => v.bundesland).filter(Boolean));

    const ausrichterIds = [...new Set(beschraenkt.filter((t) => t.sichtbarkeit === 'bundesland' && !t.bundesland).map((t) => t.verein_id))];
    const ausrichterLand = new Map(
        ausrichterIds.length > 0 ? (await knex('vereine').whereIn('id', ausrichterIds).select('id', 'bundesland')).map((v) => [v.id, v.bundesland]) : []
    );
    const einladungTurnierIds = beschraenkt.filter((t) => t.sichtbarkeit === 'eingeladen').map((t) => t.id);
    const eingeladen = new Set(
        einladungTurnierIds.length > 0 && eigeneIds.size > 0
            ? (await knex('turnier_einladungen').whereIn('turnier_id', einladungTurnierIds).whereIn('verein_id', [...eigeneIds]).select('turnier_id')).map((e) => e.turnier_id)
            : []
    );

    const erlaubt = new Set();
    for (const t of beschraenkt) {
        if (t.sichtbarkeit === 'eingeladen' && eingeladen.has(t.id)) erlaubt.add(t.id);
        if (t.sichtbarkeit === 'bundesland') {
            const land = t.bundesland || ausrichterLand.get(t.verein_id);
            if (land && eigeneLaender.has(land)) erlaubt.add(t.id);
        }
    }
    const verborgen = new Set(beschraenkt.filter((t) => !erlaubt.has(t.id)).map((t) => t.id));
    return turniere.filter((t) => !verborgen.has(t.id));
}

/** Darf der Benutzer dieses eine Turnier sehen (und ggf. dort anmelden)? */
export async function darfTurnierSehen(knex, user, turnier) {
    return (await filtereSichtbareTurniere(knex, user, [turnier])).length === 1;
}
