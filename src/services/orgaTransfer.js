// Orga-Planer im Turnier-Export/-Import (Spec 2026-10-18-orga-planer-design, "Transfer und Betriebsmodi").
// Hierarchie über temporäre Schlüssel (`ref` = Position im Export, `eltern_ref` zeigt auf eine frühere Position),
// Zuständige nur als freier Text (name_frei/email_frei, nie benutzer_id), erinnert_fuer/erledigt_von/erstellt_von
// werden nicht übernommen. Import ersetzt die Aufgaben des Zielturniers; fehlt der Abschnitt (alte Exportdatei),
// bleibt alles unberührt.
import { datumAlsText } from './helferPlan.js';
import { ORGA_PHASEN } from '../shared/orgaVorlage.js';
import { MITBRINGLISTEN_KEYS } from './orgaPlan.js';

const ARTEN = ['aufgabe', 'posten', 'mitbringen'];
const ANKER = ['turnier', 'anmeldeschluss'];
const idAus = (r) => (typeof r === 'object' ? r.id : r);
const DATUM = /^\d{4}-\d{2}-\d{2}$/;

function zeitpunktAlsText(wert) {
    if (wert == null) return null;
    const d = wert instanceof Date ? wert : new Date(wert);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Orga-Checkliste eines Turniers für den Export (Eltern vor Kindern).
 * @returns {Promise<{aufgaben: Array}>}
 */
export async function exportiereOrga(knex, turnierId) {
    const zeilen = await knex('orga_aufgaben as a')
        .leftJoin('benutzer as b', 'b.id', 'a.benutzer_id')
        .where('a.turnier_id', turnierId)
        .orderBy([{ column: 'a.reihenfolge' }, { column: 'a.id' }])
        .select('a.*', 'b.vorname', 'b.nachname');
    const eltern = zeilen.filter((z) => z.eltern_id == null);
    const kinder = zeilen.filter((z) => z.eltern_id != null);
    const reihe = [...eltern, ...kinder];
    const refVon = new Map(reihe.map((z, i) => [z.id, i]));
    return {
        aufgaben: reihe.map((z, i) => {
            const kontoName = z.benutzer_id ? [z.vorname, z.nachname].filter(Boolean).join(' ').trim() : '';
            return {
                ref: i,
                eltern_ref: z.eltern_id != null && refVon.has(z.eltern_id) ? refVon.get(z.eltern_id) : null,
                phase: z.phase,
                art: z.art,
                titel: z.titel,
                notiz: z.notiz,
                menge: z.menge,
                reihenfolge: z.reihenfolge,
                frist_anker: z.frist_anker,
                frist_tage: z.frist_tage,
                faellig_am: datumAlsText(z.faellig_am),
                faellig_manuell: !!z.faellig_manuell,
                auto_art: z.auto_art,
                auto_ref: z.auto_ref,
                link: z.link,
                vorlage_key: z.vorlage_key,
                name_frei: z.benutzer_id ? (kontoName || null) : z.name_frei,
                email_frei: z.benutzer_id ? null : z.email_frei,
                erledigt_am: zeitpunktAlsText(z.erledigt_am)
            };
        })
    };
}

const text = (w, max) => {
    const t = String(w ?? '').trim().slice(0, max);
    return t || null;
};
const ganzzahl = (w) => (w != null && w !== '' && Number.isInteger(Number(w)) ? Number(w) : null);

/**
 * Ersetzt alle Aufgaben des Turniers durch den Stand aus einem Export (in einer Transaktion aufrufen).
 * Ohne Abschnitt (null/undefined) bleibt das Turnier unberührt. Ungültige Einträge werden übersprungen.
 * @returns {Promise<{aufgaben:number}|null>} null, wenn nichts zu tun war
 */
export async function ersetzeOrga(trx, turnierId, orga) {
    if (orga == null || !Array.isArray(orga.aufgaben)) return null;
    await trx('orga_aufgaben').where({ turnier_id: turnierId }).del();
    const neueId = new Map(); // ref -> neue id (nur oberste Ebene)
    const elternKey = new Map(); // ref -> vorlage_key der obersten Aufgabe
    let anzahl = 0;
    const roh = orga.aufgaben.filter((a) => a && typeof a === 'object');
    // Eltern zuerst, damit die Kinder ihre neue id kennen
    for (const durchgang of [0, 1]) {
        for (const a of roh) {
            const istKind = a.eltern_ref != null;
            if (istKind !== (durchgang === 1)) continue;
            const titel = text(a.titel, 255);
            if (!titel || !ORGA_PHASEN.includes(a.phase)) continue;
            let elternId = null;
            if (istKind) {
                elternId = neueId.get(a.eltern_ref) ?? null;
                if (elternId == null) continue; // Eltern nur oberste Ebene: keine dritte Ebene, keine Waisen
                if (a.art === 'mitbringen' && !MITBRINGLISTEN_KEYS.has(elternKey.get(a.eltern_ref))) continue;
            }
            const art = ARTEN.includes(a.art) ? a.art : (istKind ? 'posten' : 'aufgabe');
            if ((art === 'aufgabe') === istKind) continue; // Aufgaben liegen oben, Posten/Mitbringen darunter
            const anker = ANKER.includes(a.frist_anker) ? a.frist_anker : null;
            const erledigt = a.erledigt_am ? new Date(a.erledigt_am) : null;
            const id = idAus((await trx('orga_aufgaben').insert({
                turnier_id: turnierId, eltern_id: elternId, phase: a.phase, art, titel,
                notiz: text(a.notiz, 5000), menge: ganzzahl(a.menge), reihenfolge: ganzzahl(a.reihenfolge) ?? 0,
                frist_anker: anker, frist_tage: anker ? ganzzahl(a.frist_tage) : null,
                faellig_am: DATUM.test(String(a.faellig_am ?? '')) ? a.faellig_am : null,
                faellig_manuell: !!a.faellig_manuell,
                auto_art: text(a.auto_art, 255), auto_ref: text(a.auto_ref, 255), link: text(a.link, 255),
                vorlage_key: text(a.vorlage_key, 255),
                benutzer_id: null, name_frei: text(a.name_frei, 255), email_frei: text(a.email_frei, 255),
                erledigt_am: erledigt && !Number.isNaN(erledigt.getTime()) ? erledigt : null
            }).returning('id'))[0]);
            if (a.ref != null && !istKind) {
                neueId.set(a.ref, id);
                elternKey.set(a.ref, text(a.vorlage_key, 255));
            }
            anzahl += 1;
        }
    }
    return { aufgaben: anzahl };
}
