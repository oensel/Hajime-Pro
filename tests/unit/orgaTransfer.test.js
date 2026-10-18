import { test } from 'node:test';
import assert from 'node:assert/strict';
import { starteTestPostgres } from '../helpers/testPostgres.js';

// Orga-Planer im Turnier-Export/-Import: Hierarchie, Status und Fristen überleben, Zuständige nur als freier Text,
// erinnert_fuer wird verworfen, alte Exportdateien ohne Abschnitt lassen die Checkliste unberührt.
process.env.BETRIEBSMODUS = 'cloud';
delete process.env.IS_OFFLINE;
delete process.env.SYNC_ROLLE;

const { baueTurnierExport, importiereTurnierDaten } = await import('../../src/controllers/turnierController.js');
const { legeAusVorlageAn, ladeOrga, aendereAufgabe, setzeErledigt, legeAufgabeAn } = await import('../../src/services/orgaPlan.js');
const { exportiereOrga, ersetzeOrga } = await import('../../src/services/orgaTransfer.js');
const { datumAlsText } = await import('../../src/services/helferPlan.js');

const id = (r) => (typeof r === 'object' ? r.id : r);
const alle = (o) => o.phasen.flatMap((p) => p.aufgaben);

async function baueQuelle(knex) {
    const verein = id((await knex('vereine').insert({ name: 'JC Orga' }).returning('id'))[0]);
    await knex('benutzer').insert({ id: 'u-orga-1', email: 'zustaendig@test.de', vorname: 'Zora', nachname: 'Zustaendig', password_hash: 'hash-xyz' });
    await knex('benutzer_vereine').insert({ benutzer_id: 'u-orga-1', verein_id: verein, freigegeben: 1, rolle: 'helfer' });
    const tid = id((await knex('turniere').insert({
        bezeichnung: 'Orgapokal', ort: 'Halle', datum: '2031-03-01', anmeldeschluss: '2031-02-15', ausrichter: 'JC Orga', verein_id: verein
    }).returning('id'))[0]);
    await legeAusVorlageAn(knex, tid);
    const o = await ladeOrga(knex, tid);
    const cat = alle(o).find((a) => a.vorlage_key === 'catering');
    const wiegen = alle(o).find((a) => a.vorlage_key === 'wiegen');
    const medaillen = alle(o).find((a) => a.vorlage_key === 'medaillen');
    await legeAufgabeAn(knex, tid, { eltern_id: cat.id, art: 'mitbringen', titel: 'Kuchen', benutzerId: 'u-orga-1' });
    await setzeErledigt(knex, medaillen.kinder[0].id, { erledigt: true, benutzerId: 'u-orga-1' });
    await aendereAufgabe(knex, wiegen.id, { benutzer_id: 'u-orga-1', faellig_am: '2031-02-28' });
    await aendereAufgabe(knex, cat.id, { name_frei: 'Oma Erna', email_frei: 'erna@test.de' });
    await knex('orga_aufgaben').where({ id: cat.id }).update({ erinnert_fuer: '2031-02-10' });
    return tid;
}

// Vergleichbare Form ohne IDs.
async function form(knex, tid) {
    const z = await knex('orga_aufgaben as a').leftJoin('orga_aufgaben as p', 'p.id', 'a.eltern_id')
        .where('a.turnier_id', tid).orderBy('a.reihenfolge').orderBy('a.id')
        .select('a.titel', 'p.titel as eltern', 'a.phase', 'a.art', 'a.frist_anker', 'a.frist_tage', 'a.faellig_am',
            'a.faellig_manuell', 'a.erledigt_am', 'a.vorlage_key');
    return z.map((r) => ({ ...r, faellig_am: datumAlsText(r.faellig_am), erledigt_am: !!r.erledigt_am }))
        .sort((a, b) => `${a.eltern}|${a.titel}`.localeCompare(`${b.eltern}|${b.titel}`));
}

test('Orga-Rundreise: Hierarchie, Status, Fristen; Zuständige nur als freier Text; erinnert_fuer verworfen', async () => {
    const quelle = await starteTestPostgres();
    const ziel = await starteTestPostgres();
    try {
        const qid = await baueQuelle(quelle.knex);
        const daten = JSON.parse(JSON.stringify(await baueTurnierExport(quelle.knex, qid)));
        const text = JSON.stringify(daten.orga);
        assert.ok(!text.includes('benutzer_id') && !text.includes('u-orga-1'), 'Benutzer-ID im Export');
        assert.ok(!text.includes('erinnert_fuer') && !text.includes('erledigt_von'), 'interne Felder im Export');
        assert.ok(!text.includes('hash-xyz'));
        const wiegenExport = daten.orga.aufgaben.find((a) => a.vorlage_key === 'wiegen');
        assert.equal(wiegenExport.name_frei, 'Zora Zustaendig');
        assert.equal(wiegenExport.email_frei, null);
        assert.ok(!text.includes('zustaendig@test.de'), 'Konto-E-Mail im Export');

        const { turnierId } = await importiereTurnierDaten(ziel.knex, null, daten);
        const z = await ziel.knex('orga_aufgaben').where({ turnier_id: turnierId });
        assert.equal(z.length, daten.orga.aufgaben.length);
        assert.ok(z.every((r) => r.benutzer_id === null && r.erinnert_fuer === null && r.erledigt_von === null));
        const cat = z.find((r) => r.vorlage_key === 'catering');
        assert.equal(z.filter((r) => r.eltern_id === cat.id && r.art === 'mitbringen' && r.titel === 'Kuchen').length, 1);
        assert.equal(cat.name_frei, 'Oma Erna');
        const o = await ladeOrga(ziel.knex, turnierId);
        const med = alle(o).find((a) => a.vorlage_key === 'medaillen');
        assert.equal(med.status.status, 'angefangen');
        assert.equal(med.kinder.filter((k) => k.status.status === 'erledigt').length, 1);
        assert.equal(alle(o).find((a) => a.vorlage_key === 'wiegen').faellig_am, '2031-02-28');
        assert.deepEqual(await form(ziel.knex, turnierId), await form(quelle.knex, qid));
    } finally {
        await quelle.stoppe();
        await ziel.stoppe();
    }
});

test('Alte Exportdatei ohne orga: nichts angelegt, ersetzeOrga(undefined) lässt vorhandene Aufgaben unberührt', async () => {
    const quelle = await starteTestPostgres();
    const ziel = await starteTestPostgres();
    try {
        const qid = await baueQuelle(quelle.knex);
        const daten = JSON.parse(JSON.stringify(await baueTurnierExport(quelle.knex, qid)));
        delete daten.orga;
        const { turnierId } = await importiereTurnierDaten(ziel.knex, null, daten);
        assert.equal((await ziel.knex('orga_aufgaben').where({ turnier_id: turnierId })).length, 0);

        await legeAusVorlageAn(ziel.knex, turnierId);
        const vorher = (await ziel.knex('orga_aufgaben').where({ turnier_id: turnierId })).length;
        assert.ok(vorher > 0);
        assert.equal(await ziel.knex.transaction((trx) => ersetzeOrga(trx, turnierId, undefined)), null);
        assert.equal((await ziel.knex('orga_aufgaben').where({ turnier_id: turnierId })).length, vorher);
    } finally {
        await quelle.stoppe();
        await ziel.stoppe();
    }
});

test('ersetzeOrga ersetzt vorhandene Aufgaben und überspringt ungültige Einträge', async () => {
    const db = await starteTestPostgres();
    try {
        const { knex } = db;
        const tid = id((await knex('turniere').insert({ bezeichnung: 'T', ort: 'O', datum: '2031-05-05', ausrichter: 'A' }).returning('id'))[0]);
        await legeAusVorlageAn(knex, tid);
        const r = await knex.transaction((trx) => ersetzeOrga(trx, tid, { aufgaben: [
            { ref: 0, eltern_ref: null, phase: 'turniertag', art: 'aufgabe', titel: 'Eins', erledigt_am: '2031-05-05T10:00:00.000Z' },
            { ref: 1, eltern_ref: 0, phase: 'turniertag', art: 'posten', titel: 'Kind' },
            { ref: 2, eltern_ref: 99, phase: 'turniertag', art: 'posten', titel: 'Waise' },
            { ref: 3, eltern_ref: null, phase: 'quatsch', art: 'aufgabe', titel: 'Falsche Phase' },
            { ref: 4, eltern_ref: null, phase: 'turniertag', art: 'aufgabe', titel: '   ' }
        ] }));
        assert.deepEqual(r, { aufgaben: 2 });
        const z = await knex('orga_aufgaben').where({ turnier_id: tid }).orderBy('id');
        assert.deepEqual(z.map((x) => x.titel), ['Eins', 'Kind']);
        assert.equal(z[1].eltern_id, z[0].id);
        assert.ok(z[0].erledigt_am);
        assert.equal((await exportiereOrga(knex, tid)).aufgaben.length, 2);
    } finally {
        await db.stoppe();
    }
});

test('ersetzeOrga: keine dritte Ebene, Mitbringen nur unter der Mitbringliste', async () => {
    const db = await starteTestPostgres();
    try {
        const { knex } = db;
        const tid = id((await knex('turniere').insert({ bezeichnung: 'T', ort: 'O', datum: '2031-05-05', ausrichter: 'A' }).returning('id'))[0]);
        const r = await knex.transaction((trx) => ersetzeOrga(trx, tid, { aufgaben: [
            { ref: 0, eltern_ref: null, phase: 'meldephase', art: 'aufgabe', titel: 'Cat', vorlage_key: 'catering' },
            { ref: 1, eltern_ref: null, phase: 'turniertag', art: 'aufgabe', titel: 'Normal', vorlage_key: 'wiegen' },
            { ref: 2, eltern_ref: 0, phase: 'meldephase', art: 'mitbringen', titel: 'Kuchen' },
            { ref: 3, eltern_ref: 1, phase: 'turniertag', art: 'mitbringen', titel: 'Falsch' },
            { ref: 4, eltern_ref: 2, phase: 'meldephase', art: 'posten', titel: 'Enkel' },
            { ref: 5, eltern_ref: 0, phase: 'meldephase', art: 'posten', titel: 'Posten' }
        ] }));
        assert.deepEqual(r, { aufgaben: 4 });
        const z = await knex('orga_aufgaben').where({ turnier_id: tid }).orderBy('id');
        assert.deepEqual(z.map((x) => x.titel).sort(), ['Cat', 'Kuchen', 'Normal', 'Posten']);
    } finally {
        await db.stoppe();
    }
});
