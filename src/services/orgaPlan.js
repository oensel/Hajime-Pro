// Orga-Planer (Spec 2026-10-18-orga-planer-design): Checkliste je Turnier aus der Standardvorlage,
// eigene Aufgaben, Posten und Mitbringliste. Erwartete Fehler werfen FachFehler (statusCode + deutsche Meldung).
// Der Status wird nie gespeichert, sondern in ladeOrga über berechneStatus abgeleitet.
//
// Mitbringliste (Entscheidung): Die Vorlage markiert Catering mit `mitbringliste: true`. Dafür wird KEINE
// Platzhalterzeile angelegt; die Einträge der Helfer sind normale Kinder (art 'mitbringen') der Catering-Aufgabe.
// ladeOrga liefert `mitbringliste: true` an der Elternaufgabe (über vorlage_key aus der Vorlage), damit die
// Oberfläche das Eintragsformular zeigt. Mitbringeinträge zählen nicht für den Status der Eltern (berechneStatus).
import { FachFehler } from '../utils/fachFehler.js';
import { berechneStatus } from '../shared/orgaStatus.js';
import { berechneFaelligkeit } from '../shared/orgaFrist.js';
import { ORGA_VORLAGE, ORGA_PHASEN } from '../shared/orgaVorlage.js';
import { datumAlsText } from './helferPlan.js';

const ARTEN = ['aufgabe', 'posten', 'mitbringen'];
const ANKER = ['turnier', 'anmeldeschluss'];
const MAX_TEXT = 255;
const MITBRINGLISTEN_KEYS = new Set(ORGA_VORLAGE.filter((v) => v.mitbringliste).map((v) => v.vorlage_key));

function fehler(status, nachricht) {
    const e = new FachFehler(status, nachricht);
    e.status = status;
    return e;
}

const idAus = (r) => (typeof r === 'object' ? r.id : r);

async function transaktion(knex, fn) {
    try {
        return await knex.transaction(fn);
    } catch (e) {
        if (!(e instanceof FachFehler) && (e?.code === '40P01' || e?.code === '40001')) {
            throw fehler(409, 'Bitte erneut versuchen.');
        }
        throw e;
    }
}

function heuteBerlin(jetzt = new Date()) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' })
        .format(jetzt);
}

async function sperreTurnier(trx, turnierId) {
    const t = await trx('turniere').where({ id: turnierId }).forUpdate().first('id', 'datum', 'anmeldeschluss');
    if (!t) throw fehler(404, 'Turnier nicht gefunden.');
    return t;
}

function pruefeTitel(titel) {
    const t = String(titel ?? '').trim();
    if (!t) throw fehler(400, 'Bitte einen Titel angeben.');
    if (t.length > MAX_TEXT) throw fehler(400, `Der Titel ist zu lang (höchstens ${MAX_TEXT} Zeichen).`);
    return t;
}

function pruefeDatum(wert) {
    if (wert == null || wert === '') return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(wert))) throw fehler(400, 'Ungültiges Datum.');
    return String(wert);
}

function pruefeFrist(anker, tage) {
    if (anker == null || anker === '') return { frist_anker: null, frist_tage: null };
    if (!ANKER.includes(anker)) throw fehler(400, 'Ungültiger Fristanker.');
    const n = Number(tage ?? 0);
    if (!Number.isInteger(n)) throw fehler(400, 'Die Fristtage müssen eine ganze Zahl sein.');
    return { frist_anker: anker, frist_tage: n };
}

/** Legt alle Aufgaben/Posten der Standardvorlage an, die es noch nicht gibt (Schlüssel vorlage_key). */
export async function legeAusVorlageAn(knex, turnierId) {
    return transaktion(knex, async (trx) => {
        const turnier = await sperreTurnier(trx, turnierId);
        const vorhanden = new Set((await trx('orga_aufgaben').where({ turnier_id: turnierId }).whereNotNull('vorlage_key')
            .select('vorlage_key')).map((r) => r.vorlage_key));
        let angelegt = 0;
        let reihenfolge = 0;
        for (const v of ORGA_VORLAGE) {
            reihenfolge += 1;
            if (vorhanden.has(v.vorlage_key)) continue;
            const faellig = berechneFaelligkeit(v, { turnierdatum: turnier.datum, anmeldeschluss: turnier.anmeldeschluss });
            const elternId = idAus((await trx('orga_aufgaben').insert({
                turnier_id: turnierId, phase: v.phase, art: 'aufgabe', titel: v.titel, reihenfolge,
                frist_anker: v.frist_anker, frist_tage: v.frist_tage, faellig_am: faellig,
                auto_art: v.auto_art ?? null, auto_ref: v.auto_ref ?? null, link: v.link ?? null, vorlage_key: v.vorlage_key
            }).returning('id'))[0]);
            angelegt += 1;
            if (v.posten?.length) {
                await trx('orga_aufgaben').insert(v.posten.map((p, i) => ({
                    turnier_id: turnierId, eltern_id: elternId, phase: v.phase, art: 'posten', titel: p.titel,
                    menge: p.menge ?? null, reihenfolge: i + 1
                })));
            }
        }
        return { angelegt };
    });
}

// Helferplan-Zählung in EINER Abfrage: belegt = Einsätze je Slot, höchstens Bedarf des Slots.
export async function ladeZaehlung(knex, turnierId) {
    const zeilen = await knex('helfer_taetigkeiten as t')
        .join('helfer_slots as s', 's.taetigkeit_id', 't.id')
        .leftJoin('helfer_einsaetze as e', 'e.slot_id', 's.id')
        .where('t.turnier_id', turnierId)
        .groupBy('t.art', 's.id', 's.bedarf')
        .select('t.art', 's.id as slot_id', 's.bedarf')
        .count('e.id as einsaetze');
    const z = { gesamt: { belegt: 0, bedarf: 0, slots: 0 } };
    for (const r of zeilen) {
        const bedarf = Number(r.bedarf);
        const belegt = Math.min(parseInt(r.einsaetze, 10), bedarf);
        for (const schluessel of ['gesamt', r.art]) {
            z[schluessel] ??= { belegt: 0, bedarf: 0, slots: 0 };
            z[schluessel].belegt += belegt;
            z[schluessel].bedarf += bedarf;
            z[schluessel].slots += 1;
        }
    }
    return z;
}

function ausZeile(z) {
    return { ...z, faellig_am: datumAlsText(z.faellig_am), erinnert_fuer: datumAlsText(z.erinnert_fuer) };
}

/** Lädt die Checkliste gruppiert nach Phasen, mit abgeleitetem Status und Kennzahlen der Hauptaufgaben. */
export async function ladeOrga(knex, turnierId, { jetzt = new Date() } = {}) {
    const [zeilen, zaehlung] = await Promise.all([
        knex('orga_aufgaben').where({ turnier_id: turnierId }).orderBy('reihenfolge').orderBy('id'),
        ladeZaehlung(knex, turnierId)
    ]);
    const kinderVon = new Map();
    for (const z of zeilen) {
        if (z.eltern_id != null) {
            if (!kinderVon.has(z.eltern_id)) kinderVon.set(z.eltern_id, []);
            kinderVon.get(z.eltern_id).push(z);
        }
    }
    const heute = heuteBerlin(jetzt);
    const kennzahlen = { erledigt: 0, gesamt: 0, ueberfaellig: 0, ohneZustaendigen: 0 };
    const phasen = ORGA_PHASEN.map((phase) => ({ phase, aufgaben: [] }));
    for (const z of zeilen) {
        if (z.eltern_id != null || z.art === 'mitbringen') continue;
        const kinder = (kinderVon.get(z.id) ?? []);
        const status = berechneStatus(z, kinder, zaehlung);
        const aufgabe = {
            ...ausZeile(z),
            status,
            mitbringliste: MITBRINGLISTEN_KEYS.has(z.vorlage_key),
            kinder: kinder.map((k) => ({ ...ausZeile(k), status: berechneStatus(k, []) }))
        };
        const gruppe = phasen.find((p) => p.phase === z.phase);
        if (gruppe) gruppe.aufgaben.push(aufgabe);
        kennzahlen.gesamt += 1;
        if (status.status === 'erledigt') kennzahlen.erledigt += 1;
        else if (aufgabe.faellig_am && aufgabe.faellig_am < heute) kennzahlen.ueberfaellig += 1;
        if (!z.benutzer_id && !z.name_frei) kennzahlen.ohneZustaendigen += 1;
    }
    return { phasen, kennzahlen };
}

/** Legt eine eigene Aufgabe, einen Posten oder einen Mitbringeintrag an. */
export async function legeAufgabeAn(knex, turnierId, felder = {}) {
    return transaktion(knex, async (trx) => {
        const turnier = await sperreTurnier(trx, turnierId);
        const art = felder.art ?? (felder.eltern_id ? 'posten' : 'aufgabe');
        if (!ARTEN.includes(art)) throw fehler(400, 'Ungültige Art der Aufgabe.');
        let phase = felder.phase;
        if (felder.eltern_id != null) {
            const eltern = await trx('orga_aufgaben').where({ id: felder.eltern_id, turnier_id: turnierId }).first();
            if (!eltern) throw fehler(404, 'Übergeordnete Aufgabe nicht gefunden.');
            if (eltern.eltern_id != null) throw fehler(400, 'Unteraufgaben lassen sich nicht weiter schachteln.');
            if (art === 'aufgabe') throw fehler(400, 'Unter einer Aufgabe liegen Posten oder Mitbringeinträge.');
            phase = eltern.phase;
        } else if (art !== 'aufgabe') {
            throw fehler(400, 'Posten und Mitbringeinträge brauchen eine übergeordnete Aufgabe.');
        }
        if (!ORGA_PHASEN.includes(phase)) throw fehler(400, 'Ungültige Phase.');
        const titel = pruefeTitel(felder.titel);
        const frist = pruefeFrist(felder.frist_anker, felder.frist_tage);
        const explizit = pruefeDatum(felder.faellig_am);
        const faellig = explizit ?? berechneFaelligkeit(frist, { turnierdatum: turnier.datum, anmeldeschluss: turnier.anmeldeschluss });
        const max = await trx('orga_aufgaben').where({ turnier_id: turnierId }).max('reihenfolge as m').first();
        const idNeu = idAus((await trx('orga_aufgaben').insert({
            turnier_id: turnierId, eltern_id: felder.eltern_id ?? null, phase, art, titel,
            notiz: felder.notiz ?? null, menge: felder.menge ?? null, reihenfolge: (max?.m ?? 0) + 1,
            ...frist, faellig_am: faellig, faellig_manuell: explizit != null,
            link: felder.link ?? null, benutzer_id: felder.benutzer_id ?? null,
            name_frei: felder.name_frei ?? null, email_frei: felder.email_frei ?? null,
            erstellt_von: felder.benutzerId ?? null
        }).returning('id'))[0]);
        return { id: idNeu };
    });
}

const AENDERBAR = ['titel', 'notiz', 'menge', 'phase', 'link', 'benutzer_id', 'name_frei', 'email_frei', 'reihenfolge'];

/** Ändert Felder einer Aufgabe; ein gesetztes faellig_am macht die Fälligkeit manuell. */
export async function aendereAufgabe(knex, aufgabeId, felder = {}) {
    return transaktion(knex, async (trx) => {
        const kopf = await trx('orga_aufgaben').where({ id: aufgabeId }).first('turnier_id');
        if (!kopf) throw fehler(404, 'Aufgabe nicht gefunden.');
        const turnier = await sperreTurnier(trx, kopf.turnier_id);
        const aufgabe = await trx('orga_aufgaben').where({ id: aufgabeId }).forUpdate().first();
        if (!aufgabe) throw fehler(404, 'Aufgabe nicht gefunden.');
        const update = {};
        for (const k of AENDERBAR) if (k in felder) update[k] = felder[k] === '' ? null : felder[k];
        if ('titel' in felder) update.titel = pruefeTitel(felder.titel);
        if ('phase' in update) {
            if (aufgabe.eltern_id != null) throw fehler(400, 'Die Phase einer Unteraufgabe folgt der übergeordneten Aufgabe.');
            if (!ORGA_PHASEN.includes(update.phase)) throw fehler(400, 'Ungültige Phase.');
        }
        if ('faellig_am' in felder) {
            const d = pruefeDatum(felder.faellig_am);
            if (d) { update.faellig_am = d; update.faellig_manuell = true; }
            else {
                // Datum entfernen: zurück zur Berechnung aus der Frist (falls vorhanden).
                update.faellig_manuell = false;
                update.faellig_am = berechneFaelligkeit(aufgabe, { turnierdatum: turnier.datum, anmeldeschluss: turnier.anmeldeschluss });
            }
        }
        if ('frist_anker' in felder || 'frist_tage' in felder) {
            const frist = pruefeFrist(felder.frist_anker ?? aufgabe.frist_anker, felder.frist_tage ?? aufgabe.frist_tage);
            Object.assign(update, frist);
            if (!('faellig_am' in felder) && !aufgabe.faellig_manuell) {
                update.faellig_am = berechneFaelligkeit(frist, { turnierdatum: turnier.datum, anmeldeschluss: turnier.anmeldeschluss });
            }
        }
        if (Object.keys(update).length) await trx('orga_aufgaben').where({ id: aufgabeId }).update(update);
        return { id: aufgabeId };
    });
}

/** Löscht eine Aufgabe; Unteraufgaben folgen per ON DELETE CASCADE. */
export async function loescheAufgabe(knex, aufgabeId) {
    const n = await knex('orga_aufgaben').where({ id: aufgabeId }).del();
    if (!n) throw fehler(404, 'Aufgabe nicht gefunden.');
}

/** Hakt eine Aufgabe von Hand ab bzw. nimmt den Haken zurück. */
export async function setzeErledigt(knex, aufgabeId, { erledigt, benutzerId = null } = {}) {
    const n = await knex('orga_aufgaben').where({ id: aufgabeId }).update(erledigt
        ? { erledigt_am: knex.fn.now(), erledigt_von: benutzerId }
        : { erledigt_am: null, erledigt_von: null });
    if (!n) throw fehler(404, 'Aufgabe nicht gefunden.');
}

/** Rechnet die Fälligkeit aller nicht manuell gesetzten Aufgaben mit Frist neu (nach Datumsänderung). */
export async function berechneFaelligkeitenNeu(knex, turnierId) {
    return transaktion(knex, async (trx) => {
        const turnier = await sperreTurnier(trx, turnierId);
        const zeilen = await trx('orga_aufgaben').where({ turnier_id: turnierId, faellig_manuell: false })
            .whereNotNull('frist_anker').select('id', 'frist_anker', 'frist_tage', 'faellig_am');
        let geaendert = 0;
        for (const z of zeilen) {
            const neu = berechneFaelligkeit(z, { turnierdatum: turnier.datum, anmeldeschluss: turnier.anmeldeschluss });
            if (neu !== datumAlsText(z.faellig_am)) {
                await trx('orga_aufgaben').where({ id: z.id }).update({ faellig_am: neu });
                geaendert += 1;
            }
        }
        return { geaendert };
    });
}
