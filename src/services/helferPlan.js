// Helferplan (Helferverwaltung, Spec Abschnitte 5–7): Tätigkeiten je Turnier, ihre Zeit-Slots und die
// Einsätze der Helfer. Erwartete Fehler werfen FachFehler mit HTTP-Status und deutscher Meldung.
// Regeln:
//   - Je Kampffläche „Kampfgericht Matte n“ und je Waage „Waage n“ (art 'matte'/'waage'), Bedarf 2,
//     nicht umbenennbar/löschbar; eigene Tätigkeiten (art 'frei') frei änderbar.
//   - Slots im 15-Minuten-Raster, mindestens 30 Minuten, keine Überlappung innerhalb einer Tätigkeit.
//   - Eintragen: freigegebene Mitgliedschaft im ausrichtenden Verein, kein überlappender eigener Dienst im
//     selben Turnier, Platz frei (Zählen und Einfügen in einer Transaktion mit Sperre des Slots), Frist
//     Turniertag 08:00 Europe/Berlin (gilt nicht für die Orga).
import { FachFehler } from '../utils/fachFehler.js';
import { hatHelferZugriffAufVerein } from '../utils/vereinHelper.js';
import { RASTER_MIN, MIN_LAENGE, darfHelferAendern, ueberlappt, erzeugeStandardSlots } from '../shared/helferZeit.js';

const STANDARD_BEDARF = 2;
const FRIST_MELDUNG = 'Die Frist ist abgelaufen (Turniertag 08:00 Uhr). Bitte melde dich bei der Turnierleitung.';

// Maschinenlesbare Fehlerarten (FachFehler.code) für die Routen/Oberfläche.
export const FEHLER_CODES = Object.freeze({
    BESTAETIGUNG_NOETIG: 'bestaetigung_noetig', // daten.anzahl = Zahl der Eingetragenen
    UEBERLAPPUNG: 'ueberlappung',
    VOLL: 'voll',
    FRIST: 'frist',
    TURNIER_NICHT_AKTIV: 'turnier_nicht_aktiv',
    KONFLIKT: 'konflikt'
});

// Turnierstatus, in denen Helfer sich selbst eintragen können (gespeicherte Werte laut turnierController:
// 'entwurf' | 'veroeffentlicht' | 'abgeschlossen' | 'abgesagt').
const AKTIVE_TURNIER_STATUS = ['entwurf', 'veroeffentlicht'];

function fehler(status, nachricht, { code = null, daten = null } = {}) {
    const e = new FachFehler(status, nachricht, { code, daten });
    e.status = status;
    return e;
}

// Bezeichnungen und Namen passen in varchar(255).
const MAX_TEXT_LAENGE = 255;

function pruefeBezeichnung(bezeichnung) {
    const name = String(bezeichnung || '').trim();
    if (!name) throw fehler(400, 'Bitte eine Bezeichnung angeben.');
    if (name.length > MAX_TEXT_LAENGE) throw fehler(400, `Die Bezeichnung ist zu lang (höchstens ${MAX_TEXT_LAENGE} Zeichen).`);
    return name;
}

function bestaetigungNoetig(nachricht, anzahl) {
    return fehler(409, nachricht, { code: FEHLER_CODES.BESTAETIGUNG_NOETIG, daten: { anzahl } });
}

// Transaktion; Deadlock (40P01) und Serialisierungsfehler (40001) werden zu einem 409 „Bitte erneut versuchen.“
async function transaktion(knex, fn) {
    try {
        return await knex.transaction(fn);
    } catch (e) {
        if (!(e instanceof FachFehler) && (e?.code === '40P01' || e?.code === '40001')) {
            throw fehler(409, 'Bitte erneut versuchen.', { code: FEHLER_CODES.KONFLIKT });
        }
        throw e;
    }
}

// Lock-Reihenfolge überall: Turnier → Tätigkeit → Slot (Löschen per CASCADE folgt derselben Richtung).
async function sperreTaetigkeit(trx, taetigkeitId) {
    const t = await trx('helfer_taetigkeiten').where({ id: taetigkeitId }).forUpdate().first();
    if (!t) throw fehler(404, 'Tätigkeit nicht gefunden.');
    return t;
}

async function sperreSlotUeberTaetigkeit(trx, slotId) {
    const kopf = await trx('helfer_slots').where({ id: slotId }).first('taetigkeit_id');
    if (!kopf) throw fehler(404, 'Slot nicht gefunden.');
    const taetigkeit = await sperreTaetigkeit(trx, kopf.taetigkeit_id);
    const slot = await trx('helfer_slots').where({ id: slotId }).forUpdate().first();
    if (!slot) throw fehler(404, 'Slot nicht gefunden.');
    return { slot, taetigkeit };
}

const idAus = (r) => (typeof r === 'object' ? r.id : r);

// pg liefert `date` als Date (lokale Mitternacht): aus den lokalen Feldern, nicht über toISOString.
export function datumAlsText(wert) {
    if (wert instanceof Date) {
        return `${wert.getFullYear()}-${String(wert.getMonth() + 1).padStart(2, '0')}-${String(wert.getDate()).padStart(2, '0')}`;
    }
    return wert == null ? null : String(wert).slice(0, 10);
}

// Heutiges Datum in Europe/Berlin als 'YYYY-MM-DD'.
function heuteBerlin(jetzt = new Date()) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' })
        .format(jetzt);
}

function pruefeBedarf(bedarf) {
    const n = Number(bedarf);
    if (!Number.isInteger(n) || n < 1 || n > 99) throw fehler(400, 'Die Anzahl Helfer muss eine ganze Zahl zwischen 1 und 99 sein.');
    return n;
}

function pruefeZeitraum(von, bis) {
    if (!Number.isInteger(von) || !Number.isInteger(bis) || von < 0 || bis > 1440) {
        throw fehler(400, 'Ungültige Uhrzeit für den Slot.');
    }
    if (von % RASTER_MIN !== 0 || bis % RASTER_MIN !== 0) {
        throw fehler(400, `Slots beginnen und enden im ${RASTER_MIN}-Minuten-Raster.`);
    }
    if (bis - von < MIN_LAENGE) throw fehler(400, `Ein Slot dauert mindestens ${MIN_LAENGE} Minuten.`);
}

async function pruefeKeineUeberlappung(knex, taetigkeitId, zeitraum, ohneSlotId = null) {
    let abfrage = knex('helfer_slots').where({ taetigkeit_id: taetigkeitId });
    if (ohneSlotId != null) abfrage = abfrage.whereNot({ id: ohneSlotId });
    const andere = await abfrage.select('von_min', 'bis_min');
    if (andere.some(s => ueberlappt(s, zeitraum))) {
        throw fehler(409, 'Der Slot überschneidet sich mit einem anderen Slot dieser Tätigkeit.', { code: FEHLER_CODES.UEBERLAPPUNG });
    }
}

async function ladeTurnier(knex, turnierId) {
    const turnier = await knex('turniere').where({ id: turnierId }).first();
    if (!turnier) throw fehler(404, 'Turnier nicht gefunden.');
    return turnier;
}


async function anzahlEinsaetze(knex, slotIds) {
    if (slotIds.length === 0) return 0;
    const r = await knex('helfer_einsaetze').whereIn('slot_id', slotIds).count('* as anzahl').first();
    return parseInt(r.anzahl, 10);
}

async function legeTaetigkeitMitSlotsAn(knex, turnier, felder) {
    const taetigkeitId = idAus((await knex('helfer_taetigkeiten').insert(felder).returning('id'))[0]);
    if (turnier.beginn_min != null && turnier.ende_min != null && turnier.ende_min > turnier.beginn_min) {
        const slots = erzeugeStandardSlots(turnier.beginn_min, turnier.ende_min)
            .map(s => ({ taetigkeit_id: taetigkeitId, von_min: s.von_min, bis_min: s.bis_min, bedarf: felder.bedarf }));
        if (slots.length) await knex('helfer_slots').insert(slots);
    }
    return taetigkeitId;
}

// Löscht eine Tätigkeit nur, wenn sie keine Einsätze hat.
async function loescheWennLeer(knex, taetigkeitId) {
    const slotIds = (await knex('helfer_slots').where({ taetigkeit_id: taetigkeitId }).select('id')).map(s => s.id);
    if (await anzahlEinsaetze(knex, slotIds) > 0) return false;
    await knex('helfer_taetigkeiten').where({ id: taetigkeitId }).del();
    return true;
}

function mattenBezeichnung(kampfflaeche, nummer) {
    const bez = String(kampfflaeche.bezeichnung || '').trim();
    return /^matte\b/i.test(bez) ? `Kampfgericht ${bez}` : `Kampfgericht Matte ${nummer}`;
}

/**
 * Legt je Kampffläche „Kampfgericht Matte n“ und je Waage „Waage n“ an (Bedarf 2, Standard-Slots).
 * Vorhandene bleiben unverändert; überzählige werden nur ohne Einsätze gelöscht.
 */
/**
 * Gleicht die Standard-Tätigkeiten nur für laufende bzw. künftige Turniere ab (gespeicherter Status entwurf oder
 * veroeffentlicht und Datum ab heute, Europe/Berlin). Für lesende Routen (GET): abgeschlossene, abgesagte oder
 * vergangene Turniere werden nicht mehr verändert.
 * @returns {Promise<boolean>} ob abgeglichen wurde
 */
export async function synchronisiereWennAktiv(knex, turnierId, { jetzt = new Date() } = {}) {
    const turnier = await knex('turniere').where({ id: turnierId }).first('status', 'datum');
    if (!turnier || !AKTIVE_TURNIER_STATUS.includes(turnier.status)) return false;
    const datum = datumAlsText(turnier.datum);
    if (!datum || datum < heuteBerlin(jetzt)) return false;
    await synchronisiereStandardTaetigkeiten(knex, turnierId);
    return true;
}

export async function synchronisiereStandardTaetigkeiten(knex, turnierId) {
    await transaktion(knex, async (trx) => {
        // Turnier sperren: gleichzeitige Läufe legen nichts doppelt an.
        const turnier = await trx('turniere').where({ id: turnierId }).forUpdate().first();
        if (!turnier) throw fehler(404, 'Turnier nicht gefunden.');
        const vorhandene = await trx('helfer_taetigkeiten').where({ turnier_id: turnierId }).whereIn('art', ['matte', 'waage']);

        // Matten
        const flaechen = await trx('kampfflaechen').where({ turnier_id: turnierId }).orderBy('id');
        const flaechenIds = new Set(flaechen.map(f => f.id));
        const matten = vorhandene.filter(t => t.art === 'matte');
        for (const [i, kf] of flaechen.entries()) {
            if (matten.some(t => t.kampfflaeche_id === kf.id)) continue;
            await legeTaetigkeitMitSlotsAn(trx, turnier, {
                turnier_id: turnierId, art: 'matte', kampfflaeche_id: kf.id,
                bezeichnung: mattenBezeichnung(kf, i + 1), bedarf: STANDARD_BEDARF, reihenfolge: i + 1
            });
        }
        for (const t of matten) {
            if (t.kampfflaeche_id == null || !flaechenIds.has(t.kampfflaeche_id)) await loescheWennLeer(trx, t.id);
        }

        // Waagen
        const anzahl = Math.max(0, parseInt(turnier.waagen_anzahl, 10) || 0);
        const waagen = vorhandene.filter(t => t.art === 'waage');
        for (let n = 1; n <= anzahl; n++) {
            if (waagen.some(t => t.reihenfolge === n)) continue;
            await legeTaetigkeitMitSlotsAn(trx, turnier, {
                turnier_id: turnierId, art: 'waage', kampfflaeche_id: null,
                bezeichnung: `Waage ${n}`, bedarf: STANDARD_BEDARF, reihenfolge: n
            });
        }
        for (const t of waagen) {
            if (t.reihenfolge > anzahl) await loescheWennLeer(trx, t.id);
        }
    });
}

/** Eigene Tätigkeit (art 'frei') mit 2-Stunden-Slots über die Turnierzeit. */
export async function legeTaetigkeitAn(knex, turnierId, { bezeichnung, bedarf } = {}) {
    const name = pruefeBezeichnung(bezeichnung);
    const n = pruefeBedarf(bedarf);
    return transaktion(knex, async (trx) => {
        const turnier = await ladeTurnier(trx, turnierId);
        const max = await trx('helfer_taetigkeiten').where({ turnier_id: turnierId, art: 'frei' }).max('reihenfolge as m').first();
        const id = await legeTaetigkeitMitSlotsAn(trx, turnier, {
            turnier_id: turnierId, art: 'frei', kampfflaeche_id: null,
            bezeichnung: name, bedarf: n, reihenfolge: (max && max.m != null ? max.m : 0) + 1
        });
        return { id };
    });
}

/**
 * Ändert Bezeichnung (nur eigene Tätigkeiten) und/oder Bedarf. Ein neuer Bedarf gilt auch für die Slots, die
 * bisher den Bedarf der Tätigkeit hatten (abweichende Slot-Werte bleiben). Fällt dabei der Bedarf eines Slots
 * unter die Zahl seiner Eingetragenen, ist `bestaetigt: true` nötig, sonst 409 (code 'bestaetigung_noetig',
 * daten.anzahl = höchste Belegung der betroffenen Slots).
 * @returns {Promise<{ betroffeneBenutzerIds: string[] }>} Eingetragene der Slots, die nun überbucht sind
 */
export async function aendereTaetigkeit(knex, id, { bezeichnung, bedarf, bestaetigt } = {}) {
    return transaktion(knex, async (trx) => {
        const t = await sperreTaetigkeit(trx, id);
        const aenderung = {};
        let betroffeneBenutzerIds = [];
        if (bezeichnung !== undefined) {
            const name = pruefeBezeichnung(bezeichnung);
            if (name !== t.bezeichnung) {
                if (t.art !== 'frei') throw fehler(409, 'Matten- und Waagenzeilen lassen sich nicht umbenennen.');
                aenderung.bezeichnung = name;
            }
        }
        if (bedarf !== undefined) {
            const n = pruefeBedarf(bedarf);
            if (n !== t.bedarf) {
                aenderung.bedarf = n;
                const slots = await trx('helfer_slots').where({ taetigkeit_id: id, bedarf: t.bedarf })
                    .orderBy('id').forUpdate().select('id');
                const slotIds = slots.map(s => s.id);
                const einsaetze = slotIds.length
                    ? await trx('helfer_einsaetze').whereIn('slot_id', slotIds).select('slot_id', 'benutzer_id')
                    : [];
                const proSlot = new Map();
                for (const e of einsaetze) proSlot.set(e.slot_id, [...(proSlot.get(e.slot_id) || []), e]);
                const ueberbucht = [...proSlot.values()].filter(liste => liste.length > n);
                if (ueberbucht.length > 0) {
                    const anzahl = Math.max(...ueberbucht.map(l => l.length));
                    if (bestaetigt !== true) {
                        throw bestaetigungNoetig(`${anzahl} Helfer sind in einem Slot eingetragen, mehr als die neue Anzahl. Trotzdem ändern?`, anzahl);
                    }
                    betroffeneBenutzerIds = [...new Set(ueberbucht.flat().map(e => e.benutzer_id).filter(Boolean))];
                }
                if (slotIds.length) await trx('helfer_slots').whereIn('id', slotIds).update({ bedarf: n });
            }
        }
        if (Object.keys(aenderung).length) await trx('helfer_taetigkeiten').where({ id }).update(aenderung);
        return { betroffeneBenutzerIds };
    });
}

/** Löscht eine eigene Tätigkeit; mit Einsätzen nur bei `bestaetigt === true`. */
export async function loescheTaetigkeit(knex, id, { bestaetigt } = {}) {
    return transaktion(knex, async (trx) => {
        const t = await sperreTaetigkeit(trx, id);
        if (t.art !== 'frei') throw fehler(409, 'Matten- und Waagenzeilen lassen sich nicht löschen.');
        const slots = await trx('helfer_slots').where({ taetigkeit_id: id }).orderBy('id').forUpdate().select('id');
        const einsaetze = await trx('helfer_einsaetze').whereIn('slot_id', slots.map(s => s.id)).select('benutzer_id');
        if (einsaetze.length > 0 && bestaetigt !== true) {
            throw bestaetigungNoetig(`${einsaetze.length} Helfer sind eingetragen. Trotzdem löschen?`, einsaetze.length);
        }
        await trx('helfer_taetigkeiten').where({ id }).del();
        return { betroffeneBenutzerIds: einsaetze.map(e => e.benutzer_id).filter(Boolean) };
    });
}

/** Neuer Slot in einer Tätigkeit (Bedarf der Tätigkeit). */
export async function legeSlotAn(knex, taetigkeitId, { von_min, bis_min } = {}) {
    const zeitraum = { von_min: Number(von_min), bis_min: Number(bis_min) };
    pruefeZeitraum(zeitraum.von_min, zeitraum.bis_min);
    return transaktion(knex, async (trx) => {
        // Tätigkeit sperren: zwei gleichzeitig angelegte Slots können sich nicht überlappen.
        const t = await sperreTaetigkeit(trx, taetigkeitId);
        await pruefeKeineUeberlappung(trx, taetigkeitId, zeitraum);
        const id = idAus((await trx('helfer_slots').insert({ taetigkeit_id: taetigkeitId, ...zeitraum, bedarf: t.bedarf }).returning('id'))[0]);
        return { id };
    });
}

/**
 * Ändert Zeit und/oder Bedarf eines Slots. Verkürzen/Verschieben mit Eingetragenen oder ein Bedarf unter der
 * Zahl der Eingetragenen verlangt `bestaetigt: true`, sonst 409 mit der Anzahl (daten.anzahl).
 * @returns {Promise<{ betroffeneBenutzerIds: string[] }>} Konten, deren Dienstzeit sich geändert hat
 */
export async function aendereSlot(knex, slotId, { von_min, bis_min, bedarf, bestaetigt } = {}) {
    return transaktion(knex, async (trx) => {
        const { slot } = await sperreSlotUeberTaetigkeit(trx, slotId);

        const neu = {
            von_min: von_min === undefined ? slot.von_min : Number(von_min),
            bis_min: bis_min === undefined ? slot.bis_min : Number(bis_min)
        };
        const zeitGeaendert = neu.von_min !== slot.von_min || neu.bis_min !== slot.bis_min;
        if (zeitGeaendert) {
            pruefeZeitraum(neu.von_min, neu.bis_min);
            await pruefeKeineUeberlappung(trx, slot.taetigkeit_id, neu, slotId);
        }
        const neuerBedarf = bedarf === undefined ? slot.bedarf : pruefeBedarf(bedarf);

        const einsaetze = await trx('helfer_einsaetze').where({ slot_id: slotId }).select('benutzer_id');
        const anzahl = einsaetze.length;
        if (anzahl > 0 && bestaetigt !== true) {
            const verkuerztOderVerschoben = neu.von_min > slot.von_min || neu.bis_min < slot.bis_min;
            if (verkuerztOderVerschoben) {
                throw bestaetigungNoetig(`${anzahl} Helfer sind eingetragen. Trotzdem ändern?`, anzahl);
            }
            if (neuerBedarf < anzahl) {
                throw bestaetigungNoetig(`${anzahl} Helfer sind eingetragen, mehr als die neue Anzahl. Trotzdem ändern?`, anzahl);
            }
        }

        await trx('helfer_slots').where({ id: slotId }).update({ ...neu, bedarf: neuerBedarf });
        return { betroffeneBenutzerIds: zeitGeaendert ? einsaetze.map(e => e.benutzer_id).filter(Boolean) : [] };
    });
}

/** Löscht einen Slot; mit Einsätzen nur bei `bestaetigt === true`. */
export async function loescheSlot(knex, slotId, { bestaetigt } = {}) {
    return transaktion(knex, async (trx) => {
        await sperreSlotUeberTaetigkeit(trx, slotId);
        const einsaetze = await trx('helfer_einsaetze').where({ slot_id: slotId }).select('benutzer_id');
        if (einsaetze.length > 0 && bestaetigt !== true) {
            throw bestaetigungNoetig(`${einsaetze.length} Helfer sind eingetragen. Trotzdem löschen?`, einsaetze.length);
        }
        await trx('helfer_slots').where({ id: slotId }).del();
        return { betroffeneBenutzerIds: einsaetze.map(e => e.benutzer_id).filter(Boolean) };
    });
}

// Slot samt Tätigkeit und Turnier, Slot-Zeile gesperrt (FOR UPDATE OF helfer_slots).
async function sperreSlotMitTurnier(trx, slotId) {
    const zeile = await trx('helfer_slots as s')
        .join('helfer_taetigkeiten as t', 't.id', 's.taetigkeit_id')
        .join('turniere as tu', 'tu.id', 't.turnier_id')
        .where('s.id', slotId)
        .select('s.id', 's.von_min', 's.bis_min', 's.bedarf', 't.turnier_id', 'tu.verein_id', 'tu.datum', 'tu.status')
        .forUpdate('s')
        .first();
    if (!zeile) throw fehler(404, 'Slot nicht gefunden.');
    return zeile;
}

async function belegtePlaetze(trx, slotId) {
    const r = await trx('helfer_einsaetze').where({ slot_id: slotId }).count('* as anzahl').first();
    return parseInt(r.anzahl, 10);
}

/**
 * Trägt ein Konto in einen Slot ein. Ohne `alsOrga` nur sich selbst und nur bis zur Frist.
 * @returns {Promise<{ id: number }>}
 */
export async function traegeEin(knex, { slotId, benutzerId, durchId, jetzt = new Date(), alsOrga = false }) {
    if (!benutzerId) throw fehler(400, 'Kein Helfer angegeben.');
    if (!alsOrga && benutzerId !== durchId) throw fehler(403, 'Du kannst nur dich selbst eintragen.');
    return transaktion(knex, async (trx) => {
        const slotKopf = await trx('helfer_slots as s')
            .join('helfer_taetigkeiten as t', 't.id', 's.taetigkeit_id')
            .where('s.id', slotId).select('t.turnier_id').first();
        if (!slotKopf) throw fehler(404, 'Slot nicht gefunden.');
        // Je Konto und Turnier serialisieren: zwei gleichzeitige Buchungen überlappender Slots derselben
        // Person sehen sich sonst gegenseitig nicht. Danach den Slot sperren (Reihenfolge immer gleich).
        await trx.raw('select pg_advisory_xact_lock(hashtext(?))', [`helfer:${slotKopf.turnier_id}:${benutzerId}`]);
        const slot = await sperreSlotMitTurnier(trx, slotId);

        if (!(await hatHelferZugriffAufVerein(trx, benutzerId, slot.verein_id))) {
            throw fehler(403, 'Eintragen nur mit freigegebener Mitgliedschaft im ausrichtenden Verein.');
        }
        if (!alsOrga && !AKTIVE_TURNIER_STATUS.includes(slot.status)) {
            throw fehler(409, 'Für dieses Turnier ist keine Eintragung mehr möglich (abgesagt oder abgeschlossen).',
                { code: FEHLER_CODES.TURNIER_NICHT_AKTIV });
        }
        if (!alsOrga && !darfHelferAendern(datumAlsText(slot.datum), jetzt)) {
            throw fehler(403, FRIST_MELDUNG, { code: FEHLER_CODES.FRIST });
        }

        if (await trx('helfer_einsaetze').where({ slot_id: slotId, benutzer_id: benutzerId }).first()) {
            throw fehler(409, 'Bereits für diesen Slot eingetragen.');
        }
        const eigene = await trx('helfer_einsaetze as e')
            .join('helfer_slots as s', 's.id', 'e.slot_id')
            .join('helfer_taetigkeiten as t', 't.id', 's.taetigkeit_id')
            .where({ 'e.benutzer_id': benutzerId, 't.turnier_id': slot.turnier_id })
            .select('s.von_min', 's.bis_min');
        if (eigene.some(d => ueberlappt(d, slot))) {
            throw fehler(409, 'Du bist zu dieser Zeit schon für einen anderen Dienst eingetragen.', { code: FEHLER_CODES.UEBERLAPPUNG });
        }
        if (await belegtePlaetze(trx, slotId) >= slot.bedarf) throw fehler(409, 'Gerade vergeben.', { code: FEHLER_CODES.VOLL });

        const id = idAus((await trx('helfer_einsaetze').insert({
            slot_id: slotId, benutzer_id: benutzerId, eingetragen_von: durchId || null
        }).returning('id'))[0]);
        return { id };
    });
}

/** Entfernt einen Einsatz. Ohne `alsOrga` nur den eigenen und nur bis zur Frist. */
export async function traegeAus(knex, { einsatzId, durchId, jetzt = new Date(), alsOrga = false }) {
    await transaktion(knex, async (trx) => {
        const einsatz = await trx('helfer_einsaetze as e')
            .join('helfer_slots as s', 's.id', 'e.slot_id')
            .join('helfer_taetigkeiten as t', 't.id', 's.taetigkeit_id')
            .join('turniere as tu', 'tu.id', 't.turnier_id')
            .where('e.id', einsatzId)
            .select('e.id', 'e.benutzer_id', 'tu.datum')
            .first();
        if (!einsatz) throw fehler(404, 'Eintrag nicht gefunden.');
        if (!alsOrga) {
            if (!einsatz.benutzer_id || einsatz.benutzer_id !== durchId) {
                throw fehler(403, 'Du kannst nur dich selbst austragen.');
            }
            if (!darfHelferAendern(datumAlsText(einsatz.datum), jetzt)) {
                throw fehler(403, FRIST_MELDUNG, { code: FEHLER_CODES.FRIST });
            }
        }
        await trx('helfer_einsaetze').where({ id: einsatzId }).del();
    });
}

/** Eintrag ohne Konto (z. B. Eltern ohne Smartphone), nur durch die Orga. */
export async function traegeManuellEin(knex, { slotId, name, durchId }) {
    const anzeigename = String(name || '').trim();
    if (!anzeigename) throw fehler(400, 'Bitte einen Namen angeben.');
    if (anzeigename.length > MAX_TEXT_LAENGE) throw fehler(400, `Der Name ist zu lang (höchstens ${MAX_TEXT_LAENGE} Zeichen).`);
    return transaktion(knex, async (trx) => {
        const slot = await sperreSlotMitTurnier(trx, slotId);
        if (await belegtePlaetze(trx, slotId) >= slot.bedarf) throw fehler(409, 'Gerade vergeben.', { code: FEHLER_CODES.VOLL });
        const id = idAus((await trx('helfer_einsaetze').insert({
            slot_id: slotId, benutzer_id: null, name_manuell: anzeigename, eingetragen_von: durchId || null
        }).returning('id'))[0]);
        return { id };
    });
}

const ART_REIHENFOLGE = { matte: 0, waage: 1, frei: 2 };

function anzeigename(e) {
    if (!e.benutzer_id) return e.name_manuell || '';
    const name = [e.vorname, e.nachname].filter(Boolean).join(' ').trim();
    return name || e.email || '';
}

/** Gesamter Plan eines Turniers für die Orga-Ansicht. */
export async function ladePlan(knex, turnierId) {
    const turnier = await ladeTurnier(knex, turnierId);
    const taetigkeiten = await knex('helfer_taetigkeiten').where({ turnier_id: turnierId }).orderBy([
        { column: 'reihenfolge' }, { column: 'id' }
    ]);
    taetigkeiten.sort((a, b) => (ART_REIHENFOLGE[a.art] ?? 3) - (ART_REIHENFOLGE[b.art] ?? 3));
    const ids = taetigkeiten.map(t => t.id);
    const slots = ids.length
        ? await knex('helfer_slots').whereIn('taetigkeit_id', ids).orderBy([{ column: 'von_min' }, { column: 'id' }])
        : [];
    const einsaetze = slots.length
        ? await knex('helfer_einsaetze as e')
            .leftJoin('benutzer as b', 'b.id', 'e.benutzer_id')
            .whereIn('e.slot_id', slots.map(s => s.id))
            .orderBy([{ column: 'e.eingetragen_am' }, { column: 'e.id' }])
            .select('e.id', 'e.slot_id', 'e.benutzer_id', 'e.name_manuell', 'b.vorname', 'b.nachname', 'b.email')
        : [];

    return {
        turnier: {
            beginn_min: turnier.beginn_min,
            ende_min: turnier.ende_min,
            datum: datumAlsText(turnier.datum),
            waagen_anzahl: turnier.waagen_anzahl
        },
        taetigkeiten: taetigkeiten.map(t => ({
            id: t.id,
            art: t.art,
            bezeichnung: t.bezeichnung,
            bedarf: t.bedarf,
            slots: slots.filter(s => s.taetigkeit_id === t.id).map(s => ({
                id: s.id,
                von_min: s.von_min,
                bis_min: s.bis_min,
                bedarf: s.bedarf,
                einsaetze: einsaetze.filter(e => e.slot_id === s.id)
                    .map(e => ({ id: e.id, benutzer_id: e.benutzer_id, name: anzeigename(e) }))
            }))
        }))
    };
}

/**
 * Slots für die Helfer-App: nicht volle Slots und solche, in denen das Konto steht; sortiert nach Bezeichnung
 * der Tätigkeit, dann Uhrzeit.
 */
export async function ladeOffeneSlots(knex, turnierId, benutzerId) {
    const zeilen = await knex('helfer_slots as s')
        .join('helfer_taetigkeiten as t', 't.id', 's.taetigkeit_id')
        .leftJoin('helfer_einsaetze as e', 'e.slot_id', 's.id')
        .where('t.turnier_id', turnierId)
        .groupBy('s.id', 't.bezeichnung')
        .select('s.id', 's.von_min', 's.bis_min', 's.bedarf', 't.bezeichnung')
        .select(knex.raw('count(e.id)::int as belegt'))
        .select(knex.raw('bool_or(e.benutzer_id = ?) as eigen', [benutzerId]));

    return zeilen
        .map(z => ({
            taetigkeit: z.bezeichnung,
            slotId: z.id,
            von_min: z.von_min,
            bis_min: z.bis_min,
            frei: Math.max(0, z.bedarf - z.belegt),
            eingetragen: z.eigen === true
        }))
        .filter(z => z.frei > 0 || z.eingetragen)
        .sort((a, b) => a.taetigkeit.localeCompare(b.taetigkeit, 'de', { numeric: true }) || a.von_min - b.von_min || a.slotId - b.slotId);
}

/** Alle Dienste eines Kontos, aufsteigend nach Datum und Uhrzeit. */
export async function ladeMeineDienste(knex, benutzerId) {
    const zeilen = await knex('helfer_einsaetze as e')
        .join('helfer_slots as s', 's.id', 'e.slot_id')
        .join('helfer_taetigkeiten as t', 't.id', 's.taetigkeit_id')
        .join('turniere as tu', 'tu.id', 't.turnier_id')
        .where('e.benutzer_id', benutzerId)
        .orderBy([{ column: 'tu.datum' }, { column: 's.von_min' }, { column: 'e.id' }])
        .select('e.id as einsatz_id', 'tu.id as turnier_id', 'tu.bezeichnung as turnier_name', 'tu.datum',
            't.bezeichnung as taetigkeit', 's.von_min', 's.bis_min');
    return zeilen.map(z => ({
        einsatzId: z.einsatz_id,
        turnier: { id: z.turnier_id, name: z.turnier_name, datum: datumAlsText(z.datum) },
        taetigkeit: z.taetigkeit,
        von_min: z.von_min,
        bis_min: z.bis_min
    }));
}

/**
 * Hat das Konto Dienste in noch nicht vergangenen Turnieren (Datum ≥ heute, Berlin) dieses Vereins?
 * Abgesagte und abgeschlossene Turniere zählen nicht.
 */
export async function hatOffeneDienste(knex, benutzerId, vereinId) {
    const treffer = await knex('helfer_einsaetze as e')
        .join('helfer_slots as s', 's.id', 'e.slot_id')
        .join('helfer_taetigkeiten as t', 't.id', 's.taetigkeit_id')
        .join('turniere as tu', 'tu.id', 't.turnier_id')
        .where({ 'e.benutzer_id': benutzerId, 'tu.verein_id': vereinId })
        .where('tu.datum', '>=', heuteBerlin())
        .whereNotIn('tu.status', ['abgesagt', 'abgeschlossen'])
        .first('e.id');
    return !!treffer;
}
