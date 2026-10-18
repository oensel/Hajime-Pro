// Helferplan im Turnier-Export/-Import und bei der Aktualisierung aus der Cloud (Helferverwaltung,
// Spec docs/specs/2026-10-17-helferverwaltung-design.md Abschnitte 7 und 8).
// Exportiert werden nur Anzeigenamen: keine E-Mail-Adressen, keine Passwörter, keine Benutzer-IDs.
// Kampfflächen werden über ihre Position im Export (kampfflaeche_ref = Index in der nach id sortierten
// Kampfflächenliste) zugeordnet, nicht über die Datenbank-ID. Beim Import werden die Einsätze zu
// name_manuell-Einträgen (Benutzerkonten gibt es nur in der Cloud).

const ARTEN = ['matte', 'kampfrichter', 'waage', 'ersthelfer', 'aufbau', 'frei'];
const idAus = (r) => (typeof r === 'object' ? r.id : r);

function anzeigename(e) {
    if (!e.benutzer_id) return String(e.name_manuell || '').trim();
    return [e.vorname, e.nachname].filter(Boolean).join(' ').trim() || 'Helfer';
}

/**
 * Helferplan eines Turniers für den Export.
 * @param {import('knex').Knex} knex
 * @param {number} turnierId
 * @param {Array<{id:number}>} kampfflaechen - Kampfflächen des Exports in Export-Reihenfolge
 * @returns {Promise<{taetigkeiten: Array}>}
 */
export async function exportiereHelferplan(knex, turnierId, kampfflaechen) {
    const refIndex = new Map(kampfflaechen.map((kf, i) => [kf.id, i]));
    const taetigkeiten = await knex('helfer_taetigkeiten').where({ turnier_id: turnierId })
        .orderBy([{ column: 'reihenfolge' }, { column: 'id' }]);
    const ids = taetigkeiten.map(t => t.id);
    const slots = ids.length
        ? await knex('helfer_slots').whereIn('taetigkeit_id', ids).orderBy([{ column: 'von_min' }, { column: 'id' }])
        : [];
    const einsaetze = slots.length
        ? await knex('helfer_einsaetze as e')
            .leftJoin('benutzer as b', 'b.id', 'e.benutzer_id')
            .whereIn('e.slot_id', slots.map(s => s.id))
            .orderBy([{ column: 'e.eingetragen_am' }, { column: 'e.id' }])
            // bewusst ohne E-Mail und Passwort-Hash; benutzer_id nur zur Namenswahl, nicht im Ergebnis
            .select('e.slot_id', 'e.benutzer_id', 'e.name_manuell', 'b.vorname', 'b.nachname')
        : [];

    return {
        taetigkeiten: taetigkeiten.map(t => ({
            art: t.art,
            bezeichnung: t.bezeichnung,
            bedarf: t.bedarf,
            reihenfolge: t.reihenfolge,
            tag_versatz: t.tag_versatz,
            kampfflaeche_ref: t.kampfflaeche_id != null && refIndex.has(t.kampfflaeche_id) ? refIndex.get(t.kampfflaeche_id) : null,
            slots: slots.filter(s => s.taetigkeit_id === t.id).map(s => ({
                von_min: s.von_min,
                bis_min: s.bis_min,
                bedarf: s.bedarf,
                einsaetze: einsaetze.filter(e => e.slot_id === s.id)
                    .map(e => ({ name: anzeigename(e) }))
                    .filter(e => e.name)
            }))
        }))
    };
}

function ganzzahl(wert, fallback = null) {
    const n = Number(wert);
    return Number.isInteger(n) ? n : fallback;
}

function bedarfAus(wert, fallback = 2) {
    const n = ganzzahl(wert);
    return n != null && n >= 1 && n <= 99 ? n : fallback;
}

/**
 * Ersetzt den kompletten Helferplan eines Turniers durch den Stand aus einem Export (in einer Transaktion
 * aufrufen). Turnier, Kampfflächen, Teilnehmer und Pools bleiben unberührt. Ungültige Einträge werden
 * übersprungen; Einsätze werden zu name_manuell-Einträgen.
 * @param {import('knex').Knex.Transaction} trx
 * @param {number} turnierId
 * @param {{taetigkeiten?: Array}|null|undefined} helferplan
 * @returns {Promise<{taetigkeiten:number, slots:number, einsaetze:number}>}
 */
export async function ersetzeHelferplan(trx, turnierId, helferplan) {
    const zaehler = { taetigkeiten: 0, slots: 0, einsaetze: 0 };
    // Einsätze und Slots folgen per ON DELETE CASCADE
    await trx('helfer_taetigkeiten').where({ turnier_id: turnierId }).del();

    const liste = Array.isArray(helferplan?.taetigkeiten) ? helferplan.taetigkeiten : [];
    if (liste.length === 0) return zaehler;

    const flaechen = await trx('kampfflaechen').where({ turnier_id: turnierId }).orderBy('id').select('id');

    for (const t of liste) {
        // gekappt statt abgelehnt: eine präparierte Datei soll nicht den ganzen Turnier-Import abbrechen
        const bezeichnung = String(t?.bezeichnung || '').trim().slice(0, 255);
        if (!bezeichnung) continue;
        const art = ARTEN.includes(t.art) ? t.art : 'frei';
        const ref = ganzzahl(t.kampfflaeche_ref);
        const kampfflaecheId = (art === 'matte' || art === 'kampfrichter') && ref != null && ref >= 0 && ref < flaechen.length ? flaechen[ref].id : null;
        const bedarf = bedarfAus(t.bedarf);
        const taetigkeitId = idAus((await trx('helfer_taetigkeiten').insert({
            turnier_id: turnierId,
            art,
            kampfflaeche_id: kampfflaecheId,
            bezeichnung,
            bedarf,
            reihenfolge: ganzzahl(t.reihenfolge, 0),
            tag_versatz: ganzzahl(t.tag_versatz) === -1 ? -1 : 0
        }).returning('id'))[0]);
        zaehler.taetigkeiten++;

        for (const s of Array.isArray(t.slots) ? t.slots : []) {
            const von = ganzzahl(s?.von_min);
            const bis = ganzzahl(s?.bis_min);
            if (von == null || bis == null || von < 0 || bis > 1440 || bis <= von) continue;
            const slotId = idAus((await trx('helfer_slots').insert({
                taetigkeit_id: taetigkeitId, von_min: von, bis_min: bis, bedarf: bedarfAus(s.bedarf, bedarf)
            }).returning('id'))[0]);
            zaehler.slots++;

            const namen = (Array.isArray(s.einsaetze) ? s.einsaetze : [])
                .map(e => String(e?.name || '').trim().slice(0, 255))
                .filter(Boolean);
            if (namen.length) {
                await trx('helfer_einsaetze').insert(namen.map(name => ({ slot_id: slotId, benutzer_id: null, name_manuell: name })));
                zaehler.einsaetze += namen.length;
            }
        }
    }
    return zaehler;
}
