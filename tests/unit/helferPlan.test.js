import { test } from 'node:test';
import assert from 'node:assert/strict';
import { starteTestPostgres } from '../helpers/testPostgres.js';

// Helferplan-Service (Helferverwaltung, Spec Abschnitte 5–7): Standard-Tätigkeiten, Slots,
// Eintragen/Austragen mit Frist, Überlappung und Parallelbuchung des letzten Platzes.
process.env.BETRIEBSMODUS = 'cloud';
delete process.env.IS_OFFLINE;
delete process.env.SYNC_ROLLE;

const plan = await import('../../src/services/helferPlan.js');
const { entferneMitglied } = await import('../../src/services/vereinsRollen.js');

const id = (r) => (typeof r === 'object' ? r.id : r);
const VOR_FRIST = new Date('2026-10-20T12:00:00Z');
const NACH_FRIST = new Date('2026-11-01T07:30:00Z'); // 08:30 Berlin (MEZ) am Turniertag

async function erwarteFehler(versprechen, status, muster, code) {
    await assert.rejects(versprechen, (e) => {
        assert.equal(e.statusCode, status, `${e.statusCode} ${e.message}`);
        if (muster) assert.match(e.message, muster);
        if (code !== undefined) assert.equal(e.code, code, `code bei: ${e.message}`);
        return true;
    });
}

async function legeTurnierAn(knex, { vereinId, datum, matten = 2, beginn = 540, ende = 1080, name = 'Pokal' }) {
    const turnierId = id((await knex('turniere').insert({
        bezeichnung: name, ort: 'Halle', datum, ausrichter: 'JC', verein_id: vereinId,
        beginn_min: beginn, ende_min: ende
    }).returning('id'))[0]);
    for (let i = 1; i <= matten; i++) {
        await knex('kampfflaechen').insert({ turnier_id: turnierId, bezeichnung: `Matte ${i}` });
    }
    return turnierId;
}

const zeilen = async (knex, turnierId) => (await plan.ladePlan(knex, turnierId)).taetigkeiten;
const finde = async (knex, turnierId, bez) => (await zeilen(knex, turnierId)).find(t => t.bezeichnung === bez);

test('Helferplan: Standard-Tätigkeiten, Slots, Eintragen und Austragen', async () => {
    const db = await starteTestPostgres();
    const { knex } = db;
    try {
        const verein = id((await knex('vereine').insert({ name: 'JC Plan' }).returning('id'))[0]);
        const fremd = id((await knex('vereine').insert({ name: 'JC Fremd' }).returning('id'))[0]);
        for (const n of ['anna', 'bert', 'carl', 'dora', 'eva', 'ext']) {
            await knex('benutzer').insert({ id: `u-${n}`, email: `${n}@test.de`, vorname: n, nachname: 'Test' });
        }
        await knex('benutzer_vereine').insert([
            { benutzer_id: 'u-anna', verein_id: verein, freigegeben: 1, rolle: 'helfer' },
            { benutzer_id: 'u-bert', verein_id: verein, freigegeben: 1, rolle: 'helfer' },
            { benutzer_id: 'u-carl', verein_id: verein, freigegeben: 1, rolle: 'admin' },
            { benutzer_id: 'u-dora', verein_id: verein, freigegeben: 0 },
            { benutzer_id: 'u-eva', verein_id: verein, freigegeben: 1, rolle: 'helfer' },
            { benutzer_id: 'u-ext', verein_id: fremd, freigegeben: 1, rolle: 'helfer' }
        ]);
        const turnier = await legeTurnierAn(knex, { vereinId: verein, datum: '2026-11-01' });

        // --- Synchronisieren: Matte 1, Matte 2, Waage 1 mit Standard-Slots und Bedarf 2, idempotent
        await plan.synchronisiereStandardTaetigkeiten(knex, turnier);
        let liste = await zeilen(knex, turnier);
        assert.deepEqual(liste.map(t => [t.art, t.bezeichnung, t.bedarf]), [
            ['matte', 'Kampfgericht Matte 1', 2],
            ['matte', 'Kampfgericht Matte 2', 2],
            ['waage', 'Waage 1', 2]
        ]);
        for (const t of liste) {
            assert.deepEqual(t.slots.map(s => [s.von_min, s.bis_min, s.bedarf]), [
                [540, 660, 2], [660, 780, 2], [780, 900, 2], [900, 1020, 2], [1020, 1080, 2]
            ]);
        }
        const davor = JSON.stringify(liste);
        await plan.synchronisiereStandardTaetigkeiten(knex, turnier);
        assert.equal(JSON.stringify(await zeilen(knex, turnier)), davor);

        const p = await plan.ladePlan(knex, turnier);
        assert.deepEqual(p.turnier, { beginn_min: 540, ende_min: 1080, datum: '2026-11-01', waagen_anzahl: 1 });

        // Waage-Anzahl 1 → 2 ergänzt nur Waage 2
        const waage1Vorher = await finde(knex, turnier, 'Waage 1');
        await knex('turniere').where({ id: turnier }).update({ waagen_anzahl: 2 });
        await plan.synchronisiereStandardTaetigkeiten(knex, turnier);
        liste = await zeilen(knex, turnier);
        assert.deepEqual(liste.map(t => t.bezeichnung),
            ['Kampfgericht Matte 1', 'Kampfgericht Matte 2', 'Waage 1', 'Waage 2']);
        assert.equal((await finde(knex, turnier, 'Waage 1')).id, waage1Vorher.id);

        // --- Slots: Raster, Mindestlänge, Überlappung
        const frei = await plan.legeTaetigkeitAn(knex, turnier, { bezeichnung: 'Aufbau', bedarf: 1 });
        let aufbau = await finde(knex, turnier, 'Aufbau');
        assert.equal(aufbau.id, frei.id);
        assert.equal(aufbau.art, 'frei');
        assert.equal(aufbau.slots.length, 5);
        assert.ok(aufbau.slots.every(s => s.bedarf === 1));
        // Platz schaffen: letzten Slot löschen (keine Einsätze → ohne Bestätigung)
        await plan.loescheSlot(knex, aufbau.slots[4].id, {});
        await erwarteFehler(plan.legeSlotAn(knex, frei.id, { von_min: 1020, bis_min: 1070 }), 400);   // Raster
        await erwarteFehler(plan.legeSlotAn(knex, frei.id, { von_min: 1020, bis_min: 1035 }), 400);   // zu kurz
        await erwarteFehler(plan.legeSlotAn(knex, frei.id, { von_min: 1005, bis_min: 1080 }), 409, null, "ueberlappung");   // überlappt
        const neuerSlot = await plan.legeSlotAn(knex, frei.id, { von_min: 1020, bis_min: 1050 });
        assert.ok(neuerSlot.id);
        await erwarteFehler(plan.aendereSlot(knex, neuerSlot.id, { von_min: 1005 }), 409, null, "ueberlappung");              // Verschieben in Nachbarn

        // --- Eintragen: Rechte, Frist, Überlappung
        const matte1 = await finde(knex, turnier, 'Kampfgericht Matte 1');
        const m1s1 = matte1.slots[0].id; // 09:00–11:00
        const m1s2 = matte1.slots[1].id; // 11:00–13:00
        await erwarteFehler(plan.traegeEin(knex, { slotId: m1s1, benutzerId: 'u-ext', durchId: 'u-ext', jetzt: VOR_FRIST }), 403);
        await erwarteFehler(plan.traegeEin(knex, { slotId: m1s1, benutzerId: 'u-dora', durchId: 'u-dora', jetzt: VOR_FRIST }), 403);
        await erwarteFehler(plan.traegeEin(knex, { slotId: m1s1, benutzerId: 'u-anna', durchId: 'u-anna', jetzt: NACH_FRIST }), 403,
            /Turnierleitung/, "frist");
        const annaM1 = await plan.traegeEin(knex, { slotId: m1s1, benutzerId: 'u-anna', durchId: 'u-anna', jetzt: VOR_FRIST });
        assert.ok(annaM1.id);
        await erwarteFehler(plan.traegeEin(knex, { slotId: m1s1, benutzerId: 'u-anna', durchId: 'u-anna', jetzt: VOR_FRIST }), 409);
        // Überlappung mit eigenem Dienst in anderer Tätigkeit (Waage 1, 10:00 liegt in 09:00–11:00)
        const waage1 = await finde(knex, turnier, 'Waage 1');
        await erwarteFehler(plan.traegeEin(knex, { slotId: waage1.slots[0].id, benutzerId: 'u-anna', durchId: 'u-anna', jetzt: VOR_FRIST }), 409, null, "ueberlappung");
        // angrenzend ist erlaubt
        await plan.traegeEin(knex, { slotId: waage1.slots[1].id, benutzerId: 'u-anna', durchId: 'u-anna', jetzt: VOR_FRIST });
        // Helfer trägt niemand anderen ein
        await erwarteFehler(plan.traegeEin(knex, { slotId: m1s2, benutzerId: 'u-bert', durchId: 'u-anna', jetzt: VOR_FRIST }), 403);
        // Orga nach der Frist erlaubt
        const bertM1 = await plan.traegeEin(knex, { slotId: m1s1, benutzerId: 'u-bert', durchId: 'u-carl', jetzt: NACH_FRIST, alsOrga: true });
        // jetzt voll
        await erwarteFehler(plan.traegeEin(knex, { slotId: m1s1, benutzerId: 'u-carl', durchId: 'u-carl', jetzt: VOR_FRIST }), 409,
            /Gerade vergeben/, "voll");

        // --- Parallelbuchung des letzten Platzes (Bedarf 1)
        aufbau = await finde(knex, turnier, 'Aufbau');
        const letzter = aufbau.slots[0].id;
        const ergebnisse = await Promise.allSettled([
            plan.traegeEin(knex, { slotId: letzter, benutzerId: 'u-eva', durchId: 'u-eva', jetzt: VOR_FRIST }),
            plan.traegeEin(knex, { slotId: letzter, benutzerId: 'u-carl', durchId: 'u-carl', jetzt: VOR_FRIST })
        ]);
        assert.equal(ergebnisse.filter(e => e.status === 'fulfilled').length, 1);
        const abgelehnt = ergebnisse.filter(e => e.status === 'rejected');
        assert.equal(abgelehnt.length, 1);
        assert.equal(abgelehnt[0].reason.statusCode, 409);
        assert.match(abgelehnt[0].reason.message, /Gerade vergeben/);
        assert.equal(abgelehnt[0].reason.code, "voll");
        assert.equal((await knex('helfer_einsaetze').where({ slot_id: letzter })).length, 1);
        // Mehr Druck: je Slot fünf gleichzeitige Buchungen verschiedener Konten, immer genau ein Gewinner
        const parallel = await plan.legeTaetigkeitAn(knex, turnier, { bezeichnung: 'Zz Parallel', bedarf: 1 });
        const parallelSlots = (await finde(knex, turnier, 'Zz Parallel')).slots;
        assert.equal(parallelSlots.length, 5);
        for (const [runde, s] of parallelSlots.entries()) {
            const konten = [];
            for (let k = 0; k < 5; k++) {
                const kid = `u-p${runde}-${k}`;
                await knex('benutzer').insert({ id: kid, email: `${kid}@test.de`, vorname: kid, nachname: 'P' });
                await knex('benutzer_vereine').insert({ benutzer_id: kid, verein_id: verein, freigegeben: 1, rolle: 'helfer' });
                konten.push(kid);
            }
            const r = await Promise.allSettled(konten.map(kid =>
                plan.traegeEin(knex, { slotId: s.id, benutzerId: kid, durchId: kid, jetzt: VOR_FRIST })));
            assert.equal(r.filter(e => e.status === 'fulfilled').length, 1, `Runde ${runde}`);
            assert.ok(r.filter(e => e.status === 'rejected').every(e => e.reason.statusCode === 409));
            assert.equal((await knex('helfer_einsaetze').where({ slot_id: s.id })).length, 1);
        }
        await plan.loescheTaetigkeit(knex, parallel.id, { bestaetigt: true });

        // --- Austragen: nur eigene, Frist
        await erwarteFehler(plan.traegeAus(knex, { einsatzId: bertM1.id, durchId: 'u-anna', jetzt: VOR_FRIST }), 403, null, null);
        await erwarteFehler(plan.traegeAus(knex, { einsatzId: annaM1.id, durchId: 'u-anna', jetzt: NACH_FRIST }), 403, /Turnierleitung/, "frist");

        // --- ladeOffeneSlots: volle fehlen, eigene bleiben, Sortierung Bezeichnung → Zeit
        const offen = await plan.ladeOffeneSlots(knex, turnier, 'u-anna');
        assert.ok(!offen.some(s => s.slotId === letzter), 'voller Slot fehlt');
        const eigenerVoll = offen.find(s => s.slotId === m1s1);
        assert.ok(eigenerVoll, 'voller eigener Slot bleibt');
        assert.deepEqual([eigenerVoll.eingetragen, eigenerVoll.frei, eigenerVoll.taetigkeit], [true, 0, 'Kampfgericht Matte 1']);
        assert.equal(offen.find(s => s.slotId === m1s2).eingetragen, false);
        assert.equal(offen.find(s => s.slotId === m1s2).frei, 2);
        const reihenfolge = offen.map(s => [s.taetigkeit, s.von_min]);
        const sortiert = [...reihenfolge].sort((a, b) => a[0].localeCompare(b[0], 'de', { numeric: true }) || a[1] - b[1]);
        assert.deepEqual(reihenfolge, sortiert);
        assert.equal(offen[0].taetigkeit, 'Aufbau');

        // --- aendereSlot mit Eingetragenen: Verkürzung/Bedarf nur mit Bestätigung
        const verkuerzt = plan.aendereSlot(knex, m1s1, { bis_min: 630 });
        await assert.rejects(verkuerzt, (e) => e.statusCode === 409 && /2/.test(e.message) && e.daten.anzahl === 2 && e.code === "bestaetigung_noetig");
        await erwarteFehler(plan.aendereSlot(knex, m1s1, { von_min: 525, bis_min: 645 }), 409, null, "bestaetigung_noetig");           // Verschieben (frei davor)
        await erwarteFehler(plan.aendereSlot(knex, m1s1, { von_min: 555, bis_min: 675 }), 409, null, "ueberlappung");  // in den Nachbarn
        await erwarteFehler(plan.aendereSlot(knex, m1s1, { bedarf: 1 }), 409, null, "bestaetigung_noetig");                            // Bedarf < Anzahl
        // Verlängern nach vorn ohne Bestätigung ok (kein Nachbar davor)
        const verlaengert = await plan.aendereSlot(knex, m1s1, { von_min: 510 });
        assert.deepEqual(verlaengert.betroffeneBenutzerIds.sort(), ['u-anna', 'u-bert']);
        const bestaetigt = await plan.aendereSlot(knex, m1s1, { von_min: 540, bis_min: 630, bestaetigt: true });
        assert.deepEqual(bestaetigt.betroffeneBenutzerIds.sort(), ['u-anna', 'u-bert']);
        assert.deepEqual((await plan.aendereSlot(knex, m1s1, { bedarf: 3 })).betroffeneBenutzerIds, []);
        await plan.aendereSlot(knex, m1s1, { bedarf: 1, bestaetigt: true });
        const geaendert = (await finde(knex, turnier, 'Kampfgericht Matte 1')).slots[0];
        assert.deepEqual([geaendert.von_min, geaendert.bis_min, geaendert.bedarf], [540, 630, 1]);
        assert.deepEqual(geaendert.einsaetze.map(e => e.name).sort(), ['anna Test', 'bert Test']);

        // --- manuell eintragen
        const m1s2Manuell = await plan.traegeManuellEin(knex, { slotId: m1s2, name: '  Oma Erna ', durchId: 'u-carl' });
        assert.ok(m1s2Manuell.id);
        await erwarteFehler(plan.traegeManuellEin(knex, { slotId: m1s2, name: '  ', durchId: 'u-carl' }), 400);
        const m1s2Detail = (await finde(knex, turnier, 'Kampfgericht Matte 1')).slots[1];
        assert.deepEqual(m1s2Detail.einsaetze.map(e => [e.benutzer_id, e.name]), [[null, 'Oma Erna']]);

        // --- Tätigkeiten: Matte/Waage nicht umbenennen/löschen, eigene mit Einsätzen nur mit Bestätigung
        await erwarteFehler(plan.aendereTaetigkeit(knex, matte1.id, { bezeichnung: 'Anders' }), 409);
        await erwarteFehler(plan.loescheTaetigkeit(knex, matte1.id, { bestaetigt: true }), 409);
        await plan.aendereTaetigkeit(knex, frei.id, { bezeichnung: 'Auf- und Abbau', bedarf: 2 });
        aufbau = await finde(knex, turnier, 'Auf- und Abbau');
        assert.equal(aufbau.bedarf, 2);
        // Bedarf senken: ohne Überbuchung ohne Bestätigung, mit Überbuchung nur bestätigt
        const matte2 = await finde(knex, turnier, 'Kampfgericht Matte 2');
        assert.deepEqual(await plan.aendereTaetigkeit(knex, matte2.id, { bedarf: 1 }), { betroffeneBenutzerIds: [] });
        assert.ok((await finde(knex, turnier, 'Kampfgericht Matte 2')).slots.every(s => s.bedarf === 1));
        await plan.traegeManuellEin(knex, { slotId: letzter, name: 'Opa Hans', durchId: 'u-carl' });
        await erwarteFehler(plan.aendereTaetigkeit(knex, frei.id, { bedarf: 1 }), 409, /2 Helfer/, 'bestaetigung_noetig');
        await assert.rejects(plan.aendereTaetigkeit(knex, frei.id, { bedarf: 1 }), (e) => e.daten.anzahl === 2);
        assert.equal((await finde(knex, turnier, 'Auf- und Abbau')).bedarf, 2, 'ohne Bestätigung unverändert');
        const gesenkt = await plan.aendereTaetigkeit(knex, frei.id, { bedarf: 1, bestaetigt: true });
        const gewinnerAufbau = (await knex('helfer_einsaetze').where({ slot_id: letzter }).whereNotNull('benutzer_id').first()).benutzer_id;
        assert.deepEqual(gesenkt.betroffeneBenutzerIds, [gewinnerAufbau]);
        aufbau = await finde(knex, turnier, 'Auf- und Abbau');
        assert.equal(aufbau.bedarf, 1);
        assert.ok(aufbau.slots.every(s => s.bedarf === 1));
        await erwarteFehler(plan.loescheTaetigkeit(knex, frei.id, {}), 409, null, "bestaetigung_noetig");

        // --- Slot mit Einsätzen löschen nur mit Bestätigung
        await erwarteFehler(plan.loescheSlot(knex, letzter, {}), 409, null, "bestaetigung_noetig");

        // --- ladeMeineDienste über zwei Turniere, hatOffeneDienste
        const frueher = await legeTurnierAn(knex, { vereinId: verein, datum: '2026-10-25', matten: 1, name: 'Frühpokal' });
        await plan.synchronisiereStandardTaetigkeiten(knex, frueher);
        const frueherMatte = await finde(knex, frueher, 'Kampfgericht Matte 1');
        // gleiche Uhrzeit wie in Turnier 1 ist an einem anderen Turnier keine Überlappung
        await plan.traegeEin(knex, { slotId: frueherMatte.slots[1].id, benutzerId: 'u-anna', durchId: 'u-anna', jetzt: VOR_FRIST });
        await plan.traegeEin(knex, { slotId: frueherMatte.slots[0].id, benutzerId: 'u-anna', durchId: 'u-anna', jetzt: VOR_FRIST });
        const meine = await plan.ladeMeineDienste(knex, 'u-anna');
        assert.deepEqual(meine.map(d => [d.turnier.name, d.turnier.datum, d.taetigkeit, d.von_min]), [
            ['Frühpokal', '2026-10-25', 'Kampfgericht Matte 1', 540],
            ['Frühpokal', '2026-10-25', 'Kampfgericht Matte 1', 660],
            ['Pokal', '2026-11-01', 'Kampfgericht Matte 1', 540],
            ['Pokal', '2026-11-01', 'Waage 1', 660]
        ]);
        assert.ok(meine.every(d => d.einsatzId && d.turnier.id && d.bis_min > d.von_min));

        assert.equal(await plan.hatOffeneDienste(knex, 'u-anna', verein), true);
        assert.equal(await plan.hatOffeneDienste(knex, 'u-anna', fremd), false);
        assert.equal(await plan.hatOffeneDienste(knex, 'u-dora', verein), false);
        // vergangenes Turnier zählt nicht
        const alt = await legeTurnierAn(knex, { vereinId: verein, datum: '2020-01-01', matten: 1, name: 'Alt' });
        await plan.synchronisiereStandardTaetigkeiten(knex, alt);
        const altSlot = (await finde(knex, alt, 'Kampfgericht Matte 1')).slots[0].id;
        await knex('helfer_einsaetze').insert({ slot_id: altSlot, benutzer_id: 'u-dora', eingetragen_von: 'u-carl' });
        assert.equal(await plan.hatOffeneDienste(knex, 'u-dora', verein), false);
        // abgesagtes Turnier: Helfer können sich nicht eintragen, Orga schon; zählt nicht als offener Dienst
        await knex('benutzer').insert({ id: 'u-frank', email: 'frank@test.de', vorname: 'frank', nachname: 'Test' });
        await knex('benutzer_vereine').insert({ benutzer_id: 'u-frank', verein_id: verein, freigegeben: 1, rolle: 'helfer' });
        const abgesagt = await legeTurnierAn(knex, { vereinId: verein, datum: '2026-11-08', matten: 1, name: 'Abgesagt' });
        await knex('turniere').where({ id: abgesagt }).update({ status: 'abgesagt' });
        await plan.synchronisiereStandardTaetigkeiten(knex, abgesagt);
        const abgesagtSlot = (await finde(knex, abgesagt, 'Kampfgericht Matte 1')).slots[0].id;
        await erwarteFehler(plan.traegeEin(knex, { slotId: abgesagtSlot, benutzerId: 'u-frank', durchId: 'u-frank', jetzt: VOR_FRIST }),
            409, null, 'turnier_nicht_aktiv');
        await knex('turniere').where({ id: abgesagt }).update({ status: 'abgeschlossen' });
        await erwarteFehler(plan.traegeEin(knex, { slotId: abgesagtSlot, benutzerId: 'u-frank', durchId: 'u-frank', jetzt: VOR_FRIST }),
            409, null, 'turnier_nicht_aktiv');
        await knex('turniere').where({ id: abgesagt }).update({ status: 'abgesagt' });
        await plan.traegeEin(knex, { slotId: abgesagtSlot, benutzerId: 'u-frank', durchId: 'u-carl', jetzt: VOR_FRIST, alsOrga: true });
        assert.equal(await plan.hatOffeneDienste(knex, 'u-frank', verein), false);
        await knex('turniere').where({ id: abgesagt }).update({ status: 'veroeffentlicht' });
        assert.equal(await plan.hatOffeneDienste(knex, 'u-frank', verein), true);
        // Status 'entwurf' (Standard) und 'veroeffentlicht' erlauben das Eintragen
        await plan.traegeEin(knex, { slotId: (await finde(knex, abgesagt, 'Kampfgericht Matte 1')).slots[1].id,
            benutzerId: 'u-frank', durchId: 'u-frank', jetzt: VOR_FRIST });

        // vereinsRollen nutzt die echte Prüfung: Austritt mit offenem Dienst → 409
        await knex('benutzer_vereine').insert({ benutzer_id: 'u-anna', verein_id: fremd, freigegeben: 1, rolle: 'helfer' });
        const austritt = await entferneMitglied(knex, { vereinId: verein, benutzerId: 'u-anna', durchId: 'u-anna' });
        assert.deepEqual([austritt.ok, austritt.status], [false, 409]);

        // eigener Einsatz vor der Frist austragbar
        await plan.traegeAus(knex, { einsatzId: annaM1.id, durchId: 'u-anna', jetzt: VOR_FRIST });
        assert.equal(await knex('helfer_einsaetze').where({ id: annaM1.id }).first(), undefined);
        // Orga trägt fremden Einsatz nach der Frist aus
        await plan.traegeAus(knex, { einsatzId: bertM1.id, durchId: 'u-carl', jetzt: NACH_FRIST, alsOrga: true });

        // --- Synchronisieren entfernt überzählige Waage nur ohne Einsätze
        const waage2 = await finde(knex, turnier, 'Waage 2');
        await plan.traegeEin(knex, { slotId: waage2.slots[3].id, benutzerId: 'u-bert', durchId: 'u-carl', jetzt: VOR_FRIST, alsOrga: true });
        await knex('turniere').where({ id: turnier }).update({ waagen_anzahl: 1 });
        await plan.synchronisiereStandardTaetigkeiten(knex, turnier);
        assert.ok(await finde(knex, turnier, 'Waage 2'), 'Waage 2 mit Einsatz bleibt');
        await knex('helfer_einsaetze').whereIn('slot_id', waage2.slots.map(s => s.id)).del();
        await plan.synchronisiereStandardTaetigkeiten(knex, turnier);
        assert.equal(await finde(knex, turnier, 'Waage 2'), undefined);
    } finally {
        await db.stoppe();
    }
});
