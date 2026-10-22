// Vereine verwalten (Super-Admin, Seite „Vereine“): anlegen, umbenennen, zusammenführen (Dubletten wie „TSV X“ und
// „TSV X e.V.“) und leere Vereine löschen. Reine Datenbanklogik ohne Express, damit sie sich einzeln testen lässt.
import { ROLLEN } from '../shared/rollen.js';

export const MAX_VEREINSNAME_LAENGE = 255;

/** Vereinsname bereinigen (Leerzeichen zusammenfassen); null bei leer oder zu lang. */
export function bereinigeVereinsname(roh) {
    if (typeof roh !== 'string') return null;
    const name = roh.replace(/\s+/g, ' ').trim();
    if (!name || name.length > MAX_VEREINSNAME_LAENGE) return null;
    return name;
}

async function nameVergeben(knex, name, ausserId = null) {
    const abfrage = knex('vereine').whereRaw('lower(trim(name)) = ?', [name.toLowerCase()]);
    if (ausserId != null) abfrage.whereNot({ id: ausserId });
    return !!(await abfrage.first('id'));
}

/** @returns {Promise<{ ok: true, verein: object } | { ok: false, status: number, error: string }>} */
export async function legeVereinAn(knex, { name, bundesland = null }) {
    const bereinigt = bereinigeVereinsname(name);
    if (!bereinigt) {
        return { ok: false, status: 400, error: `Bitte einen Vereinsnamen mit höchstens ${MAX_VEREINSNAME_LAENGE} Zeichen angeben.` };
    }
    if (await nameVergeben(knex, bereinigt)) {
        return { ok: false, status: 409, error: 'Ein Verein mit diesem Namen existiert bereits.' };
    }
    const [zeile] = await knex('vereine').insert({ name: bereinigt, bundesland }).returning(['id', 'name', 'bundesland']);
    return { ok: true, verein: zeile };
}

/** @returns {Promise<{ ok: true, name: string } | { ok: false, status: number, error: string }>} */
export async function benenneVereinUm(knex, vereinId, name) {
    const bereinigt = bereinigeVereinsname(name);
    if (!bereinigt) {
        return { ok: false, status: 400, error: `Bitte einen Vereinsnamen mit höchstens ${MAX_VEREINSNAME_LAENGE} Zeichen angeben.` };
    }
    const verein = await knex('vereine').where({ id: vereinId }).first('id');
    if (!verein) return { ok: false, status: 404, error: 'Verein nicht gefunden.' };
    if (await nameVergeben(knex, bereinigt, vereinId)) {
        return { ok: false, status: 409, error: 'Ein anderer Verein heißt bereits so. Zum Zusammenlegen „Zusammenführen“ verwenden.' };
    }
    await knex('vereine').where({ id: vereinId }).update({ name: bereinigt, updated_at: knex.fn.now() });
    return { ok: true, name: bereinigt };
}

// Rang einer Rolle (kleiner = mehr Rechte); null/unbekannt = keine freigegebene Rolle.
const rang = (rolle) => {
    const i = ROLLEN.indexOf(rolle);
    return i === -1 ? ROLLEN.length : i;
};

// Alle Fremdschlüssel auf vereine(id): [{ tabelle, spalte }]
async function fremdschluesselAufVereine(trx) {
    const ergebnis = await trx.raw(`
        SELECT kcu.table_name AS tabelle, kcu.column_name AS spalte
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
        JOIN information_schema.constraint_column_usage ccu
          ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND ccu.table_name = 'vereine' AND ccu.column_name = 'id'
          AND tc.table_schema = current_schema()
    `);
    return ergebnis.rows;
}

const BESONDERS_BEHANDELT = new Set(['benutzer_vereine.verein_id', 'urkunden_vorlagen.verein_id']);

function freierName(name, belegt) {
    if (!belegt.has(name)) return name;
    for (let i = 2; ; i += 1) {
        const kandidat = `${name} (${i})`;
        if (!belegt.has(kandidat)) return kandidat;
    }
}

/**
 * Führt den Verein `quelleId` in `zielId` zusammen und löscht ihn danach. Mitglieder (bei Doppelmitgliedschaft gilt die
 * höhere Rolle), Turniere, Urkunden-Vorlagen (bei gleichem Namen „Name (2)“), Einladungen/Tokens und alles Übrige mit
 * Fremdschlüssel auf den Verein wandern zum Zielverein; ein leeres Bundesland des Ziels wird aus der Quelle gefüllt.
 * Alles in einer Transaktion.
 * @returns {Promise<{ ok: true, mitglieder: number, turniere: number, vorlagen: number } | { ok: false, status: number, error: string }>}
 */
export async function fuehreVereineZusammen(knex, quelleId, zielId) {
    if (quelleId === zielId) return { ok: false, status: 400, error: 'Quelle und Ziel müssen verschiedene Vereine sein.' };
    try {
        return await knex.transaction(async (trx) => {
            const quelle = await trx('vereine').where({ id: quelleId }).forUpdate().first();
            const ziel = await trx('vereine').where({ id: zielId }).forUpdate().first();
            if (!quelle || !ziel) return { ok: false, status: 404, error: 'Verein nicht gefunden.' };

            // Mitgliedschaften
            const quellMitglieder = await trx('benutzer_vereine').where({ verein_id: quelleId });
            const zielMitglieder = new Map((await trx('benutzer_vereine').where({ verein_id: zielId }))
                .map(m => [m.benutzer_id, m]));
            for (const m of quellMitglieder) {
                const vorhanden = zielMitglieder.get(m.benutzer_id);
                if (!vorhanden) {
                    await trx('benutzer_vereine').where({ id: m.id }).update({ verein_id: zielId, updated_at: trx.fn.now() });
                    continue;
                }
                const aenderung = {};
                if (m.freigegeben && !vorhanden.freigegeben) aenderung.freigegeben = m.freigegeben;
                const quellRolle = m.freigegeben ? m.rolle : null;
                const zielRolle = vorhanden.freigegeben ? vorhanden.rolle : null;
                if (rang(quellRolle) < rang(zielRolle)) aenderung.rolle = quellRolle;
                if (Object.keys(aenderung).length) {
                    await trx('benutzer_vereine').where({ id: vorhanden.id }).update({ ...aenderung, updated_at: trx.fn.now() });
                }
                await trx('benutzer_vereine').where({ id: m.id }).del();
            }
            await trx('benutzer').where({ aktiver_verein_id: quelleId }).update({ aktiver_verein_id: zielId });

            // Urkunden-Vorlagen: (verein_id, name) ist eindeutig
            const vorlagen = await trx('urkunden_vorlagen').where({ verein_id: quelleId }).select('id', 'name').orderBy('id');
            const belegt = new Set((await trx('urkunden_vorlagen').where({ verein_id: zielId }).select('name')).map(v => v.name));
            for (const v of vorlagen) {
                const name = freierName(v.name, belegt);
                belegt.add(name);
                await trx('urkunden_vorlagen').where({ id: v.id }).update({ verein_id: zielId, name });
            }

            // Turniere und alles Übrige, was auf den Verein zeigt
            const turniere = await trx('turniere').where({ verein_id: quelleId }).update({ verein_id: zielId });
            for (const { tabelle, spalte } of await fremdschluesselAufVereine(trx)) {
                const schluessel = `${tabelle}.${spalte}`;
                if (BESONDERS_BEHANDELT.has(schluessel) || schluessel === 'turniere.verein_id' || schluessel === 'benutzer.aktiver_verein_id') continue;
                await trx(tabelle).where({ [spalte]: quelleId }).update({ [spalte]: zielId });
            }

            if (!ziel.bundesland && quelle.bundesland) {
                await trx('vereine').where({ id: zielId }).update({ bundesland: quelle.bundesland, updated_at: trx.fn.now() });
            }
            await trx('vereine').where({ id: quelleId }).del();
            return { ok: true, mitglieder: quellMitglieder.length, turniere, vorlagen: vorlagen.length };
        });
    } catch (err) {
        if (err && err.code === '23505') {
            return { ok: false, status: 409, error: 'Das Zusammenführen ist an einem doppelten Eintrag gescheitert. Es wurde nichts geändert.' };
        }
        throw err;
    }
}

/**
 * Löscht einen Verein, aber nur einen leeren: ohne Turniere und ohne Mitglieder (sonst „Zusammenführen“).
 * @returns {Promise<{ ok: true } | { ok: false, status: number, error: string }>}
 */
export async function loescheLeerenVerein(knex, vereinId) {
    return knex.transaction(async (trx) => {
        const verein = await trx('vereine').where({ id: vereinId }).forUpdate().first('id');
        if (!verein) return { ok: false, status: 404, error: 'Verein nicht gefunden.' };
        const turniere = await trx('turniere').where({ verein_id: vereinId }).count('* as n').first();
        const mitglieder = await trx('benutzer_vereine').where({ verein_id: vereinId }).count('* as n').first();
        if (parseInt(turniere.n, 10) > 0 || parseInt(mitglieder.n, 10) > 0) {
            return {
                ok: false,
                status: 409,
                error: 'Der Verein hat noch Turniere oder Mitglieder und kann nicht gelöscht werden. Zum Aufräumen „Zusammenführen“ verwenden.'
            };
        }
        await trx('vereine').where({ id: vereinId }).del();
        return { ok: true };
    });
}
